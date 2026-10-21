import type { TaskConfirmInput, TaskDraft, TaskView } from '@/types/api'

/** Guiding and active tasks are open; done and abandoned ones are closed. */
export function isTaskOpen(task: Pick<TaskView, 'status'>): boolean {
    return task.status === 'guiding' || task.status === 'active'
}

/** Ids of the tasks a session belongs to. */
export function taskIdsOfSession(tasks: TaskView[], sessionId: string): string[] {
    return tasks.filter((task) => task.members.some((member) => member.sessionId === sessionId)).map((task) => task.id)
}

/** Session ids of each task, keyed by task id. */
export function sessionIdsByTask(tasks: TaskView[]): Map<string, string[]> {
    return new Map(tasks.map((task) => [task.id, task.members.map((member) => member.sessionId)]))
}

/** The user's edits to one draft version on the task card. */
export type DraftEdits = {
    version: number
    kept: Record<string, boolean>
    texts: Record<string, string>
    answers: Record<string, string>
    goal: string | null
    /** The whole non-goal list once the user changed it. */
    nonGoals: string[] | null
    /** Criteria the user wrote. */
    added: string[]
}

export function freshDraftEdits(draft: TaskDraft): DraftEdits {
    return {
        version: draft.version,
        kept: Object.fromEntries(draft.criteria.map((criterion) => [criterion.id, true])),
        texts: {},
        answers: Object.fromEntries(draft.questions.map((question) => [question.id, question.default])),
        goal: null,
        nonGoals: null,
        added: []
    }
}

/** Edits for a new draft version: its defaults, plus the user's own criteria and the answers that still fit. */
export function carryOver(draft: TaskDraft, previous: DraftEdits | null): DraftEdits {
    const fresh = freshDraftEdits(draft)
    if (!previous) return fresh
    const answers = { ...fresh.answers }
    for (const question of draft.questions) {
        const answer = previous.answers[question.id]
        if (answer && question.options.some((option) => option.id === answer)) answers[question.id] = answer
    }
    return { ...fresh, answers, added: previous.added.filter((text) => text.trim()) }
}

/** How many criteria "Confirm criteria" would confirm. */
export function keptCount(draft: TaskDraft, edits: DraftEdits): number {
    return draft.criteria.filter((criterion) => edits.kept[criterion.id] !== false).length
        + edits.added.filter((text) => text.trim()).length
}

/**
 * What "Confirm criteria" sends: every criterion with kept or not, a text only when changed, the criteria the user
 * wrote, the non-goals when changed, and one option per question.
 */
export function confirmInputFrom(draft: TaskDraft, edits: DraftEdits): TaskConfirmInput {
    const goal = edits.goal?.trim()
    const nonGoals = edits.nonGoals?.map((line) => line.trim()).filter(Boolean)
    const added = edits.added.map((text) => text.trim()).filter(Boolean)
    return {
        ...(goal && goal !== draft.goal ? { goal } : {}),
        ...(nonGoals && nonGoals.join('\n') !== draft.nonGoals.join('\n') ? { nonGoals } : {}),
        ...(added.length > 0 ? { added: added.map((text) => ({ text })) } : {}),
        criteria: draft.criteria.map((criterion) => {
            const text = edits.texts[criterion.id]?.trim()
            return { id: criterion.id, kept: edits.kept[criterion.id] !== false, ...(text && text !== criterion.text ? { text } : {}) }
        }),
        answers: Object.fromEntries(draft.questions.map((question) => [question.id, edits.answers[question.id] ?? question.default]))
    }
}
