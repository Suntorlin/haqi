import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MemoryService } from '../memory/service'
import { Store } from '../store'
import type { RunSession } from './runService'
import { TaskError, TaskService, type TaskSession } from './taskService'

const DRAFT = {
    goal: '记忆页加归档恢复',
    nonGoals: [],
    criteria: [
        { text: '归档的记忆能恢复', source: 'inferred', verify: '点恢复后出现在列表' },
        { text: 'bun run test 通过', source: 'repo', sourceRef: 'AGENTS.md', verify: 'bun run test' },
        { text: '手机上能用', source: 'inferred', verify: '390px 截图' }
    ],
    questions: []
}

/** Embeddings answer with one flat vector, so every memory matches; nothing reaches the network. */
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
    const sessions = new Map<string, TaskSession & { thinking: boolean; worktree: RunSession['worktree']; requests: RunSession['pendingRequests'] }>()
    const spawned: Array<{ id: string; kind: 'lead' | 'worker'; directory: string; worktreeName?: string; name: string; text: string }> = []
    const sent: Array<{ sessionId: string; text: string }> = []
    const pushes: string[] = []
    const reports: string[] = []
    const stopped: string[] = []
    const approved: string[] = []
    let next = 1
    const addSession = (id: string, path: string, worktree: RunSession['worktree'] = null) => {
        sessions.set(id, { id, active: true, thinking: false, machineId: 'm1', path, name: null, tags: [], updatedAt: Date.now(), worktree, requests: [] })
        const now = Date.now()
        ;(store as unknown as { db: Database }).db.prepare(
            "INSERT INTO sessions (id, tag, namespace, created_at, updated_at, metadata, metadata_version, agent_state_version, active, active_at, seq) VALUES (?, NULL, 'default', ?, ?, ?, 1, 1, 1, ?, 0)"
        ).run(id, now, now, JSON.stringify({ path }), now)
    }
    const spawn = (kind: 'lead' | 'worker') => async (input: { directory: string; worktreeName?: string; name: string; text: string }) => {
        const id = `${kind}-${next++}`
        const worktree = input.worktreeName ? { branch: `hapi-${input.worktreeName}`, path: `/repo-worktrees/${input.worktreeName}` } : null
        addSession(id, worktree?.path ?? input.directory, worktree)
        spawned.push({ id, kind, ...input })
        return { sessionId: id }
    }
    const service = new TaskService(store, memory, {
        planner: {
            spawnAndPrompt: async (input) => spawn('lead')(input),
            send: async (sessionId, text) => { if (!sessions.get(sessionId)?.active) return false; sent.push({ sessionId, text }); return true }
        },
        session: (_ns, id) => sessions.get(id) ?? null,
        sessions: () => [...sessions.values()],
        machineOnline: () => true,
        changed: () => {},
        stopSession: async (_ns, id) => { stopped.push(id); const s = sessions.get(id); if (s) s.active = false },
        run: {
            spawnWorker: async (input) => spawn('worker')(input),
            spawnLead: async (input) => spawn('lead')(input),
            send: async (sessionId, text) => { if (!sessions.get(sessionId)?.active) return false; sent.push({ sessionId, text }); return true },
            session: (_ns, id) => {
                const s = sessions.get(id)
                return s ? { id, active: s.active, thinking: s.thinking, path: s.path, worktree: s.worktree, pendingRequests: s.requests } : null
            },
            activity: () => ({ lastMessageAt: Date.now(), commands: [] }),
            push: async (_ns, notice) => { pushes.push(notice.title) },
            createReport: (_ns, input) => { reports.push(input.markdown); return { shareUrl: 'https://example.test/share/r/x' } },
            approve: async (sessionId, requestId) => { approved.push(`${sessionId}:${requestId}`); sessions.get(sessionId)!.requests = sessions.get(sessionId)!.requests.filter((r) => r.id !== requestId) }
        }
    })
    addSession('work', '/repo')
    const settle = async () => {
        await service.whenIdle()
        for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    }
    return { store, service, runs: service.runs!, sessions, spawned, sent, pushes, reports, stopped, approved, settle }
}

describe('task run after the guide step', () => {
    let dir = ''
    const previousKey = process.env.JEV_API_KEY
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'haqi-runs-'))
        process.env.JEV_API_KEY = 'test-key'
    })
    afterAll(() => {
        rmSync(dir, { recursive: true, force: true })
        if (previousKey === undefined) delete process.env.JEV_API_KEY
        else process.env.JEV_API_KEY = previousKey
    })

    it('splits, works in worktrees, merges, reviews, fixes, reports and is accepted', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        // The lead that drafted is asked to split.
        expect(t.sent.at(-1)?.text).toContain('请拆成子任务')
        expect(t.service.get('default', task.id)!.run?.phase).toBe('planning')

        await expect(t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'ui', title: '界面', brief: '加按钮', criteria: ['c1'] }] })).rejects.toThrow(TaskError)
        await t.runs.submitPlan('default', task.id, {
            subtasks: [
                { id: 'api', title: '接口', brief: '加恢复接口', criteria: ['c1', 'c2'] },
                { id: 'ui', title: '界面', brief: '加恢复按钮', criteria: ['c3'], dependsOn: ['api'] }
            ]
        })
        await t.settle()
        let run = t.service.get('default', task.id)!.run!
        expect(run.phase).toBe('running')
        // Only the subtask without dependencies starts, in its own worktree, with every permission.
        expect(run.subtasks.map((s) => [s.id, s.state, s.branch])).toEqual([['api', 'running', 'hapi-task-' + task.id.slice(0, 6) + '-api'], ['ui', 'waiting', null]])
        const apiWorker = t.spawned.find((s) => s.name === '执行 · 接口')!
        expect(apiWorker.worktreeName).toBe(`task-${task.id.slice(0, 6)}-api`)
        expect(apiWorker.text).toContain('不推送（git push）')
        expect(apiWorker.text).toContain('[c2] bun run test 通过')

        await t.runs.subtaskDone('default', task.id, { subtaskId: 'api', summary: '加了 POST /restore', evidence: ['bun test 全过'] })
        await t.settle()
        expect(t.stopped).toContain(apiWorker.id)
        expect(t.service.get('default', task.id)!.run!.subtasks.find((s) => s.id === 'ui')!.state).toBe('running')
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'ui', summary: '加了按钮' })
        await t.settle()

        // Two branches: a merge session merges them into task/<id> in its own worktree.
        run = t.service.get('default', task.id)!.run!
        expect(run.phase).toBe('integrating')
        const merger = t.spawned.find((s) => s.name.startsWith('合并'))!
        expect(merger.text).toContain(`worktree add /repo-worktrees/task-${task.id} -b task/${task.id}`)
        await t.runs.integrated('default', task.id, { branch: `task/${task.id}`, worktreePath: `/repo-worktrees/task-${task.id}`, summary: '无冲突，测试全过' })
        await t.settle()

        // The reviewer runs in the merged worktree; one criterion fails, a fixer goes there.
        expect(t.service.get('default', task.id)!.run!.phase).toBe('reviewing')
        const reviewer = t.spawned.find((s) => s.name.startsWith('评审'))!
        expect(reviewer.directory).toBe(`/repo-worktrees/task-${task.id}`)
        await expect(t.runs.reviewSubmitted('default', task.id, { results: [{ criterionId: 'c1', status: 'met', evidence: 'ok' }] })).rejects.toThrow(TaskError)
        await t.runs.reviewSubmitted('default', task.id, { results: [
            { criterionId: 'c1', status: 'met', evidence: '能恢复' },
            { criterionId: 'c2', status: 'met', evidence: '测试全过' },
            { criterionId: 'c3', status: 'not_met', evidence: '390px 下按钮被挡住' }
        ] })
        await t.settle()
        run = t.service.get('default', task.id)!.run!
        expect(run.phase).toBe('fixing')
        const fixer = t.spawned.find((s) => s.name.startsWith('返工 1'))!
        expect([fixer.directory, fixer.worktreeName]).toEqual([`/repo-worktrees/task-${task.id}`, undefined])
        expect(fixer.text).toContain('390px 下按钮被挡住')
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'fix-1', summary: '按钮挪到上面' })
        await t.settle()
        await t.runs.reviewSubmitted('default', task.id, { results: [
            { criterionId: 'c1', status: 'met', evidence: '能恢复' },
            { criterionId: 'c2', status: 'met', evidence: '测试全过' },
            { criterionId: 'c3', status: 'met', evidence: '截图里看得到' }
        ] })
        await t.settle()

        // The report waits for the user; the user is pushed.
        const reporting = t.service.get('default', task.id)!
        expect(reporting.run!.phase).toBe('reporting')
        expect(reporting.run!.report).toMatchObject({ conclusion: `3 条验收标准全部达到，结果在本地分支 task/${task.id}（未推送）。`, shareUrl: 'https://example.test/share/r/x' })
        expect(t.reports[0]).toContain('返工 · 返工 1')
        expect(t.pushes.at(-1)).toBe('等你验收：记忆页加归档恢复')

        const accepted = await t.runs.verdict('default', task.id, { approved: true }).then(() => t.service.get('default', task.id)!)
        expect([accepted.status, accepted.run!.phase]).toEqual(['done', 'accepted'])
    })

    it('asks the user mid-way, writes the answer as an experience, and answers the same question by precedent next time', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'all', title: '全部', brief: '做完', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        const worker = t.service.get('default', task.id)!.run!.subtasks[0]!.sessionId!

        const ask = { question: '恢复后放哪个状态', options: [{ label: '生效', good: '马上能用', cost: '可能是旧的' }, { label: '观察中' }], recommended: '观察中', sessionId: worker }
        const first = await t.runs.askDecision('default', task.id, ask)
        expect(first.message).toContain('Sent to the user')
        expect(t.pushes.at(-1)).toBe('等你拍板：记忆页加归档恢复')
        const decision = t.service.get('default', task.id)!.run!.decisions[0]!
        expect([decision.subtaskId, decision.answer]).toEqual(['all', null])

        await expect(t.runs.answerDecision('default', task.id, decision.id, '删除')).rejects.toThrow(TaskError)
        await t.runs.answerDecision('default', task.id, decision.id, '观察中')
        expect(t.sent.at(-1)).toEqual({ sessionId: worker, text: `[HAQI_TASK_WORK] 任务 ${task.id}：「恢复后放哪个状态」用户选了：观察中。按这个继续。` })
        const experience = t.store.memories.list('default').find((m) => m.source === 'decision')!
        expect(experience.text).toBe('情境：恢复后放哪个状态；选项：生效/观察中；你选了：观察中')

        const again = await t.runs.askDecision('default', task.id, ask)
        expect(again.message).toContain('"观察中"')
        expect(t.service.get('default', task.id)!.run!.decisions[1]!.answer).toMatchObject({ label: '观察中', by: 'precedent', memoryId: experience.id })
    })

    it('observes: an executor waiting on an approval is pushed to the user once', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'all', title: '全部', brief: '做完', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        const worker = t.service.get('default', task.id)!.run!.subtasks[0]!.sessionId!
        t.sessions.get(worker)!.requests = [{ id: 'r1', tool: 'Bash', detail: 'git push' }]
        const before = t.pushes.length
        await t.runs.tick('default')
        await t.runs.tick('default')
        expect(t.pushes.length - before).toBe(1)
        expect(t.service.get('default', task.id)!.run!.signals.map((s) => s.kind)).toEqual(['approval'])
    })

    it('grants the lead read-only requests for the user, and pushes anything else once', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        const lead = t.service.get('default', task.id)!.leadSessionId!
        t.sessions.get(lead)!.requests = [
            { id: 'r1', tool: 'Bash', detail: 'ls', args: { command: 'for d in /a /b; do ls $d; done | head' } },
            { id: 'r2', tool: 'Bash', detail: 'rm -rf build', args: { command: 'rm -rf build' } }
        ]
        const before = t.pushes.length
        await t.runs.tick('default')
        await t.runs.tick('default')
        expect(t.approved).toEqual([`${lead}:r1`])
        expect(t.pushes.slice(before)).toEqual(['负责人等你批准：记忆页加归档恢复'])
    })

    it('sends an answer to a working session when the asker stopped, and puts decisions in later briefs', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        const lead = t.service.get('default', task.id)!.leadSessionId!
        await t.runs.askDecision('default', task.id, { question: '优先级用几档', options: [{ label: '三档' }, { label: '五档' }], sessionId: lead })
        await t.runs.submitPlan('default', task.id, {
            subtasks: [
                { id: 'a', title: '数据', brief: '加字段', criteria: ['c1', 'c2'] },
                { id: 'b', title: '界面', brief: '加选择', criteria: ['c3'], dependsOn: ['a'] }
            ]
        })
        await t.settle()
        expect(t.sessions.get(lead)!.active).toBe(false)
        const worker = t.service.get('default', task.id)!.run!.subtasks.find((s) => s.id === 'a')!.sessionId!
        await t.runs.answerDecision('default', task.id, 'd1', '五档')
        expect(t.sent.at(-1)).toMatchObject({ sessionId: worker })
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'a', summary: '加了字段' })
        await t.settle()
        expect(t.spawned.find((s) => s.name === '执行 · 界面')!.text).toContain('## 已定的决定（照做）\n- 优先级用几档 → 五档')
    })

    it('stops every working session when the task is abandoned', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'a', title: 'A', brief: 'a', criteria: ['c1', 'c2'] }, { id: 'b', title: 'B', brief: 'b', criteria: ['c3'] }] })
        await t.settle()
        const workers = t.service.get('default', task.id)!.run!.subtasks.map((s) => s.sessionId!)
        t.service.update('default', task.id, { status: 'abandoned' })
        await t.settle()
        expect(workers.every((id) => t.stopped.includes(id))).toBe(true)
    })
})
