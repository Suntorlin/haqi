import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { PreviewUrlHistoryEntry, StoredSession, VersionedUpdateResult } from './types'
import { safeJsonParse } from './json'
import { updateVersionedField } from './versionedUpdates'

type DbSessionRow = {
    id: string
    tag: string | null
    namespace: string
    machine_id: string | null
    created_at: number
    updated_at: number
    metadata: string | null
    metadata_version: number
    agent_state: string | null
    agent_state_version: number
    preview_url: string | null
    todos: string | null
    todos_updated_at: number | null
    team_state: string | null
    team_state_updated_at: number | null
    active: number
    active_at: number | null
    seq: number
}

function toStoredSession(row: DbSessionRow): StoredSession {
    return {
        id: row.id,
        tag: row.tag,
        namespace: row.namespace,
        machineId: row.machine_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: row.metadata_version,
        agentState: safeJsonParse(row.agent_state),
        agentStateVersion: row.agent_state_version,
        previewUrl: row.preview_url,
        todos: safeJsonParse(row.todos),
        todosUpdatedAt: row.todos_updated_at,
        teamState: safeJsonParse(row.team_state),
        teamStateUpdatedAt: row.team_state_updated_at,
        active: row.active === 1,
        activeAt: row.active_at,
        seq: row.seq
    }
}

export function getOrCreateSession(
    db: Database,
    tag: string,
    metadata: unknown,
    agentState: unknown,
    namespace: string
): StoredSession {
    const existing = db.prepare(
        'SELECT * FROM sessions WHERE tag = ? AND namespace = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tag, namespace) as DbSessionRow | undefined

    if (existing) {
        return toStoredSession(existing)
    }

    const now = Date.now()
    const id = randomUUID()

    const metadataJson = JSON.stringify(metadata)
    const agentStateJson = agentState === null || agentState === undefined ? null : JSON.stringify(agentState)

    db.prepare(`
        INSERT INTO sessions (
            id, tag, namespace, machine_id, created_at, updated_at,
            metadata, metadata_version,
            agent_state, agent_state_version,
            todos, todos_updated_at,
            active, active_at, seq
        ) VALUES (
            @id, @tag, @namespace, NULL, @created_at, @updated_at,
            @metadata, 1,
            @agent_state, 1,
            NULL, NULL,
            0, NULL, 0
        )
    `).run({
        id,
        tag,
        namespace,
        created_at: now,
        updated_at: now,
        metadata: metadataJson,
        agent_state: agentStateJson
    })

    const row = getSession(db, id)
    if (!row) {
        throw new Error('Failed to create session')
    }
    return row
}

export function updateSessionMetadata(
    db: Database,
    id: string,
    metadata: unknown,
    expectedVersion: number,
    namespace: string,
    options?: { touchUpdatedAt?: boolean }
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const touchUpdatedAt = options?.touchUpdatedAt !== false

    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'metadata',
        versionField: 'metadata_version',
        expectedVersion,
        value: metadata,
        encode: (value) => {
            const json = JSON.stringify(value)
            return json === undefined ? null : json
        },
        decode: safeJsonParse,
        setClauses: [
            'updated_at = CASE WHEN @touch_updated_at = 1 THEN @updated_at ELSE updated_at END',
            'seq = seq + 1'
        ],
        params: {
            updated_at: now,
            touch_updated_at: touchUpdatedAt ? 1 : 0
        }
    })
}

export function updateSessionAgentState(
    db: Database,
    id: string,
    agentState: unknown,
    expectedVersion: number,
    namespace: string
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const normalized = agentState ?? null

    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'agent_state',
        versionField: 'agent_state_version',
        expectedVersion,
        value: normalized,
        encode: (value) => (value === null ? null : JSON.stringify(value)),
        decode: safeJsonParse,
        setClauses: ['updated_at = @updated_at', 'seq = seq + 1'],
        params: { updated_at: now }
    })
}

export function setSessionTodos(
    db: Database,
    id: string,
    todos: unknown,
    todosUpdatedAt: number,
    namespace: string
): boolean {
    try {
        const json = todos === null || todos === undefined ? null : JSON.stringify(todos)
        const result = db.prepare(`
            UPDATE sessions
            SET todos = @todos,
                todos_updated_at = @todos_updated_at,
                updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND (todos_updated_at IS NULL OR todos_updated_at < @todos_updated_at)
        `).run({
            id,
            todos: json,
            todos_updated_at: todosUpdatedAt,
            updated_at: todosUpdatedAt,
            namespace
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function setSessionPreviewUrl(
    db: Database,
    id: string,
    previewUrl: string | null,
    namespace: string
): boolean {
    try {
        const result = db.prepare(`
            UPDATE sessions
            SET preview_url = @preview_url,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
        `).run({
            id,
            namespace,
            preview_url: previewUrl
        })

        if (result.changes !== 1) {
            return false
        }

        if (previewUrl && previewUrl.trim()) {
            savePreviewUrlHistory(db, namespace, previewUrl)
        }

        return true
    } catch {
        return false
    }
}

export function setSessionTeamState(
    db: Database,
    id: string,
    teamState: unknown,
    updatedAt: number,
    namespace: string
): boolean {
    try {
        const json = teamState === null || teamState === undefined ? null : JSON.stringify(teamState)
        const result = db.prepare(`
            UPDATE sessions
            SET team_state = @team_state,
                team_state_updated_at = @team_state_updated_at,
                updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
              AND (team_state_updated_at IS NULL OR team_state_updated_at < @team_state_updated_at)
        `).run({
            id,
            team_state: json,
            team_state_updated_at: updatedAt,
            updated_at: updatedAt,
            namespace
        })

        return result.changes === 1
    } catch {
        return false
    }
}

export function savePreviewUrlHistory(db: Database, namespace: string, url: string): boolean {
    const trimmed = url.trim()
    if (!trimmed) {
        return false
    }

    try {
        const now = Date.now()
        db.prepare(`
            INSERT INTO preview_url_history (namespace, url, created_at, last_used_at)
            VALUES (@namespace, @url, @created_at, @last_used_at)
            ON CONFLICT(namespace, url)
            DO UPDATE SET last_used_at = excluded.last_used_at
        `).run({
            namespace,
            url: trimmed,
            created_at: now,
            last_used_at: now
        })
        return true
    } catch {
        return false
    }
}

type DbPreviewUrlHistoryRow = {
    url: string
    created_at: number
    last_used_at: number
}

export function getPreviewUrlHistory(
    db: Database,
    namespace: string,
    limit: number = 20
): PreviewUrlHistoryEntry[] {
    const normalizedLimit = Math.max(1, Math.min(100, Math.trunc(limit)))
    const rows = db.prepare(`
        SELECT url, created_at, last_used_at
        FROM preview_url_history
        WHERE namespace = ?
        ORDER BY last_used_at DESC, created_at DESC
        LIMIT ?
    `).all(namespace, normalizedLimit) as DbPreviewUrlHistoryRow[]

    return rows.map((row) => ({
        url: row.url,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at
    }))
}

export function getSession(db: Database, id: string): StoredSession | null {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessionByNamespace(db: Database, id: string, namespace: string): StoredSession | null {
    const row = db.prepare(
        'SELECT * FROM sessions WHERE id = ? AND namespace = ?'
    ).get(id, namespace) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessions(db: Database): StoredSession[] {
    const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function getSessionsByNamespace(db: Database, namespace: string): StoredSession[] {
    const rows = db.prepare(
        'SELECT * FROM sessions WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as DbSessionRow[]
    return rows.map(toStoredSession)
}

/** The ids of every session spawned for one employee (metadata.employeeId), for its metrics. */
export function getSessionIdsForEmployee(db: Database, namespace: string, employeeId: string): string[] {
    const rows = db.prepare(
        "SELECT id FROM sessions WHERE namespace = ? AND json_extract(metadata, '$.employeeId') = ?"
    ).all(namespace, employeeId) as Array<{ id: string }>
    return rows.map((row) => row.id)
}

export function deleteSession(db: Database, id: string, namespace: string): boolean {
    const result = db.prepare(
        'DELETE FROM sessions WHERE id = ? AND namespace = ?'
    ).run(id, namespace)
    return result.changes > 0
}
