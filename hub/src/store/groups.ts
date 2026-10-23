import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import { safeJsonParse } from './json'
import type {
    StoredAcceptanceCriterion,
    StoredGroup,
    StoredGroupKind,
    StoredGroupMember,
    StoredGroupMessage,
    StoredGroupMessageType,
    StoredGroupNote,
    StoredGroupTask,
    StoredGroupTaskStatus,
    StoredTaskStatus
} from './types'

type DbGroupRow = {
    id: string
    namespace: string
    name: string
    description: string | null
    note_session_id: string | null
    kind: string | null
    tag: string | null
    status: string | null
    goal: string | null
    non_goals: string | null
    acceptance: string | null
    repo_path: string | null
    machine_id: string | null
    lead_session_id: string | null
    completed_at: number | null
    archived_at?: number | null
    created_at: number
    updated_at: number
}

const TASK_STATUSES: readonly StoredTaskStatus[] = ['guiding', 'active', 'done', 'abandoned']

function parseStringArray(value: string | null): string[] {
    const parsed = value ? safeJsonParse(value) : null
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
}

function parseAcceptance(value: string | null): StoredAcceptanceCriterion[] {
    const parsed = value ? safeJsonParse(value) : null
    return Array.isArray(parsed) ? parsed as StoredAcceptanceCriterion[] : []
}

type DbGroupMemberRow = {
    id: number
    group_id: string
    namespace: string
    member_type: 'session' | 'human'
    session_id: string | null
    user_id: number | null
    role: string
    created_at: number
}

type DbGroupMessageRow = {
    id: string
    group_id: string
    namespace: string
    seq: number
    type: StoredGroupMessageType
    trace_id: string | null
    task_id: string | null
    source: string
    actor_session_id: string | null
    actor_name: string | null
    target_session_ids: string | null
    quoted_message_id: string | null
    payload: string
    created_at: number
}

type DbGroupTaskRow = {
    id: string
    group_id: string
    namespace: string
    trace_id: string
    source: string
    target_session_id: string
    command: string
    status: StoredGroupTaskStatus
    dedupe_key: string | null
    expires_at: number | null
    created_at: number
    updated_at: number
    started_at: number | null
    completed_at: number | null
    error: string | null
}

type DbGroupNoteRow = {
    group_id: string
    namespace: string
    content: string
    version: number
    updated_by: string | null
    updated_at: number
}

function toStoredGroup(row: DbGroupRow): StoredGroup {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        description: row.description,
        noteSessionId: row.note_session_id,
        kind: row.kind === 'task' ? 'task' : 'chat',
        tag: row.tag,
        status: TASK_STATUSES.includes(row.status as StoredTaskStatus) ? row.status as StoredTaskStatus : null,
        goal: row.goal,
        nonGoals: parseStringArray(row.non_goals),
        acceptance: parseAcceptance(row.acceptance),
        repoPath: row.repo_path,
        machineId: row.machine_id,
        leadSessionId: row.lead_session_id,
        completedAt: row.completed_at,
        archivedAt: row.archived_at ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredGroupMember(row: DbGroupMemberRow): StoredGroupMember {
    return {
        id: row.id,
        groupId: row.group_id,
        namespace: row.namespace,
        memberType: row.member_type,
        sessionId: row.session_id,
        userId: row.user_id,
        role: row.role,
        createdAt: row.created_at
    }
}

function parseTargetSessionIds(value: string | null): string[] | null {
    if (!value) {
        return null
    }
    const parsed = safeJsonParse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
        ? parsed
        : null
}

function toStoredGroupMessage(row: DbGroupMessageRow): StoredGroupMessage {
    return {
        id: row.id,
        groupId: row.group_id,
        namespace: row.namespace,
        seq: row.seq,
        type: row.type,
        traceId: row.trace_id,
        taskId: row.task_id,
        source: row.source,
        actorSessionId: row.actor_session_id,
        actorName: row.actor_name,
        targetSessionIds: parseTargetSessionIds(row.target_session_ids),
        quotedMessageId: row.quoted_message_id,
        payload: safeJsonParse(row.payload),
        createdAt: row.created_at
    }
}

function toStoredGroupTask(row: DbGroupTaskRow): StoredGroupTask {
    return {
        id: row.id,
        groupId: row.group_id,
        namespace: row.namespace,
        traceId: row.trace_id,
        source: row.source,
        targetSessionId: row.target_session_id,
        command: row.command,
        status: row.status,
        dedupeKey: row.dedupe_key,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: row.error
    }
}

function toStoredGroupNote(row: DbGroupNoteRow): StoredGroupNote {
    return {
        groupId: row.group_id,
        namespace: row.namespace,
        content: row.content,
        version: row.version,
        updatedBy: row.updated_by,
        updatedAt: row.updated_at
    }
}

export function createGroup(
    db: Database,
    options: {
        namespace: string
        name: string
        description?: string | null
        noteSessionId?: string | null
        members?: Array<{
            memberType: 'session' | 'human'
            sessionId?: string | null
            userId?: number | null
            role?: string
        }>
        /** A task: 12 characters, so `task:<id>` style references stay short. */
        task?: { id: string; tag: string; status: StoredTaskStatus; repoPath?: string | null; machineId?: string | null }
    }
): StoredGroup {
    const now = Date.now()
    const id = options.task?.id ?? randomUUID()

    try {
        db.exec('BEGIN')
        db.prepare(`
            INSERT INTO groups (
                id, namespace, name, description, note_session_id, kind, tag, status, repo_path, machine_id, created_at, updated_at
            ) VALUES (
                @id, @namespace, @name, @description, @note_session_id, @kind, @tag, @status, @repo_path, @machine_id, @created_at, @updated_at
            )
        `).run({
            id,
            namespace: options.namespace,
            name: options.name,
            description: options.description ?? null,
            note_session_id: options.noteSessionId ?? null,
            kind: options.task ? 'task' : 'chat',
            tag: options.task?.tag ?? null,
            status: options.task?.status ?? null,
            repo_path: options.task?.repoPath ?? null,
            machine_id: options.task?.machineId ?? null,
            created_at: now,
            updated_at: now
        })

        for (const member of options.members ?? []) {
            insertMemberOnce(db, {
                groupId: id,
                namespace: options.namespace,
                memberType: member.memberType,
                sessionId: member.sessionId ?? null,
                userId: member.userId ?? null,
                role: member.role ?? 'member',
                createdAt: now
            })
        }

        db.prepare(`
            INSERT OR IGNORE INTO group_notes (
                group_id, namespace, content, version, updated_by, updated_at
            ) VALUES (
                @group_id, @namespace, '', 1, NULL, @updated_at
            )
        `).run({
            group_id: id,
            namespace: options.namespace,
            updated_at: now
        })
        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }

    const created = getGroupByNamespace(db, id, options.namespace)
    if (!created) {
        throw new Error('Failed to create group')
    }
    return created
}

/** Namespaces that have a task running (status active), for the task observer. */
export function getActiveTaskNamespaces(db: Database): string[] {
    const rows = db.prepare("SELECT DISTINCT namespace FROM groups WHERE kind = 'task' AND status = 'active'").all() as Array<{ namespace: string }>
    return rows.map((row) => row.namespace)
}

export function getGroupsByNamespace(db: Database, namespace: string, kind?: StoredGroupKind): StoredGroup[] {
    const rows = kind
        ? db.prepare(
            "SELECT * FROM groups WHERE namespace = ? AND COALESCE(kind, 'chat') = ? ORDER BY updated_at DESC"
        ).all(namespace, kind) as DbGroupRow[]
        : db.prepare(
            'SELECT * FROM groups WHERE namespace = ? ORDER BY updated_at DESC'
        ).all(namespace) as DbGroupRow[]
    return rows.map(toStoredGroup)
}

/**
 * The unique index on group_members includes user_id, which is NULL for a session member, and SQLite does not treat
 * two NULLs as equal: INSERT OR IGNORE alone adds the same session twice.
 */
function insertMemberOnce(
    db: Database,
    member: {
        groupId: string
        namespace: string
        memberType: 'session' | 'human'
        sessionId: string | null
        userId: number | null
        role: string
        createdAt: number
    }
): boolean {
    const result = db.prepare(`
        INSERT INTO group_members (group_id, namespace, member_type, session_id, user_id, role, created_at)
        SELECT @group_id, @namespace, @member_type, @session_id, @user_id, @role, @created_at
        WHERE NOT EXISTS (
            SELECT 1 FROM group_members
            WHERE group_id = @group_id AND member_type = @member_type
                AND session_id IS @session_id AND user_id IS @user_id
        )
    `).run({
        group_id: member.groupId,
        namespace: member.namespace,
        member_type: member.memberType,
        session_id: member.sessionId,
        user_id: member.userId,
        role: member.role,
        created_at: member.createdAt
    })
    return result.changes > 0
}

export type TaskFieldsPatch = {
    name?: string
    tag?: string
    status?: StoredTaskStatus
    goal?: string | null
    nonGoals?: string[]
    acceptance?: StoredAcceptanceCriterion[]
    repoPath?: string | null
    machineId?: string | null
    leadSessionId?: string | null
}

/** Changes the task fields of a task group; `completed_at` follows the status. */
export function updateTaskFields(db: Database, options: { groupId: string; namespace: string; patch: TaskFieldsPatch }): StoredGroup | null {
    const current = getGroupByNamespace(db, options.groupId, options.namespace)
    if (!current || current.kind !== 'task') return null
    const patch = options.patch
    const now = Date.now()
    const status = patch.status ?? current.status
    const completedAt = status === 'done' ? (current.status === 'done' ? current.completedAt : now) : null
    db.prepare(`
        UPDATE groups
        SET name = @name, tag = @tag, status = @status, goal = @goal, non_goals = @non_goals, acceptance = @acceptance,
            repo_path = @repo_path, machine_id = @machine_id, lead_session_id = @lead_session_id,
            completed_at = @completed_at, updated_at = @updated_at
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: options.groupId,
        namespace: options.namespace,
        name: patch.name ?? current.name,
        tag: patch.tag ?? current.tag,
        status,
        goal: patch.goal !== undefined ? patch.goal : current.goal,
        non_goals: JSON.stringify(patch.nonGoals ?? current.nonGoals),
        acceptance: JSON.stringify(patch.acceptance ?? current.acceptance),
        repo_path: patch.repoPath !== undefined ? patch.repoPath : current.repoPath,
        machine_id: patch.machineId !== undefined ? patch.machineId : current.machineId,
        lead_session_id: patch.leadSessionId !== undefined ? patch.leadSessionId : current.leadSessionId,
        completed_at: completedAt,
        updated_at: now
    })
    return getGroupByNamespace(db, options.groupId, options.namespace)
}

export function getAllGroups(db: Database): StoredGroup[] {
    const rows = db.prepare(
        'SELECT * FROM groups ORDER BY updated_at DESC'
    ).all() as DbGroupRow[]
    return rows.map(toStoredGroup)
}

export function getGroup(db: Database, groupId: string): StoredGroup | null {
    const row = db.prepare(
        'SELECT * FROM groups WHERE id = ? LIMIT 1'
    ).get(groupId) as DbGroupRow | undefined
    return row ? toStoredGroup(row) : null
}

export function getGroupByNamespace(db: Database, groupId: string, namespace: string): StoredGroup | null {
    const row = db.prepare(
        'SELECT * FROM groups WHERE id = ? AND namespace = ?'
    ).get(groupId, namespace) as DbGroupRow | undefined
    return row ? toStoredGroup(row) : null
}

export function deleteGroup(
    db: Database,
    options: {
        groupId: string
        namespace: string
    }
): boolean {
    const existing = getGroupByNamespace(db, options.groupId, options.namespace)
    if (!existing) {
        return false
    }

    try {
        db.exec('BEGIN')
        db.prepare(`
            DELETE FROM group_members
            WHERE group_id = @group_id AND namespace = @namespace
        `).run({
            group_id: options.groupId,
            namespace: options.namespace
        })
        db.prepare(`
            DELETE FROM group_messages
            WHERE group_id = @group_id AND namespace = @namespace
        `).run({
            group_id: options.groupId,
            namespace: options.namespace
        })
        db.prepare(`
            DELETE FROM group_tasks
            WHERE group_id = @group_id AND namespace = @namespace
        `).run({
            group_id: options.groupId,
            namespace: options.namespace
        })
        db.prepare(`
            DELETE FROM group_notes
            WHERE group_id = @group_id AND namespace = @namespace
        `).run({
            group_id: options.groupId,
            namespace: options.namespace
        })

        const result = db.prepare(`
            DELETE FROM groups
            WHERE id = @group_id AND namespace = @namespace
        `).run({
            group_id: options.groupId,
            namespace: options.namespace
        })
        db.exec('COMMIT')
        return result.changes > 0
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}

export function getGroupMembersByNamespace(db: Database, groupId: string, namespace: string): StoredGroupMember[] {
    const rows = db.prepare(`
        SELECT *
        FROM group_members
        WHERE group_id = ? AND namespace = ?
        ORDER BY id ASC
    `).all(groupId, namespace) as DbGroupMemberRow[]
    return rows.map(toStoredGroupMember)
}

export function addGroupMessage(
    db: Database,
    options: {
        groupId: string
        namespace: string
        type: StoredGroupMessageType
        traceId?: string | null
        taskId?: string | null
        source: string
        actorSessionId?: string | null
        actorName?: string | null
        targetSessionIds?: string[] | null
        quotedMessageId?: string | null
        payload: unknown
    }
): StoredGroupMessage {
    const now = Date.now()
    const id = randomUUID()
    const seqRow = db.prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS next_seq FROM group_messages WHERE group_id = ?'
    ).get(options.groupId) as { next_seq: number }

    db.prepare(`
        INSERT INTO group_messages (
            id, group_id, namespace, seq, type, trace_id, task_id, source,
            actor_session_id, actor_name, target_session_ids, quoted_message_id, payload, created_at
        ) VALUES (
            @id, @group_id, @namespace, @seq, @type, @trace_id, @task_id, @source,
            @actor_session_id, @actor_name, @target_session_ids, @quoted_message_id, @payload, @created_at
        )
    `).run({
        id,
        group_id: options.groupId,
        namespace: options.namespace,
        seq: seqRow.next_seq,
        type: options.type,
        trace_id: options.traceId ?? null,
        task_id: options.taskId ?? null,
        source: options.source,
        actor_session_id: options.actorSessionId ?? null,
        actor_name: options.actorName ?? null,
        target_session_ids: options.targetSessionIds ? JSON.stringify(options.targetSessionIds) : null,
        quoted_message_id: options.quotedMessageId ?? null,
        payload: JSON.stringify(options.payload ?? {}),
        created_at: now
    })

    db.prepare(`
        UPDATE groups
        SET updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: options.groupId,
        namespace: options.namespace,
        updated_at: now
    })

    const row = db.prepare('SELECT * FROM group_messages WHERE id = ?').get(id) as DbGroupMessageRow | undefined
    if (!row) {
        throw new Error('Failed to create group message')
    }
    return toStoredGroupMessage(row)
}

export function getGroupMessages(
    db: Database,
    groupId: string,
    namespace: string,
    limit: number = 200,
    beforeSeq?: number
): StoredGroupMessage[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200
    const rows = (beforeSeq !== undefined && beforeSeq !== null && Number.isFinite(beforeSeq))
        ? db.prepare(`
            SELECT *
            FROM group_messages
            WHERE group_id = ? AND namespace = ? AND seq < ?
            ORDER BY seq DESC
            LIMIT ?
        `).all(groupId, namespace, beforeSeq, safeLimit) as DbGroupMessageRow[]
        : db.prepare(`
            SELECT *
            FROM group_messages
            WHERE group_id = ? AND namespace = ?
            ORDER BY seq DESC
            LIMIT ?
        `).all(groupId, namespace, safeLimit) as DbGroupMessageRow[]

    return rows.reverse().map(toStoredGroupMessage)
}

export function getGroupMessageByNamespace(
    db: Database,
    groupId: string,
    namespace: string,
    messageId: string
): StoredGroupMessage | null {
    const row = db.prepare(`
        SELECT *
        FROM group_messages
        WHERE group_id = ? AND namespace = ? AND id = ?
        LIMIT 1
    `).get(groupId, namespace, messageId) as DbGroupMessageRow | undefined
    return row ? toStoredGroupMessage(row) : null
}

export function getGroupTasks(
    db: Database,
    groupId: string,
    namespace: string,
    limit: number = 200
): StoredGroupTask[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200
    const rows = db.prepare(`
        SELECT *
        FROM group_tasks
        WHERE group_id = ? AND namespace = ?
        ORDER BY created_at DESC
        LIMIT ?
    `).all(groupId, namespace, safeLimit) as DbGroupTaskRow[]
    return rows.map(toStoredGroupTask)
}

export function getGroupNote(db: Database, groupId: string, namespace: string): StoredGroupNote | null {
    const row = db.prepare(`
        SELECT *
        FROM group_notes
        WHERE group_id = ? AND namespace = ?
        LIMIT 1
    `).get(groupId, namespace) as DbGroupNoteRow | undefined
    return row ? toStoredGroupNote(row) : null
}

export function updateGroupNote(
    db: Database,
    options: {
        groupId: string
        namespace: string
        content: string
        updatedBy?: string | null
    }
): StoredGroupNote {
    const now = Date.now()
    try {
        db.exec('BEGIN')
        const existing = getGroupNote(db, options.groupId, options.namespace)
        if (existing) {
            db.prepare(`
                UPDATE group_notes
                SET content = @content,
                    version = version + 1,
                    updated_by = @updated_by,
                    updated_at = @updated_at
                WHERE group_id = @group_id AND namespace = @namespace
            `).run({
                group_id: options.groupId,
                namespace: options.namespace,
                content: options.content,
                updated_by: options.updatedBy ?? null,
                updated_at: now
            })
        } else {
            db.prepare(`
                INSERT INTO group_notes (
                    group_id, namespace, content, version, updated_by, updated_at
                ) VALUES (
                    @group_id, @namespace, @content, 1, @updated_by, @updated_at
                )
            `).run({
                group_id: options.groupId,
                namespace: options.namespace,
                content: options.content,
                updated_by: options.updatedBy ?? null,
                updated_at: now
            })
        }
        db.prepare(`
            UPDATE groups
            SET updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END
            WHERE id = @id AND namespace = @namespace
        `).run({
            id: options.groupId,
            namespace: options.namespace,
            updated_at: now
        })
        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }

    const note = getGroupNote(db, options.groupId, options.namespace)
    if (!note) {
        throw new Error('Failed to update group note')
    }
    return note
}

export function addGroupMember(
    db: Database,
    options: {
        groupId: string
        namespace: string
        sessionId: string
        role?: string
    }
): StoredGroupMember {
    const now = Date.now()

    insertMemberOnce(db, {
        groupId: options.groupId,
        namespace: options.namespace,
        memberType: 'session',
        sessionId: options.sessionId,
        userId: null,
        role: options.role ?? 'member',
        createdAt: now
    })

    db.prepare(`
        UPDATE groups
        SET updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: options.groupId,
        namespace: options.namespace,
        updated_at: now
    })

    const row = db.prepare(`
        SELECT *
        FROM group_members
        WHERE group_id = ? AND namespace = ? AND session_id = ? AND member_type = 'session'
        LIMIT 1
    `).get(options.groupId, options.namespace, options.sessionId) as DbGroupMemberRow | undefined

    if (!row) {
        throw new Error('Failed to add group member')
    }
    return toStoredGroupMember(row)
}

export function removeGroupMember(
    db: Database,
    options: {
        groupId: string
        namespace: string
        sessionId: string
    }
): boolean {
    const result = db.prepare(`
        DELETE FROM group_members
        WHERE group_id = @group_id
            AND namespace = @namespace
            AND member_type = 'session'
            AND session_id = @session_id
    `).run({
        group_id: options.groupId,
        namespace: options.namespace,
        session_id: options.sessionId
    })

    if (result.changes <= 0) {
        return false
    }

    const now = Date.now()
    db.prepare(`
        UPDATE groups
        SET updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: options.groupId,
        namespace: options.namespace,
        updated_at: now
    })

    return true
}

/**
 * A resumed session can come back under a new id, and the old row is deleted (which cascades to its memberships and
 * dispatched commands). Before that, every group reference moves to the new id: memberships keep their role, a task
 * keeps its lead. Returns the groups that referred to the old id.
 */
export function replaceGroupSession(db: Database, options: { namespace: string; fromSessionId: string; toSessionId: string }): string[] {
    const params = { namespace: options.namespace, from: options.fromSessionId, to: options.toSessionId }
    const groupIds = new Set((db.prepare(`
        SELECT group_id AS id FROM group_members WHERE namespace = @namespace AND member_type = 'session' AND session_id = @from
        UNION SELECT id FROM groups WHERE namespace = @namespace AND (lead_session_id = @from OR note_session_id = @from)
        UNION SELECT group_id AS id FROM group_tasks WHERE namespace = @namespace AND target_session_id = @from
    `).all(params) as Array<{ id: string }>).map((row) => row.id))
    if (groupIds.size === 0) return []

    db.exec('BEGIN')
    try {
        // Where the new session is already a member, it takes the old one's role unless it has a role of its own.
        db.prepare(`
            UPDATE group_members AS m SET role = (
                SELECT o.role FROM group_members AS o
                WHERE o.group_id = m.group_id AND o.member_type = 'session' AND o.session_id = @from
            )
            WHERE m.namespace = @namespace AND m.member_type = 'session' AND m.session_id = @to AND m.role = 'member'
                AND EXISTS (SELECT 1 FROM group_members AS o WHERE o.group_id = m.group_id AND o.member_type = 'session' AND o.session_id = @from)
        `).run(params)
        db.prepare(`
            UPDATE group_members SET session_id = @to
            WHERE namespace = @namespace AND member_type = 'session' AND session_id = @from
                AND NOT EXISTS (
                    SELECT 1 FROM group_members AS n
                    WHERE n.group_id = group_members.group_id AND n.member_type = 'session' AND n.session_id = @to
                )
        `).run(params)
        db.prepare('UPDATE groups SET lead_session_id = @to WHERE namespace = @namespace AND lead_session_id = @from').run(params)
        db.prepare('UPDATE groups SET note_session_id = @to WHERE namespace = @namespace AND note_session_id = @from').run(params)
        db.prepare('UPDATE group_tasks SET target_session_id = @to WHERE namespace = @namespace AND target_session_id = @from').run(params)
        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
    return [...groupIds]
}

export function updateGroup(
    db: Database,
    options: {
        groupId: string
        namespace: string
        name?: string
        description?: string | null
        noteSessionId?: string | null
        archived?: boolean
    }
): StoredGroup | null {
    const now = Date.now()
    const setClauses: string[] = ['updated_at = @updated_at']
    if (options.archived !== undefined) {
        setClauses.push('archived_at = @archived_at')
    }

    if (options.name !== undefined) {
        setClauses.push('name = @name')
    }
    if (options.description !== undefined) {
        setClauses.push('description = @description')
    }
    if (options.noteSessionId !== undefined) {
        setClauses.push('note_session_id = @note_session_id')
    }

    // Bun SQLite ignores named params that aren't referenced in the SQL
    const result = db.prepare(`
        UPDATE groups
        SET ${setClauses.join(', ')}
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: options.groupId,
        namespace: options.namespace,
        updated_at: now,
        name: options.name ?? null,
        description: options.description ?? null,
        note_session_id: options.noteSessionId ?? null,
        archived_at: options.archived ? now : null
    })

    if (result.changes === 0) {
        return null
    }
    return getGroupByNamespace(db, options.groupId, options.namespace)
}

export function addGroupTask(
    db: Database,
    options: {
        groupId: string
        namespace: string
        traceId: string
        source: string
        targetSessionId: string
        command: string
        status?: StoredGroupTaskStatus
        dedupeKey?: string | null
        expiresAt?: number | null
    }
): StoredGroupTask {
    const now = Date.now()
    const id = randomUUID()
    const status = options.status ?? 'pending'
    const dedupeKey = options.dedupeKey ?? null

    try {
        db.prepare(`
            INSERT INTO group_tasks (
                id, group_id, namespace, trace_id, source, target_session_id, command, status,
                dedupe_key, expires_at, created_at, updated_at, started_at, completed_at, error
            ) VALUES (
                @id, @group_id, @namespace, @trace_id, @source, @target_session_id, @command, @status,
                @dedupe_key, @expires_at, @created_at, @updated_at, NULL, NULL, NULL
            )
        `).run({
            id,
            group_id: options.groupId,
            namespace: options.namespace,
            trace_id: options.traceId,
            source: options.source,
            target_session_id: options.targetSessionId,
            command: options.command,
            status,
            dedupe_key: dedupeKey,
            expires_at: options.expiresAt ?? null,
            created_at: now,
            updated_at: now
        })
    } catch (error) {
        if (dedupeKey) {
            const existing = db.prepare(`
                SELECT *
                FROM group_tasks
                WHERE group_id = ? AND namespace = ? AND dedupe_key = ?
                LIMIT 1
            `).get(options.groupId, options.namespace, dedupeKey) as DbGroupTaskRow | undefined
            if (existing) {
                return toStoredGroupTask(existing)
            }
        }
        throw error
    }

    const row = db.prepare('SELECT * FROM group_tasks WHERE id = ?').get(id) as DbGroupTaskRow | undefined
    if (!row) {
        throw new Error('Failed to create group task')
    }
    return toStoredGroupTask(row)
}

export function getGroupTaskByNamespace(
    db: Database,
    groupId: string,
    taskId: string,
    namespace: string
): StoredGroupTask | null {
    const row = db.prepare(`
        SELECT *
        FROM group_tasks
        WHERE id = ? AND group_id = ? AND namespace = ?
        LIMIT 1
    `).get(taskId, groupId, namespace) as DbGroupTaskRow | undefined
    return row ? toStoredGroupTask(row) : null
}

export function getGroupTaskByDedupeKey(
    db: Database,
    groupId: string,
    namespace: string,
    dedupeKey: string
): StoredGroupTask | null {
    const row = db.prepare(`
        SELECT *
        FROM group_tasks
        WHERE group_id = ? AND namespace = ? AND dedupe_key = ?
        LIMIT 1
    `).get(groupId, namespace, dedupeKey) as DbGroupTaskRow | undefined
    return row ? toStoredGroupTask(row) : null
}

export function hasGroupTaskForTargetSession(
    db: Database,
    options: {
        groupId: string
        namespace: string
        targetSessionId: string
        excludeTaskId?: string
    }
): boolean {
    const row = options.excludeTaskId
        ? db.prepare(`
            SELECT 1
            FROM group_tasks
            WHERE group_id = ?
                AND namespace = ?
                AND target_session_id = ?
                AND id != ?
            LIMIT 1
        `).get(options.groupId, options.namespace, options.targetSessionId, options.excludeTaskId)
        : db.prepare(`
            SELECT 1
            FROM group_tasks
            WHERE group_id = ?
                AND namespace = ?
                AND target_session_id = ?
            LIMIT 1
        `).get(options.groupId, options.namespace, options.targetSessionId)

    return !!row
}

export function updateGroupTaskStatus(
    db: Database,
    options: {
        groupId: string
        taskId: string
        namespace: string
        status: StoredGroupTaskStatus
        error?: string | null
    }
): StoredGroupTask | null {
    const now = Date.now()
    const updates: string[] = ['status = @status', 'updated_at = @updated_at', 'error = @error']
    if (options.status === 'running') {
        updates.push('started_at = COALESCE(started_at, @updated_at)')
    }
    if (options.status === 'completed' || options.status === 'manual_done' || options.status === 'failed' || options.status === 'canceled' || options.status === 'expired') {
        updates.push('completed_at = COALESCE(completed_at, @updated_at)')
    }

    const result = db.prepare(`
        UPDATE group_tasks
        SET ${updates.join(', ')}
        WHERE id = @task_id AND group_id = @group_id AND namespace = @namespace
    `).run({
        task_id: options.taskId,
        group_id: options.groupId,
        namespace: options.namespace,
        status: options.status,
        updated_at: now,
        error: options.error ?? null
    })

    if (result.changes === 0) {
        return null
    }

    return getGroupTaskByNamespace(db, options.groupId, options.taskId, options.namespace)
}
