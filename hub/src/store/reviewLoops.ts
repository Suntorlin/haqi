import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import { safeJsonParse } from './json'
import type {
    StoredReviewLoop,
    StoredReviewLoopStatus,
    StoredReviewLoopUserPreference,
    StoredReviewRound,
    StoredReviewRoundStatus
} from './types'

type DbReviewLoopRow = {
    id: string
    namespace: string
    worker_session_id: string
    reviewer_session_id: string
    requirement: string
    acceptance_criteria: string
    status: StoredReviewLoopStatus
    user_preference: StoredReviewLoopUserPreference
    current_round: number
    max_rounds: number
    employee_id?: string | null
    created_at: number
    updated_at: number
}

type DbReviewRoundRow = {
    id: string
    loop_id: string
    namespace: string
    round: number
    instruction: string
    worker_output: string | null
    verdict: string | null
    status: StoredReviewRoundStatus
    started_at: number
    completed_at: number | null
}

function toStoredReviewLoop(row: DbReviewLoopRow): StoredReviewLoop {
    return {
        id: row.id,
        namespace: row.namespace,
        workerSessionId: row.worker_session_id,
        reviewerSessionId: row.reviewer_session_id,
        requirement: row.requirement,
        acceptanceCriteria: row.acceptance_criteria,
        status: row.status,
        userPreference: row.user_preference,
        currentRound: row.current_round,
        maxRounds: row.max_rounds,
        employeeId: row.employee_id ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredReviewRound(row: DbReviewRoundRow): StoredReviewRound {
    return {
        id: row.id,
        loopId: row.loop_id,
        namespace: row.namespace,
        round: row.round,
        instruction: row.instruction,
        workerOutput: row.worker_output ? safeJsonParse(row.worker_output) : null,
        verdict: row.verdict ? safeJsonParse(row.verdict) : null,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at
    }
}

// ---- ReviewLoop CRUD ----

export function createReviewLoop(
    db: Database,
    options: {
        namespace: string
        workerSessionId: string
        reviewerSessionId: string
        requirement: string
        acceptanceCriteria: string
        maxRounds?: number
        userPreference?: StoredReviewLoopUserPreference
        /** The employee whose work this loop reviews; its metrics count the loop. */
        employeeId?: string | null
    }
): StoredReviewLoop {
    const now = Date.now()
    const id = randomUUID()

    db.prepare(`
        INSERT INTO review_loops (
            id, namespace, worker_session_id, reviewer_session_id,
            requirement, acceptance_criteria, status, user_preference,
            current_round, max_rounds, employee_id, created_at, updated_at
        ) VALUES (
            @id, @namespace, @worker_session_id, @reviewer_session_id,
            @requirement, @acceptance_criteria, @status, @user_preference,
            @current_round, @max_rounds, @employee_id, @created_at, @updated_at
        )
    `).run({
        id,
        namespace: options.namespace,
        worker_session_id: options.workerSessionId,
        reviewer_session_id: options.reviewerSessionId,
        requirement: options.requirement,
        acceptance_criteria: options.acceptanceCriteria,
        status: 'executing',
        user_preference: options.userPreference ?? 'auto',
        current_round: 0,
        max_rounds: options.maxRounds ?? 10,
        employee_id: options.employeeId ?? null,
        created_at: now,
        updated_at: now
    })

    const row = db.prepare('SELECT * FROM review_loops WHERE id = ?').get(id) as DbReviewLoopRow | undefined
    if (!row) {
        throw new Error('Failed to create review loop')
    }
    return toStoredReviewLoop(row)
}

/** The loops that count toward one employee's metrics, inside a period. */
export function listReviewLoopsForEmployee(db: Database, namespace: string, employeeId: string, since: number): StoredReviewLoop[] {
    const rows = db.prepare(
        'SELECT * FROM review_loops WHERE namespace = ? AND employee_id = ? AND created_at >= ? ORDER BY created_at'
    ).all(namespace, employeeId, since) as DbReviewLoopRow[]
    return rows.map(toStoredReviewLoop)
}

export function getReviewLoopsByNamespace(db: Database, namespace: string): StoredReviewLoop[] {
    const rows = db.prepare(
        'SELECT * FROM review_loops WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as DbReviewLoopRow[]
    return rows.map(toStoredReviewLoop)
}

export function getReviewLoopByNamespace(
    db: Database,
    loopId: string,
    namespace: string
): StoredReviewLoop | null {
    const row = db.prepare(
        'SELECT * FROM review_loops WHERE id = ? AND namespace = ?'
    ).get(loopId, namespace) as DbReviewLoopRow | undefined
    return row ? toStoredReviewLoop(row) : null
}

export function updateReviewLoop(
    db: Database,
    options: {
        loopId: string
        namespace: string
        status?: StoredReviewLoopStatus
        userPreference?: StoredReviewLoopUserPreference
        currentRound?: number
        maxRounds?: number
    }
): StoredReviewLoop | null {
    const now = Date.now()
    const setClauses: string[] = ['updated_at = @updated_at']

    if (options.status !== undefined) {
        setClauses.push('status = @status')
    }
    if (options.userPreference !== undefined) {
        setClauses.push('user_preference = @user_preference')
    }
    if (options.currentRound !== undefined) {
        setClauses.push('current_round = @current_round')
    }
    if (options.maxRounds !== undefined) {
        setClauses.push('max_rounds = @max_rounds')
    }

    const result = db.prepare(`
        UPDATE review_loops
        SET ${setClauses.join(', ')}
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: options.loopId,
        namespace: options.namespace,
        updated_at: now,
        status: options.status ?? null,
        user_preference: options.userPreference ?? null,
        current_round: options.currentRound ?? null,
        max_rounds: options.maxRounds ?? null
    })

    if (result.changes === 0) {
        return null
    }
    return getReviewLoopByNamespace(db, options.loopId, options.namespace)
}

export function deleteReviewLoop(
    db: Database,
    options: { loopId: string; namespace: string }
): boolean {
    try {
        db.exec('BEGIN')
        db.prepare(
            'DELETE FROM review_rounds WHERE loop_id = @loop_id AND namespace = @namespace'
        ).run({ loop_id: options.loopId, namespace: options.namespace })

        const result = db.prepare(
            'DELETE FROM review_loops WHERE id = @id AND namespace = @namespace'
        ).run({ id: options.loopId, namespace: options.namespace })
        db.exec('COMMIT')
        return result.changes > 0
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}

// ---- ReviewRound CRUD ----

export function createReviewRound(
    db: Database,
    options: {
        loopId: string
        namespace: string
        round: number
        instruction: string
    }
): StoredReviewRound {
    const now = Date.now()
    const id = randomUUID()

    db.prepare(`
        INSERT INTO review_rounds (
            id, loop_id, namespace, round, instruction,
            worker_output, verdict, status, started_at, completed_at
        ) VALUES (
            @id, @loop_id, @namespace, @round, @instruction,
            NULL, NULL, 'instructed', @started_at, NULL
        )
    `).run({
        id,
        loop_id: options.loopId,
        namespace: options.namespace,
        round: options.round,
        instruction: options.instruction,
        started_at: now
    })

    const row = db.prepare('SELECT * FROM review_rounds WHERE id = ?').get(id) as DbReviewRoundRow | undefined
    if (!row) {
        throw new Error('Failed to create review round')
    }
    return toStoredReviewRound(row)
}

export function getReviewRoundsByLoop(
    db: Database,
    loopId: string,
    namespace: string
): StoredReviewRound[] {
    const rows = db.prepare(
        'SELECT * FROM review_rounds WHERE loop_id = ? AND namespace = ? ORDER BY round ASC'
    ).all(loopId, namespace) as DbReviewRoundRow[]
    return rows.map(toStoredReviewRound)
}

export function getReviewRoundByNamespace(
    db: Database,
    roundId: string,
    namespace: string
): StoredReviewRound | null {
    const row = db.prepare(
        'SELECT * FROM review_rounds WHERE id = ? AND namespace = ?'
    ).get(roundId, namespace) as DbReviewRoundRow | undefined
    return row ? toStoredReviewRound(row) : null
}

export function getLatestReviewRound(
    db: Database,
    loopId: string,
    namespace: string
): StoredReviewRound | null {
    const row = db.prepare(
        'SELECT * FROM review_rounds WHERE loop_id = ? AND namespace = ? ORDER BY round DESC LIMIT 1'
    ).get(loopId, namespace) as DbReviewRoundRow | undefined
    return row ? toStoredReviewRound(row) : null
}

export function updateReviewRound(
    db: Database,
    options: {
        roundId: string
        namespace: string
        status?: StoredReviewRoundStatus
        workerOutput?: unknown
        verdict?: unknown
    }
): StoredReviewRound | null {
    const setClauses: string[] = []

    if (options.status !== undefined) {
        setClauses.push('status = @status')
    }
    if (options.workerOutput !== undefined) {
        setClauses.push('worker_output = @worker_output')
    }
    if (options.verdict !== undefined) {
        setClauses.push('verdict = @verdict')
    }

    // Set completed_at when round reaches a terminal-ish state
    if (options.status === 'reviewed' || options.status === 'user_pending') {
        setClauses.push('completed_at = COALESCE(completed_at, @completed_at)')
    }

    if (setClauses.length === 0) {
        return getReviewRoundByNamespace(db, options.roundId, options.namespace)
    }

    const now = Date.now()
    const result = db.prepare(`
        UPDATE review_rounds
        SET ${setClauses.join(', ')}
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: options.roundId,
        namespace: options.namespace,
        status: options.status ?? null,
        worker_output: options.workerOutput !== undefined ? JSON.stringify(options.workerOutput) : null,
        verdict: options.verdict !== undefined ? JSON.stringify(options.verdict) : null,
        completed_at: now
    })

    if (result.changes === 0) {
        return null
    }
    return getReviewRoundByNamespace(db, options.roundId, options.namespace)
}
