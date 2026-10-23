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
    const lines: Array<{ text: string; report?: string }> = []
    let next = 1
    // Off by default: a stopped session stays stopped unless a test turns this on.
    let resumable = false
    // On: the task's folder is not a git repository, so a worktree cannot be made.
    let plainFolder = false
    let spawnError: string | null = null
    const addSession = (id: string, path: string, worktree: RunSession['worktree'] = null) => {
        sessions.set(id, { id, active: true, thinking: false, machineId: 'm1', path, name: null, tags: [], updatedAt: Date.now(), worktree, requests: [] })
        const now = Date.now()
        ;(store as unknown as { db: Database }).db.prepare(
            "INSERT INTO sessions (id, tag, namespace, created_at, updated_at, metadata, metadata_version, agent_state_version, active, active_at, seq) VALUES (?, NULL, 'default', ?, ?, ?, 1, 1, 1, ?, 0)"
        ).run(id, now, now, JSON.stringify({ path }), now)
    }
    const spawn = (kind: 'lead' | 'worker') => async (input: { directory: string; worktreeName?: string; name: string; text: string }): Promise<{ sessionId: string } | { error: string }> => {
        if (plainFolder && input.worktreeName) return { error: 'Path is not a Git repository: fatal: not a git repository (or any of the parent directories): .git' }
        if (spawnError && kind === 'worker') return { error: spawnError }
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
        timeline: (_ns, _id, text, extra) => { lines.push({ text, report: extra?.report?.markdown }) },
        stopSession: async (_ns, id) => { stopped.push(id); const s = sessions.get(id); if (s) s.active = false },
        run: {
            spawnWorker: async (input) => spawn('worker')(input),
            spawnLead: async (input) => spawn('lead')(input),
            send: async (sessionId, text) => { if (!sessions.get(sessionId)?.active) return false; sent.push({ sessionId, text }); return true },
            resume: async (_ns, id) => {
                const s = sessions.get(id)
                if (!resumable || !s) return null
                s.active = true
                return id
            },
            session: (_ns, id) => {
                const s = sessions.get(id)
                return s ? { id, active: s.active, thinking: s.thinking, path: s.path, worktree: s.worktree, pendingRequests: s.requests } : null
            },
            activity: () => ({ lastMessageAt: Date.now(), commands: [], lastStep: '运行 npm test' }),
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
    return {
        store, service, runs: service.runs!, sessions, addSession, spawned, sent, pushes, reports, stopped, approved, lines, settle,
        setResumable: (on: boolean) => { resumable = on },
        setPlainFolder: (on: boolean) => { plainFolder = on },
        failSpawn: (message: string | null) => { spawnError = message }
    }
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

        // The lead writes what the user gets, in the user's rules; then the report waits for the user.
        expect(t.service.get('default', task.id)!.run!.phase).toBe('delivering')
        // The lead stayed up through the run, so the hand-over goes to it as a message.
        const lead = t.service.get('default', task.id)!.leadSessionId!
        const handover = t.sent.filter((m) => m.sessionId === lead).at(-1)!
        expect([handover.text.includes('请写交给用户的交付说明'), handover.text.includes('subtask_id 填 "deliver-1"')]).toEqual([true, true])
        expect(handover.text).toContain('## 用户的原则（必须遵守）')
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'deliver-1', summary: '归档的记忆能恢复了，没推送。\n\n## 要你做的事\n1. 看分支，决定要不要合并。' })
        await t.settle()
        const reporting = t.service.get('default', task.id)!
        expect(reporting.run!.phase).toBe('reporting')
        expect(reporting.run!.report).toMatchObject({ conclusion: '归档的记忆能恢复了，没推送。', shareUrl: 'https://example.test/share/r/x' })
        expect(t.reports.at(-1)).toContain('## 要你做的事\n1. 看分支，决定要不要合并。\n\n---\n\n## 附：HAQI 的核对')
        expect(t.reports.at(-1)).toContain('返工 · 返工 1')
        expect(t.reports.at(-1)).not.toContain('负责人整理交付')
        expect(t.stopped).not.toContain(lead)
        expect(t.pushes.at(-1)).toBe('等你验收：记忆页加归档恢复')
        // The report also lands in the task's conversation, in full.
        expect(t.lines.at(-1)?.text.startsWith('做完了，等你验收：')).toBe(true)
        expect(t.lines.at(-1)?.report).toBe(t.reports.at(-1))

        // The user asks for a change: a fixer does it, the reviewer is told, and the lead replaces its hand-over.
        await t.runs.verdict('default', task.id, { approved: false, text: '报告不好读，给个简单版' })
        await t.settle()
        expect(t.service.get('default', task.id)!.run!.revisions).toMatchObject([{ request: '报告不好读，给个简单版', fixId: 'fix-2', summary: null }])
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'fix-2', summary: '写了易读版：https://example.test/share/r/easy' })
        await t.settle()
        expect(t.spawned.at(-1)!.text).toContain('验收时要改：报告不好读，给个简单版')
        expect(t.spawned.at(-1)!.text).toContain('以「用户要改：」开头')
        await t.runs.reviewSubmitted('default', task.id, { results: [
            { criterionId: 'c1', status: 'met', evidence: '能恢复' },
            { criterionId: 'c2', status: 'met', evidence: '测试全过' },
            { criterionId: 'c3', status: 'met', evidence: '截图里看得到' }
        ] })
        await t.settle()
        const second = t.sent.filter((m) => m.sessionId === lead).at(-1)!
        expect(second.text).toContain('subtask_id 填 "deliver-2"')
        expect(second.text).toContain('## 你上次交给用户的（这次要替换它）\n归档的记忆能恢复了，没推送。')
        expect(second.text).toContain('「## 按你的意见改了」')
        expect(second.text).toContain('写了易读版：https://example.test/share/r/easy')
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'deliver-2', summary: '按你的意见出了易读版。\n\n## 交付物\n- 易读版：https://example.test/share/r/easy' })
        await t.settle()
        const revised = t.service.get('default', task.id)!.run!
        expect(revised.delivery).toMatchObject({ conclusion: '按你的意见出了易读版。' })
        expect(revised.report!.conclusion).toBe('按你的意见出了易读版。')

        const accepted = await t.runs.verdict('default', task.id, { approved: true }).then(() => t.service.get('default', task.id)!)
        expect([accepted.status, accepted.run!.phase]).toEqual(['done', 'accepted'])

        // Accepted by mistake: a word in the chat says how to go on, reopening brings the report back, and a change still works.
        await t.runs.userMessage('default', task.id, '还有一处没改')
        expect(t.lines.at(-1)!.text).toContain('先在任务页点“重新打开”')
        await t.runs.reopen('default', task.id)
        const reopened = t.service.get('default', task.id)!
        expect([reopened.status, reopened.run!.phase]).toEqual(['active', 'reporting'])
        await expect(t.runs.reopen('default', task.id)).rejects.toThrow('Only an accepted task can be reopened')
        await t.runs.verdict('default', task.id, { approved: false, text: '还有一处没改' })
        await t.settle()
        expect(t.service.get('default', task.id)!.run!.phase).toBe('fixing')
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
        const run = t.service.get('default', task.id)!.run!
        expect(run.signals.map((s) => s.kind)).toEqual(['approval'])
        // The task page sees what the observer saw: the session's latest step, the approval, and the log.
        expect(run.subtasks[0]!.live).toMatchObject({ active: true, step: '运行 npm test', waiting: 'Bash git push' })
        expect(run.watch?.checkedAt).toBeGreaterThan(0)
        expect(run.watch?.log.map((e) => [e.kind, e.notified])).toEqual([['approval', true]])
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
        // The lead stays up after the split; here it has stopped (it crashed) and cannot be resumed.
        expect(t.sessions.get(lead)!.active).toBe(true)
        t.sessions.get(lead)!.active = false
        const worker = t.service.get('default', task.id)!.run!.subtasks.find((s) => s.id === 'a')!.sessionId!
        await t.runs.answerDecision('default', task.id, 'd1', '五档')
        expect(t.sent.at(-1)).toMatchObject({ sessionId: worker })
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'a', summary: '加了字段' })
        await t.settle()
        expect(t.spawned.find((s) => s.name === '执行 · 界面')!.text).toContain('## 已定的决定（照做）\n- 优先级用几档 → 五档')
    })

    it('sends what the user says in the task while it runs to the working sessions, and into later briefs', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, {
            subtasks: [
                { id: 'a', title: '数据', brief: '加字段', criteria: ['c1', 'c2'] },
                { id: 'b', title: '界面', brief: '加选择', criteria: ['c3'], dependsOn: ['a'] }
            ]
        })
        await t.settle()
        const worker = t.service.get('default', task.id)!.run!.subtasks.find((s) => s.id === 'a')!.sessionId!
        const lead = t.service.get('default', task.id)!.leadSessionId!
        await t.runs.userMessage('default', task.id, '按钮放右上角')
        // The lead hears it and answers; the executor takes it into its work.
        const toLead = t.sent.find((m) => m.sessionId === lead && m.text.includes('用户在任务页跟你说：「按钮放右上角」'))!
        expect(toLead.text).toContain('- 数据：在做')
        expect(t.sent.at(-1)).toMatchObject({ sessionId: worker })
        expect(t.sent.at(-1)!.text).toContain('用户在任务里说：「按钮放右上角」')
        expect(t.lines.at(-1)!.text).toBe('负责人收到了，也转给了正在干活的 1 个会话。')
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'a', summary: '加了字段' })
        await t.settle()
        expect(t.spawned.find((s) => s.name === '执行 · 界面')!.text).toContain('## 用户在任务里说过的话（照顾到）\n- 按钮放右上角')
    })

    it('takes the words to the lead when nobody else works, wakes a stopped lead, and says so when no one can take them', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'a', title: 'A', brief: 'a', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        const worker = t.service.get('default', task.id)!.run!.subtasks[0]!.sessionId!
        const lead = t.service.get('default', task.id)!.leadSessionId!
        t.sessions.get(worker)!.active = false
        await t.runs.userMessage('default', task.id, '会话又出问题了')
        expect(t.sent.at(-1)).toMatchObject({ sessionId: lead })
        expect(t.lines.at(-1)!.text).toBe('负责人收到了。')
        // A lead that stopped is resumed to hear it.
        t.sessions.get(lead)!.active = false
        t.setResumable(true)
        await t.runs.userMessage('default', task.id, '还在吗')
        expect(t.sent.at(-1)!.text).toContain('用户在任务页跟你说：「还在吗」')
        expect(t.sessions.get(lead)!.active).toBe(true)
        // No lead and no executor: the words wait in the brief.
        t.setResumable(false)
        t.sessions.get(lead)!.active = false
        const before = t.sent.length
        await t.runs.userMessage('default', task.id, '全部推进吧')
        expect(t.sent.length).toBe(before)
        expect(t.lines.at(-1)!.text).toContain('负责人起不来，也没有会话在干活')
    })

    it('follows a session that is resumed under a new id: lead, membership and run', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'a', title: 'A', brief: 'a', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        const lead = t.service.get('default', task.id)!.leadSessionId!
        const worker = t.service.get('default', task.id)!.run!.subtasks[0]!.sessionId!
        const db = (t.store as unknown as { db: Database }).db
        for (const [from, to] of [[lead, 'lead-resumed'], [worker, 'worker-resumed']] as const) {
            t.addSession(to, '/repo')
            t.service.sessionReplaced('default', from, to)
            // The merge deletes the old row; memberships must not go with it.
            db.prepare('DELETE FROM sessions WHERE id = ?').run(from)
        }
        const view = t.service.get('default', task.id)!
        expect(view.leadSessionId).toBe('lead-resumed')
        const members = t.store.groups.getGroupMembersByNamespace(task.id, 'default')
        expect(members.find((m) => m.sessionId === 'lead-resumed')?.role).toBe('lead')
        expect(members.some((m) => m.sessionId === 'worker-resumed')).toBe(true)
        expect(view.run!.subtasks[0]!.sessionId).toBe('worker-resumed')
        await t.runs.userMessage('default', task.id, '继续')
        expect(t.sent.at(-1)).toMatchObject({ sessionId: 'worker-resumed' })
    })

    it('sends HAQI\'s report when the lead does not hand over in time, and takes a late hand-over', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'a', title: 'A', brief: 'a', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'a', summary: '做完了' })
        await t.settle()
        await t.runs.reviewSubmitted('default', task.id, { results: ['c1', 'c2', 'c3'].map((criterionId) => ({ criterionId, status: 'met', evidence: 'ok' })) })
        await t.settle()
        expect(t.service.get('default', task.id)!.run!.phase).toBe('delivering')
        await t.runs.tick('default', Date.now() + 5 * 60_000)
        expect(t.service.get('default', task.id)!.run!.phase).toBe('delivering')
        await t.runs.tick('default', Date.now() + 21 * 60_000)
        const fallback = t.service.get('default', task.id)!.run!
        expect(fallback.phase).toBe('reporting')
        expect(fallback.report!.conclusion.startsWith('3 条验收标准全部达到')).toBe(true)
        expect(t.lines.some((l) => l.text.includes('负责人 20 分钟没交交付说明'))).toBe(true)
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'deliver-1', summary: '晚到的交付说明。' })
        await t.settle()
        expect(t.service.get('default', task.id)!.run!.report!.conclusion).toBe('晚到的交付说明。')
    })

    it('sends the user\'s ask-back to the asker, and its next question replaces the old one', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'a', title: '数据', brief: 'a', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        const worker = t.service.get('default', task.id)!.run!.subtasks[0]!.sessionId!
        await t.runs.askDecision('default', task.id, { question: '用哪条测试路', options: [{ label: '本地' }, { label: 'dev' }], sessionId: worker })
        await t.runs.askDecision('default', task.id, { question: '要不要写 Linear', options: [{ label: '要' }, { label: '不要' }], sessionId: 'lead-x' })
        const result = await t.runs.askAboutDecision('default', task.id, 'd1', 'scale api 是哪个？')
        expect(result.to).toBe('数据')
        expect(t.sent.at(-1)).toMatchObject({ sessionId: worker })
        expect(t.sent.at(-1)!.text).toContain('用户没选，反问了：「scale api 是哪个？」')
        expect(t.lines.at(-1)!.text).toBe('你问了「用哪条测试路」：scale api 是哪个？（已转给数据）')
        expect(t.service.get('default', task.id)!.run!.decisions.find((d) => d.id === 'd1')!.asked).toMatchObject({ text: 'scale api 是哪个？', to: worker })
        // The asker answers by asking again: the new question replaces d1, the other one stays, ids do not repeat.
        await t.runs.askDecision('default', task.id, { question: '用本地测试路，行吗', context: 'scale api 是 billing-cost-api，不是模型接口。', options: [{ label: '行' }, { label: '不行' }], sessionId: worker })
        expect(t.service.get('default', task.id)!.run!.decisions.map((d) => d.id)).toEqual(['d2', 'd3'])
        // Nobody to take it: the asker and the lead have stopped.
        t.sessions.get(worker)!.active = false
        t.sessions.get(t.service.get('default', task.id)!.leadSessionId!)!.active = false
        await expect(t.runs.askAboutDecision('default', task.id, 'd3', '为什么')).rejects.toThrow('都起不来')
    })

    it('works in a folder that is not a git repository: no worktree, no merge, review in the folder', async () => {
        const t = setup(dir)
        t.setPlainFolder(true)
        const task = await t.service.create('default', { text: '调研 skill 并跑一次复刻', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, {
            subtasks: [
                { id: 'research', title: '调研', brief: '查同类 skill', criteria: ['c1'] },
                { id: 'pick', title: '选视频', brief: '选爆款', criteria: ['c2', 'c3'] }
            ]
        })
        await t.settle()
        let run = t.service.get('default', task.id)!.run!
        expect(run.subtasks.map((s) => s.state)).toEqual(['running', 'running'])
        const workers = t.spawned.filter((s) => s.name.startsWith('执行'))
        expect(workers.map((w) => [w.directory, w.worktreeName])).toEqual([['/repo', undefined], ['/repo', undefined]])
        expect(workers[0]!.text).toContain('/repo 不是 git 仓库：不建分支，不提交。')
        expect(workers[0]!.text).not.toContain('git commit 到你的分支')
        expect(t.lines.some((l) => l.text === '/repo 不是 git 仓库：执行者直接在这个目录里干活，不建分支。')).toBe(true)

        await t.runs.subtaskDone('default', task.id, { subtaskId: 'research', summary: '写了 /repo/research/skill.md' })
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'pick', summary: '选了一条' })
        await t.settle()
        // Nothing to merge: the reviewer goes straight to the folder.
        run = t.service.get('default', task.id)!.run!
        expect(run.phase).toBe('reviewing')
        expect(t.spawned.some((s) => s.name.startsWith('合并'))).toBe(false)
        const reviewer = t.spawned.find((s) => s.name.startsWith('评审'))!
        expect(reviewer.directory).toBe('/repo')
        expect(reviewer.text).toContain('你在任务目录里')
    })

    it('keeps the lead up through the run: the observer starts a stopped lead again, at most every few minutes', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'a', title: 'A', brief: 'a', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        const lead = t.service.get('default', task.id)!.leadSessionId!
        expect(t.stopped).not.toContain(lead)
        expect(t.sessions.get(lead)!.active).toBe(true)

        t.sessions.get(lead)!.active = false
        const now = Date.now()
        await t.runs.tick('default', now)
        expect(t.sessions.get(lead)!.active).toBe(false)
        t.setResumable(true)
        // Too soon after the last try.
        await t.runs.tick('default', now + 60_000)
        expect(t.sessions.get(lead)!.active).toBe(false)
        await t.runs.tick('default', now + 6 * 60_000)
        expect(t.sessions.get(lead)!.active).toBe(true)
        expect(t.service.get('default', task.id)!.run!.watch!.log.map((entry) => entry.text)).toContain('负责人停了，HAQI 把它拉起来了。')
    })

    it('stops every session of an archived task and does not start its lead again', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'a', title: 'A', brief: 'a', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        const lead = t.service.get('default', task.id)!.leadSessionId!
        const worker = t.service.get('default', task.id)!.run!.subtasks[0]!.sessionId!
        expect(t.store.groups.updateGroup({ groupId: task.id, namespace: 'default', archived: true })!.archivedAt).toBeNumber()
        await t.service.archived('default', task.id)
        expect(t.stopped).toEqual(expect.arrayContaining([lead, worker]))
        t.setResumable(true)
        await t.runs.tick('default', Date.now() + 10 * 60_000)
        expect(t.sessions.get(lead)!.active).toBe(false)
        // Brought back: the lead is started again.
        expect(t.store.groups.updateGroup({ groupId: task.id, namespace: 'default', archived: false })!.archivedAt).toBeNull()
        await t.runs.tick('default', Date.now() + 20 * 60_000)
        expect(t.sessions.get(lead)!.active).toBe(true)
    })

    it('starts a subtask again that could not start', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        t.failSpawn('machine offline')
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'a', title: '数据', brief: 'a', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        let subtask = t.service.get('default', task.id)!.run!.subtasks[0]!
        expect([subtask.state, subtask.sessionId]).toEqual(['stopped', null])
        expect(t.lines.some((l) => l.text === '「数据」没能启动：machine offline；HAQI 1 分钟后再试')).toBe(true)

        // The observer tries again after 1, 5 and 15 minutes; only the last failure is pushed, then it stops trying.
        const pushed = t.pushes.length
        await t.runs.tick('default', Date.now() + 30_000)
        expect(t.spawned.length).toBe(1)
        const minutes = (n: number) => Date.now() + n * 60_000 + 1_000
        await t.runs.tick('default', minutes(1))
        await t.runs.tick('default', minutes(5))
        expect(t.pushes.length).toBe(pushed)
        await t.runs.tick('default', minutes(15))
        expect(t.lines.at(-1)!.text).toBe('「数据」没能启动：machine offline；自动重试了 3 次都没起来，要你看一下')
        expect(t.pushes.length).toBe(pushed + 1)
        await t.runs.tick('default', minutes(60))
        expect(t.service.get('default', task.id)!.run!.subtasks[0]!.state).toBe('stopped')

        await expect(t.runs.restartSubtask('default', task.id, 'nope')).rejects.toThrow(TaskError)
        t.failSpawn(null)
        await t.runs.restartSubtask('default', task.id, 'a')
        subtask = t.service.get('default', task.id)!.run!.subtasks[0]!
        expect(subtask.state).toBe('running')
        expect(subtask.sessionId).toBe(t.spawned.at(-1)!.id)
        expect(t.service.get('default', task.id)!.run!.signals.filter((sig) => sig.key === 'stopped:a')).toEqual([])
        await expect(t.runs.restartSubtask('default', task.id, 'a')).rejects.toThrow('Only a stopped subtask')
    })

    it('starts a subtask that could not start once the machine is back, without the user', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        t.failSpawn('machine offline')
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'a', title: '数据', brief: 'a', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        t.failSpawn(null)
        await t.runs.tick('default', Date.now() + 61_000)
        const run = t.service.get('default', task.id)!.run!
        expect([run.subtasks[0]!.state, run.subtasks[0]!.sessionId]).toEqual(['running', t.spawned.at(-1)!.id])
        expect(run.signals).toEqual([])
    })

    it('holds an executor that finishes before the user answers its question', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'all', title: '全部', brief: '做完', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        const worker = t.service.get('default', task.id)!.run!.subtasks[0]!.sessionId!
        const asked = await t.runs.askDecision('default', task.id, { question: '截图出几版', options: [{ label: '一版' }, { label: '两版' }], sessionId: worker })
        expect(asked.message).toContain('Do not call subtask_done before the answer.')
        await expect(t.runs.subtaskDone('default', task.id, { subtaskId: 'all', summary: '做完了' })).rejects.toThrow('the user has not answered d1 "截图出几版"')
        expect(t.service.get('default', task.id)!.run!.subtasks[0]!.state).toBe('running')
        await t.runs.answerDecision('default', task.id, 'd1', '两版')
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'all', summary: '出了两版' })
        expect(t.service.get('default', task.id)!.run!.subtasks[0]!.state).toBe('done')
    })

    it('opens a change round when the user answers a question at the report', async () => {
        const t = setup(dir)
        const task = await t.service.create('default', { text: '记忆页加归档恢复', fromSessionId: 'work' })
        await t.settle()
        t.service.submitDraft('default', task.id, DRAFT)
        await t.service.confirm('default', task.id, { criteria: DRAFT.criteria.map((_c, i) => ({ id: `c${i + 1}`, kept: true })), answers: {} })
        await t.settle()
        await t.runs.submitPlan('default', task.id, { subtasks: [{ id: 'all', title: '全部', brief: '做完', criteria: ['c1', 'c2', 'c3'] }] })
        await t.settle()
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'all', summary: '做完了' })
        await t.settle()
        await t.runs.reviewSubmitted('default', task.id, { results: ['c1', 'c2', 'c3'].map((id) => ({ criterionId: id, status: 'met', evidence: 'ok' })) })
        await t.settle()
        await t.runs.subtaskDone('default', task.id, { subtaskId: 'deliver-1', summary: '做完了，没推送。' })
        await t.settle()
        expect(t.service.get('default', task.id)!.run!.phase).toBe('reporting')

        const lead = t.service.get('default', task.id)!.leadSessionId!
        await t.runs.askDecision('default', task.id, { question: '要不要推送', context: '分支有 3 个本地提交', options: [{ label: '推送' }, { label: '先不推' }], sessionId: lead })
        await t.runs.answerDecision('default', task.id, 'd1', '推送')
        await t.settle()
        const run = t.service.get('default', task.id)!.run!
        expect(run.phase).toBe('fixing')
        expect(run.revisions).toMatchObject([{ request: '拍板：要不要推送 → 推送', fixId: 'fix-1' }])
        const fixer = t.spawned.at(-1)!
        expect(fixer.name.startsWith('返工 1')).toBe(true)
        expect(fixer.text).toContain('用户拍板：「要不要推送」选了「推送」。按这个做。')
        expect(fixer.text).toContain('问题背景：分支有 3 个本地提交')
        expect(t.sent.filter((m) => m.sessionId === lead).at(-1)!.text).toContain('HAQI 已按这个开了一轮返工')
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
