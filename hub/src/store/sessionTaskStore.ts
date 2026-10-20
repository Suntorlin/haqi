import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { SessionTask } from '@hapi/protocol/types'

type SessionTaskRow = {
    id: string
    tag: string
    title: string
    status: string
    created_at: number
    updated_at: number
    completed_at: number | null
}

function toSessionTask(row: SessionTaskRow): SessionTask {
    return {
        id: row.id,
        tag: row.tag,
        title: row.title,
        status: row.status === 'done' ? 'done' : 'open',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        completedAt: row.completed_at
    }
}

/** 12 lowercase characters: `task:<id>` must fit the 40-character session tag limit. */
function newTaskId(): string {
    return randomUUID().replace(/-/g, '').slice(0, 12)
}

export class SessionTaskStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    list(namespace: string): SessionTask[] {
        const rows = this.db.prepare(`
            SELECT id, tag, title, status, created_at, updated_at, completed_at
            FROM session_tasks
            WHERE namespace = ?
            ORDER BY created_at ASC
        `).all(namespace) as SessionTaskRow[]
        return rows.map(toSessionTask)
    }

    get(namespace: string, id: string): SessionTask | null {
        const row = this.db.prepare(`
            SELECT id, tag, title, status, created_at, updated_at, completed_at
            FROM session_tasks
            WHERE namespace = ? AND id = ?
        `).get(namespace, id) as SessionTaskRow | null
        return row ? toSessionTask(row) : null
    }

    create(namespace: string, input: { tag: string; title: string }): SessionTask {
        const id = newTaskId()
        const now = Date.now()
        this.db.prepare(`
            INSERT INTO session_tasks (id, namespace, tag, title, status, created_at, updated_at, completed_at)
            VALUES (?, ?, ?, ?, 'open', ?, ?, NULL)
        `).run(id, namespace, input.tag, input.title, now, now)
        return this.get(namespace, id)!
    }

    update(
        namespace: string,
        id: string,
        patch: { title?: string; status?: SessionTask['status'] }
    ): SessionTask | null {
        const current = this.get(namespace, id)
        if (!current) return null
        const now = Date.now()
        const status = patch.status ?? current.status
        const completedAt = status === 'done'
            ? (current.status === 'done' ? current.completedAt : now)
            : null
        this.db.prepare(`
            UPDATE session_tasks
            SET title = ?, status = ?, completed_at = ?, updated_at = ?
            WHERE namespace = ? AND id = ?
        `).run(patch.title ?? current.title, status, completedAt, now, namespace, id)
        return this.get(namespace, id)
    }

    delete(namespace: string, id: string): boolean {
        const result = this.db.prepare('DELETE FROM session_tasks WHERE namespace = ? AND id = ?').run(namespace, id)
        return result.changes > 0
    }
}
