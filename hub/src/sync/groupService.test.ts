import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import type { SyncEvent } from '@hapi/protocol/types'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../store'
import type { SSEManager } from '../sse/sseManager'
import { EventPublisher } from './eventPublisher'
import { GroupService } from './groupService'

type ExecuteNoteRefreshPayload = {
    groupId: string
    namespace: string
    traceId: string
    noteSessionId: string
    source: string
    command: string
}

function closeStore(store: Store): void {
    const db = (store as unknown as { db: Database }).db
    db.close()
}

function createService(
    store: Store,
    options?: {
        executeNoteRefresh?: (payload: ExecuteNoteRefreshPayload) => Promise<{ accepted: boolean; reason?: string }>
        events?: SyncEvent[]
        dispatchTask?: (payload: {
            groupId: string
            namespace: string
            taskId: string
            traceId: string
            source: string
            targetSessionId: string
            command: string
        }) => Promise<void>
        resolveSessionRoutingState?: (sessionId: string, namespace: string) => { active: boolean } | null
    }
): GroupService {
    const publisher = new EventPublisher(
        {
            broadcast: (event: SyncEvent) => {
                if (options?.events) {
                    options.events.push(event)
                }
            }
        } as unknown as SSEManager,
        () => 'default'
    )

    return new GroupService(
        store,
        publisher,
        options?.dispatchTask ?? (async () => {}),
        options?.executeNoteRefresh,
        options?.resolveSessionRoutingState
    )
}

describe('GroupService createGroup', () => {
    it('sets the first session member as note executor when noteSessionId is omitted', () => {
        const store = new Store(':memory:')
        const first = store.sessions.getOrCreateSession('session-1', { path: '/repo/a' }, null, 'default')
        const second = store.sessions.getOrCreateSession('session-2', { path: '/repo/b' }, null, 'default')
        const service = createService(store)

        const result = service.createGroup({
            namespace: 'default',
            name: 'Team Alpha',
            sessionMemberIds: [first.id, second.id]
        })

        expect(result.group.noteSessionId).toBe(first.id)

        const firstMember = result.members.find((member) => member.sessionId === first.id)
        const secondMember = result.members.find((member) => member.sessionId === second.id)

        expect(firstMember?.role).toBe('note_executor')
        expect(secondMember?.role).toBe('member')
    })

    it('marks the first manually added member as note executor', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('session-3', { path: '/repo/c' }, null, 'default')
        const service = createService(store)

        const created = service.createGroup({
            namespace: 'default',
            name: 'Team Beta'
        })

        const updated = service.addMember({
            groupId: created.group.id,
            namespace: 'default',
            sessionId: session.id
        })
        const addedMember = updated.members.find((member) => member.sessionId === session.id)

        expect(updated.group.noteSessionId).toBe(session.id)
        expect(addedMember?.role).toBe('note_executor')
    })

    it('validates note executor must be a group member session', () => {
        const store = new Store(':memory:')
        const member = store.sessions.getOrCreateSession('session-4', { path: '/repo/d' }, null, 'default')
        const outsider = store.sessions.getOrCreateSession('session-5', { path: '/repo/e' }, null, 'default')
        const service = createService(store)

        const created = service.createGroup({
            namespace: 'default',
            name: 'Team Gamma',
            sessionMemberIds: [member.id]
        })

        expect(() => service.updateGroup({
            groupId: created.group.id,
            namespace: 'default',
            noteSessionId: outsider.id
        })).toThrow('Note session must be a group session member')
    })

    it('removes a member and emits group-updated', () => {
        const store = new Store(':memory:')
        const first = store.sessions.getOrCreateSession('session-remove-1', { path: '/repo/remove-1' }, null, 'default')
        const second = store.sessions.getOrCreateSession('session-remove-2', { path: '/repo/remove-2' }, null, 'default')
        const events: SyncEvent[] = []
        const service = createService(store, { events })

        const created = service.createGroup({
            namespace: 'default',
            name: 'Team Remove',
            sessionMemberIds: [first.id, second.id]
        })

        const updated = service.removeMember({
            groupId: created.group.id,
            namespace: 'default',
            sessionId: second.id
        })

        expect(updated.members.some((member) => member.sessionId === second.id)).toBe(false)
        const updatedEvent = events.find((event) => event.type === 'group-updated' && event.groupId === created.group.id)
        expect(updatedEvent).toBeDefined()
    })

    it('reassigns note executor when the current executor is removed', () => {
        const store = new Store(':memory:')
        const first = store.sessions.getOrCreateSession('session-note-remove-1', { path: '/repo/note-remove-1' }, null, 'default')
        const second = store.sessions.getOrCreateSession('session-note-remove-2', { path: '/repo/note-remove-2' }, null, 'default')
        const service = createService(store)

        const created = service.createGroup({
            namespace: 'default',
            name: 'Team Reassign',
            sessionMemberIds: [first.id, second.id]
        })
        expect(created.group.noteSessionId).toBe(first.id)

        const afterFirstRemoval = service.removeMember({
            groupId: created.group.id,
            namespace: 'default',
            sessionId: first.id
        })
        expect(afterFirstRemoval.group.noteSessionId).toBe(second.id)

        const afterSecondRemoval = service.removeMember({
            groupId: created.group.id,
            namespace: 'default',
            sessionId: second.id
        })
        expect(afterSecondRemoval.group.noteSessionId).toBeNull()
    })

    it('returns quoted metadata and dispatches command with quoted context', async () => {
        const store = new Store(':memory:')
        const worker = store.sessions.getOrCreateSession('session-quote-worker', { path: '/repo/quote' }, null, 'default')
        const dispatched: Array<{ command: string; targetSessionId: string }> = []
        const service = createService(store, {
            dispatchTask: async (payload) => {
                dispatched.push({
                    command: payload.command,
                    targetSessionId: payload.targetSessionId
                })
            },
            resolveSessionRoutingState: (sessionId) => (sessionId === worker.id ? { active: true } : null)
        })

        const created = service.createGroup({
            namespace: 'default',
            name: 'Quote Group',
            sessionMemberIds: [worker.id]
        })

        const referenced = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'chat',
            source: `session:${worker.id}`,
            actorSessionId: worker.id,
            actorName: 'Worker',
            payload: { text: '需要保留的引用上下文' }
        })

        const reply = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'command',
            source: 'user:web',
            payload: { text: `@${worker.id} 继续实现` },
            quotedMessageId: referenced.message.id
        })

        expect(reply.message.quotedMessageId).toBe(referenced.message.id)
        expect(reply.message.quotedMessage?.text).toBe('需要保留的引用上下文')
        expect(reply.message.quotedMessage?.actorName).toBe('Worker')
        expect(reply.createdTasks).toHaveLength(1)
        expect(dispatched).toHaveLength(1)
        expect(dispatched[0]?.targetSessionId).toBe(worker.id)
        expect(dispatched[0]?.command).toContain('> Worker: 需要保留的引用上下文')
        expect(dispatched[0]?.command).toContain(`@${worker.id} 继续实现`)

        const page = service.getMessagesPage(created.group.id, 'default', {
            limit: 20,
            beforeSeq: null
        })
        const repliedMessage = page.messages.find((message) => message.id === reply.message.id)
        expect(repliedMessage?.quotedMessageId).toBe(referenced.message.id)
        expect(repliedMessage?.quotedMessage?.text).toBe('需要保留的引用上下文')
    })

    it('dispatches session-origin chat mentions using member aliases', async () => {
        const store = new Store(':memory:')
        const delegator = store.sessions.getOrCreateSession(
            'session-delegator',
            { path: '/repo/delegator', name: 'AgentA' },
            null,
            'default'
        )
        const worker = store.sessions.getOrCreateSession(
            'session-worker-target',
            { path: '/repo/worker', name: 'AgentB' },
            null,
            'default'
        )
        const dispatched: Array<{ command: string; targetSessionId: string }> = []
        const service = createService(store, {
            dispatchTask: async (payload) => {
                dispatched.push({
                    command: payload.command,
                    targetSessionId: payload.targetSessionId
                })
            },
            resolveSessionRoutingState: (sessionId) => (
                sessionId === delegator.id || sessionId === worker.id
                    ? { active: true }
                    : null
            )
        })

        const created = service.createGroup({
            namespace: 'default',
            name: 'Delegation Group',
            sessionMemberIds: [delegator.id, worker.id]
        })

        const result = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'chat',
            source: `session:${delegator.id}`,
            actorSessionId: delegator.id,
            actorName: 'AgentA',
            payload: { text: '@AgentB 请接手 API 对接' }
        })

        expect(result.message.type).toBe('chat')
        expect(result.createdTasks).toHaveLength(1)
        expect(result.createdTasks[0]?.targetSessionId).toBe(worker.id)
        expect(dispatched).toHaveLength(1)
        expect(dispatched[0]?.targetSessionId).toBe(worker.id)
        expect(dispatched[0]?.command).toContain('@AgentB')
    })

    it('leaves a task lead out of @all, and still reaches it with an explicit mention', async () => {
        const store = new Store(':memory:')
        const worker = store.sessions.getOrCreateSession('session-worker', { path: '/repo/w', name: 'Worker' }, null, 'default')
        const lead = store.sessions.getOrCreateSession('session-lead', { path: '/repo/l', name: 'Lead' }, null, 'default')
        const service = createService(store, { resolveSessionRoutingState: () => ({ active: true }) })
        const created = service.createGroup({ namespace: 'default', name: 'Task', sessionMemberIds: [worker.id] })
        store.groups.addGroupMember({ groupId: created.group.id, namespace: 'default', sessionId: lead.id, role: 'lead' })

        const all = await service.addTimelineMessage({ groupId: created.group.id, namespace: 'default', type: 'command', payload: { text: '@all 开工' } })
        expect(all.createdTasks.map((task) => task.targetSessionId)).toEqual([worker.id])
        const direct = await service.addTimelineMessage({ groupId: created.group.id, namespace: 'default', type: 'command', payload: { text: '看一下' }, targetSessionIds: [lead.id] })
        expect(direct.createdTasks.map((task) => task.targetSessionId)).toEqual([lead.id])
    })

    it('excludes origin session from @all dispatch targets', async () => {
        const store = new Store(':memory:')
        const origin = store.sessions.getOrCreateSession(
            'session-origin',
            { path: '/repo/origin', name: 'Origin' },
            null,
            'default'
        )
        const workerA = store.sessions.getOrCreateSession(
            'session-worker-a',
            { path: '/repo/worker-a', name: 'WorkerA' },
            null,
            'default'
        )
        const workerB = store.sessions.getOrCreateSession(
            'session-worker-b',
            { path: '/repo/worker-b', name: 'WorkerB' },
            null,
            'default'
        )
        const dispatched: Array<{ command: string; targetSessionId: string }> = []
        const service = createService(store, {
            dispatchTask: async (payload) => {
                dispatched.push({
                    command: payload.command,
                    targetSessionId: payload.targetSessionId
                })
            },
            resolveSessionRoutingState: (sessionId) => (
                sessionId === origin.id || sessionId === workerA.id || sessionId === workerB.id
                    ? { active: true }
                    : null
            )
        })

        const created = service.createGroup({
            namespace: 'default',
            name: 'All Mention Group',
            sessionMemberIds: [origin.id, workerA.id, workerB.id]
        })

        const result = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'chat',
            source: `session:${origin.id}`,
            actorSessionId: origin.id,
            actorName: 'Origin',
            payload: { text: '@all 请同步进展' }
        })

        const taskTargets = result.createdTasks.map((task) => task.targetSessionId).sort()
        expect(taskTargets).toEqual([workerA.id, workerB.id].sort())
        expect(taskTargets).not.toContain(origin.id)

        const dispatchedTargets = dispatched.map((entry) => entry.targetSessionId).sort()
        expect(dispatchedTargets).toEqual([workerA.id, workerB.id].sort())
        expect(dispatchedTargets).not.toContain(origin.id)
    })

    it('excludes origin session from explicit command targets', async () => {
        const store = new Store(':memory:')
        const origin = store.sessions.getOrCreateSession(
            'session-origin-explicit',
            { path: '/repo/origin-explicit', name: 'Origin' },
            null,
            'default'
        )
        const worker = store.sessions.getOrCreateSession(
            'session-worker-explicit',
            { path: '/repo/worker-explicit', name: 'Worker' },
            null,
            'default'
        )
        const dispatched: Array<{ command: string; targetSessionId: string }> = []
        const service = createService(store, {
            dispatchTask: async (payload) => {
                dispatched.push({
                    command: payload.command,
                    targetSessionId: payload.targetSessionId
                })
            },
            resolveSessionRoutingState: (sessionId) => (
                sessionId === origin.id || sessionId === worker.id
                    ? { active: true }
                    : null
            )
        })

        const created = service.createGroup({
            namespace: 'default',
            name: 'Explicit Target Group',
            sessionMemberIds: [origin.id, worker.id]
        })

        const result = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'command',
            source: `session:${origin.id}`,
            actorSessionId: origin.id,
            actorName: 'Origin',
            targetSessionIds: [origin.id, worker.id],
            payload: { text: '@all 请同步进展' }
        })

        const taskTargets = result.createdTasks.map((task) => task.targetSessionId)
        expect(taskTargets).toEqual([worker.id])

        const dispatchedTargets = dispatched.map((entry) => entry.targetSessionId)
        expect(dispatchedTargets).toEqual([worker.id])
        expect(dispatchedTargets).not.toContain(origin.id)
    })

    it('injects target session identity context into dispatched task command', async () => {
        const store = new Store(':memory:')
        const worker = store.sessions.getOrCreateSession(
            'session-context-worker',
            { path: '/repo/context-worker' },
            null,
            'default'
        )
        const dispatched: Array<{ command: string; targetSessionId: string }> = []
        const service = createService(store, {
            dispatchTask: async (payload) => {
                dispatched.push({
                    command: payload.command,
                    targetSessionId: payload.targetSessionId
                })
            },
            resolveSessionRoutingState: (sessionId) => (sessionId === worker.id ? { active: true } : null)
        })

        const created = service.createGroup({
            namespace: 'default',
            name: 'Identity Context Group',
            sessionMemberIds: [worker.id]
        })

        const result = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'command',
            source: 'user:web',
            targetSessionIds: [worker.id],
            payload: { text: `@${worker.id} 请处理重试逻辑` }
        })

        expect(result.createdTasks).toHaveLength(1)
        expect(dispatched).toHaveLength(1)
        expect(dispatched[0]?.targetSessionId).toBe(worker.id)
        expect(dispatched[0]?.command).toContain('[HAQI_GROUP_TASK_CONTEXT]')
        expect(dispatched[0]?.command).toContain('Group Note Markdown Path: (disabled: in-memory store)')
        expect(dispatched[0]?.command).toContain(`Your HAQI Session ID (self): ${worker.id}`)
        expect(dispatched[0]?.command).toContain(`@${worker.id} 请处理重试逻辑`)
    })

    it('injects group task context only on first dispatched message per target session', async () => {
        const store = new Store(':memory:')
        const worker = store.sessions.getOrCreateSession(
            'session-context-once-worker',
            { path: '/repo/context-once-worker' },
            null,
            'default'
        )
        const dispatched: Array<{ command: string; targetSessionId: string }> = []
        const service = createService(store, {
            dispatchTask: async (payload) => {
                dispatched.push({
                    command: payload.command,
                    targetSessionId: payload.targetSessionId
                })
            },
            resolveSessionRoutingState: (sessionId) => (sessionId === worker.id ? { active: true } : null)
        })

        const created = service.createGroup({
            namespace: 'default',
            name: 'Identity Context Once Group',
            sessionMemberIds: [worker.id]
        })

        const first = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'command',
            source: 'user:web',
            targetSessionIds: [worker.id],
            payload: { text: `@${worker.id} 第一条任务` }
        })
        const second = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'command',
            source: 'user:web',
            targetSessionIds: [worker.id],
            payload: { text: `@${worker.id} 第二条任务` }
        })

        expect(first.createdTasks).toHaveLength(1)
        expect(second.createdTasks).toHaveLength(1)
        expect(dispatched).toHaveLength(2)
        expect(dispatched[0]?.targetSessionId).toBe(worker.id)
        expect(dispatched[1]?.targetSessionId).toBe(worker.id)
        expect(dispatched[0]?.command).toContain('[HAQI_GROUP_TASK_CONTEXT]')
        expect(dispatched[1]?.command).not.toContain('[HAQI_GROUP_TASK_CONTEXT]')
        expect(dispatched[1]?.command).toContain(`@${worker.id} 第二条任务`)
    })

    it('keeps slash command text unchanged when dispatching task', async () => {
        const store = new Store(':memory:')
        const worker = store.sessions.getOrCreateSession(
            'session-slash-worker',
            { path: '/repo/slash-worker' },
            null,
            'default'
        )
        const dispatched: Array<{ command: string; targetSessionId: string }> = []
        const service = createService(store, {
            dispatchTask: async (payload) => {
                dispatched.push({
                    command: payload.command,
                    targetSessionId: payload.targetSessionId
                })
            },
            resolveSessionRoutingState: (sessionId) => (sessionId === worker.id ? { active: true } : null)
        })

        const created = service.createGroup({
            namespace: 'default',
            name: 'Slash Command Group',
            sessionMemberIds: [worker.id]
        })

        const result = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'command',
            source: 'user:web',
            targetSessionIds: [worker.id],
            payload: { text: '/status' }
        })

        expect(result.createdTasks).toHaveLength(1)
        expect(dispatched).toHaveLength(1)
        expect(dispatched[0]?.targetSessionId).toBe(worker.id)
        expect(dispatched[0]?.command).toBe('/status')
    })

    it('does not dispatch user-origin chat mentions', async () => {
        const store = new Store(':memory:')
        const worker = store.sessions.getOrCreateSession('session-chat-worker', { path: '/repo/chat-worker' }, null, 'default')
        const dispatched: Array<{ command: string; targetSessionId: string }> = []
        const service = createService(store, {
            dispatchTask: async (payload) => {
                dispatched.push({
                    command: payload.command,
                    targetSessionId: payload.targetSessionId
                })
            },
            resolveSessionRoutingState: (sessionId) => (sessionId === worker.id ? { active: true } : null)
        })

        const created = service.createGroup({
            namespace: 'default',
            name: 'User Chat Group',
            sessionMemberIds: [worker.id]
        })

        const result = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'chat',
            source: 'user:web',
            payload: { text: `@${worker.id} 这是一条普通聊天` }
        })

        expect(result.createdTasks).toHaveLength(0)
        expect(dispatched).toHaveLength(0)
    })

    it('builds structured note refresh prompt from timeline and tasks', async () => {
        const store = new Store(':memory:')
        const noteExecutor = store.sessions.getOrCreateSession('session-note', { path: '/repo/note' }, null, 'default')
        const worker = store.sessions.getOrCreateSession('session-worker', { path: '/repo/work' }, null, 'default')
        const capturedPayloads: ExecuteNoteRefreshPayload[] = []
        const service = createService(store, {
            executeNoteRefresh: async (payload) => {
                capturedPayloads.push(payload)
                return { accepted: true }
            }
        })

        const created = service.createGroup({
            namespace: 'default',
            name: 'Team Delta',
            noteSessionId: noteExecutor.id,
            sessionMemberIds: [noteExecutor.id, worker.id]
        })

        store.groups.addGroupMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'command',
            source: 'user:web',
            targetSessionIds: [worker.id],
            payload: { text: '@session-worker finish dashboard api migration' }
        })
        store.groups.addGroupTask({
            groupId: created.group.id,
            namespace: 'default',
            traceId: 'trace-1',
            source: 'user:web',
            targetSessionId: worker.id,
            command: 'finish dashboard api migration',
            status: 'running'
        })

        const refreshResult = await service.refreshGroupNote({
            groupId: created.group.id,
            namespace: 'default',
            source: 'user:web'
        })

        expect(refreshResult.triggered).toBe(true)
        expect(capturedPayloads.length).toBe(1)
        const captured = capturedPayloads[0]
        if (!captured) {
            throw new Error('expected refresh payload to be captured')
        }
        expect(captured.noteSessionId).toBe(noteExecutor.id)
        expect(captured.command).toContain('## 每个agent的职责')
        expect(captured.command).toContain('## 当前目标、进展以及待办事项')
        expect(captured.command).toContain('Recent Group Timeline')
        expect(captured.command).toContain(worker.id)

        const timeline = service.getMessagesPage(created.group.id, 'default', {
            limit: 20,
            beforeSeq: null
        }).messages
        const refreshSystem = timeline.find((message) => message.type === 'system' && message.traceId === captured.traceId)
        const refreshPayload = refreshSystem?.payload as { text?: unknown } | undefined
        expect(refreshPayload?.text).toBe('Generating group note...')
    })

    it('persists group note markdown to disk when store is file-backed', () => {
        const dir = mkdtempSync(join(tmpdir(), 'haqi-group-note-md-'))
        const previousHapiHome = process.env.HAPI_HOME
        process.env.HAPI_HOME = dir
        const dbPath = join(dir, 'hapi.db')
        const store = new Store(dbPath)
        try {
            const service = createService(store)
            const content = '## Note\n- [ ] verify group note markdown'

            const created = service.createGroup({
                namespace: 'default',
                name: 'File Backed Group'
            })
            service.updateGroupNote({
                groupId: created.group.id,
                namespace: 'default',
                content,
                updatedBy: 'test'
            })

            const notePath = join(dir, 'memory', 'groups', 'default', created.group.id, 'GROUP-NOTE.md')
            const fileContent = readFileSync(notePath, 'utf8')
            expect(fileContent).toBe(content)
        } finally {
            closeStore(store)
            if (previousHapiHome === undefined) {
                delete process.env.HAPI_HOME
            } else {
                process.env.HAPI_HOME = previousHapiHome
            }
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('syncs newer markdown file content back into group note', () => {
        const dir = mkdtempSync(join(tmpdir(), 'haqi-group-note-sync-pull-'))
        const previousHapiHome = process.env.HAPI_HOME
        process.env.HAPI_HOME = dir
        const dbPath = join(dir, 'hapi.db')
        const store = new Store(dbPath)
        try {
            const service = createService(store)
            const created = service.createGroup({
                namespace: 'default',
                name: 'File Sync Pull Group'
            })

            service.updateGroupNote({
                groupId: created.group.id,
                namespace: 'default',
                content: '## Old note content',
                updatedBy: 'test'
            })

            const notePath = join(dir, 'memory', 'groups', 'default', created.group.id, 'GROUP-NOTE.md')
            const before = store.groups.getGroupNote(created.group.id, 'default')
            const waitUntil = (before?.updatedAt ?? Date.now()) + 5
            while (Date.now() <= waitUntil) {
                // Busy wait to ensure file mtime is newer than note.updatedAt.
            }

            const finalMarkdown = '## 每个agent的职责\n- session-a: 完成同步\n\n## 当前目标、进展以及待办事项\n- [ ] 验收'
            writeFileSync(notePath, finalMarkdown, { encoding: 'utf8' })

            const syncResult = service.syncGroupNoteMarkdownFiles()
            expect(syncResult.pulledFromFile).toBe(1)

            const note = store.groups.getGroupNote(created.group.id, 'default')
            expect(note?.content).toBe(finalMarkdown)
            expect(note?.updatedBy).toBe('system:file-sync')
        } finally {
            closeStore(store)
            if (previousHapiHome === undefined) {
                delete process.env.HAPI_HOME
            } else {
                process.env.HAPI_HOME = previousHapiHome
            }
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('recreates missing markdown file from stored group note', () => {
        const dir = mkdtempSync(join(tmpdir(), 'haqi-group-note-sync-push-'))
        const previousHapiHome = process.env.HAPI_HOME
        process.env.HAPI_HOME = dir
        const dbPath = join(dir, 'hapi.db')
        const store = new Store(dbPath)
        try {
            const service = createService(store)
            const content = '## Canonical note\n- persisted in db'

            const created = service.createGroup({
                namespace: 'default',
                name: 'File Sync Push Group'
            })
            service.updateGroupNote({
                groupId: created.group.id,
                namespace: 'default',
                content,
                updatedBy: 'test'
            })

            const notePath = join(dir, 'memory', 'groups', 'default', created.group.id, 'GROUP-NOTE.md')
            unlinkSync(notePath)
            expect(existsSync(notePath)).toBe(false)

            const syncResult = service.syncGroupNoteMarkdownFiles()
            expect(syncResult.pushedToFile).toBe(1)
            expect(existsSync(notePath)).toBe(true)
            expect(readFileSync(notePath, 'utf8')).toBe(content)
        } finally {
            closeStore(store)
            if (previousHapiHome === undefined) {
                delete process.env.HAPI_HOME
            } else {
                process.env.HAPI_HOME = previousHapiHome
            }
            rmSync(dir, { recursive: true, force: true })
        }
    })

    it('deletes group and related records, then emits group-removed', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('session-delete', { path: '/repo/delete' }, null, 'default')
        const events: SyncEvent[] = []
        const service = createService(store, { events })

        const created = service.createGroup({
            namespace: 'default',
            name: 'Delete Group',
            sessionMemberIds: [session.id]
        })

        store.groups.addGroupMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'chat',
            source: 'user:web',
            payload: { text: 'before delete' }
        })
        store.groups.addGroupTask({
            groupId: created.group.id,
            namespace: 'default',
            traceId: 'trace-delete',
            source: 'user:web',
            targetSessionId: session.id,
            command: 'cleanup',
            status: 'pending'
        })
        service.updateGroupNote({
            groupId: created.group.id,
            namespace: 'default',
            content: 'delete me',
            updatedBy: 'test'
        })

        service.deleteGroup('default', created.group.id)

        expect(store.groups.getGroupByNamespace(created.group.id, 'default')).toBeNull()
        expect(store.groups.getGroupMembersByNamespace(created.group.id, 'default')).toHaveLength(0)
        expect(store.groups.getGroupMessages(created.group.id, 'default')).toHaveLength(0)
        expect(store.groups.getGroupTasks(created.group.id, 'default')).toHaveLength(0)
        expect(store.groups.getGroupNote(created.group.id, 'default')).toBeNull()

        const removed = events.find((event) => event.type === 'group-removed' && event.groupId === created.group.id)
        expect(removed).toBeDefined()
        expect(removed?.namespace).toBe('default')
    })
})

describe('GroupService employee mentions', () => {
    it('keeps an offline employee session mentionable, so the dispatcher can wake it', async () => {
        const store = new Store(':memory:')
        const employee = store.employees.insert({
            namespace: 'default', name: '小鱼', emoji: null, status: 'active', homePath: 'HAQI/员工/小鱼',
            machineId: 'm1', directory: '/repo', agent: 'claude', model: null, permissionMode: null,
            accountGroup: null, timezone: 'UTC', dailyResetHour: 4, compactThreshold: 0.75, webhookSlug: null
        })
        const main = store.sessions.getOrCreateSession(
            'session-employee-main',
            { path: '/repo', name: '小鱼', employeeId: employee.id },
            null,
            'default'
        )
        const dispatched: Array<{ targetSessionId: string; command: string }> = []
        const service = createService(store, {
            dispatchTask: async (payload) => { dispatched.push({ targetSessionId: payload.targetSessionId, command: payload.command }) },
            // The session is offline: the routing state says inactive.
            resolveSessionRoutingState: () => ({ active: false })
        })
        const created = service.createGroup({ namespace: 'default', name: '哈气群', sessionMemberIds: [main.id] })

        const result = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'chat',
            source: 'user:web',
            actorSessionId: 'user',
            payload: { text: '@小鱼 日报发了吗' }
        })

        // The mention resolved to the offline employee session; waking it is the dispatcher's job.
        expect(result.createdTasks.map((task) => task.targetSessionId)).toEqual([main.id])
        expect(dispatched).toHaveLength(1)
        expect(dispatched[0]?.targetSessionId).toBe(main.id)

        // A plain offline session (no employee) stays unreachable.
        const plain = store.sessions.getOrCreateSession('session-plain', { path: '/repo', name: '路人' }, null, 'default')
        store.groups.addGroupMember({ groupId: created.group.id, namespace: 'default', sessionId: plain.id, role: 'member' })
        const miss = await service.addTimelineMessage({
            groupId: created.group.id,
            namespace: 'default',
            type: 'chat',
            source: 'user:web',
            actorSessionId: 'user',
            payload: { text: '@路人 在吗' }
        })
        expect(miss.createdTasks).toHaveLength(0)
    })
})
