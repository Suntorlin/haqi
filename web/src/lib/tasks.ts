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

/** The user's edits to one draft version in the guide sheet. */
export type DraftEdits = {
    version: number
    kept: Record<string, boolean>
    texts: Record<string, string>
    answers: Record<string, string>
    goal: string | null
}

export function freshDraftEdits(draft: TaskDraft): DraftEdits {
    return {
        version: draft.version,
        kept: Object.fromEntries(draft.criteria.map((criterion) => [criterion.id, true])),
        texts: {},
        answers: Object.fromEntries(draft.questions.map((question) => [question.id, question.default])),
        goal: null
    }
}

/** What "Create task" sends: every criterion with kept or not, a text only when changed, and one option per question. */
export function confirmInputFrom(draft: TaskDraft, edits: DraftEdits): TaskConfirmInput {
    const goal = edits.goal?.trim()
    return {
        ...(goal && goal !== draft.goal ? { goal } : {}),
        criteria: draft.criteria.map((criterion) => {
            const text = edits.texts[criterion.id]?.trim()
            return { id: criterion.id, kept: edits.kept[criterion.id] !== false, ...(text && text !== criterion.text ? { text } : {}) }
        }),
        answers: Object.fromEntries(draft.questions.map((question) => [question.id, edits.answers[question.id] ?? question.default]))
    }
}
