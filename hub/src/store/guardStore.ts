import type { Database } from 'bun:sqlite'

import { safeJsonParse } from './json'
import type { StoredSessionGuard } from './types'

/** One compliance light per session: its status, the last violated memory, and the recent strikes per memory. */
export const GUARD_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS session_guards (
        session_id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL,
        reason TEXT,
        memory_id TEXT,
        strikes TEXT NOT NULL DEFAULT '{}',
        clean_streak INTEGER NOT NULL DEFAULT 0,
        checked_end_seq INTEGER NOT NULL DEFAULT -1,
        checked_turns INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_session_guards_namespace ON session_guards(namespace);
`

type GuardRow = {
    session_id: string
    namespace: string
    status: string
    reason: string | null
    memory_id: string | null
    strikes: string
    clean_streak: number
    checked_end_seq: number
    checked_turns: number
    cost_usd: number
    updated_at: number
}

/** Strikes as turn numbers per memory; a count stored before they were turn numbers starts over. */
function parseStrikes(raw: string): Record<string, number[]> {
    const parsed = safeJsonParse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const strikes: Record<string, number[]> = {}
    for (const [memoryId, turns] of Object.entries(parsed as Record<string, unknown>)) {
        if (Array.isArray(turns)) strikes[memoryId] = turns.filter((n): n is number => typeof n === 'number')
    }
    return strikes
}

function toGuard(row: GuardRow): StoredSessionGuard {
    return {
        sessionId: row.session_id,
        namespace: row.namespace,
        status: row.status === 'alert' ? 'alert' : row.status === 'warn' ? 'warn' : 'ok',
        reason: row.reason,
        memoryId: row.memory_id,
        strikes: parseStrikes(row.strikes),
        cleanStreak: row.clean_streak,
        checkedEndSeq: row.checked_end_seq,
        checkedTurns: row.checked_turns,
        costUsd: row.cost_usd,
        updatedAt: row.updated_at
    }
}

export class GuardStore {
    constructor(private readonly db: Database) {}

    get(sessionId: string): StoredSessionGuard | null {
        const row = this.db.prepare('SELECT * FROM session_guards WHERE session_id = ?').get(sessionId) as GuardRow | undefined
        return row ? toGuard(row) : null
    }

    /** The guard state of a set of sessions (an employee's), for its metrics. */
    listForSessions(sessionIds: string[]): StoredSessionGuard[] {
        if (sessionIds.length === 0) return []
        const marks = sessionIds.map(() => '?').join(', ')
        const rows = this.db.prepare(`SELECT * FROM session_guards WHERE session_id IN (${marks})`).all(...sessionIds) as GuardRow[]
        return rows.map(toGuard)
    }

    upsert(guard: StoredSessionGuard): void {
        this.db.prepare(`
            INSERT INTO session_guards (session_id, namespace, status, reason, memory_id, strikes, clean_streak, checked_end_seq, checked_turns, cost_usd, updated_at)
            VALUES (@session_id, @namespace, @status, @reason, @memory_id, @strikes, @clean_streak, @checked_end_seq, @checked_turns, @cost_usd, @updated_at)
            ON CONFLICT(session_id) DO UPDATE SET
                status = excluded.status, reason = excluded.reason, memory_id = excluded.memory_id,
                strikes = excluded.strikes, clean_streak = excluded.clean_streak,
                checked_end_seq = excluded.checked_end_seq, checked_turns = excluded.checked_turns,
                cost_usd = excluded.cost_usd, updated_at = excluded.updated_at
        `).run({
            session_id: guard.sessionId,
            namespace: guard.namespace,
            status: guard.status,
            reason: guard.reason,
            memory_id: guard.memoryId,
            strikes: JSON.stringify(guard.strikes),
            clean_streak: guard.cleanStreak,
            checked_end_seq: guard.checkedEndSeq,
            checked_turns: guard.checkedTurns,
            cost_usd: guard.costUsd,
            updated_at: guard.updatedAt
        })
    }
}
