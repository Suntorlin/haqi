import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import { safeJsonParse } from './json'
import type { StoredMemory, StoredMemoryEvent, StoredMemoryLink } from './types'

/** Memories (one sentence + level + scope), "supports" links between them, the capture log, and one embedding per memory for search. */
export const MEMORY_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        text TEXT NOT NULL,
        level TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        reason TEXT,
        source TEXT NOT NULL,
        source_label TEXT,
        session_id TEXT,
        said INTEGER NOT NULL DEFAULT 0,
        support INTEGER NOT NULL DEFAULT 1,
        jev TEXT,
        overridden TEXT,
        replaces TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_namespace_status ON memories(namespace, status);

    CREATE TABLE IF NOT EXISTS memory_links (
        namespace TEXT NOT NULL DEFAULT 'default',
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (from_id, to_id),
        FOREIGN KEY (from_id) REFERENCES memories(id) ON DELETE CASCADE,
        FOREIGN KEY (to_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_links_namespace ON memory_links(namespace);

    CREATE TABLE IF NOT EXISTS memory_events (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        memory_id TEXT,
        action TEXT NOT NULL,
        text TEXT NOT NULL,
        reason TEXT,
        source TEXT NOT NULL,
        source_label TEXT,
        source_ref TEXT,
        hash TEXT,
        session_id TEXT,
        jev TEXT,
        cost_usd REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memory_events_namespace_created ON memory_events(namespace, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_events_hash ON memory_events(namespace, hash);
    CREATE INDEX IF NOT EXISTS idx_memory_events_memory ON memory_events(memory_id, created_at);

    CREATE TABLE IF NOT EXISTS memory_vectors (
        memory_id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        model TEXT NOT NULL,
        text_hash TEXT NOT NULL,
        vector TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_memory_vectors_namespace ON memory_vectors(namespace);
`

type DbMemoryRow = {
    id: string
    namespace: string
    text: string
    level: string
    scope: string
    status: string
    reason: string | null
    source: string
    source_label: string | null
    session_id: string | null
    said: number
    support: number
    jev: string | null
    overridden: string | null
    replaces: string | null
    version: number
    created_at: number
    updated_at: number
}

type DbEventRow = {
    id: string
    namespace: string
    memory_id: string | null
    action: string
    text: string
    reason: string | null
    source: string
    source_label: string | null
    source_ref: string | null
    hash: string | null
    session_id: string | null
    jev: string | null
    cost_usd: number
    latency_ms: number
    created_at: number
}

function toStoredMemory(row: DbMemoryRow): StoredMemory {
    return {
        id: row.id,
        namespace: row.namespace,
        text: row.text,
        level: row.level as StoredMemory['level'],
        scope: row.scope,
        status: row.status as StoredMemory['status'],
        reason: row.reason,
        source: row.source,
        sourceLabel: row.source_label,
        sessionId: row.session_id,
        said: row.said === 1,
        support: row.support,
        jev: row.jev ? safeJsonParse(row.jev) : null,
        overridden: row.overridden ? safeJsonParse(row.overridden) as StoredMemory['overridden'] : null,
        replaces: row.replaces,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredEvent(row: DbEventRow): StoredMemoryEvent {
    return {
        id: row.id,
        namespace: row.namespace,
        memoryId: row.memory_id,
        action: row.action,
        text: row.text,
        reason: row.reason,
        source: row.source,
        sourceLabel: row.source_label,
        sourceRef: row.source_ref,
        hash: row.hash,
        sessionId: row.session_id,
        jev: row.jev ? safeJsonParse(row.jev) : null,
        costUsd: row.cost_usd,
        latencyMs: row.latency_ms,
        createdAt: row.created_at
    }
}

export type NewMemory = Omit<StoredMemory, 'id' | 'version' | 'createdAt' | 'updatedAt'>

export function insertMemory(db: Database, input: NewMemory): StoredMemory {
    const now = Date.now()
    const id = randomUUID()
    db.prepare(`
        INSERT INTO memories (id, namespace, text, level, scope, status, reason, source, source_label, session_id, said, support, jev, overridden, replaces, version, created_at, updated_at)
        VALUES (@id, @namespace, @text, @level, @scope, @status, @reason, @source, @source_label, @session_id, @said, @support, @jev, @overridden, @replaces, 1, @now, @now)
    `).run({
        id,
        namespace: input.namespace,
        text: input.text,
        level: input.level,
        scope: input.scope,
        status: input.status,
        reason: input.reason,
        source: input.source,
        source_label: input.sourceLabel,
        session_id: input.sessionId,
        said: input.said ? 1 : 0,
        support: input.support,
        jev: input.jev === null ? null : JSON.stringify(input.jev),
        overridden: input.overridden === null ? null : JSON.stringify(input.overridden),
        replaces: input.replaces,
        now
    })
    const stored = getMemory(db, id, input.namespace)
    if (!stored) throw new Error('Failed to insert memory')
    return stored
}

export function getMemory(db: Database, id: string, namespace: string): StoredMemory | null {
    const row = db.prepare('SELECT * FROM memories WHERE id = ? AND namespace = ?').get(id, namespace) as DbMemoryRow | null
    return row ? toStoredMemory(row) : null
}

export function listMemories(db: Database, namespace: string): StoredMemory[] {
    const rows = db.prepare("SELECT * FROM memories WHERE namespace = ? AND status != 'archived' ORDER BY created_at DESC").all(namespace) as DbMemoryRow[]
    return rows.map(toStoredMemory)
}

export type MemoryPatch = Partial<Pick<StoredMemory, 'text' | 'level' | 'scope' | 'status' | 'reason' | 'support' | 'said' | 'overridden' | 'replaces'>> & { bumpVersion?: boolean }

export function updateMemory(db: Database, id: string, namespace: string, patch: MemoryPatch): StoredMemory | null {
    const current = getMemory(db, id, namespace)
    if (!current) return null
    const next = { ...current, ...patch }
    db.prepare(`
        UPDATE memories SET text = @text, level = @level, scope = @scope, status = @status, reason = @reason,
            support = @support, said = @said, overridden = @overridden, replaces = @replaces, version = @version, updated_at = @now
        WHERE id = @id AND namespace = @namespace
    `).run({
        id,
        namespace,
        text: next.text,
        level: next.level,
        scope: next.scope,
        status: next.status,
        reason: next.reason,
        support: next.support,
        said: next.said ? 1 : 0,
        overridden: next.overridden === null ? null : JSON.stringify(next.overridden),
        replaces: next.replaces,
        version: current.version + (patch.bumpVersion ? 1 : 0),
        now: Date.now()
    })
    return getMemory(db, id, namespace)
}

export function deleteMemory(db: Database, id: string, namespace: string): boolean {
    return db.prepare('DELETE FROM memories WHERE id = ? AND namespace = ?').run(id, namespace).changes > 0
}

export function addMemoryLink(db: Database, namespace: string, fromId: string, toId: string): void {
    db.prepare('INSERT OR IGNORE INTO memory_links (namespace, from_id, to_id, created_at) VALUES (?, ?, ?, ?)').run(namespace, fromId, toId, Date.now())
}

export function listMemoryLinks(db: Database, namespace: string): StoredMemoryLink[] {
    const rows = db.prepare('SELECT namespace, from_id, to_id, created_at FROM memory_links WHERE namespace = ?').all(namespace) as Array<{ namespace: string; from_id: string; to_id: string; created_at: number }>
    return rows.map((row) => ({ namespace: row.namespace, fromId: row.from_id, toId: row.to_id, createdAt: row.created_at }))
}

export type NewMemoryEvent = Omit<StoredMemoryEvent, 'id' | 'createdAt'>

export function addMemoryEvent(db: Database, input: NewMemoryEvent): StoredMemoryEvent {
    const id = randomUUID()
    const now = Date.now()
    db.prepare(`
        INSERT INTO memory_events (id, namespace, memory_id, action, text, reason, source, source_label, source_ref, hash, session_id, jev, cost_usd, latency_ms, created_at)
        VALUES (@id, @namespace, @memory_id, @action, @text, @reason, @source, @source_label, @source_ref, @hash, @session_id, @jev, @cost_usd, @latency_ms, @now)
    `).run({
        id,
        namespace: input.namespace,
        memory_id: input.memoryId,
        action: input.action,
        text: input.text,
        reason: input.reason,
        source: input.source,
        source_label: input.sourceLabel,
        source_ref: input.sourceRef,
        hash: input.hash,
        session_id: input.sessionId,
        jev: input.jev === null ? null : JSON.stringify(input.jev),
        cost_usd: input.costUsd,
        latency_ms: input.latencyMs,
        now
    })
    return { ...input, id, createdAt: now }
}

export function listMemoryEvents(db: Database, namespace: string, limit: number): StoredMemoryEvent[] {
    const rows = db.prepare('SELECT * FROM memory_events WHERE namespace = ? ORDER BY created_at DESC LIMIT ?').all(namespace, limit) as DbEventRow[]
    return rows.map(toStoredEvent)
}

export function listMemoryEventsSince(db: Database, namespace: string, since: number): StoredMemoryEvent[] {
    const rows = db.prepare('SELECT * FROM memory_events WHERE namespace = ? AND created_at >= ? ORDER BY created_at DESC').all(namespace, since) as DbEventRow[]
    return rows.map(toStoredEvent)
}

export function hasMemoryEventWithHash(db: Database, namespace: string, hash: string): boolean {
    return Boolean(db.prepare('SELECT 1 FROM memory_events WHERE namespace = ? AND hash = ? LIMIT 1').get(namespace, hash))
}

/** Events that count as "this came up again": the first capture, later mentions, and merged duplicates. */
const MENTION_ACTIONS = ['added', 'pending', 'candidate', 'reinforced', 'merged'] as const

export function mentionStats(db: Database, namespace: string, since: number): Map<string, { recent: number; lastAt: number }> {
    const rows = db.prepare(`
        SELECT memory_id, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS recent, MAX(created_at) AS last_at
        FROM memory_events
        WHERE namespace = ? AND memory_id IS NOT NULL AND action IN (${MENTION_ACTIONS.map(() => '?').join(', ')})
        GROUP BY memory_id
    `).all(since, namespace, ...MENTION_ACTIONS) as Array<{ memory_id: string; recent: number; last_at: number }>
    return new Map(rows.map((row) => [row.memory_id, { recent: row.recent, lastAt: row.last_at }]))
}

/** Memories the user approved by hand: confirmed, or edited. */
export function approvedMemoryIds(db: Database, namespace: string): Set<string> {
    const rows = db.prepare("SELECT DISTINCT memory_id FROM memory_events WHERE namespace = ? AND memory_id IS NOT NULL AND action IN ('confirmed', 'edited')").all(namespace) as Array<{ memory_id: string }>
    return new Set(rows.map((row) => row.memory_id))
}

export type UserTurn = { messageId: string; sessionId: string; createdAt: number; content: string; sessionMetadata: string | null; before: string | null }

/** Messages the user sent after `since`, oldest first, each with the end of the agent's reply before it. */
export function listUserTurns(db: Database, namespace: string, since: number, limit: number): UserTurn[] {
    const rows = db.prepare(`
        SELECT t.user_message_id AS message_id, t.session_id, t.created_at, m.content, s.metadata,
            (SELECT p.assistant_preview FROM conversation_turns p WHERE p.session_id = t.session_id AND p.turn_index = t.turn_index - 1) AS before
        FROM conversation_turns t
        JOIN messages m ON m.id = t.user_message_id
        JOIN sessions s ON s.id = t.session_id
        WHERE s.namespace = ? AND t.created_at > ?
        ORDER BY t.created_at ASC
        LIMIT ?
    `).all(namespace, since, limit) as Array<{ message_id: string; session_id: string; created_at: number; content: string; metadata: string | null; before: string | null }>
    return rows.map((row) => ({ messageId: row.message_id, sessionId: row.session_id, createdAt: row.created_at, content: row.content, sessionMetadata: row.metadata, before: row.before }))
}

/** True when some memory, in any status, was ever proposed as a replacement of `id`. */
export function hasReplacement(db: Database, namespace: string, id: string): boolean {
    return Boolean(db.prepare('SELECT 1 FROM memories WHERE namespace = ? AND replaces = ? LIMIT 1').get(namespace, id))
}

export type StoredVector = { memoryId: string; model: string; textHash: string; vector: number[] }

export function setMemoryVector(db: Database, namespace: string, input: StoredVector): void {
    db.prepare(`
        INSERT INTO memory_vectors (memory_id, namespace, model, text_hash, vector, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(memory_id) DO UPDATE SET model = excluded.model, text_hash = excluded.text_hash, vector = excluded.vector, created_at = excluded.created_at
    `).run(input.memoryId, namespace, input.model, input.textHash, JSON.stringify(input.vector), Date.now())
}

export function listMemoryVectors(db: Database, namespace: string): StoredVector[] {
    const rows = db.prepare('SELECT memory_id, model, text_hash, vector FROM memory_vectors WHERE namespace = ?').all(namespace) as Array<{ memory_id: string; model: string; text_hash: string; vector: string }>
    return rows.map((row) => ({ memoryId: row.memory_id, model: row.model, textHash: row.text_hash, vector: JSON.parse(row.vector) as number[] }))
}
