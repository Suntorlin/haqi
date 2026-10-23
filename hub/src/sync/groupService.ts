import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
    Store,
    StoredGroup,
    StoredGroupConversationTurn,
    StoredGroupMessage,
    StoredGroupNote,
    StoredGroupTask
} from '../store'
import { EventPublisher } from './eventPublisher'

export type GroupWithDetails = {
    group: StoredGroup
    members: ReturnType<Store['groups']['getGroupMembersByNamespace']>
    note: StoredGroupNote | null
}

export type GroupNoteFileSyncResult = {
    checked: number
    pulledFromFile: number
    pushedToFile: number
    skipped: number
    errors: number
}

type GroupTaskDispatchPayload = {
    groupId: string
    namespace: string
    taskId: string
    traceId: string
    source: string
    targetSessionId: string
    command: string
}

type GroupNoteExecutor = (payload: {
    groupId: string
    namespace: string
    traceId: string
    noteSessionId: string
    source: string
    command: string
}) => Promise<{ accepted: boolean; reason?: string }>

type SessionRoutingState = {
    active: boolean
}

type ResolveSessionRoutingState = (sessionId: string, namespace: string) => SessionRoutingState | null

type TimelineQuotedMessage = {
    id: string
    text: string
    actorName?: string
    createdAt: number
}

type TimelineMessage = {
    id: string
    groupId: string
    namespace: string
    seq: number
    type: StoredGroupMessage['type']
    traceId?: string
    taskId?: string
    source: string
    actorSessionId?: string
    actorName?: string
    targetSessionIds?: string[]
    quotedMessageId?: string
    quotedMessage?: TimelineQuotedMessage
    payload: unknown
    createdAt: number
}

type GroupConversationTurn = {
    id: string
    groupId: string
    namespace: string
    turnIndex: number
    status: 'open' | 'closed'
    initiatorMessageId: string | null
    initiatorSeq: number | null
    initiatorSource: string | null
    initiatorActorSessionId: string | null
    responderStartSeq: number | null
    responderEndSeq: number | null
    messageCount: number
    initiatorPreview: string | null
    responderPreview: string | null
    createdAt: number
    updatedAt: number
}

const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'expired', 'canceled', 'manual_done'])
const NOTE_REFRESH_TIMELINE_LIMIT = 120
const NOTE_REFRESH_TASK_LIMIT = 120
const NOTE_REFRESH_NOTE_MAX_LENGTH = 2_000
const NOTE_REFRESH_PAYLOAD_MAX_LENGTH = 500
const GROUP_NOTE_FILENAME = 'GROUP-NOTE.md'
const SETTINGS_FILENAME = 'settings.json'
const QUOTED_CONTEXT_MAX_LENGTH = 2_000
const DEFAULT_PURE_CONTEXT_MODE = false

function extractCommandText(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload.trim()
    }
    if (!payload || typeof payload !== 'object') {
        return ''
    }
    const candidate = (payload as { text?: unknown }).text
    return typeof candidate === 'string' ? candidate.trim() : ''
}

function uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.filter(Boolean)))
}

function extractMentionTokens(command: string): string[] {
    return Array.from(command.matchAll(/\B@([A-Za-z0-9._:-]+)/g))
        .map((match) => (match[1] ?? '').trim())
        .filter((token) => token.length > 0)
}

function sanitizeMentionAlias(value: string): string {
    return value.replace(/[^A-Za-z0-9._:-]/g, '')
}

function toMentionAliasKey(value: string): string {
    return value.trim().toLowerCase()
}

function truncateText(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value
    }
    return `${value.slice(0, maxLength)}...`
}

function stringifyPayload(payload: unknown): string {
    if (typeof payload === 'string') {
        return payload.trim()
    }
    if (!payload || typeof payload !== 'object') {
        return ''
    }

    const record = payload as Record<string, unknown>
    const textCandidate = record.text
    if (typeof textCandidate === 'string' && textCandidate.trim()) {
        return textCandidate.trim()
    }
    const commandCandidate = record.command
    if (typeof commandCandidate === 'string' && commandCandidate.trim()) {
        return commandCandidate.trim()
    }
    const messageCandidate = record.message
    if (typeof messageCandidate === 'string' && messageCandidate.trim()) {
        return messageCandidate.trim()
    }
    const statusCandidate = record.status
    const reasonCandidate = record.reason
    if (typeof statusCandidate === 'string' && statusCandidate.trim()) {
        const status = statusCandidate.trim()
        const reason = typeof reasonCandidate === 'string' && reasonCandidate.trim()
            ? ` (${reasonCandidate.trim()})`
            : ''
        return `${status}${reason}`
    }

    try {
        return JSON.stringify(payload)
    } catch {
        return ''
    }
}

function toPathSegment(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) {
        return '_'
    }
    return trimmed.replace(/[^A-Za-z0-9._-]/g, '_')
}

function resolveHapiHomeDir(): string {
    const raw = process.env.HAPI_HOME?.trim()
    if (raw && raw.length > 0) {
        return raw.replace(/^~(?=\/|$)/, homedir())
    }
    return join(homedir(), '.hapi')
}

function resolveSettingsPath(): string {
    return join(resolveHapiHomeDir(), SETTINGS_FILENAME)
}

function isPureContextModeEnabled(): boolean {
    try {
        const filepath = resolveSettingsPath()
        if (!existsSync(filepath)) {
            return DEFAULT_PURE_CONTEXT_MODE
        }
        const raw = readFileSync(filepath, 'utf-8').trim()
        if (!raw) {
            return DEFAULT_PURE_CONTEXT_MODE
        }
        const parsed = JSON.parse(raw) as { pureContextMode?: unknown }
        if (typeof parsed.pureContextMode === 'boolean') {
            return parsed.pureContextMode
        }
        return DEFAULT_PURE_CONTEXT_MODE
    } catch {
        return DEFAULT_PURE_CONTEXT_MODE
    }
}

function normalizeGroupNoteContent(content: string): string {
    const normalizedLineEndings = content.replace(/\r\n/g, '\n')
    return normalizedLineEndings.replace(/\n+$/g, '')
}

export class GroupService {
    private readonly dedupeBucketMs: number
    private readonly taskTtlMs: number

    constructor(
        private readonly store: Store,
        private readonly publisher: EventPublisher,
        private readonly dispatchTask: (payload: GroupTaskDispatchPayload) => Promise<void>,
        private readonly executeNoteRefresh?: GroupNoteExecutor,
        private readonly resolveSessionRoutingState?: ResolveSessionRoutingState,
        options?: {
            dedupeBucketMs?: number
            taskTtlMs?: number
        }
    ) {
        this.dedupeBucketMs = options?.dedupeBucketMs ?? 5 * 60 * 1000
        this.taskTtlMs = options?.taskTtlMs ?? 30 * 60 * 1000
    }

    /** Every group: chat groups and task groups share one list. */
    getGroupsByNamespace(namespace: string): GroupWithDetails[] {
        return this.store.groups.getGroupsByNamespace(namespace).map((group) => ({
            group,
            members: this.store.groups.getGroupMembersByNamespace(group.id, namespace),
            note: this.store.groups.getGroupNote(group.id, namespace)
        }))
    }

    getGroupByNamespace(groupId: string, namespace: string): GroupWithDetails | null {
        const group = this.store.groups.getGroupByNamespace(groupId, namespace)
        if (!group) {
            return null
        }
        return {
            group,
            members: this.store.groups.getGroupMembersByNamespace(group.id, namespace),
            note: this.store.groups.getGroupNote(group.id, namespace)
        }
    }

    createGroup(options: {
        namespace: string
        name: string
        description?: string | null
        noteSessionId?: string | null
        sessionMemberIds?: string[]
    }): GroupWithDetails {
        const sessionMemberIds = uniqueStrings(options.sessionMemberIds ?? [])
        const resolvedNoteSessionId = options.noteSessionId ?? sessionMemberIds[0] ?? null

        const members = sessionMemberIds.map((sessionId) => ({
            memberType: 'session' as const,
            sessionId,
            role: sessionId === resolvedNoteSessionId ? 'note_executor' : 'member'
        }))
        const group = this.store.groups.createGroup({
            namespace: options.namespace,
            name: options.name,
            description: options.description ?? null,
            noteSessionId: resolvedNoteSessionId,
            members
        })

        const groupData = {
            group,
            members: this.store.groups.getGroupMembersByNamespace(group.id, group.namespace),
            note: this.store.groups.getGroupNote(group.id, group.namespace)
        }
        this.publisher.emit({
            type: 'group-added',
            groupId: group.id,
            data: groupData
        })
        return groupData
    }

    addMember(options: {
        groupId: string
        namespace: string
        sessionId: string
    }): GroupWithDetails {
        const group = this.requireGroup(options.groupId, options.namespace)

        // If this is the first session member and no noteSessionId is set, make this session the note executor
        const shouldSetAsNoteSession = !group.noteSessionId

        this.store.groups.addGroupMember({
            groupId: options.groupId,
            namespace: options.namespace,
            sessionId: options.sessionId,
            role: shouldSetAsNoteSession ? 'note_executor' : 'member'
        })

        // Auto-set first session as note executor
        if (shouldSetAsNoteSession) {
            this.store.groups.updateGroup({
                groupId: options.groupId,
                namespace: options.namespace,
                noteSessionId: options.sessionId
            })
        }

        const groupData = this.getGroupByNamespace(options.groupId, options.namespace)
        if (!groupData) {
            throw new Error('Group not found after adding member')
        }
        this.publisher.emit({
            type: 'group-updated',
            groupId: options.groupId,
            data: groupData
        })
        return groupData
    }

    removeMember(options: {
        groupId: string
        namespace: string
        sessionId: string
    }): GroupWithDetails {
        const group = this.requireGroup(options.groupId, options.namespace)
        const removed = this.store.groups.removeGroupMember({
            groupId: options.groupId,
            namespace: options.namespace,
            sessionId: options.sessionId
        })
        if (!removed) {
            throw new Error('Group member not found')
        }

        if (group.noteSessionId === options.sessionId) {
            const remainingSessionMemberIds = this.store.groups
                .getGroupMembersByNamespace(options.groupId, options.namespace)
                .filter((member) => member.memberType === 'session' && typeof member.sessionId === 'string' && member.sessionId.length > 0)
                .map((member) => member.sessionId as string)
            const nextNoteSessionId = remainingSessionMemberIds[0] ?? null
            this.store.groups.updateGroup({
                groupId: options.groupId,
                namespace: options.namespace,
                noteSessionId: nextNoteSessionId
            })
        }

        const groupData = this.getGroupByNamespace(options.groupId, options.namespace)
        if (!groupData) {
            throw new Error('Group not found after removing member')
        }
        this.publisher.emit({
            type: 'group-updated',
            groupId: options.groupId,
            data: groupData
        })
        return groupData
    }

    updateGroup(options: {
        groupId: string
        namespace: string
        name?: string
        description?: string | null
        noteSessionId?: string | null
        archived?: boolean
    }): GroupWithDetails {
        this.requireGroup(options.groupId, options.namespace)
        if (options.noteSessionId !== undefined && options.noteSessionId !== null) {
            const isSessionMember = this.store.groups
                .getGroupMembersByNamespace(options.groupId, options.namespace)
                .some((member) => member.memberType === 'session' && member.sessionId === options.noteSessionId)
            if (!isSessionMember) {
                throw new Error('Note session must be a group session member')
            }
        }
        const updated = this.store.groups.updateGroup(options)
        if (!updated) {
            throw new Error('Group not found')
        }
        const groupData = {
            group: updated,
            members: this.store.groups.getGroupMembersByNamespace(updated.id, updated.namespace),
            note: this.store.groups.getGroupNote(updated.id, updated.namespace)
        }
        this.publisher.emit({
            type: 'group-updated',
            groupId: options.groupId,
            data: groupData
        })
        return groupData
    }

    deleteGroup(namespace: string, groupId: string, actorMachineId?: string): void {
        void actorMachineId
        this.requireGroup(groupId, namespace)
        const deleted = this.store.groups.deleteGroup({ groupId, namespace })
        if (!deleted) {
            throw new Error('Failed to delete group')
        }
        this.publisher.emit({
            type: 'group-removed',
            groupId,
            namespace
        })
    }

    getMessagesPage(
        groupId: string,
        namespace: string,
        options: { limit: number; beforeSeq: number | null }
    ): {
        messages: TimelineMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
        }
    } {
        this.requireGroup(groupId, namespace)
        const storedMessages = this.store.groups.getGroupMessages(groupId, namespace, options.limit, options.beforeSeq ?? undefined)

        let oldestSeq: number | null = null
        for (const message of storedMessages) {
            if (oldestSeq === null || message.seq < oldestSeq) {
                oldestSeq = message.seq
            }
        }

        const nextBeforeSeq = oldestSeq
        const hasMore = nextBeforeSeq !== null
            && this.store.groups.getGroupMessages(groupId, namespace, 1, nextBeforeSeq).length > 0

        return {
            messages: storedMessages.map((message) => this.toTimelineMessage(message)),
            page: {
                limit: options.limit,
                beforeSeq: options.beforeSeq,
                nextBeforeSeq,
                hasMore
            }
        }
    }

    getConversationTurnsPage(
        groupId: string,
        namespace: string,
        options: { limit: number; beforeTurnIndex: number | null }
    ): {
        turns: GroupConversationTurn[]
        page: {
            limit: number
            beforeTurnIndex: number | null
            nextBeforeTurnIndex: number | null
            hasMore: boolean
        }
    } {
        this.requireGroup(groupId, namespace)
        const storedTurns = this.store.groups.getConversationTurns(
            groupId,
            namespace,
            options.limit,
            options.beforeTurnIndex ?? undefined
        )

        let oldestTurnIndex: number | null = null
        for (const turn of storedTurns) {
            if (oldestTurnIndex === null || turn.turnIndex < oldestTurnIndex) {
                oldestTurnIndex = turn.turnIndex
            }
        }

        const nextBeforeTurnIndex = oldestTurnIndex
        const hasMore = nextBeforeTurnIndex !== null
            && this.store.groups.getConversationTurns(groupId, namespace, 1, nextBeforeTurnIndex).length > 0

        return {
            turns: storedTurns.map((turn) => this.toConversationTurn(turn)),
            page: {
                limit: options.limit,
                beforeTurnIndex: options.beforeTurnIndex,
                nextBeforeTurnIndex,
                hasMore
            }
        }
    }

    getConversationTurnMessagesPage(
        groupId: string,
        namespace: string,
        turnId: string,
        options: { limit: number; beforeSeq: number | null }
    ): {
        turn: GroupConversationTurn
        messages: TimelineMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
            startSeq: number | null
            endSeq: number | null
        }
    } | null {
        this.requireGroup(groupId, namespace)
        const result = this.store.groups.getConversationTurnMessagesPage(groupId, namespace, turnId, options)
        if (!result) {
            return null
        }

        return {
            turn: this.toConversationTurn(result.turn),
            messages: result.messages.map((message) => this.toTimelineMessage(message)),
            page: result.page
        }
    }

    async addTimelineMessage(options: {
        groupId: string
        namespace: string
        type: 'chat' | 'command' | 'task_state' | 'note_state' | 'system'
        payload: unknown
        source?: string
        actorSessionId?: string | null
        actorName?: string | null
        traceId?: string | null
        taskId?: string | null
        targetSessionIds?: string[] | null
        quotedMessageId?: string | null
    }): Promise<{
        message: TimelineMessage
        createdTasks: StoredGroupTask[]
    }> {
        this.requireGroup(options.groupId, options.namespace)
        const source = options.source ?? 'user:web'
        const storedMessage = this.store.groups.addGroupMessage({
            groupId: options.groupId,
            namespace: options.namespace,
            type: options.type,
            payload: options.payload,
            source,
            actorSessionId: options.actorSessionId ?? null,
            actorName: options.actorName ?? null,
            traceId: options.traceId ?? null,
            taskId: options.taskId ?? null,
            targetSessionIds: options.targetSessionIds ?? null,
            quotedMessageId: options.quotedMessageId ?? null
        })
        this.emitMessageEvent(storedMessage)
        const timelineMessage = this.toTimelineMessage(storedMessage)

        const command = extractCommandText(options.payload)
        const shouldDispatchTasks = this.shouldDispatchTasksFromMessage({
            type: options.type,
            source,
            actorSessionId: options.actorSessionId ?? null,
            command
        })

        if (!shouldDispatchTasks || !command) {
            return { message: timelineMessage, createdTasks: [] }
        }

        const commandWithQuotedContext = this.buildCommandWithQuotedContext(command, timelineMessage.quotedMessage)
        const explicitTargets = options.type === 'command'
            ? (options.targetSessionIds ?? null)
            : null
        const originSessionId = this.resolveOriginSessionId(source, options.actorSessionId ?? null)

        const targetSessionIds = this.resolveCommandTargets(
            options.groupId,
            options.namespace,
            command,
            explicitTargets,
            originSessionId
        )
        if (targetSessionIds.length === 0) {
            return { message: timelineMessage, createdTasks: [] }
        }

        const traceId = options.traceId ?? storedMessage.traceId ?? randomUUID()
        const createdTasks = await this.createAndDispatchTasks({
            groupId: options.groupId,
            namespace: options.namespace,
            source,
            command: commandWithQuotedContext,
            traceId,
            targetSessionIds
        })
        return { message: timelineMessage, createdTasks }
    }

    getGroupNote(groupId: string, namespace: string): StoredGroupNote | null {
        this.requireGroup(groupId, namespace)
        return this.store.groups.getGroupNote(groupId, namespace)
    }

    getGroupTasks(groupId: string, namespace: string, limit: number = 200): StoredGroupTask[] {
        this.requireGroup(groupId, namespace)
        return this.store.groups.getGroupTasks(groupId, namespace, limit)
    }

    updateGroupNote(options: {
        groupId: string
        namespace: string
        content: string
        updatedBy?: string | null
    }): StoredGroupNote {
        this.requireGroup(options.groupId, options.namespace)
        const note = this.store.groups.updateGroupNote(options)
        this.publisher.emit({
            type: 'group-note-updated',
            groupId: options.groupId,
            note
        })

        const noteStateMessage = this.store.groups.addGroupMessage({
            groupId: options.groupId,
            namespace: options.namespace,
            type: 'note_state',
            source: options.updatedBy ?? 'system:note',
            payload: {
                version: note.version,
                updatedAt: note.updatedAt,
                updatedBy: note.updatedBy
            }
        })
        this.emitMessageEvent(noteStateMessage)
        this.persistGroupNoteMarkdown(note)
        return note
    }

    async refreshGroupNote(options: {
        groupId: string
        namespace: string
        source?: string
        command?: string
    }): Promise<{ triggered: boolean; reason?: string }> {
        const detail = this.getGroupByNamespace(options.groupId, options.namespace)
        if (!detail) {
            throw new Error('Group not found')
        }
        const noteSessionId = detail.group.noteSessionId
        if (!noteSessionId) {
            return { triggered: false, reason: 'note session not configured' }
        }
        if (!this.executeNoteRefresh) {
            return { triggered: false, reason: 'note executor unavailable' }
        }

        const traceId = randomUUID()
        const source = options.source ?? 'user:web'
        const pureContextMode = isPureContextModeEnabled()
        if (pureContextMode && (!options.command || !options.command.trim())) {
            return { triggered: false, reason: 'pure context mode enabled' }
        }
        const command = options.command ?? this.buildNoteRefreshCommand(detail, source)
        const result = await this.executeNoteRefresh({
            groupId: options.groupId,
            namespace: options.namespace,
            traceId,
            noteSessionId,
            source,
            command
        })

        const status = result.accepted ? 'enqueued' : 'rejected'
        const reason = result.reason ?? null
        const text = result.accepted
            ? 'Generating group note...'
            : `Failed to start group note generation${reason ? `: ${reason}` : ''}`

        const payload = {
            traceId,
            noteSessionId,
            status,
            reason,
            text
        }

        const event = this.store.groups.addGroupMessage({
            groupId: options.groupId,
            namespace: options.namespace,
            type: 'system',
            traceId,
            source,
            payload
        })
        this.emitMessageEvent(event)
        return {
            triggered: result.accepted,
            reason: result.reason
        }
    }

    private buildNoteRefreshCommand(detail: GroupWithDetails, source: string): string {
        const memberSessionIds = detail.members
            .filter((member): member is typeof member & { sessionId: string } => member.memberType === 'session' && typeof member.sessionId === 'string')
            .map((member) => member.sessionId)

        const timeline = this.store.groups.getGroupMessages(
            detail.group.id,
            detail.group.namespace,
            NOTE_REFRESH_TIMELINE_LIMIT
        )
        const tasks = this.store.groups.getGroupTasks(
            detail.group.id,
            detail.group.namespace,
            NOTE_REFRESH_TASK_LIMIT
        ).slice().reverse()

        const memberLines = memberSessionIds.length > 0
            ? memberSessionIds.map((sessionId) => `- ${sessionId}${sessionId === detail.group.noteSessionId ? ' (note_executor)' : ''}`).join('\n')
            : '- (no session members)'

        const timelineLines = timeline.length > 0
            ? timeline.map((message) => {
                const actor = message.actorSessionId
                    ?? (message.source.startsWith('session:') ? message.source.slice('session:'.length) : message.source)
                const payload = truncateText(stringifyPayload(message.payload), NOTE_REFRESH_PAYLOAD_MAX_LENGTH)
                const targets = message.targetSessionIds && message.targetSessionIds.length > 0
                    ? ` targets=${message.targetSessionIds.join(',')}`
                    : ''
                const trace = message.traceId ? ` trace=${message.traceId}` : ''
                const task = message.taskId ? ` task=${message.taskId}` : ''
                return `- [${new Date(message.createdAt).toISOString()}] type=${message.type} actor=${actor}${targets}${trace}${task} | ${payload || '(empty)'}`
            }).join('\n')
            : '- (no timeline messages)'

        const taskLines = tasks.length > 0
            ? tasks.map((task) => {
                const error = task.error ? ` error=${truncateText(task.error, 180)}` : ''
                return `- [${new Date(task.createdAt).toISOString()}] status=${task.status} target=${task.targetSessionId} command=${truncateText(task.command, 240)}${error}`
            }).join('\n')
            : '- (no tasks)'

        const existingNote = detail.note?.content
            ? truncateText(detail.note.content, NOTE_REFRESH_NOTE_MAX_LENGTH)
            : '(empty)'
        const noteFilePath = this.getGroupNoteFilePath(detail.group.namespace, detail.group.id)

        return [
            '你是 HAQI Group 的 note 执行器。',
            '请基于给定的 Group Timeline 和 Task 状态，输出最新 Group Note。',
            '要求：',
            '1. 只输出最终 Markdown 正文，不要额外解释。',
            '2. 必须包含以下两大部分：',
            '   - 每个agent的职责',
            '   - 当前目标、进展以及待办事项',
            '3. 只根据提供信息总结；不确定项标注“待确认”。',
            '4. 待办事项使用 `- [ ]`，并尽量标注责任 session。',
            '',
            '建议结构：',
            '## 每个agent的职责',
            '- <sessionId>: 职责 | 当前状态 | 依据',
            '',
            '## 当前目标、进展以及待办事项',
            '### 当前目标',
            '- ...',
            '### 当前进展',
            '- ...',
            '### 待办事项',
            '- [ ] ... (@sessionId)',
            '### 风险/阻塞',
            '- ...',
            '',
            `Group: ${detail.group.name} (${detail.group.id})`,
            `Refresh Source: ${source}`,
            `Current Note Executor: ${detail.group.noteSessionId ?? 'not-configured'}`,
            `Group Note Markdown Path: ${noteFilePath ?? '(disabled: in-memory store)'}`,
            '你可以自行决定是否读取该文件，读取时以最新文件内容为准。',
            '',
            'Group Members (session):',
            memberLines,
            '',
            'Current Group Note:',
            existingNote,
            '',
            'Recent Group Timeline (oldest -> newest):',
            timelineLines,
            '',
            'Recent Group Tasks (oldest -> newest):',
            taskLines
        ].join('\n')
    }

    private getGroupNoteFilePath(namespace: string, groupId: string): string | null {
        const dbPath = this.store.getDatabasePath()
        if (dbPath === ':memory:' || dbPath.startsWith('file::memory:')) {
            return null
        }
        const hapiHome = resolveHapiHomeDir()
        return join(hapiHome, 'memory', 'groups', toPathSegment(namespace), groupId, GROUP_NOTE_FILENAME)
    }

    private persistGroupNoteMarkdown(note: StoredGroupNote): void {
        const filePath = this.getGroupNoteFilePath(note.namespace, note.groupId)
        if (!filePath) {
            return
        }
        const normalizedContent = note.content.length > 0 ? note.content : ''
        try {
            mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
            writeFileSync(filePath, normalizedContent, { encoding: 'utf8' })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`[GroupService] Failed to persist group note markdown at ${filePath}: ${message}`)
        }
    }

    syncGroupNoteMarkdownFiles(): GroupNoteFileSyncResult {
        const result: GroupNoteFileSyncResult = {
            checked: 0,
            pulledFromFile: 0,
            pushedToFile: 0,
            skipped: 0,
            errors: 0
        }

        const groups = this.store.groups.getAllGroups()
        for (const group of groups) {
            const note = this.store.groups.getGroupNote(group.id, group.namespace)
            const filePath = this.getGroupNoteFilePath(group.namespace, group.id)
            if (!note || !filePath) {
                result.skipped += 1
                continue
            }

            result.checked += 1
            const normalizedNoteContent = normalizeGroupNoteContent(note.content)

            let fileExists = false
            let fileContent = ''
            let fileMtimeMs = 0
            try {
                fileExists = existsSync(filePath)
                if (fileExists) {
                    const stats = statSync(filePath)
                    if (!stats.isFile()) {
                        result.skipped += 1
                        continue
                    }
                    fileContent = readFileSync(filePath, 'utf8')
                    fileMtimeMs = stats.mtimeMs
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(`[GroupService] Failed to read group note markdown at ${filePath}: ${message}`)
                result.errors += 1
                continue
            }

            if (!fileExists) {
                if (!normalizedNoteContent) {
                    continue
                }
                this.persistGroupNoteMarkdown(note)
                result.pushedToFile += 1
                continue
            }

            const normalizedFileContent = normalizeGroupNoteContent(fileContent)
            if (normalizedFileContent === normalizedNoteContent) {
                continue
            }

            if (fileMtimeMs > note.updatedAt) {
                try {
                    this.updateGroupNote({
                        groupId: group.id,
                        namespace: group.namespace,
                        content: normalizedFileContent,
                        updatedBy: 'system:file-sync'
                    })
                    result.pulledFromFile += 1
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    console.warn(`[GroupService] Failed to sync group note from markdown for ${group.id}: ${message}`)
                    result.errors += 1
                }
                continue
            }

            this.persistGroupNoteMarkdown(note)
            result.pushedToFile += 1
        }

        return result
    }

    claimTask(groupId: string, taskId: string, namespace: string): StoredGroupTask {
        this.requireGroup(groupId, namespace)
        const existing = this.requireTask(groupId, taskId, namespace)
        if (TERMINAL_TASK_STATUSES.has(existing.status)) {
            return existing
        }
        const task = this.store.groups.updateGroupTaskStatus({
            groupId,
            taskId,
            namespace,
            status: 'running'
        })
        if (!task) {
            throw new Error('Task not found')
        }
        this.emitTaskUpdate(task)
        return task
    }

    doneTask(groupId: string, taskId: string, namespace: string): StoredGroupTask {
        this.requireGroup(groupId, namespace)
        const existing = this.requireTask(groupId, taskId, namespace)
        if (TERMINAL_TASK_STATUSES.has(existing.status)) {
            return existing
        }
        const task = this.store.groups.updateGroupTaskStatus({
            groupId,
            taskId,
            namespace,
            status: 'manual_done'
        })
        if (!task) {
            throw new Error('Task not found')
        }
        this.emitTaskUpdate(task)
        return task
    }

    cancelTask(groupId: string, taskId: string, namespace: string): StoredGroupTask {
        this.requireGroup(groupId, namespace)
        const existing = this.requireTask(groupId, taskId, namespace)
        if (TERMINAL_TASK_STATUSES.has(existing.status)) {
            return existing
        }
        const task = this.store.groups.updateGroupTaskStatus({
            groupId,
            taskId,
            namespace,
            status: 'canceled'
        })
        if (!task) {
            throw new Error('Task not found')
        }
        this.emitTaskUpdate(task)
        return task
    }

    updateTaskExecutionStatus(options: {
        groupId: string
        taskId: string
        namespace: string
        status: 'running' | 'completed' | 'failed'
        error?: string | null
    }): StoredGroupTask | null {
        this.requireGroup(options.groupId, options.namespace)
        const existing = this.store.groups.getGroupTaskByNamespace(options.groupId, options.taskId, options.namespace)
        if (!existing) {
            return null
        }
        if (existing.status === options.status) {
            return existing
        }
        if (TERMINAL_TASK_STATUSES.has(existing.status)) {
            return existing
        }

        const task = this.store.groups.updateGroupTaskStatus({
            groupId: options.groupId,
            taskId: options.taskId,
            namespace: options.namespace,
            status: options.status,
            error: options.error
        })
        if (!task) {
            return null
        }
        this.emitTaskUpdate(task)
        return task
    }

    private async createAndDispatchTasks(options: {
        groupId: string
        namespace: string
        command: string
        traceId: string
        source: string
        targetSessionIds: string[]
    }): Promise<StoredGroupTask[]> {
        const createdTasks: StoredGroupTask[] = []
        const now = Date.now()
        const expiresAt = now + this.taskTtlMs
        const bucket = Math.floor(now / this.dedupeBucketMs)
        const normalizedCommand = options.command.replace(/\s+/g, ' ').trim().toLowerCase()

        for (const targetSessionId of options.targetSessionIds) {
            const dedupeKey = `${options.groupId}:${targetSessionId}:${normalizedCommand}:${bucket}`
            const existing = this.store.groups.getGroupTaskByDedupeKey(
                options.groupId,
                options.namespace,
                dedupeKey
            )
            if (existing) {
                createdTasks.push(existing)
                continue
            }

            const hasTaskHistory = this.store.groups.hasGroupTaskForTargetSession(
                options.groupId,
                options.namespace,
                targetSessionId
            )

            const task = this.store.groups.addGroupTask({
                groupId: options.groupId,
                namespace: options.namespace,
                traceId: options.traceId,
                source: options.source,
                targetSessionId,
                command: options.command,
                status: 'pending',
                dedupeKey,
                expiresAt
            })
            createdTasks.push(task)
            this.emitTaskUpdate(task)

            try {
                const dispatchCommand = this.buildTaskDispatchCommand({
                    groupId: task.groupId,
                    namespace: task.namespace,
                    targetSessionId: task.targetSessionId,
                    command: task.command,
                    includeTaskContext: !hasTaskHistory
                })
                await this.dispatchTask({
                    groupId: options.groupId,
                    namespace: options.namespace,
                    taskId: task.id,
                    traceId: task.traceId,
                    source: task.source,
                    targetSessionId: task.targetSessionId,
                    command: dispatchCommand
                })

                const enqueued = this.store.groups.updateGroupTaskStatus({
                    groupId: options.groupId,
                    taskId: task.id,
                    namespace: options.namespace,
                    status: 'enqueued'
                })
                if (enqueued) {
                    this.emitTaskUpdate(enqueued)
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                const failed = this.store.groups.updateGroupTaskStatus({
                    groupId: options.groupId,
                    taskId: task.id,
                    namespace: options.namespace,
                    status: 'failed',
                    error: message
                })
                if (failed) {
                    this.emitTaskUpdate(failed)
                }
            }
        }

        return createdTasks
    }

    private shouldDispatchTasksFromMessage(options: {
        type: 'chat' | 'command' | 'task_state' | 'note_state' | 'system'
        source: string
        actorSessionId: string | null
        command: string
    }): boolean {
        if (!options.command.trim()) {
            return false
        }
        if (options.type === 'command') {
            return true
        }
        if (options.type !== 'chat') {
            return false
        }

        const originSessionId = this.resolveOriginSessionId(options.source, options.actorSessionId)
        if (!originSessionId) {
            return false
        }

        if (/\B@all\b/i.test(options.command)) {
            return true
        }

        return extractMentionTokens(options.command).length > 0
    }

    private resolveCommandTargets(
        groupId: string,
        namespace: string,
        command: string,
        explicitTargets: string[] | null,
        originSessionId: string | null
    ): string[] {
        const members = this.store.groups
            .getGroupMembersByNamespace(groupId, namespace)
            .filter((member) => member.memberType === 'session' && typeof member.sessionId === 'string')
        const sessionMembers = members.map((member) => member.sessionId as string)
        // A task's lead (its planner) is not a worker: @all leaves it out; an explicit @ still reaches it.
        const leads = new Set(members.filter((member) => member.role === 'lead').map((member) => member.sessionId as string))

        if (sessionMembers.length === 0) {
            return []
        }

        const onlineSessionMembers = sessionMembers.filter((sessionId) => this.isSessionMentionable(sessionId, namespace))
        const onlineSessionMembersSet = new Set(onlineSessionMembers)
        const aliasLookup = this.buildMentionAliasLookup(onlineSessionMembers, namespace)

        if (explicitTargets && explicitTargets.length > 0) {
            return uniqueStrings(explicitTargets).filter(
                (sessionId) => onlineSessionMembers.includes(sessionId) && sessionId !== originSessionId
            )
        }

        if (/\B@all\b/i.test(command)) {
            return onlineSessionMembers.filter((sessionId) => sessionId !== originSessionId && !leads.has(sessionId))
        }

        const mentions = extractMentionTokens(command)
        const resolvedTargets: string[] = []
        for (const mention of mentions) {
            if (onlineSessionMembersSet.has(mention)) {
                resolvedTargets.push(mention)
                continue
            }

            const mappedSessionId = aliasLookup.get(toMentionAliasKey(mention))
            if (mappedSessionId && onlineSessionMembersSet.has(mappedSessionId)) {
                resolvedTargets.push(mappedSessionId)
            }
        }

        return uniqueStrings(resolvedTargets)
    }

    private isSessionMentionable(sessionId: string, namespace: string): boolean {
        const session = this.resolveSessionRoutingState?.(sessionId, namespace)
        if (!session) {
            return false
        }
        return session.active
    }

    private resolveOriginSessionId(source: string, actorSessionId: string | null): string | null {
        const normalizedActorSessionId = actorSessionId?.trim()
        if (normalizedActorSessionId) {
            return normalizedActorSessionId
        }
        if (!source.startsWith('session:')) {
            return null
        }
        const sourceSessionId = source.slice('session:'.length).trim()
        return sourceSessionId.length > 0 ? sourceSessionId : null
    }

    private buildMentionAliasLookup(sessionIds: string[], namespace: string): Map<string, string | null> {
        const aliasLookup = new Map<string, string | null>()
        for (const sessionId of sessionIds) {
            const aliases = this.getSessionMentionAliases(sessionId, namespace)
            for (const alias of aliases) {
                const key = toMentionAliasKey(alias)
                if (!key) {
                    continue
                }
                const existing = aliasLookup.get(key)
                if (!aliasLookup.has(key)) {
                    aliasLookup.set(key, sessionId)
                    continue
                }
                if (existing !== sessionId) {
                    aliasLookup.set(key, null)
                }
            }
        }
        return aliasLookup
    }

    private getSessionMentionAliases(sessionId: string, namespace: string): string[] {
        const aliases = new Set<string>([sessionId])
        const session = this.store.sessions.getSessionByNamespace(sessionId, namespace)
        const metadata = (session?.metadata && typeof session.metadata === 'object')
            ? (session.metadata as Record<string, unknown>)
            : null
        const name = typeof metadata?.name === 'string'
            ? metadata.name.trim()
            : ''
        if (!name) {
            return Array.from(aliases)
        }

        const rawVariants = [
            name,
            name.replace(/\s+/g, '-'),
            name.replace(/\s+/g, '_'),
            name.replace(/\s+/g, '')
        ]
        for (const variant of rawVariants) {
            const sanitized = sanitizeMentionAlias(variant.trim())
            if (sanitized.length > 0) {
                aliases.add(sanitized)
            }
        }
        return Array.from(aliases)
    }

    private buildCommandWithQuotedContext(command: string, quotedMessage: TimelineQuotedMessage | undefined): string {
        if (isPureContextModeEnabled()) {
            return command
        }
        if (!quotedMessage || command.trimStart().startsWith('>')) {
            return command
        }
        const quotedText = quotedMessage.text.replace(/\s+/g, ' ').trim()
        if (!quotedText) {
            return command
        }
        const actorName = quotedMessage.actorName?.trim() || 'Unknown'
        const quotedLine = truncateText(quotedText, QUOTED_CONTEXT_MAX_LENGTH)
        return `> ${actorName}: ${quotedLine}\n\n${command}`
    }

    private buildTaskDispatchCommand(options: {
        groupId: string
        namespace: string
        targetSessionId: string
        command: string
        includeTaskContext: boolean
    }): string {
        if (isPureContextModeEnabled()) {
            return options.command
        }
        const trimmedCommand = options.command.trimStart()
        if (trimmedCommand.startsWith('/')) {
            // Keep slash commands intact so agent-native command parsing remains unchanged.
            return options.command
        }
        if (options.command.includes('[HAQI_GROUP_TASK_CONTEXT]')) {
            return options.command
        }
        if (!options.includeTaskContext) {
            return options.command
        }
        const groupNotePath = this.getGroupNoteFilePath(options.namespace, options.groupId)
        return [
            options.command,
            '[HAQI_GROUP_TASK_CONTEXT]',
            `- Group ID: ${options.groupId}`,
            `- Group Note Markdown Path: ${groupNotePath ?? '(disabled: in-memory store)'}`,
            `- Your HAQI Session ID (self): ${options.targetSessionId}`,
            'Instructions:',
            '- This task is assigned to you. Keep replies concise and action-oriented. Better not to contain @all in your reply.',
            '- @all is expensive. Use @all only when every active session must take action now.',
            '- If only part of the group needs action, mention specific sessions instead of @all.',
            '- For status updates, acknowledgements, summaries, or confirmations: do NOT use @all.',
            '- If unsure whether @all is needed, do NOT use @all.',
            '- When needed, read or write Group Note Markdown Path first, then continue based on the latest note content.',
            `- Only if you need to ask yourself to do next work, use @${options.targetSessionId}.`,
            '[/HAQI_GROUP_TASK_CONTEXT]',
            ''
        ].join('\n')
    }

    private resolveMessageActorName(message: StoredGroupMessage): string | undefined {
        const actorName = message.actorName?.trim()
        if (actorName) {
            return actorName
        }
        const actorSessionId = message.actorSessionId?.trim()
        if (actorSessionId) {
            return actorSessionId
        }
        if (message.source.startsWith('session:')) {
            const value = message.source.slice('session:'.length).trim()
            return value || undefined
        }
        return undefined
    }

    private resolveQuotedMessage(
        groupId: string,
        namespace: string,
        quotedMessageId: string | null
    ): TimelineQuotedMessage | null {
        if (!quotedMessageId) {
            return null
        }
        const quoted = this.store.groups.getGroupMessageByNamespace(groupId, namespace, quotedMessageId)
        if (!quoted) {
            return null
        }
        const actorName = this.resolveMessageActorName(quoted)
        return {
            id: quoted.id,
            text: stringifyPayload(quoted.payload),
            ...(actorName ? { actorName } : {}),
            createdAt: quoted.createdAt
        }
    }

    private emitMessageEvent(message: StoredGroupMessage): void {
        this.publisher.emit({
            type: 'group-message-received',
            groupId: message.groupId,
            message: this.toTimelineMessage(message)
        })
    }

    private emitTaskUpdate(task: StoredGroupTask): void {
        this.publisher.emit({
            type: 'group-task-updated',
            groupId: task.groupId,
            task
        })

        const timeline = this.store.groups.addGroupMessage({
            groupId: task.groupId,
            namespace: task.namespace,
            type: 'task_state',
            traceId: task.traceId,
            taskId: task.id,
            source: task.source,
            targetSessionIds: [task.targetSessionId],
            payload: {
                taskId: task.id,
                status: task.status,
                targetSessionId: task.targetSessionId,
                command: task.command,
                error: task.error
            }
        })
        this.emitMessageEvent(timeline)
    }

    private toTimelineMessage(message: StoredGroupMessage): TimelineMessage {
        const quotedMessage = this.resolveQuotedMessage(message.groupId, message.namespace, message.quotedMessageId)
        return {
            id: message.id,
            groupId: message.groupId,
            namespace: message.namespace,
            seq: message.seq,
            type: message.type,
            ...(message.traceId ? { traceId: message.traceId } : {}),
            ...(message.taskId ? { taskId: message.taskId } : {}),
            source: message.source,
            ...(message.actorSessionId ? { actorSessionId: message.actorSessionId } : {}),
            ...(message.actorName ? { actorName: message.actorName } : {}),
            ...(message.targetSessionIds ? { targetSessionIds: message.targetSessionIds } : {}),
            ...(message.quotedMessageId ? { quotedMessageId: message.quotedMessageId } : {}),
            ...(quotedMessage ? { quotedMessage } : {}),
            payload: message.payload,
            createdAt: message.createdAt
        }
    }

    private toConversationTurn(turn: StoredGroupConversationTurn): GroupConversationTurn {
        return {
            id: turn.id,
            groupId: turn.groupId,
            namespace: turn.namespace,
            turnIndex: turn.turnIndex,
            status: turn.status,
            initiatorMessageId: turn.initiatorMessageId,
            initiatorSeq: turn.initiatorSeq,
            initiatorSource: turn.initiatorSource,
            initiatorActorSessionId: turn.initiatorActorSessionId,
            responderStartSeq: turn.responderStartSeq,
            responderEndSeq: turn.responderEndSeq,
            messageCount: turn.messageCount,
            initiatorPreview: turn.initiatorPreview,
            responderPreview: turn.responderPreview,
            createdAt: turn.createdAt,
            updatedAt: turn.updatedAt
        }
    }

    private requireGroup(groupId: string, namespace: string): StoredGroup {
        const group = this.store.groups.getGroupByNamespace(groupId, namespace)
        if (!group) {
            throw new Error('Group not found')
        }
        return group
    }

    private requireTask(groupId: string, taskId: string, namespace: string): StoredGroupTask {
        const task = this.store.groups.getGroupTaskByNamespace(groupId, taskId, namespace)
        if (!task) {
            throw new Error('Task not found')
        }
        return task
    }
}
