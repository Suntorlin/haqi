import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import { safeJsonParse } from './json'
import type { StoredTaskEvent } from './types'

type TaskEventRow = {
    id: string
    namespace: string
    group_id: string
    type: string
    payload: string
    created_at: number
}

function toTaskEvent(row: TaskEventRow): StoredTaskEvent {
    return {
        id: row.id,
        namespace: row.namespace,
        groupId: row.group_id,
        type: row.type,
        payload: safeJsonParse(row.payload),
        createdAt: row.created_at
    }
}

/** The append-only log of what happened to a task. Nothing is updated or deleted, except with the task. */
export class TaskEventStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    add(input: { namespace: string; groupId: string; type: string; payload?: unknown }): StoredTaskEvent {
        const row: TaskEventRow = {
            id: randomUUID(),
            namespace: input.namespace,
            group_id: input.groupId,
            type: input.type,
            payload: JSON.stringify(input.payload ?? null),
            created_at: Date.now()
        }
        this.db.prepare(`
            INSERT INTO task_events (id, namespace, group_id, type, payload, created_at)
            VALUES (@id, @namespace, @group_id, @type, @payload, @created_at)
        `).run(row)
        return toTaskEvent(row)
    }

    list(namespace: string, groupId: string): StoredTaskEvent[] {
        const rows = this.db.prepare(`
            SELECT * FROM task_events WHERE namespace = ? AND group_id = ? ORDER BY created_at ASC, rowid ASC
        `).all(namespace, groupId) as TaskEventRow[]
        return rows.map(toTaskEvent)
    }

    /** The newest event of one type, such as the latest draft. */
    latest(namespace: string, groupId: string, type: string): StoredTaskEvent | null {
        const row = this.db.prepare(`
            SELECT * FROM task_events WHERE namespace = ? AND group_id = ? AND type = ?
            ORDER BY created_at DESC, rowid DESC LIMIT 1
        `).get(namespace, groupId, type) as TaskEventRow | null
        return row ? toTaskEvent(row) : null
    }

    /** Events of the given types across every task an employee escalated, inside a period; for its metrics. */
    listForEmployee(namespace: string, employeeId: string, types: string[], since: number): StoredTaskEvent[] {
        if (types.length === 0) return []
        const marks = types.map(() => '?').join(', ')
        const rows = this.db.prepare(`
            SELECT e.* FROM task_events e
            JOIN groups g ON g.id = e.group_id AND g.namespace = e.namespace
            WHERE e.namespace = ? AND g.employee_id = ? AND e.type IN (${marks}) AND e.created_at >= ?
            ORDER BY e.created_at ASC, e.rowid ASC
        `).all(namespace, employeeId, ...types, since) as TaskEventRow[]
        return rows.map(toTaskEvent)
    }

    count(namespace: string, groupId: string, type: string): number {
        const row = this.db.prepare(
            'SELECT COUNT(*) AS n FROM task_events WHERE namespace = ? AND group_id = ? AND type = ?'
        ).get(namespace, groupId, type) as { n: number }
        return row.n
    }

    deleteForGroup(namespace: string, groupId: string): void {
        this.db.prepare('DELETE FROM task_events WHERE namespace = ? AND group_id = ?').run(namespace, groupId)
    }
}
