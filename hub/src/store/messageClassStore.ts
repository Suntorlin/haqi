import type { Database } from 'bun:sqlite'

import type { StoredMessageClass } from './types'

type MessageClassRow = {
    message_id: string
    namespace: string
    session_id: string
    class: string
    confidence: number
    jev_cost_usd: number
    created_at: number
}

function toMessageClass(row: MessageClassRow): StoredMessageClass {
    return {
        messageId: row.message_id,
        namespace: row.namespace,
        sessionId: row.session_id,
        class: row.class,
        confidence: row.confidence,
        jevCostUsd: row.jev_cost_usd,
        createdAt: row.created_at
    }
}

/** One class per message the user typed; `created_at` is the message's own time. */
export class MessageClassStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    upsert(input: StoredMessageClass): void {
        this.db.prepare(`
            INSERT INTO message_classes (message_id, namespace, session_id, class, confidence, jev_cost_usd, created_at)
            VALUES (@message_id, @namespace, @session_id, @class, @confidence, @jev_cost_usd, @created_at)
            ON CONFLICT(message_id) DO UPDATE SET class = excluded.class, confidence = excluded.confidence,
                jev_cost_usd = excluded.jev_cost_usd
        `).run({
            message_id: input.messageId,
            namespace: input.namespace,
            session_id: input.sessionId,
            class: input.class,
            confidence: input.confidence,
            jev_cost_usd: input.jevCostUsd,
            created_at: input.createdAt
        })
    }

    has(messageId: string): boolean {
        return Boolean(this.db.prepare('SELECT 1 FROM message_classes WHERE message_id = ?').get(messageId))
    }

    list(namespace: string, since: number, sessionIds?: string[]): StoredMessageClass[] {
        if (sessionIds && sessionIds.length === 0) return []
        const filter = sessionIds ? ` AND session_id IN (${sessionIds.map(() => '?').join(', ')})` : ''
        const rows = this.db.prepare(`
            SELECT * FROM message_classes WHERE namespace = ? AND created_at >= ?${filter} ORDER BY created_at ASC
        `).all(namespace, since, ...(sessionIds ?? [])) as MessageClassRow[]
        return rows.map(toMessageClass)
    }
}
