/**
 * After the guide step a task runs: the lead splits it, executor sessions work, the lead merges, a reviewer checks,
 * a report waits for the user. Every step is an event; the run state below is read back from the log, so the task
 * page and the report come from the same record.
 */
import type { CriterionVerdict, SubtaskState, TaskDecision, TaskPhase, TaskRun, TaskSignal, TaskSubtask, TaskWatchEntry } from '@hapi/protocol/types'
import { z } from 'zod'
import type { StoredTaskEvent } from '../../store/types'

export const RUN_EVENT = {
    phase: 'run_phase',
    planSubmitted: 'plan_submitted',
    subtaskAdded: 'subtask_added',
    subtaskStarted: 'subtask_started',
    subtaskDone: 'subtask_done',
    subtaskState: 'subtask_state',
    decisionAsked: 'decision_asked',
    decisionAnswered: 'decision_answered',
    signal: 'signal',
    /** A log-only observer entry, e.g. a read-only request it approved for the lead. */
    watch: 'watch',
    integrated: 'integrated',
    reviewStarted: 'review_started',
    reviewSubmitted: 'review_submitted',
    reportReady: 'report_ready',
    verdict: 'verdict'
} as const

/** The task page shows the newest entries of the observer's log. */
const WATCH_LOG_MAX = 50

export const RUN_LIMITS = { subtasks: 5, concurrency: 3, reviewRounds: 2 } as const

const idSchema = z.string().trim().min(1).max(40).regex(/^[a-z0-9][a-z0-9-_]*$/i, 'ids are letters, digits, - and _')

/** What the lead submits through task_plan_submit. */
export const planInputSchema = z.object({
    subtasks: z.array(z.object({
        id: idSchema,
        title: z.string().trim().min(1).max(60),
        brief: z.string().trim().min(1).max(4000),
        criteria: z.array(z.string().trim().min(1).max(40)).default([]),
        dependsOn: z.array(idSchema).default([])
    })).min(1).max(RUN_LIMITS.subtasks)
}).refine((plan) => new Set(plan.subtasks.map((s) => s.id)).size === plan.subtasks.length, { message: 'subtask ids must be unique' })
    .refine((plan) => plan.subtasks.every((s) => s.dependsOn.every((d) => d !== s.id && plan.subtasks.some((o) => o.id === d))), { message: 'depends_on must name other subtasks of this plan' })

export const subtaskDoneSchema = z.object({
    subtaskId: z.string().trim().min(1).max(60),
    summary: z.string().trim().min(1).max(4000),
    evidence: z.array(z.string().trim().min(1).max(1000)).max(20).default([])
})

export const decisionAskSchema = z.object({
    question: z.string().trim().min(1).max(300),
    context: z.string().trim().max(1000).nullish(),
    options: z.array(z.object({
        label: z.string().trim().min(1).max(80),
        good: z.string().trim().max(120).nullish(),
        cost: z.string().trim().max(120).nullish()
    })).min(2).max(4),
    recommended: z.string().trim().max(80).nullish(),
    sessionId: z.string().trim().min(1).nullish()
}).refine((d) => !d.recommended || d.options.some((o) => o.label === d.recommended), { message: 'recommended must be the label of one of the options' })

export const integratedSchema = z.object({
    branch: z.string().trim().min(1).max(200),
    worktreePath: z.string().trim().regex(/^\//, 'worktree_path must be absolute').max(500),
    summary: z.string().trim().max(4000).nullish()
})

export const reviewSubmitSchema = z.object({
    results: z.array(z.object({
        criterionId: z.string().trim().min(1).max(40),
        status: z.enum(['met', 'not_met', 'unclear']),
        evidence: z.string().trim().min(1).max(2000)
    })).min(1),
    suggestions: z.array(z.string().trim().min(1).max(500)).max(10).default([])
})

export type PlanInput = z.infer<typeof planInputSchema>

type Payload = Record<string, unknown>

/** Reads the run state back from the task's events. */
export function readRun(events: StoredTaskEvent[]): TaskRun | null {
    let phase: TaskPhase | null = null
    const subtasks = new Map<string, TaskSubtask>()
    const decisions = new Map<string, TaskDecision>()
    const signals = new Map<string, TaskSignal>()
    const log: TaskWatchEntry[] = []
    let integration: TaskRun['integration'] = null
    let review: TaskRun['review'] = null
    let report: TaskRun['report'] = null

    const addSubtask = (raw: Payload, fix: boolean) => {
        const id = String(raw.id)
        subtasks.set(id, {
            id,
            title: String(raw.title ?? id),
            brief: String(raw.brief ?? ''),
            criteria: Array.isArray(raw.criteria) ? raw.criteria.map(String) : [],
            dependsOn: Array.isArray(raw.dependsOn) ? raw.dependsOn.map(String) : [],
            fix,
            state: 'waiting',
            sessionId: null,
            branch: null,
            summary: null,
            startedAt: null,
            doneAt: null
        })
    }

    for (const event of events) {
        const p = (event.payload ?? {}) as Payload
        switch (event.type) {
            case RUN_EVENT.phase:
                phase = p.phase as TaskPhase
                break
            case RUN_EVENT.planSubmitted:
                for (const id of [...subtasks.keys()]) if (!subtasks.get(id)!.fix) subtasks.delete(id)
                for (const raw of (p.subtasks as Payload[] | undefined) ?? []) addSubtask(raw, false)
                break
            case RUN_EVENT.subtaskAdded:
                addSubtask(p, true)
                break
            case RUN_EVENT.subtaskStarted: {
                const s = subtasks.get(String(p.id))
                if (s) Object.assign(s, { state: 'running', sessionId: p.sessionId ?? null, branch: p.branch ?? null, startedAt: event.createdAt })
                break
            }
            case RUN_EVENT.subtaskDone: {
                const s = subtasks.get(String(p.id))
                if (s) Object.assign(s, { state: 'done', summary: p.summary ?? null, doneAt: event.createdAt })
                break
            }
            case RUN_EVENT.subtaskState: {
                const s = subtasks.get(String(p.id))
                if (s && s.state !== 'done') s.state = p.state as SubtaskState
                break
            }
            case RUN_EVENT.decisionAsked:
                decisions.set(String(p.id), {
                    id: String(p.id),
                    question: String(p.question),
                    context: (p.context as string | null) ?? null,
                    options: (p.options as TaskDecision['options']) ?? [],
                    recommended: (p.recommended as string | null) ?? null,
                    askedBy: (p.askedBy as string | null) ?? null,
                    subtaskId: (p.subtaskId as string | null) ?? null,
                    askedAt: event.createdAt,
                    answer: null
                })
                break
            case RUN_EVENT.decisionAnswered: {
                const d = decisions.get(String(p.id))
                if (d) d.answer = { label: String(p.label), by: p.by === 'precedent' ? 'precedent' : 'user', memoryId: (p.memoryId as string | null) ?? null, at: event.createdAt }
                break
            }
            case RUN_EVENT.signal:
                if (p.cleared) signals.delete(String(p.key))
                else {
                    signals.set(String(p.key), {
                        key: String(p.key),
                        kind: p.kind as TaskSignal['kind'],
                        text: String(p.text),
                        sessionId: (p.sessionId as string | null) ?? null,
                        at: event.createdAt,
                        notified: Boolean(p.notified)
                    })
                    log.push({ at: event.createdAt, kind: p.kind as TaskSignal['kind'], text: String(p.text), notified: Boolean(p.notified) })
                }
                break
            case RUN_EVENT.watch:
                log.push({ at: event.createdAt, kind: p.kind as TaskWatchEntry['kind'], text: String(p.text), notified: Boolean(p.notified) })
                break
            case RUN_EVENT.integrated:
                integration = { branch: String(p.branch), worktree: String(p.worktreePath), summary: (p.summary as string | null) ?? null }
                break
            case RUN_EVENT.reviewSubmitted:
                review = {
                    round: Number(p.round ?? 1),
                    results: ((p.results as Payload[] | undefined) ?? []).map((r) => ({ criterionId: String(r.criterionId), status: r.status as CriterionVerdict, evidence: String(r.evidence) })),
                    suggestions: ((p.suggestions as unknown[] | undefined) ?? []).map(String)
                }
                break
            case RUN_EVENT.reportReady:
                report = { conclusion: String(p.conclusion), markdown: String(p.markdown), shareUrl: (p.shareUrl as string | null) ?? null, at: event.createdAt }
                break
        }
    }
    if (!phase) return null
    return {
        phase,
        subtasks: [...subtasks.values()],
        decisions: [...decisions.values()],
        signals: [...signals.values()],
        integration,
        review,
        report,
        watch: { checkedAt: null, log: log.slice(-WATCH_LOG_MAX) }
    }
}

/** Subtasks that can start now: waiting, with every dependency done, within the concurrency limit. */
export function readyToStart(run: TaskRun, limit = RUN_LIMITS.concurrency): TaskSubtask[] {
    const running = run.subtasks.filter((s) => s.state === 'running' || s.state === 'stuck').length
    const done = new Set(run.subtasks.filter((s) => s.state === 'done').map((s) => s.id))
    return run.subtasks
        .filter((s) => s.state === 'waiting' && s.dependsOn.every((d) => done.has(d)))
        .slice(0, Math.max(0, limit - running))
}
