import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MemoryService } from '../memory/service'
import { realUserText } from '../memory/userMessage'
import { Store } from '../store'
import { TaskTransitionError } from './kernel/stateMachine'
import { commonFolder, TaskError, TaskService, type TaskSession } from './taskService'

const DRAFT = {
    goal: '创建任务时多一步引导，起草验收标准',
    nonGoals: ['不拆子任务'],
    criteria: [
        { text: 'bun run test 全部通过', source: 'repo', sourceRef: 'AGENTS.md', verify: 'bun run test' },
        { text: '结论先行', source: 'principle', sourceRef: 'p1', verify: '看报告第一段' },
        { text: '引导面板 3 秒内出现', source: 'inferred', verify: 'Playwright 计时' }
    ],
    questions: [
        { id: 'q1', text: '截图放哪里？', options: [{ id: 'a', label: 'Linear 工单' }, { id: 'b', label: 'Obsidian' }], default: 'a', precedentRef: 'e1' }
    ]
}

/** Embeddings answer with one flat vector; anything else fails, so a test never reaches the network. */
const noNetwork = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/embeddings')) {
        const input = (JSON.parse(String(init?.body)) as { input: string[] }).input
        return new Response(JSON.stringify({ data: input.map((_text, index) => ({ index, embedding: [1, 0] })) }), { status: 200 })
    }
    return new Response('no network in tests', { status: 500 })
}) as typeof fetch

function setup(dir: string) {
    const store = new Store(':memory:')
    const memory = new MemoryService(store, { paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings.json') }), onChange: () => {}, fetchFn: noNetwork })
    const sessions = new Map<string, TaskSession>()
    const sent: Array<{ sessionId: string; text: string; meta: Record<string, unknown> }> = []
    const spawned: Array<{ directory: string; name: string; tags: string[]; text: string }> = []
    const changes: string[] = []
    const lines: string[] = []
    const stopped: string[] = []
    let spawnError: string | null = null
    let nextId = 1
    const addSession = (session: Partial<TaskSession> & { id: string }) => {
        const full: TaskSession = { active: true, machineId: 'm1', path: '/repo/haqi', name: null, tags: [], updatedAt: Date.now(), ...session }
        sessions.set(full.id, full)
        const now = Date.now()
        ;(store as unknown as { db: Database }).db.prepare(
            "INSERT INTO sessions (id, tag, namespace, created_at, updated_at, metadata, metadata_version, agent_state_version, active, active_at, seq) VALUES (?, NULL, 'default', ?, ?, ?, 1, 1, 1, ?, 0)"
        ).run(full.id, now, now, JSON.stringify({ path: full.path, tags: full.tags }), now)
        return full
    }
    const service = new TaskService(store, memory, {
        planner: {
            spawnAndPrompt: async (input) => {
                if (spawnError) return { error: spawnError }
                spawned.push(input)
                const session = addSession({ id: `planner-${nextId++}`, name: input.name, tags: input.tags })
                store.messages.addMessage(session.id, { role: 'user', content: { type: 'text', text: input.text }, meta: input.meta })
                return { sessionId: session.id }
            },
            send: async (sessionId, text, meta) => {
                if (!sessions.get(sessionId)?.active) return false
                sent.push({ sessionId, text, meta })
                return true
            }
        },
        session: (_namespace, id) => sessions.get(id) ?? null,
        sessions: () => [...sessions.values()],
        machineOnline: (_namespace, machineId) => machineId !== 'offline',
        changed: (_namespace, id) => changes.push(id),
        timeline: (_namespace, _id, text) => lines.push(text),
        stopSession: async (_namespace, id) => { stopped.push(id); sessions.get(id)!.active = false }
    })
    return {
        store, service, sessions, sent, spawned, changes, lines, stopped, addSession,
        failSpawn: (message: string | null) => { spawnError = message },
        settle: () => service.whenIdle()
    }
}


describe('TaskService guide step', () => {
    let dir = ''
    const previousKey = process.env.JEV_API_KEY
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'haqi-tasks-'))
        process.env.JEV_API_KEY = 'test-key'
    })
    afterAll(() => {
        rmSync(dir, { recursive: true, force: true })
        if (previousKey === undefined) delete process.env.JEV_API_KEY
        else process.env.JEV_API_KEY = previousKey
    })

    it('creates a task, starts a planner with the user model, takes a draft and turns the confirmation into experiences', async () => {
        const t = setup(dir)
        t.addSession({ id: 'work', name: '修引导', tags: ['haqi'] })
        t.store.messages.addMessage('work', { role: 'user', content: { type: 'text', text: '以后报告都要结论先行' }, meta: { sentFrom: 'webapp' } })
        t.store.memories.insert({
            namespace: 'default', text: '结论先行', level: 'principle', scope: '', status: 'active', reason: null, source: 'import',
            sourceLabel: null, sessionId: null, said: true, support: 1, jev: null, overridden: null, replaces: null
        })

        const created = await t.service.create('default', { text: '创建任务时帮我写验收标准\n细节见会话', tag: 'haqi', fromSessionId: 'work' })
        expect([created.status, created.name, created.repoPath, created.guide.state]).toEqual(['guiding', '创建任务时帮我写验收标准', '/repo/haqi', 'starting'])
        await t.settle()

        const started = t.service.get('default', created.id)!
        expect(started.guide.state).toBe('drafting')
        expect(started.leadSessionId).toBe('planner-1')
        expect(started.members).toEqual([{ sessionId: 'work', role: 'member' }, { sessionId: 'planner-1', role: 'lead' }])
        const prompt = t.spawned[0]!
        expect(prompt.tags).toEqual(['haqi'])
        expect(prompt.text.startsWith('[HAQI_TASK_GUIDE]')).toBe(true)
        expect(prompt.text).toContain('以后报告都要结论先行')
        expect(prompt.text).toContain('] 结论先行')
        expect(prompt.text).toContain(`task_id 填 "${created.id}"`)
        // The guide message in the planner session is not read as the user's words.
        const stored = t.store.messages.getMessages('planner-1', 10)[0]!
        expect(realUserText(stored.content as string)).toBeNull()

        expect(() => t.service.submitDraft('default', created.id, { ...DRAFT, criteria: DRAFT.criteria.slice(0, 2) })).toThrow(TaskError)
        expect(t.service.submitDraft('default', created.id, DRAFT).version).toBe(1)
        const ready = t.service.get('default', created.id)!
        expect(ready.guide.state).toBe('ready')
        expect(ready.draft?.criteria.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])

        await t.service.revise('default', created.id, '再加一条：不推送')
        expect(t.service.get('default', created.id)!.guide.state).toBe('drafting')
        expect(t.sent.at(-1)?.text).toContain('再加一条：不推送')
        expect(t.service.submitDraft('default', created.id, DRAFT).version).toBe(2)

        const confirmed = await t.service.confirm('default', created.id, {
            criteria: [{ id: 'c1', kept: true }, { id: 'c2', kept: true, text: '报告结论先行，带关键数字' }, { id: 'c3', kept: false }],
            added: [{ text: '不推送到远程' }],
            answers: { q1: 'b' }
        })
        expect(confirmed.status).toBe('active')
        expect(confirmed.guide.state).toBe('confirmed')
        expect(confirmed.draft).toBeNull()
        expect(confirmed.acceptance.map((c) => [c.text, c.source])).toEqual([
            ['bun run test 全部通过', 'repo'],
            ['报告结论先行，带关键数字', 'user'],
            ['不推送到远程', 'user']
        ])
        // The user follows the guide step in the task group's timeline.
        const heads = ['HAQI 正在读你的记忆', '第 1 版草稿好了', '第 2 版草稿好了', '你确认了目标和 3 条验收标准']
        expect(t.lines.map((line, index) => line.startsWith(heads[index] ?? '-'))).toEqual([true, true, true, true])
        // The planner has nothing to do until P4: it is stopped and stays the lead.
        expect(t.stopped).toEqual(['planner-1'])
        expect(confirmed.leadSessionId).toBe('planner-1')

        const decisions = t.store.memories.list('default').filter((m) => m.source === 'decision')
        expect(decisions.map((m) => [m.text, m.status, m.level, m.tags]).sort()).toEqual([
            ['情境：截图放哪里；选项：Linear 工单/Obsidian；你选了：Obsidian', 'active', 'experience', ['haqi']],
            ['情境：验收标准“引导面板 3 秒内出现”；选项：保留/去掉；你选了：去掉', 'active', 'experience', ['haqi']]
        ])
        const refs = t.store.memories.events('default', 20).filter((e) => e.source === 'decision').map((e) => e.sourceRef).sort()
        expect(refs).toEqual([`task:${created.id}#c3`, `task:${created.id}#q1`])
        expect(t.store.groups.getGroupNote(created.id, 'default')?.content).toContain('报告结论先行，带关键数字')

        await expect(t.service.confirm('default', created.id, { criteria: [], answers: {} })).rejects.toThrow(TaskError)
        expect(() => t.service.submitDraft('default', created.id, DRAFT)).toThrow(TaskError)
    })

    it('records why the planner could not start, and starts again on retry', async () => {
        const t = setup(dir)
        t.addSession({ id: 'work', tags: ['haqi'] })
        t.failSpawn('机器不在线')
        const task = await t.service.create('default', { text: '修一个 bug', tag: 'haqi' })
        await t.settle()
        expect(t.service.get('default', task.id)!.guide).toEqual({ state: 'failed', error: '机器不在线', request: '修一个 bug' })
        expect(t.lines.at(-1)).toBe('起草失败：机器不在线')
        t.failSpawn(null)
        await t.service.retry('default', task.id)
        await t.settle()
        expect(t.service.get('default', task.id)!.guide.state).toBe('drafting')
    })

    it('fails the guide step when no repository is known on a machine that is online', async () => {
        const t = setup(dir)
        t.addSession({ id: 'old', machineId: 'offline', tags: ['nowhere'] })
        const task = await t.service.create('default', { text: '没有仓库的任务', tag: 'nowhere' })
        expect(task.guide.state).toBe('failed')
        expect(t.spawned).toHaveLength(0)
    })

    it('starts a new planner with the last draft when the old one stopped', async () => {
        const t = setup(dir)
        t.addSession({ id: 'work', tags: ['haqi'] })
        const task = await t.service.create('default', { text: '修一个 bug', tag: 'haqi' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        t.sessions.get('planner-1')!.active = false
        await t.service.revise('default', task.id, '目标写具体一点')
        await t.settle()
        expect(t.service.get('default', task.id)!.leadSessionId).toBe('planner-2')
        expect(t.spawned[1]!.text).toContain('目标写具体一点')
        expect(t.spawned[1]!.text).toContain(DRAFT.goal)
    })

    it('creates a task with only the text: the planner picks the repository and the tag', async () => {
        const t = setup(dir)
        t.addSession({ id: 'old', path: '/repo/old', tags: ['old'], updatedAt: 1 })
        t.addSession({ id: 'new', path: '/repo/haqi', name: '修引导', tags: ['web'], updatedAt: 2 })
        const task = await t.service.create('default', { text: '修一个 bug' })
        await t.settle()
        expect([task.tag, task.repoPath, task.machineId]).toEqual(['', null, 'm1'])
        // It starts in the folder that holds the recent repositories and is told to pick one.
        expect(t.spawned[0]!.directory).toBe('/repo')
        expect(t.spawned[0]!.tags).toEqual([])
        expect(t.spawned[0]!.text).toContain('可选的仓库（你来判断在哪个做）')
        expect(t.spawned[0]!.text).toContain('- /repo/haqi（项目 haqi）：最近的会话 修引导')
        expect(t.spawned[0]!.text).toContain('repo_path')
        expect(t.spawned[0]!.text).toContain('已有的 tag（给任务选一个）')
        expect(t.spawned[0]!.text).toContain('old、web')
        const withOptions = { ...DRAFT, tag: 'Web', repoPath: '/repo/haqi', questions: [{ ...DRAFT.questions[0]!, options: [{ id: 'a', label: 'Linear 工单', good: '有截图', cost: '多一步' }, { id: 'b', label: 'Obsidian' }] }] }
        t.service.submitDraft('default', task.id, withOptions)
        const ready = t.service.get('default', task.id)!
        expect([ready.tag, ready.repoPath]).toEqual(['web', '/repo/haqi'])
        expect(() => t.service.submitDraft('default', task.id, { ...DRAFT, repoPath: 'repo/haqi' })).toThrow(TaskError)
        expect(ready.draft?.questions[0]?.options[0]).toEqual({ id: 'a', label: 'Linear 工单', good: '有截图', cost: '多一步' })
    })

    it('starts a task without the guide step as a plain discussion, and stops the planner when a task ends', async () => {
        const t = setup(dir)
        t.addSession({ id: 'work', tags: ['haqi'] })
        const plain = await t.service.create('default', { text: '聊聊下周的发布\n先拉几个会话', draft: false })
        expect([plain.status, plain.name, plain.leadSessionId, t.spawned.length]).toEqual(['active', '聊聊下周的发布', null, 0])
        expect(t.store.groups.getGroupByNamespace(plain.id, 'default')?.description).toBe('聊聊下周的发布\n先拉几个会话')

        const task = await t.service.create('default', { text: '修一个 bug' })
        await t.settle()
        t.service.update('default', task.id, { status: 'abandoned' })
        await Promise.resolve()
        expect(t.stopped).toEqual(['planner-1'])
    })

    it('finds the folder that holds the repositories', () => {
        expect(commonFolder(['/u/p/haqi', '/u/p/fish', '/u/p/haqi-wt'])).toBe('/u/p')
        expect(commonFolder(['/u/p/haqi'])).toBe('/u/p')
        expect(commonFolder(['/a/x', '/b/y'])).toBeNull()
        expect(commonFolder([])).toBeNull()
    })

    it('keeps the state machine: no going back to guiding, done can be reopened', async () => {
        const t = setup(dir)
        t.addSession({ id: 'work', tags: ['haqi'] })
        const task = await t.service.create('default', { text: '修一个 bug', tag: 'haqi' })
        expect(() => t.service.update('default', task.id, { status: 'done' })).toThrow(TaskTransitionError)
        t.service.update('default', task.id, { status: 'abandoned' })
        t.service.update('default', task.id, { status: 'active' })
        const done = t.service.update('default', task.id, { status: 'done' })
        expect(done.completedAt).toBeNumber()
        expect(() => t.service.update('default', task.id, { status: 'guiding' })).toThrow(TaskTransitionError)
        expect(t.service.update('default', task.id, { status: 'active' }).completedAt).toBeNull()
    })

    it('lists tasks by tag and keeps them out of the chat group list', async () => {
        const t = setup(dir)
        t.addSession({ id: 'work', tags: ['haqi'] })
        await t.service.create('default', { text: 'A', tag: 'haqi' })
        await t.service.create('default', { text: 'B', tag: 'prod', machineId: 'm1', directory: '/repo/prod' })
        t.store.groups.createGroup({ namespace: 'default', name: 'chat' })
        expect(t.service.list('default', 'haqi').map((task) => task.name)).toEqual(['A'])
        expect(t.service.list('default')).toHaveLength(2)
        expect(t.store.groups.getGroupsByNamespace('default', 'chat').map((g) => g.name)).toEqual(['chat'])
        expect(t.service.addMember('default', t.service.list('default', 'prod')[0]!.id, 'work').members).toEqual([{ sessionId: 'work', role: 'member' }])
    })
})
