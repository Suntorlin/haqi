/**
 * The task after the guide step: split (the lead), work (executor sessions, one git worktree each), merge (a merge
 * session), review (a reviewer against the acceptance list), fix (failed criteria go back), report (waits for the
 * user's verdict). The observer watches the working sessions; decisions the work needs go to the user, or are
 * answered by a precedent. Every step is a task event; the run state is read back from the log.
 */
import type { SubtaskLive, TaskDecision, TaskRun, TaskSubtask } from '@hapi/protocol/types'
import { projectNameFor } from '../memory/harvest'
import type { MemoryService } from '../memory/service'
import type { Store } from '../store'
import type { StoredGroup, StoredTaskEvent } from '../store/types'
import { TaskError } from './errors'
import type { TaskKernel } from './kernel/kernel'
import {
    DELIVERY_DETAILS, RUN_EVENT, RUN_LIMITS, currentSessionId, decisionAskSchema, deliveryTooLong, isDeliverId, integratedSchema, planInputSchema, readRun, readyToStart, reviewSubmitSchema, subtaskDoneSchema
} from './kernel/run'
import { matchPrecedent } from './plugins/decisions/precedent'
import { observe, type WatchedSession } from './plugins/observer/observer'
import { isReadOnlyRequest } from './plugins/observer/readonly'
import { composeReport } from './plugins/report/report'
import {
    answerHandedPrompt, answerPrompt, askBackPrompt, deliverPrompt, fixPrompt, integratePrompt, leadUserMessagePrompt, planPrompt, remindPrompt, reviewPrompt, userMessagePrompt, workPrompt, type TaskBrief
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
    /** Starts a stopped session again with its history; returns its id now (a resume can change it), or null. */
    resume?: (namespace: string, sessionId: string) => Promise<string | null>
    session: (namespace: string, sessionId: string) => RunSession | null
    /** When the session last wrote, the shell commands it ran after `since`, and a quota refusal as its latest reply. */
    activity: (sessionId: string, since: number) => { lastMessageAt: number; commands: string[]; lastStep?: string | null; quota?: { text: string; at: number } | null }
    stopSession: (namespace: string, sessionId: string) => Promise<void>
    /** Grants a permission request on the user's behalf (only read-only requests are). */
    approve: (sessionId: string, requestId: string) => Promise<void>
    /** A line in the task's conversation; `report` makes it the report card there. */
    timeline: (namespace: string, taskId: string, text: string, extra?: { report?: { markdown: string } }) => void
    push: (namespace: string, notice: { title: string; body: string; url: string }) => Promise<void>
    createReport: (namespace: string, input: { title: string; markdown: string }) => { shareUrl: string | null }
    load: (namespace: string, sessionIds: string[], since: number) => import('@hapi/protocol/types').TaskLoad | null
}

const ACTIVE_PHASES = new Set(['running', 'integrating', 'reviewing', 'fixing', 'delivering'])
/** The lead stays up from the split to the user's verdict, so the user always has someone to talk to. */
const LEAD_PHASES = new Set(['planning', ...ACTIVE_PHASES, 'reporting'])
/** A lead that stopped is started again at most this often. */
const LEAD_REVIVE_MS = 5 * 60_000
const NOT_A_REPO = /not a git repository/i
/** A subtask that could not start is tried again after these waits, then left to the user. */
const START_RETRY_MS = [60_000, 5 * 60_000, 15 * 60_000] as const

/** A lead that does not hand over in this time, or stops, gets replaced by HAQI's own report. */
const DELIVER_TIMEOUT_MS = 20 * 60_000
const DELIVER_START_GRACE_MS = 3 * 60_000

function meta(taskId: string, step: string): Record<string, unknown> {
    return { taskWork: { taskId, step } }
}

export class RunService {
    /** Per session: when the observer last scanned its commands. */
    private readonly scanned = new Map<string, number>()
    /** Lead approval requests already pushed to the user. */
    private readonly pushedRequests = new Set<string>()
    /** Per session: what the observer saw at its last look, shown on the task page. Memory only; refilled within a tick. */
    private readonly live = new Map<string, SubtaskLive>()
    /** When the observer last looked. */
    private checkedAt: number | null = null
    /** Per task: when HAQI last tried to start its stopped lead again. */
    private readonly leadRevivedAt = new Map<string, number>()

    constructor(
        private readonly store: Store,
        private readonly kernel: TaskKernel,
        private readonly memory: MemoryService,
        private readonly host: RunHost
    ) {}

    run(namespace: string, taskId: string): TaskRun | null {
        return readRun(this.kernel.events(namespace, taskId))
    }

    /** The run as the task page shows it: each working session's live state and when the observer last looked. */
    decorate(run: TaskRun): TaskRun {
        return {
            ...run,
            subtasks: run.subtasks.map((s) => ({ ...s, live: s.sessionId && s.state !== 'done' ? this.live.get(s.sessionId) ?? null : null })),
            watch: { checkedAt: this.checkedAt, log: run.watch?.log ?? [] }
        }
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
        // The lead stays up: the user talks to it while the executors work.
        void this.dispatch(namespace, taskId)
        return { message: `Plan accepted: ${parsed.data.subtasks.length} subtasks start now. Stop here and wait; the user may talk to you on the task page.` }
    }

    // ---- work -------------------------------------------------------------------------------------------------

    /** Starts every subtask that can start: dependencies done, within the concurrency limit. */
    async dispatch(namespace: string, taskId: string): Promise<void> {
        const task = this.kernel.get(namespace, taskId)
        const run = this.run(namespace, taskId)
        if (!task || !run || task.status !== 'active' || run.phase !== 'running' || !task.machineId || !task.repoPath) return
        for (const subtask of readyToStart(run)) {
            this.kernel.log(namespace, taskId, RUN_EVENT.subtaskState, { id: subtask.id, state: 'running' })
            const spawn = () => {
                const plain = this.isPlainFolder(namespace, taskId)
                return this.host.spawnWorker({
                    machineId: task.machineId!,
                    directory: task.repoPath!,
                    ...(plain ? {} : { worktreeName: `task-${taskId.slice(0, 6)}-${subtask.id}` }),
                    name: `执行 · ${subtask.title}`,
                    tags: task.tag ? [task.tag] : [],
                    text: workPrompt(this.brief(task), subtask),
                    meta: meta(taskId, `work:${subtask.id}`)
                })
            }
            let result = await spawn()
            // A folder that holds repositories, or one with no code: the executors work in it directly.
            if ('error' in result && NOT_A_REPO.test(result.error) && !this.isPlainFolder(namespace, taskId)) {
                this.kernel.log(namespace, taskId, RUN_EVENT.plainFolder, { directory: task.repoPath })
                this.host.timeline(namespace, taskId, `${task.repoPath} 不是 git 仓库：执行者直接在这个目录里干活，不建分支。`)
                result = await spawn()
            }
            if ('error' in result) {
                // Marked: the observer and the hand-over log `stopped` too, and only a failed start is tried again.
                this.kernel.log(namespace, taskId, RUN_EVENT.subtaskState, { id: subtask.id, state: 'stopped', startFailed: true })
                // The user hears of the first failure and of the last; the tries between are on the task page only.
                const failures = this.startFailures(namespace, taskId, subtask.id).length
                const wait = START_RETRY_MS[failures - 1]
                const next = wait ? `；HAQI ${wait / 60_000} 分钟后再试` : `；自动重试了 ${START_RETRY_MS.length} 次都没起来，要你看一下`
                this.signal(namespace, task, { key: `stopped:${subtask.id}`, kind: 'stopped', text: `「${subtask.title}」没能启动：${result.error}${next}`, sessionId: null }, failures === 1 || !wait)
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
        const tooLong = isDeliverId(subtask.id) ? deliveryTooLong(parsed.data.summary) : null
        if (tooLong) {
            throw new TaskError(`Rejected: the hand-over is too long for the user: ${tooLong}. Cut process, repeated facts and anything the user does not need to decide; keep the sections. Then call subtask_done again.`)
        }
        // An executor waits for the user's answer to its own question: an answer that comes after it stopped would
        // reach no one. The lead's hand-over is not held; its open questions go into the report.
        const open = isDeliverId(subtask.id) || !subtask.sessionId ? [] : run.decisions.filter((d) => !d.answer && d.askedBy === subtask.sessionId)
        if (open.length) {
            throw new TaskError(`Not done yet: the user has not answered ${open.map((d) => `${d.id} "${d.question}"`).join(', ')}. Stop here and wait; the answer comes to this session as a message. Do what it needs, then call subtask_done again.`, 409)
        }
        this.kernel.log(namespace, taskId, RUN_EVENT.subtaskDone, { id: subtask.id, summary: parsed.data.summary, evidence: parsed.data.evidence })
        this.clearSignals(namespace, taskId, subtask.id)
        this.host.timeline(namespace, taskId, `「${subtask.title}」做完了：${parsed.data.summary.slice(0, 120)}`)
        // The lead's hand-over is one of these; the lead stays up for the user's verdict.
        if (subtask.sessionId && subtask.sessionId !== task.leadSessionId) void this.host.stopSession(namespace, subtask.sessionId).catch(() => {})
        const after = this.run(namespace, taskId)!
        if (isDeliverId(subtask.id)) {
            // A late hand-over (HAQI's report already went out) still replaces it until the user decides.
            if (after.phase === 'delivering' || after.phase === 'reporting') this.report(namespace, task)
        } else if (subtask.fix) {
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
        // No git, nothing to merge: the results are already in the folder.
        if (this.isPlainFolder(namespace, task.id)) {
            this.kernel.log(namespace, task.id, RUN_EVENT.integrated, { branch: '', worktreePath: repo, summary: null })
            return this.startReview(namespace, task)
        }
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
        const reviewer = this.reviewer(namespace, taskId)
        if (reviewer) void this.host.stopSession(namespace, reviewer).catch(() => {})
        const failed = parsed.data.results.filter((r) => r.status === 'not_met')
        this.host.timeline(namespace, taskId, `评审第 ${round} 轮：达到 ${parsed.data.results.filter((r) => r.status === 'met').length} 条，没达到 ${failed.length} 条。`)
        if (failed.length && round < RUN_LIMITS.reviewRounds) {
            const byId = new Map(task.acceptance.map((c) => [c.id, c]))
            void this.fix(namespace, task, failed.map((r) => `[${r.criterionId}] ${byId.get(r.criterionId)?.text ?? ''}：评审说 ${r.evidence}`), failed.map((r) => r.criterionId))
        } else {
            void this.deliver(namespace, task)
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

    // ---- hand-over --------------------------------------------------------------------------------------------

    /**
     * The review is done: the lead writes what the user gets, in the user's writing rules, before the report goes
     * out. It is woken (resumed if stopped, started again if gone); if it cannot be, HAQI's own report goes out.
     */
    private async deliver(namespace: string, task: StoredGroup): Promise<void> {
        const run = this.run(namespace, task.id)!
        const id = `deliver-${run.subtasks.filter((s) => isDeliverId(s.id)).length + 1}`
        this.phase(namespace, task.id, 'delivering')
        this.kernel.log(namespace, task.id, RUN_EVENT.subtaskAdded, { id, title: '负责人整理交付', brief: '', criteria: [], dependsOn: [] })
        this.host.timeline(namespace, task.id, '评审做完了，负责人在整理交给你的东西。')
        const byId = new Map((run.review?.results ?? []).map((r) => [r.criterionId, r]))
        const text = deliverPrompt(this.brief(task), {
            subtaskId: id,
            results: task.acceptance.map((c) => `[${c.id}] ${c.text}：${byId.get(c.id) ? `${byId.get(c.id)!.status}，${byId.get(c.id)!.evidence}` : '没评审'}`),
            materials: [
                ...run.subtasks.filter((s) => s.summary && !isDeliverId(s.id)).map((s) => `${s.fix ? '返工 · ' : ''}${s.title}：${s.summary}`),
                ...(run.review?.suggestions ?? []).map((line) => `评审建议：${line}`)
            ],
            principles: this.principles(namespace, task),
            worktree: run.integration?.worktree ?? null,
            previous: run.delivery ? [run.delivery.conclusion, run.delivery.body, ...(run.delivery.details ? [DELIVERY_DETAILS, run.delivery.details] : [])].join('\n') : null
        })
        const lead = await this.wakeLead(namespace, task, text, id).catch(() => null)
        if (!lead) {
            this.kernel.log(namespace, task.id, RUN_EVENT.subtaskState, { id, state: 'stopped' })
            this.host.timeline(namespace, task.id, '负责人没能起来，先给你 HAQI 核对的版本。')
            this.report(namespace, task)
        }
    }

    /** Sends `text` to the task's lead: as it is, resumed, or a new one. Logs the hand-over subtask's start. */
    private async wakeLead(namespace: string, task: StoredGroup, text: string, subtaskId: string): Promise<string | null> {
        let id = task.leadSessionId
        if (id && !this.host.session(namespace, id)?.active) id = this.host.resume ? await this.host.resume(namespace, id).catch(() => null) : null
        if (id && this.host.session(namespace, id)?.active) {
            this.kernel.log(namespace, task.id, RUN_EVENT.subtaskStarted, { id: subtaskId, sessionId: id, branch: null })
            if (await this.host.send(id, text, meta(task.id, subtaskId))) return id
        }
        if (!task.machineId || !task.repoPath) return null
        const result = await this.host.spawnLead({
            machineId: task.machineId, directory: task.repoPath, name: `负责人 · ${task.name}`, tags: task.tag ? [task.tag] : [], text, meta: meta(task.id, subtaskId)
        })
        if ('error' in result) return null
        this.store.groups.addGroupMember({ groupId: task.id, namespace, sessionId: result.sessionId, role: 'lead' })
        this.kernel.update(namespace, task.id, { leadSessionId: result.sessionId })
        this.kernel.log(namespace, task.id, RUN_EVENT.subtaskStarted, { id: subtaskId, sessionId: result.sessionId, branch: null })
        return result.sessionId
    }

    /** The user's principles for this task: global ones, the repository's, and the tag's. */
    private principles(namespace: string, task: StoredGroup): string[] {
        const project = task.repoPath ? projectNameFor(task.repoPath) : null
        return this.store.memories.list(namespace)
            .filter((m) => m.level === 'principle' && m.status === 'active')
            .filter((m) => m.scope === '' || m.scope === project || (task.tag ? m.tags.includes(task.tag) : false))
            .map((m) => m.text)
    }

    /** A lead that stopped, or did not hand over in time: the user gets HAQI's report instead of waiting. */
    private checkDelivery(namespace: string, task: StoredGroup, run: TaskRun, now: number): void {
        const subtask = run.subtasks.filter((s) => isDeliverId(s.id)).at(-1)
        if (!subtask || subtask.state === 'done') return
        // A hand-over that never started (the hub stopped mid-way) counts from when delivering began.
        const since = subtask.startedAt ?? this.kernel.latest(namespace, task.id, RUN_EVENT.phase)?.createdAt ?? now
        const session = subtask.sessionId ? this.host.session(namespace, subtask.sessionId) : null
        const gone = !session?.active && now - since > DELIVER_START_GRACE_MS
        if (!gone && now - since <= DELIVER_TIMEOUT_MS) return
        this.kernel.log(namespace, task.id, RUN_EVENT.subtaskState, { id: subtask.id, state: 'stopped' })
        this.host.timeline(namespace, task.id, gone ? '负责人停了，没交交付说明；先给你 HAQI 核对的版本。' : '负责人 20 分钟没交交付说明；先给你 HAQI 核对的版本。')
        this.report(namespace, task)
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
        this.host.timeline(namespace, task.id, `做完了，等你验收：${conclusion}`, { report: { markdown } })
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
            await this.stopAll(namespace, taskId)
            this.host.timeline(namespace, taskId, '你接收了结果，任务完成。')
            return
        }
        const text = body.text?.trim()
        if (!text) throw new TaskError('Say what to change')
        this.host.timeline(namespace, taskId, `你要改：${text}`)
        await this.fix(namespace, task, [`用户的意见：${text}`], [])
    }

    /** An accepted task goes back to its report: the user can ask for a change, or accept again. */
    async reopen(namespace: string, taskId: string): Promise<void> {
        const task = this.kernel.get(namespace, taskId)
        if (!task) throw new TaskError('Task not found', 404)
        if (task.status !== 'done' || this.run(namespace, taskId)?.phase !== 'accepted') throw new TaskError('Only an accepted task can be reopened', 409)
        this.kernel.move(namespace, taskId, 'active')
        this.phase(namespace, taskId, 'reporting')
        this.host.timeline(namespace, taskId, '你重新打开了任务：可以点“要改”继续，或者再点“通过”。')
    }

    // ---- the user's words ------------------------------------------------------------------------------------

    /**
     * What the user says in the task's conversation while it runs goes to the sessions working now. It is also logged,
     * so every session started later gets it in its brief (the lead is stopped after the split; it is not asked).
     */
    async userMessage(namespace: string, taskId: string, text: string): Promise<void> {
        const task = this.kernel.get(namespace, taskId)
        const run = this.run(namespace, taskId)
        // An accepted task has no one working: say so, instead of dropping the words without a trace.
        if (task && run?.phase === 'accepted') {
            this.host.timeline(namespace, taskId, '这个任务已经通过了，没人在干活。要继续，先在任务页点“重新打开”。')
            return
        }
        if (!task || !run || !LEAD_PHASES.has(run.phase)) return
        this.kernel.log(namespace, taskId, RUN_EVENT.userMessage, { text })
        // The lead always hears it (started again if it stopped), and answers; the executors take it into their work.
        const lead = task.leadSessionId ? await this.reach(namespace, task.leadSessionId) : null
        const leadHeard = lead
            ? await this.host.send(lead, leadUserMessagePrompt(taskId, text, this.subtaskLines(run)), meta(taskId, 'user')).catch(() => false)
            : false
        const working = [
            ...run.subtasks.filter((s) => s.state === 'running' && s.sessionId).map((s) => s.sessionId!),
            ...(run.phase === 'reviewing' ? [this.reviewer(namespace, taskId)].filter((id): id is string => Boolean(id)) : [])
        ].filter((id) => id !== lead)
        const prompt = userMessagePrompt(taskId, text)
        let delivered = 0
        for (const sessionId of working) {
            if (!this.host.session(namespace, sessionId)?.active) continue
            if (await this.host.send(sessionId, prompt, meta(taskId, 'user')).catch(() => false)) delivered += 1
        }
        this.host.timeline(namespace, taskId, leadHeard
            ? (delivered ? `负责人收到了，也转给了正在干活的 ${delivered} 个会话。` : '负责人收到了。')
            : delivered
                ? `负责人起不来；已转给正在干活的 ${delivered} 个会话。`
                : '负责人起不来，也没有会话在干活；这句话会写进之后每个会话的指令。')
    }

    /** A session resumed under a new id: the run follows it (the group rows moved already). */
    sessionReplaced(namespace: string, taskId: string, from: string, to: string): void {
        this.kernel.log(namespace, taskId, RUN_EVENT.sessionReplaced, { from, to })
        const seen = this.live.get(from)
        if (seen) {
            this.live.delete(from)
            this.live.set(to, seen)
        }
        const scanned = this.scanned.get(from)
        if (scanned !== undefined) {
            this.scanned.delete(from)
            this.scanned.set(to, scanned)
        }
    }

    // ---- decisions --------------------------------------------------------------------------------------------

    async askDecision(namespace: string, taskId: string, body: unknown): Promise<{ message: string }> {
        const task = this.requireRunning(namespace, taskId)
        const parsed = decisionAskSchema.safeParse(body)
        if (!parsed.success) throw new TaskError(`Rejected: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'decision'}: ${i.message}`).join('; ')}`)
        const run = this.run(namespace, taskId)
        // Counted over every question ever asked: a replaced question leaves the list, its id stays taken.
        const id = `d${this.kernel.events(namespace, taskId).filter((e) => e.type === RUN_EVENT.decisionAsked).length + 1}`
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
        const executor = subtaskId !== null && !isDeliverId(subtaskId)
        return { message: `Sent to the user. Go on with the parts that do not depend on it; the answer comes to this session as a message.${executor ? ' Do not call subtask_done before the answer.' : ''}` }
    }

    /**
     * The user asks back about an open decision instead of picking. It goes to the session that asked (resumed if
     * stopped), else to the lead; that session answers by asking again, and its new question replaces this one.
     */
    async askAboutDecision(namespace: string, taskId: string, decisionId: string, text: string): Promise<{ to: string }> {
        const task = this.requireRunning(namespace, taskId)
        const decision = this.run(namespace, taskId)?.decisions.find((d) => d.id === decisionId)
        if (!decision) throw new TaskError('Decision not found', 404)
        if (decision.answer) throw new TaskError('Already answered', 409)
        const prompt = askBackPrompt(taskId, decision.question, text)
        const askMeta = meta(taskId, `ask:${decisionId}`)
        let to = decision.askedBy ? await this.reach(namespace, decision.askedBy) : null
        if (!to || !await this.host.send(to, prompt, askMeta).catch(() => false)) {
            to = task.leadSessionId ? await this.reach(namespace, task.leadSessionId) : null
            if (!to || !await this.host.send(to, prompt, askMeta).catch(() => false)) throw new TaskError('提问的会话和负责人都起不来，问不了。', 409)
        }
        const name = this.run(namespace, taskId)?.subtasks.find((s) => s.sessionId === to)?.title ?? '负责人'
        this.kernel.log(namespace, taskId, RUN_EVENT.decisionQuestioned, { id: decisionId, text, to })
        this.host.timeline(namespace, taskId, `你问了「${decision.question}」：${text}（已转给${name}）`)
        return { to: name }
    }

    /** A session that can take a message now: as it is, or resumed. */
    private async reach(namespace: string, sessionId: string): Promise<string | null> {
        if (this.host.session(namespace, sessionId)?.active) return sessionId
        const resumed = this.host.resume ? await this.host.resume(namespace, sessionId).catch(() => null) : null
        return resumed && this.host.session(namespace, resumed)?.active ? resumed : null
    }

    async answerDecision(namespace: string, taskId: string, decisionId: string, label: string): Promise<void> {
        const task = this.requireRunning(namespace, taskId)
        const decision = this.run(namespace, taskId)?.decisions.find((d) => d.id === decisionId)
        if (!decision) throw new TaskError('Decision not found', 404)
        if (decision.answer) throw new TaskError('Already answered', 409)
        if (!decision.options.some((o) => o.label === label)) throw new TaskError('Pick one of the options')
        this.kernel.log(namespace, taskId, RUN_EVENT.decisionAnswered, { id: decisionId, label, by: 'user' })
        this.host.timeline(namespace, taskId, `你定了：${decision.question} → ${label}`)
        const run = this.run(namespace, taskId)
        if (run?.phase === 'reporting' && run.integration) {
            await this.fixFromAnswer(namespace, task, decision, label)
        } else {
            // To the session that asked; if it stopped, or it is the lead (which does no work itself), also to the
            // sessions still working. Later sessions get it in their brief.
            const text = answerPrompt(taskId, decision.question, label, 'user')
            let delivered = decision.askedBy ? await this.host.send(decision.askedBy, text, meta(taskId, `answer:${decisionId}`)).catch(() => false) : false
            if (!delivered || decision.askedBy === task.leadSessionId) {
                for (const subtask of run?.subtasks ?? []) {
                    if (subtask.state !== 'running' || !subtask.sessionId || subtask.sessionId === decision.askedBy) continue
                    if (await this.host.send(subtask.sessionId, text, meta(taskId, `answer:${decisionId}`)).catch(() => false)) delivered = true
                }
            }
            if (!delivered) this.host.timeline(namespace, taskId, '提问的会话已经停了；这个决定会写进之后每个会话的指令。')
        }
        await this.memory.recordDecision({
            namespace, situation: decision.question, options: decision.options.map((o) => o.label), chosen: label,
            project: task.repoPath ? projectNameFor(task.repoPath) : null, tags: task.tag ? [task.tag] : [], sessionId: decision.askedBy, sourceRef: `task:${taskId}#${decisionId}`
        }).catch(() => {})
    }

    /**
     * An answer given at the report: nobody works then, so it opens a change round, as if the user had asked for
     * it at the report. The lead hears that the round does it.
     */
    private async fixFromAnswer(namespace: string, task: StoredGroup, decision: TaskDecision, label: string): Promise<void> {
        this.kernel.log(namespace, task.id, RUN_EVENT.verdict, { approved: false, text: `拍板：${decision.question} → ${label}` })
        this.host.timeline(namespace, task.id, '报告已出，没人在干活：按你的选择开一轮返工。')
        await this.fix(namespace, task, [`用户拍板：「${decision.question}」选了「${label}」。按这个做。`, ...(decision.context ? [`问题背景：${decision.context}`] : [])], [])
        const lead = task.leadSessionId
        if (lead && this.host.session(namespace, lead)?.active) {
            await this.host.send(lead, answerHandedPrompt(task.id, decision.question, label), meta(task.id, `answer:${decision.id}`)).catch(() => false)
        }
    }

    /** A subtask's state events since the plan. */
    private stateEvents(namespace: string, taskId: string, subtaskId: string): StoredTaskEvent[] {
        const since = this.kernel.latest(namespace, taskId, RUN_EVENT.planSubmitted)?.createdAt ?? 0
        return this.kernel.events(namespace, taskId).filter((e) => e.type === RUN_EVENT.subtaskState && e.createdAt >= since && (e.payload as { id?: unknown } | null)?.id === subtaskId)
    }

    /** The times a subtask could not start since the plan. */
    private startFailures(namespace: string, taskId: string, subtaskId: string): StoredTaskEvent[] {
        return this.stateEvents(namespace, taskId, subtaskId).filter((e) => (e.payload as { startFailed?: unknown }).startFailed === true)
    }

    /** Subtasks that could not start are tried again, after 1, 5 and 15 minutes; then the user decides. */
    private async retryStarts(namespace: string, taskId: string, run: TaskRun, now: number): Promise<void> {
        let due = false
        for (const subtask of run.subtasks) {
            if (subtask.fix || subtask.state !== 'stopped') continue
            // Stopped because its start failed, not because its session went away.
            const last = this.stateEvents(namespace, taskId, subtask.id).at(-1)
            if ((last?.payload as { startFailed?: unknown } | undefined)?.startFailed !== true) continue
            const failures = this.startFailures(namespace, taskId, subtask.id)
            const wait = START_RETRY_MS[failures.length - 1]
            if (wait === undefined || now - last!.createdAt < wait) continue
            this.clearSignals(namespace, taskId, subtask.id)
            this.kernel.log(namespace, taskId, RUN_EVENT.subtaskState, { id: subtask.id, state: 'waiting' })
            due = true
        }
        if (due) await this.dispatch(namespace, taskId)
    }

    /**
     * The user starts a stopped subtask again: its session is resumed with a nudge, or, if it never started or cannot
     * be resumed, a new executor takes it.
     */
    async restartSubtask(namespace: string, taskId: string, subtaskId: string): Promise<void> {
        this.requireRunning(namespace, taskId)
        const run = this.run(namespace, taskId)
        const subtask = run?.subtasks.find((s) => s.id === subtaskId)
        if (!run || !subtask) throw new TaskError('Subtask not found', 404)
        if (subtask.state !== 'stopped' && subtask.state !== 'stuck') throw new TaskError('Only a stopped subtask can be started again', 409)
        this.clearSignals(namespace, taskId, subtaskId)
        const resumed = subtask.sessionId ? await this.reach(namespace, subtask.sessionId) : null
        if (resumed && await this.host.send(resumed, remindPrompt(taskId, subtask), meta(taskId, `work:${subtaskId}`)).catch(() => false)) {
            this.kernel.log(namespace, taskId, RUN_EVENT.subtaskState, { id: subtaskId, state: 'running' })
            this.host.timeline(namespace, taskId, `「${subtask.title}」接着做了。`)
            return
        }
        if (subtask.fix) throw new TaskError('返工会话起不来；在任务页点“要改”再提一次。', 409)
        this.kernel.log(namespace, taskId, RUN_EVENT.subtaskState, { id: subtaskId, state: 'waiting' })
        if (run.phase !== 'running') return
        await this.dispatch(namespace, taskId)
        const after = this.run(namespace, taskId)?.subtasks.find((s) => s.id === subtaskId)
        if (after?.state === 'waiting') this.host.timeline(namespace, taskId, `「${subtask.title}」排上了：等前面的子任务做完就开始。`)
    }

    /** One line per subtask, for the lead. */
    private subtaskLines(run: TaskRun): string[] {
        const words: Record<string, string> = { waiting: '等着', running: '在做', done: '做完了', stuck: '卡住了', stopped: '停了' }
        return run.subtasks.length
            ? run.subtasks.map((s) => `${s.title}：${words[s.state] ?? s.state}${s.summary ? `。${s.summary.slice(0, 120)}` : ''}`)
            : ['还没拆子任务']
    }

    /** The lead of a running task stopped (it crashed, or the machine restarted): start it again, at most every few minutes. */
    private async keepLeadsUp(namespace: string, now: number): Promise<void> {
        if (!this.host.resume) return
        for (const task of this.kernel.list(namespace)) {
            if (task.status !== 'active' || !task.leadSessionId || task.archivedAt) continue
            const run = this.run(namespace, task.id)
            if (!run || !LEAD_PHASES.has(run.phase)) continue
            if (this.host.session(namespace, task.leadSessionId)?.active) continue
            if (now - (this.leadRevivedAt.get(task.id) ?? 0) < LEAD_REVIVE_MS) continue
            this.leadRevivedAt.set(task.id, now)
            const id = await this.host.resume(namespace, task.leadSessionId).catch(() => null)
            this.kernel.log(namespace, task.id, RUN_EVENT.watch, {
                kind: 'lead_revived', text: id ? '负责人停了，HAQI 把它拉起来了。' : '负责人停了，HAQI 拉不起来；几分钟后再试。'
            })
        }
    }

    private isPlainFolder(namespace: string, taskId: string): boolean {
        return Boolean(this.kernel.latest(namespace, taskId, RUN_EVENT.plainFolder))
    }

    // ---- observer ---------------------------------------------------------------------------------------------

    /** One look at every running task: approvals, stopped or silent sessions, risky commands. */
    async tick(namespace: string, now = Date.now()): Promise<void> {
        this.checkedAt = now
        await this.keepLeadsUp(namespace, now)
        await this.watchLeads(namespace)
        for (const task of this.kernel.list(namespace)) {
            if (task.status !== 'active' || task.archivedAt) continue
            const run = this.run(namespace, task.id)
            if (!run || !ACTIVE_PHASES.has(run.phase)) continue
            if (run.phase === 'delivering') {
                this.checkDelivery(namespace, task, run, now)
                continue
            }
            if (run.phase === 'running') await this.retryStarts(namespace, task.id, run, now)
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
                    newCommands: activity.commands,
                    quota: activity.quota ?? null
                })
                const request = session.pendingRequests[0]
                this.live.set(subtask.sessionId, {
                    active: session.active,
                    thinking: session.thinking,
                    lastActivityAt: Math.max(activity.lastMessageAt, subtask.startedAt ?? 0) || null,
                    step: activity.lastStep ?? null,
                    waiting: request ? `${request.tool} ${request.detail}`.slice(0, 200) : null
                })
            }
            // The page shows each session's latest step and when the observer looked: refresh it after every look.
            this.kernel.touch(namespace, task.id)
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
                    const approved = await this.host.approve(lead.id, request.id).then(() => true, () => false)
                    if (approved && task.status === 'active') {
                        this.kernel.log(namespace, task.id, RUN_EVENT.watch, { kind: 'auto_approved', text: `替负责人批准了只读请求：${request.tool} ${request.detail}`.slice(0, 200) })
                    }
                    continue
                }
                if (this.pushedRequests.has(request.id)) continue
                this.pushedRequests.add(request.id)
                void this.host.push(namespace, { title: `负责人等你批准：${task.name}`, body: `${request.tool} ${request.detail}`.slice(0, 200), url: `/groups/${task.id}` }).catch(() => {})
                if (task.status === 'active') {
                    this.kernel.log(namespace, task.id, RUN_EVENT.watch, { kind: 'approval', text: `负责人等你批准：${request.tool} ${request.detail}`.slice(0, 200), notified: true })
                }
            }
        }
    }

    /** A task that ends (done or abandoned) stops every session still working on it. */
    async stopAll(namespace: string, taskId: string): Promise<void> {
        const run = this.run(namespace, taskId)
        const reviewer = this.reviewer(namespace, taskId)
        const ids = [...(run?.subtasks ?? []).filter((s) => s.state !== 'done' && s.sessionId).map((s) => s.sessionId!), ...(reviewer ? [reviewer] : [])]
        for (const id of ids) {
            if (this.host.session(namespace, id)?.active) await this.host.stopSession(namespace, id).catch(() => {})
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
        const decisions = (readRun(this.kernel.events(task.namespace, task.id))?.decisions ?? [])
            .filter((d) => d.answer)
            .map((d) => ({ question: d.question, label: d.answer!.label }))
        // What the user said during the run, and what they asked to change at a report: the reviewer checks those too.
        const userMessages = this.kernel.events(task.namespace, task.id).flatMap((e) => {
            const p = (e.payload ?? {}) as { text?: unknown; approved?: unknown }
            const text = typeof p.text === 'string' ? p.text.trim() : ''
            if (!text) return []
            if (e.type === RUN_EVENT.userMessage) return [text]
            if (e.type === RUN_EVENT.verdict && p.approved === false) return [`验收时要改：${text}`]
            return []
        })
        return {
            taskId: task.id, goal: task.goal ?? task.name, nonGoals: task.nonGoals, acceptance: task.acceptance, repoPath: task.repoPath ?? '', decisions, userMessages,
            plainFolder: this.isPlainFolder(task.namespace, task.id)
        }
    }

    /** The current review's session, following a resume. */
    private reviewer(namespace: string, taskId: string): string | null {
        const started = (this.kernel.latest(namespace, taskId, RUN_EVENT.reviewStarted)?.payload as { sessionId?: string } | undefined)?.sessionId
        return started ? currentSessionId(this.kernel.events(namespace, taskId), started) : null
    }

    private requireRunning(namespace: string, taskId: string): StoredGroup {
        const task = this.kernel.get(namespace, taskId)
        if (!task) throw new TaskError('Task not found', 404)
        if (task.status !== 'active') throw new TaskError('The task is not running', 409)
        return task
    }
}
