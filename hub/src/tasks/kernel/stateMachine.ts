import type { StoredTaskStatus } from '../../store/types'

/** guiding -> active -> done; guiding or active -> abandoned. A finished task can be reopened. */
const NEXT: Record<StoredTaskStatus, readonly StoredTaskStatus[]> = {
    guiding: ['active', 'abandoned'],
    active: ['done', 'abandoned'],
    done: ['active'],
    abandoned: ['active']
}

export class TaskTransitionError extends Error {
    constructor(readonly from: StoredTaskStatus, readonly to: StoredTaskStatus) {
        super(`A task cannot go from ${from} to ${to}`)
    }
}

export function canMove(from: StoredTaskStatus, to: StoredTaskStatus): boolean {
    return NEXT[from].includes(to)
}

export function assertMove(from: StoredTaskStatus, to: StoredTaskStatus): void {
    if (from !== to && !canMove(from, to)) throw new TaskTransitionError(from, to)
}
