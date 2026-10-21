/**
 * A task is a group with kind "task": a goal, an acceptance list the user confirmed, member sessions and a lead
 * (planner) session. While it is "guiding", the planner drafts the acceptance list and the user confirms it.
 */

export type TaskStatus = 'guiding' | 'active' | 'done' | 'abandoned'

/**
 * principle: from one of the user's principles; repo: from a repository convention file; inferred: the planner's guess;
 * user: written or rewritten by the user in the guide step.
 */
export type CriterionSource = 'principle' | 'repo' | 'inferred' | 'user'

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
    /** `good` and `cost`: one line each on what picking the option gains and costs. */
    options: Array<{ id: string; label: string; good?: string | null; cost?: string | null }>
    default: string
    /** The experience the default comes from. */
    precedentRef: string | null
}

export type TaskDraft = {
    version: number
    /** The tag the planner picked for the task. */
    tag?: string | null
    /** The repository the planner picked. */
    repoPath?: string | null
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
    /** After the guide step: subtasks, decisions, review and report. Null while guiding. */
    run: TaskRun | null
    createdAt: number
    updatedAt: number
    completedAt: number | null
}

/**
 * Where a confirmed task is: the lead splits it (planning), executor sessions work in worktrees (running), the lead
 * merges their branches (integrating), a reviewer checks every criterion (reviewing), failed criteria go back to a
 * fixer (fixing), the report waits for the user's verdict (reporting), and the user accepts it (accepted).
 */
export type TaskPhase = 'planning' | 'running' | 'integrating' | 'reviewing' | 'fixing' | 'reporting' | 'accepted'

export type SubtaskState = 'waiting' | 'running' | 'done' | 'stuck' | 'stopped'

export type TaskSubtask = {
    id: string
    title: string
    brief: string
    criteria: string[]
    dependsOn: string[]
    /** A fix after a failed review or the user's "change it". */
    fix: boolean
    state: SubtaskState
    sessionId: string | null
    branch: string | null
    summary: string | null
    startedAt: number | null
    doneAt: number | null
}

export type TaskDecisionOption = { label: string; good?: string | null; cost?: string | null }

export type TaskDecision = {
    id: string
    question: string
    context: string | null
    options: TaskDecisionOption[]
    recommended: string | null
    askedBy: string | null
    subtaskId: string | null
    askedAt: number
    /** answered: by the user, or by a precedent in memory with high confidence. */
    answer: { label: string; by: 'user' | 'precedent'; memoryId: string | null; at: number } | null
}

/** Something the observer saw: an approval waiting, a stuck or stopped session, a risky command. */
export type TaskSignal = {
    key: string
    kind: 'approval' | 'stuck' | 'stopped' | 'danger' | 'reminded'
    text: string
    sessionId: string | null
    at: number
    /** The user was pushed a notification for it. */
    notified: boolean
}

export type CriterionVerdict = 'met' | 'not_met' | 'unclear'

export type TaskReview = {
    round: number
    results: Array<{ criterionId: string; status: CriterionVerdict; evidence: string }>
    suggestions: string[]
}

export type TaskRun = {
    phase: TaskPhase
    subtasks: TaskSubtask[]
    decisions: TaskDecision[]
    signals: TaskSignal[]
    integration: { branch: string; worktree: string; summary: string | null } | null
    review: TaskReview | null
    report: { conclusion: string; markdown: string; shareUrl: string | null; at: number } | null
}
