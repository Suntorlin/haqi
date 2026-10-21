/**
 * A task is a group with kind "task": a goal, an acceptance list the user confirmed, member sessions and a lead
 * (planner) session. While it is "guiding", the planner drafts the acceptance list and the user confirms it.
 */

export type TaskStatus = 'guiding' | 'active' | 'done' | 'abandoned'

/** principle: from one of the user's principles; repo: from a repository convention file; inferred: the planner's guess. */
export type CriterionSource = 'principle' | 'repo' | 'inferred'

export type AcceptanceCriterion = {
    id: string
    text: string
    source: CriterionSource
    sourceRef: string | null
    verify: string
}

export type TaskDraftQuestion = {
    id: string
    text: string
    options: Array<{ id: string; label: string }>
    default: string
    /** The experience the default comes from. */
    precedentRef: string | null
}

export type TaskDraft = {
    version: number
    goal: string
    nonGoals: string[]
    criteria: AcceptanceCriterion[]
    questions: TaskDraftQuestion[]
}

/**
 * Where the guide step is: starting (the planner session is starting), drafting (the planner is writing a draft),
 * ready (a draft waits for the user), failed (the planner could not start; see `error`), confirmed.
 */
export type TaskGuideState = 'starting' | 'drafting' | 'ready' | 'failed' | 'confirmed'

/** How often the user had to step in, from the classes of their messages in the task's sessions. */
export type TaskLoad = {
    progress: number
    correction: number
    decision: number
    request: number
}

export type TaskView = {
    id: string
    name: string
    tag: string
    status: TaskStatus
    goal: string | null
    nonGoals: string[]
    acceptance: AcceptanceCriterion[]
    repoPath: string | null
    machineId: string | null
    leadSessionId: string | null
    members: Array<{ sessionId: string; role: string }>
    guide: { state: TaskGuideState; error: string | null; request: string | null }
    draft: TaskDraft | null
    load: TaskLoad | null
    createdAt: number
    updatedAt: number
    completedAt: number | null
}
