import type { Database } from 'bun:sqlite'

import {
    createReviewLoop,
    createReviewRound,
    deleteReviewLoop,
    getLatestReviewRound,
    getReviewLoopByNamespace,
    getReviewLoopsByNamespace,
    getReviewRoundByNamespace,
    getReviewRoundsByLoop,
    listReviewLoopsForEmployee,
    updateReviewLoop,
    updateReviewRound
} from './reviewLoops'
import type {
    StoredReviewLoop,
    StoredReviewLoopStatus,
    StoredReviewLoopUserPreference,
    StoredReviewRound,
    StoredReviewRoundStatus
} from './types'

export class ReviewLoopStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    createReviewLoop(options: {
        namespace: string
        workerSessionId: string
        reviewerSessionId: string
        requirement: string
        acceptanceCriteria: string
        maxRounds?: number
        userPreference?: StoredReviewLoopUserPreference
        employeeId?: string | null
    }): StoredReviewLoop {
        return createReviewLoop(this.db, options)
    }

    getReviewLoopsByNamespace(namespace: string): StoredReviewLoop[] {
        return getReviewLoopsByNamespace(this.db, namespace)
    }

    listForEmployee(namespace: string, employeeId: string, since: number): StoredReviewLoop[] {
        return listReviewLoopsForEmployee(this.db, namespace, employeeId, since)
    }

    /** A deleted employee's review loops stay as history, but shed the dead employee_id. */
    clearEmployee(namespace: string, employeeId: string): number {
        return this.db.prepare('UPDATE review_loops SET employee_id = NULL WHERE namespace = ? AND employee_id = ?')
            .run(namespace, employeeId).changes
    }

    getReviewLoopByNamespace(loopId: string, namespace: string): StoredReviewLoop | null {
        return getReviewLoopByNamespace(this.db, loopId, namespace)
    }

    updateReviewLoop(options: {
        loopId: string
        namespace: string
        status?: StoredReviewLoopStatus
        userPreference?: StoredReviewLoopUserPreference
        currentRound?: number
        maxRounds?: number
    }): StoredReviewLoop | null {
        return updateReviewLoop(this.db, options)
    }

    deleteReviewLoop(options: { loopId: string; namespace: string }): boolean {
        return deleteReviewLoop(this.db, options)
    }

    createReviewRound(options: {
        loopId: string
        namespace: string
        round: number
        instruction: string
    }): StoredReviewRound {
        return createReviewRound(this.db, options)
    }

    getReviewRoundsByLoop(loopId: string, namespace: string): StoredReviewRound[] {
        return getReviewRoundsByLoop(this.db, loopId, namespace)
    }

    getReviewRoundByNamespace(roundId: string, namespace: string): StoredReviewRound | null {
        return getReviewRoundByNamespace(this.db, roundId, namespace)
    }

    getLatestReviewRound(loopId: string, namespace: string): StoredReviewRound | null {
        return getLatestReviewRound(this.db, loopId, namespace)
    }

    updateReviewRound(options: {
        roundId: string
        namespace: string
        status?: StoredReviewRoundStatus
        workerOutput?: unknown
        verdict?: unknown
    }): StoredReviewRound | null {
        return updateReviewRound(this.db, options)
    }
}
