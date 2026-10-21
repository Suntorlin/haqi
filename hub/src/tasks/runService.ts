/**
 * The task after the guide step: split (the lead), work (executor sessions, one git worktree each), merge (a merge
 * session), review (a reviewer against the acceptance list), fix (failed criteria go back), report (waits for the
 * user's verdict). The observer watches the working sessions; decisions the work needs go to the user, or are
 * answered by a precedent. Every step is a task event; the run state is read back from the log.
 */
import type { TaskRun, TaskSubtask } from '@hapi/protocol/types'
import { projectNameFor } from '../memory/harvest'
import type { MemoryService } from '../memory/service'
import type { Store } from '../store'
import type { StoredGroup } from '../store/types'
import { TaskError } from './errors'
import type { TaskKernel } from './kernel/kernel'
import {
    RUN_EVENT, RUN_LIMITS, decisionAskSchema, integratedSchema, planInputSchema, readRun, readyToStart, reviewSubmitSchema, subtaskDoneSchema
} from './kernel/run'
import { matchPrecedent } from './plugins/decisions/precedent'
import { observe, type WatchedSession } from './plugins/observer/observer'
import { isReadOnlyRequest } from './plugins/observer/readonly'
import { composeReport } from './plugins/report/report'
import {
    answerPrompt, fixPrompt, integratePrompt, planPrompt, remindPrompt, reviewPrompt, workPrompt, type TaskBrief
} from './plugins/work/prompts'

export type RunSession = {
    id: string
    active: boolean
    thinking: boolean
    path: string | null
    worktree: { branch: string; path: string | null } | null
    pendingRequests: Array<{ id: string; tool: string; detail: string; args?: unknown }>
}

export type RunHost = {
    /** Starts a session with every permission granted (yolo); in a new git worktree when `worktreeName` is set. */
    spawnWorker: (input: { machineId: string; directory: string; name: string; tags: string[]; text: string; meta: Record<string, unknown>; worktreeName?: string }) => Promise<{ sessionId: string } | { error: string }>
    /** Starts the lead (planner) again: default permissions, in the repository. */
    spawnLead: (input: { machineId: string; directory: string; name: string; tags: string[]; text: string; meta: Record<string, unknown> }) => Promise<{ sessionId: string } | { error: string }>
    send: (sessionId: string, text: string, meta: Record<string, unknown>) => Promise<boolean>
    session: (namespace: string, sessionId: string) => RunSession | null
    /** When the session last wrote, and the shell commands it ran after `since`. */
    activity: (sessionId: string, since: number) => { lastMessageAt: number; commands: string[] }
    stopSession: (namespace: string, sessionId: string) => Promise<void>
    /** Grants a permission request on the user's behalf (only read-only requests are). */
    approve: (sessionId: string, requestId: string) => Promise<void>
    timeline: (namespace: string, taskId: string, text: string) => void
    push: (namespace: string, notice: { title: string; body: string; url: string }) => Promise<void>
    createReport: (namespace: string, input: { title: string; markdown: string }) => { shareUrl: string | null }
    load: (namespace: string, sessionIds: string[], since: number) => import('@hapi/protocol/types').TaskLoad | null
}

const ACTIVE_PHASES = new Set(['running', 'integrating', 'reviewing', 'fixing'])

function meta(taskId: string, step: string): Record<string, unknown> {
    return { taskWork: { taskId, step } }
}

export class RunService {
    /** Per session: when the observer last scanned its commands. */
    private readonly scanned = new Map<string, number>()
    /** Lead approval requests already pushed to the user. */
    private readonly pushedRequests = new Set<string>()

    constructor(
        private readonly store: Store,
        private readonly kernel: TaskKernel,
        private readonly memory: MemoryService,
        private readonly host: RunHost
    ) {}

    run(namespace: string, taskId: string): TaskRun | null {
        return readRun(this.kernel.events(namespace, taskId))
    }

    // ---- planning ---------------------------------------------------------------------------------------------

    /** After the user confirms: the lead splits the task. */
    async start(namespace: string, task: StoredGroup): Promise<void> {
        this.phase(namespace, task.id, 'planning')
        this.host.timeline(namespace, task.id, '负责人正在把任务拆成子任务。')
        const brief = this.brief(task)
        const lead = task.leadSessionId ? this.host.session(namespace, task.leadSessionId) : null
        if (lead?.active && await this.host.send(lead.id, planPrompt(brief), meta(task.id, 'plan'))) return
        if (!task.machineId) return this.fail(namespace, task.id, '没有在线机器，拆不了子任务。')
        const result = await this.host.spawnLead({
            machineId: task.machineId, directory: brief.repoPath, name: `负责人 · ${task.name}`, tags: task.tag ? [task.tag] : [], text: planPrompt(brief), meta: meta(task.id, 'plan')
        })
        if ('error' in result) return this.fail(namespace, task.id, `负责人没能启动：${result.error}`)
        this.store.groups.addGroupMember({ groupId: task.id, namespace, sessionId: result.sessionId, role: 'lead' })
        this.kernel.update(namespace, task.id, { leadSessionId: result.sessionId })
    }

    async submitPlan(namespace: string, taskId: string, body: unknown): Promise<{ message: string }> {
        const task = this.requireRunning(namespace, taskId)
        const run = this.run(namespace, taskId)
        if (run && run.phase !== 'planning') throw new TaskError('The plan is already submitted; the subtasks are running.', 409)
        const parsed = planInputSchema.safeParse(body)
        if (!parsed.success) throw new TaskError(`Plan rejected: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'plan'}: ${i.message}`).join('; ')}. Fix it and submit again.`)
        const ids = new Set(task.acceptance.map((c) => c.id))
        const unknown = parsed.data.subtasks.flatMap((s) => s.criteria).filter((id) => !ids.has(id))
        if (unknown.length) throw new TaskError(`Plan rejected: unknown criteria ${unknown.join(', ')}. Use the ids from the guide message.`)
        const uncovered = task.acceptance.filter((c) => !parsed.data.subtasks.some((s) => s.criteria.includes(c.id)))
        if (uncovered.length) throw new TaskError(`Plan rejected: no subtask covers ${uncovered.map((c) => c.id).join(', ')}. Every criterion needs one.`)
        this.kernel.log(namespace, taskId, RUN_EVENT.planSubmitted, { subtasks: parsed.data.subtasks })
        this.phase(namespace, taskId, 'running')
        this.host.timeline(namespace, taskId, `拆成了 ${parsed.data.subtasks.length} 个子任务：${parsed.data.subtasks.map((s) => s.title).join('、')}。`)
        // The lead has nothing to do until the work is in; it holds about 185 MB.
        if (task.leadSessionId) void this.host.stopSession(namespace, task.leadSessionId).catch(() => {})
        void this.dispatch(namespace, taskId)
        return { message: `Plan accepted: ${parsed.data.subtasks.length} subtasks start now. You are done; stop here.` }
    }

    // ---- work -------------------------------------------------------------------------------------------------

    /** Starts every subtask that can start: dependencies done, within the concurrency limit. */
    async dispatch(namespace: string, taskId: string): Promise<void> {
        const task = this.kernel.get(namespace, taskId)
        const run = this.run(namespace, taskId)
        if (!task || !run || task.status !== 'active' || run.phase !== 'running' || !task.machineId || !task.repoPath) return
        for (const subtask of readyToStart(run)) {
            this.kernel.log(namespace, taskId, RUN_EVENT.subtaskState, { id: subtask.id, state: 'running' })
            const result = await this.host.spawnWorker({
                machineId: task.machineId,
                directory: task.repoPath,
                worktreeName: `task-${taskId.slice(0, 6)}-${subtask.id}`,
                name: `执行 · ${subtask.title}`,
                tags: task.tag ? [task.tag] : [],
                text: workPrompt(this.brief(task), subtask),
                meta: meta(taskId, `work:${subtask.id}`)
            })
            if ('error' in result) {
                this.kernel.log(namespace, taskId, RUN_EVENT.subtaskState, { id: subtask.id, state: 'stopped' })
                this.signal(namespace, task, { key: `stopped:${subtask.id}`, kind: 'stopped', text: `「${subtask.title}」没能启动：${result.error}`, sessionId: null }, true)
                continue
            }
            const session = this.host.session(namespace, result.sessionId)
            this.store.groups.addGroupMember({ groupId: taskId, namespace, sessionId: result.sessionId, role: 'worker' })
            this.kernel.log(namespace, taskId, RUN_EVENT.subtaskStarted, {
                id: subtask.id, sessionId: result.sessionId, branch: session?.worktree?.branch ?? null, worktree: session?.worktree?.path ?? session?.path ?? null
            })
            this.host.timeline(namespace, taskId, `开始做「${subtask.title}」。`)
        }
    }

    async subtaskDone(namespace: string, taskId: string, body: unknown): Promise<{ message: string }> {
        const task = this.requireRunning(namespace, taskId)
        const parsed = subtaskDoneSchema.safeParse(body)
        if (!parsed.success) throw new TaskError(`Rejected: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
        const run = this.run(namespace, taskId)
        const subtask = run?.subtasks.find((s) => s.id === parsed.data.subtaskId)
        if (!run || !subtask) throw new TaskError(`Unknown subtask ${parsed.data.subtaskId}.`, 404)
        if (subtask.state === 'done') return { message: 'Already recorded. You are done.' }
        this.kernel.log(namespace, taskId, RUN_EVENT.subtaskDone, { id: subtask.id, summary: parsed.data.summary, evidence: parsed.data.evidence })
        this.clearSignals(namespace, taskId, subtask.id)
        this.host.timeline(namespace, taskId, `「${subtask.title}」做完了：${parsed.data.summary.slice(0, 120)}`)
        if (subtask.sessionId) void this.host.stopSession(namespace, subtask.sessionId).catch(() => {})
        const after = this.run(namespace, taskId)!
        if (subtask.fix) {
            void this.startReview(namespace, task)
        } else if (after.subtasks.filter((s) => !s.fix).every((s) => s.state === 'done')) {
            void this.integrate(namespace, task)
        } else {
            void this.dispatch(namespace, taskId)
        }
        return { message: 'Recorded. You are done; stop here.' }
    }

    // ---- merge ------------------------------------------------------------------------------------------------

    private async integrate(namespace: string, task: StoredGroup): Promise<void> {
        const run = this.run(namespace, task.id)!
        const workers = run.subtasks.filter((s) => !s.fix)
        const started = this.kernel.events(namespace, task.id).filter((e) => e.type === RUN_EVENT.subtaskStarted)
        const worktreeOf = (s: TaskSubtask) => (started.filter((e) => (e.payload as { id?: string }).id === s.id).pop()?.payload as { worktree?: string | null } | undefined)?.worktree ?? null
        // One subtask: its own branch is the result.
        if (workers.length === 1 && workers[0]!.branch && worktreeOf(workers[0]!)) {
            this.kernel.log(namespace, task.id, RUN_EVENT.integrated, { branch: workers[0]!.branch, worktreePath: worktreeOf(workers[0]!), summary: workers[0]!.summary })
            return this.startReview(namespace, task)
        }
        this.phase(namespace, task.id, 'integrating')
        const repo = task.repoPath!
        const target = { branch: `task/${task.id}`, worktree: `${repo.replace(/\/$/, '')}-worktrees/task-${task.id}` }
        this.host.timeline(namespace, task.id, `子任务都做完了，正在合并到本地分支 ${target.branch}。`)
        const result = await this.host.spawnWorker({
            machineId: task.machineId!, directory: repo, name: `合并 · ${task.name}`, tags: task.tag ? [task.tag] : [],
            text: integratePrompt(this.brief(task), workers, target), meta: meta(task.id, 'integrate')
        })
        if ('error' in result) return this.fail(namespace, task.id, `合并会话没能启动：${result.error}`)
        this.store.groups.addGroupMember({ groupId: task.id, namespace, sessionId: result.sessionId, role: 'worker' })
        this.kernel.log(namespace, task.id, RUN_EVENT.subtaskAdded, { id: 'merge', title: '合并分支', brief: '', criteria: [], dependsOn: [] })
        this.kernel.log(namespace, task.id, RUN_EVENT.subtaskStarted, { id: 'merge', sessionId: result.sessionId, branch: target.branch, worktree: target.worktree })
    }

    async integrated(namespace: string, taskId: string, body: unknown): Promise<{ message: string }> {
        const task = this.requireRunning(namespace, taskId)
        const parsed = integratedSchema.safeParse(body)
        if (!parsed.success) throw new TaskError(`Rejected: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
        this.kernel.log(namespace, taskId, RUN_EVENT.integrated, parsed.data)
        const merge = this.run(namespace, taskId)?.subtasks.find((s) => s.id === 'merge')
        if (merge) {
            this.kernel.log(namespace, taskId, RUN_EVENT.subtaskDone, { id: 'merge', summary: parsed.data.summary ?? '已合并' })
            if (merge.sessionId) void this.host.stopSession(namespace, merge.sessionId).catch(() => {})
        }
        void this.startReview(namespace, task)
        return { message: 'Recorded. A reviewer checks it now; you are done.' }
    }

    // ---- review -----------------------------------------------------------------------------------------------

    private async startReview(namespace: string, task: StoredGroup): Promise<void> {
        const run = this.run(namespace, task.id)!
        if (!run.integration) return this.fail(namespace, task.id, '没有合并好的分支，评审不了。')
        const round = this.kernel.events(namespace, task.id).filter((e) => e.type === RUN_EVENT.reviewStarted).length + 1
        this.phase(namespace, task.id, 'reviewing')
        this.host.timeline(namespace, task.id, `正在按验收标准评审（第 ${round} 轮）。`)
        const evidence = [
            ...run.subtasks.filter((s) => s.summary).map((s) => `${s.fix ? '返工 · ' : ''}${s.title}：${s.summary}`),
            ...(run.integration.summary ? [`合并：${run.integration.summary}`] : [])
        ]
        const result = await this.host.spawnWorker({
            machineId: task.machineId!, directory: run.integration.worktree, name: `评审 · ${task.name}`, tags: task.tag ? [task.tag] : [],
            text: reviewPrompt(this.brief(task), evidence, round), meta: meta(task.id, `review:${round}`)
        })
        if ('error' in result) return this.fail(namespace, task.id, `评审会话没能启动：${result.error}`)
        this.store.groups.addGroupMember({ groupId: task.id, namespace, sessionId: result.sessionId, role: 'reviewer' })
        this.kernel.log(namespace, task.id, RUN_EVENT.reviewStarted, { round, sessionId: result.sessionId })
    }

    async reviewSubmitted(namespace: string, taskId: string, body: unknown): Promise<{ message: string }> {
        const task = this.requireRunning(namespace, taskId)
        const parsed = reviewSubmitSchema.safeParse(body)
        if (!parsed.success) throw new TaskError(`Review rejected: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
        const missing = task.acceptance.filter((c) => !parsed.data.results.some((r) => r.criterionId === c.id))
        if (missing.length) throw new TaskError(`Review rejected: no result for ${missing.map((c) => c.id).join(', ')}. Give one per criterion.`)
        const started = this.kernel.latest(namespace, taskId, RUN_EVENT.reviewStarted)?.payload as { round?: number; sessionId?: string } | undefined
        const round = started?.round ?? 1
        this.kernel.log(namespace, taskId, RUN_EVENT.reviewSubmitted, { round, ...parsed.data })
        if (started?.sessionId) void this.host.stopSession(namespace, started.sessionId).catch(() => {})
        const failed = parsed.data.results.filter((r) => r.status === 'not_met')
        this.host.timeline(namespace, taskId, `评审第 ${round} 轮：达到 ${parsed.data.results.filter((r) => r.status === 'met').length} 条，没达到 ${failed.length} 条。`)
        if (failed.length && round < RUN_LIMITS.reviewRounds) {
            const byId = new Map(task.acceptance.map((c) => [c.id, c]))
            void this.fix(namespace, task, failed.map((r) => `[${r.criterionId}] ${byId.get(r.criterionId)?.text ?? ''}：评审说 ${r.evidence}`), failed.map((r) => r.criterionId))
        } else {
            this.report(namespace, task)
        }
        return { message: 'Review recorded. You are done.' }
    }

    private async fix(namespace: string, task: StoredGroup, items: string[], criteria: string[]): Promise<void> {
        const run = this.run(namespace, task.id)!
        const n = run.subtasks.filter((s) => s.fix && s.id.startsWith('fix-')).length + 1
        const id = `fix-${n}`
        this.phase(namespace, task.id, 'fixing')
        this.kernel.log(namespace, task.id, RUN_EVENT.subtaskAdded, { id, title: `返工 ${n}`, brief: items.join('\n'), criteria, dependsOn: [] })
        this.host.timeline(namespace, task.id, `返工 ${n}：${items.length} 条要改。`)
        const result = await this.host.spawnWorker({
            machineId: task.machineId!, directory: run.integration!.worktree, name: `返工 ${n} · ${task.name}`, tags: task.tag ? [task.tag] : [],
            text: fixPrompt(this.brief(task), items, run.integration!.worktree, id), meta: meta(task.id, `fix:${n}`)
        })
        if ('error' in result) return this.fail(namespace, task.id, `返工会话没能启动：${result.error}`)
        this.store.groups.addGroupMember({ groupId: task.id, namespace, sessionId: result.sessionId, role: 'worker' })
        this.kernel.log(namespace, task.id, RUN_EVENT.subtaskStarted, { id, sessionId: result.sessionId, branch: run.integration!.branch, worktree: run.integration!.worktree })
    }

    // ---- report -----------------------------------------------------------------------------------------------

    private report(namespace: string, task: StoredGroup): void {
        const run = this.run(namespace, task.id)!
        const members = this.store.groups.getGroupMembersByNamespace(task.id, namespace).map((m) => m.sessionId).filter((id): id is string => Boolean(id))
        const startedAt = this.kernel.latest(namespace, task.id, RUN_EVENT.planSubmitted)?.createdAt ?? task.createdAt
        const { conclusion, markdown } = composeReport({
            name: task.name, goal: task.goal ?? task.name, acceptance: task.acceptance, run, load: this.host.load(namespace, members, task.createdAt), startedAt, now: Date.now()
        })
        const { shareUrl } = this.host.createReport(namespace, { title: `任务报告：${task.name}`, markdown })
        this.kernel.log(namespace, task.id, RUN_EVENT.reportReady, { conclusion, markdown, shareUrl })
        this.phase(namespace, task.id, 'reporting')
        this.host.timeline(namespace, task.id, `做完了，等你验收：${conclusion}`)
        void this.host.push(namespace, { title: `等你验收：${task.name}`, body: conclusion, url: `/groups/${task.id}` }).catch(() => {})
    }

    /** The user accepts the result, or asks for a change (which goes to a fixer, then review and a new report). */
    async verdict(namespace: string, taskId: string, body: { approved: boolean; text?: string }): Promise<void> {
        const task = this.requireRunning(namespace, taskId)
        const run = this.run(namespace, taskId)
        if (run?.phase !== 'reporting') throw new TaskError('There is no report to accept yet', 409)
        this.kernel.log(namespace, taskId, RUN_EVENT.verdict, body)
        if (body.approved) {
            this.phase(namespace, taskId, 'accepted')
            this.kernel.move(namespace, taskId, 'done')
            this.host.timeline(namespace, taskId, '你接收了结果，任务完成。')
            return
        }
        const text = body.text?.trim()
        if (!text) throw new TaskError('Say what to change')
        this.host.timeline(namespace, taskId, `你要改：${text}`)
        await this.fix(namespace, task, [`用户的意见：${text}`], [])
    }

    // ---- decisions --------------------------------------------------------------------------------------------

    async askDecision(namespace: string, taskId: string, body: unknown): Promise<{ message: string }> {
        const task = this.requireRunning(namespace, taskId)
        const parsed = decisionAskSchema.safeParse(body)
        if (!parsed.success) throw new TaskError(`Rejected: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'decision'}: ${i.message}`).join('; ')}`)
        const run = this.run(namespace, taskId)
        const id = `d${(run?.decisions.length ?? 0) + 1}`
        const askedBy = parsed.data.sessionId ?? null
        const subtaskId = run?.subtasks.find((s) => s.sessionId && s.sessionId === askedBy)?.id ?? null
        this.kernel.log(namespace, taskId, RUN_EVENT.decisionAsked, {
            id, question: parsed.data.question, context: parsed.data.context ?? null, options: parsed.data.options, recommended: parsed.data.recommended ?? null, askedBy, subtaskId
        })
        const labels = parsed.data.options.map((o) => o.label)
        const hits = await this.memory.search(namespace, `${parsed.data.question} ${labels.join(' / ')}`, 3, { levels: ['experience'], statuses: ['active'] }).catch(() => [])
        const precedent = matchPrecedent(labels, hits.map((h) => ({ memoryId: h.memory.id, text: h.memory.text, score: h.score })))
        if (precedent) {
            this.kernel.log(namespace, taskId, RUN_EVENT.decisionAnswered, { id, label: precedent.label, by: 'precedent', memoryId: precedent.memoryId })
            this.host.timeline(namespace, taskId, `按你以前的选择定了：${parsed.data.question} → ${precedent.label}`)
            return { message: `The user chose this before in a similar case: "${precedent.label}". Go on with it.` }
        }
        this.host.timeline(namespace, taskId, `等你拍板：${parsed.data.question}`)
        void this.host.push(namespace, { title: `等你拍板：${task.name}`, body: parsed.data.question, url: `/groups/${taskId}` }).catch(() => {})
        return { message: 'Sent to the user. Go on with the parts that do not depend on it; the answer comes to this session as a message.' }
    }

    async answerDecision(namespace: string, taskId: string, decisionId: string, label: string): Promise<void> {
        const task = this.requireRunning(namespace, taskId)
        const decision = this.run(namespace, taskId)?.decisions.find((d) => d.id === decisionId)
        if (!decision) throw new TaskError('Decision not found', 404)
        if (decision.answer) throw new TaskError('Already answered', 409)
        if (!decision.options.some((o) => o.label === label)) throw new TaskError('Pick one of the options')
        this.kernel.log(namespace, taskId, RUN_EVENT.decisionAnswered, { id: decisionId, label, by: 'user' })
        this.host.timeline(namespace, taskId, `你定了：${decision.question} → ${label}`)
        if (decision.askedBy) await this.host.send(decision.askedBy, answerPrompt(taskId, decision.question, label, 'user'), meta(taskId, `answer:${decisionId}`)).catch(() => false)
        await this.memory.recordDecision({
            namespace, situation: decision.question, options: decision.options.map((o) => o.label), chosen: label,
            project: task.repoPath ? projectNameFor(task.repoPath) : null, tags: task.tag ? [task.tag] : [], sessionId: decision.askedBy, sourceRef: `task:${taskId}#${decisionId}`
        }).catch(() => {})
    }

    // ---- observer ---------------------------------------------------------------------------------------------

    /** One look at every running task: approvals, stopped or silent sessions, risky commands. */
    async tick(namespace: string, now = Date.now()): Promise<void> {
        await this.watchLeads(namespace)
        for (const task of this.kernel.list(namespace)) {
            if (task.status !== 'active') continue
            const run = this.run(namespace, task.id)
            if (!run || !ACTIVE_PHASES.has(run.phase)) continue
            const watched: WatchedSession[] = []
            for (const subtask of run.subtasks) {
                if (!subtask.sessionId || subtask.state === 'done' || subtask.state === 'waiting') continue
                const session = this.host.session(namespace, subtask.sessionId)
                if (!session) continue
                const since = this.scanned.get(subtask.sessionId) ?? subtask.startedAt ?? now
                const activity = this.host.activity(subtask.sessionId, since)
                this.scanned.set(subtask.sessionId, now)
                watched.push({
                    subtask,
                    active: session.active,
                    thinking: session.thinking,
                    lastMessageAt: Math.max(activity.lastMessageAt, subtask.startedAt ?? 0),
                    pendingRequests: session.pendingRequests,
                    newCommands: activity.commands
                })
            }
            for (const action of observe(watched, run.signals, now)) {
                if (action.type === 'signal') this.signal(namespace, task, action.signal, action.notify)
                else if (action.type === 'clear') this.kernel.log(namespace, task.id, RUN_EVENT.signal, { key: action.key, cleared: true })
                else if (action.type === 'state') this.kernel.log(namespace, task.id, RUN_EVENT.subtaskState, { id: action.subtaskId, state: action.state })
                else if (action.type === 'remind' && action.subtask.sessionId) {
                    await this.host.send(action.subtask.sessionId, remindPrompt(task.id, action.subtask), meta(task.id, 'remind')).catch(() => false)
                }
            }
        }
    }

    /**
     * The lead runs with default permissions while it drafts and splits. A read-only request (it or a sub-agent it
     * started wants to list or search files) is granted on the user's behalf; anything else is pushed once.
     */
    private async watchLeads(namespace: string): Promise<void> {
        for (const task of this.kernel.list(namespace)) {
            if ((task.status !== 'guiding' && task.status !== 'active') || !task.leadSessionId) continue
            const lead = this.host.session(namespace, task.leadSessionId)
            if (!lead?.active) continue
            for (const request of lead.pendingRequests) {
                if (isReadOnlyRequest(request.tool, request.args)) {
                    await this.host.approve(lead.id, request.id).catch(() => {})
                    continue
                }
                if (this.pushedRequests.has(request.id)) continue
                this.pushedRequests.add(request.id)
                void this.host.push(namespace, { title: `负责人等你批准：${task.name}`, body: `${request.tool} ${request.detail}`.slice(0, 200), url: `/groups/${task.id}` }).catch(() => {})
            }
        }
    }

    // ---- helpers ----------------------------------------------------------------------------------------------

    private signal(namespace: string, task: StoredGroup, signal: { key: string; kind: string; text: string; sessionId: string | null }, notify: boolean): void {
        this.kernel.log(namespace, task.id, RUN_EVENT.signal, { ...signal, notified: notify })
        if (notify) {
            this.host.timeline(namespace, task.id, signal.text)
            void this.host.push(namespace, { title: `任务要你看一下：${task.name}`, body: signal.text, url: `/groups/${task.id}` }).catch(() => {})
        }
    }

    private clearSignals(namespace: string, taskId: string, subtaskId: string): void {
        for (const signal of this.run(namespace, taskId)?.signals ?? []) {
            if (signal.key.endsWith(`:${subtaskId}`)) this.kernel.log(namespace, taskId, RUN_EVENT.signal, { key: signal.key, cleared: true })
        }
    }

    private phase(namespace: string, taskId: string, phase: TaskRun['phase']): void {
        this.kernel.log(namespace, taskId, RUN_EVENT.phase, { phase })
    }

    private fail(namespace: string, taskId: string, text: string): void {
        const task = this.kernel.get(namespace, taskId)
        if (task) this.signal(namespace, task, { key: `failed:${Date.now()}`, kind: 'stopped', text, sessionId: null }, true)
    }

    private brief(task: StoredGroup): TaskBrief {
        return { taskId: task.id, goal: task.goal ?? task.name, nonGoals: task.nonGoals, acceptance: task.acceptance, repoPath: task.repoPath ?? '' }
    }

    private requireRunning(namespace: string, taskId: string): StoredGroup {
        const task = this.kernel.get(namespace, taskId)
        if (!task) throw new TaskError('Task not found', 404)
        if (task.status !== 'active') throw new TaskError('The task is not running', 409)
        return task
    }
}
