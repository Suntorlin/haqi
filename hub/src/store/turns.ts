import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'

import { safeJsonParse } from './json'
import type { StoredConversationTurn, StoredMessage } from './types'

type DbConversationTurnRow = {
    id: string
    session_id: string
    turn_index: number
    status: 'open' | 'closed'
    user_message_id: string | null
    user_seq: number | null
    agent_start_seq: number | null
    agent_end_seq: number | null
    message_count: number
    user_preview: string | null
    assistant_preview: string | null
    created_at: number
    updated_at: number
}

type DbMessageRow = {
    id: string
    session_id: string
    content: string
    created_at: number
    seq: number
    local_id: string | null
}

type MutableTurn = {
    id: string
    sessionId: string
    turnIndex: number
    status: 'open' | 'closed'
    userMessageId: string | null
    userSeq: number | null
    agentStartSeq: number | null
    agentEndSeq: number | null
    messageCount: number
    userPreview: string | null
    assistantPreview: string | null
    createdAt: number
    updatedAt: number
}

const PREVIEW_TEXT_MAX_LENGTH = 6000
const TEXT_EXTRACTION_DEPTH_LIMIT = 5
const PRIORITY_TEXT_KEYS = ['text', 'summary', 'message', 'content', 'prompt', 'title', 'error']
const NON_CONTENT_FIELD_KEYS = new Set(['type', 'role', 'id', 'uuid', 'name'])

function toStoredConversationTurn(row: DbConversationTurnRow): StoredConversationTurn {
    return {
        id: row.id,
        sessionId: row.session_id,
        turnIndex: row.turn_index,
        status: row.status,
        userMessageId: row.user_message_id,
        userSeq: row.user_seq,
        agentStartSeq: row.agent_start_seq,
        agentEndSeq: row.agent_end_seq,
        messageCount: row.message_count,
        userPreview: row.user_preview,
        assistantPreview: row.assistant_preview,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredMessage(row: DbMessageRow): StoredMessage {
    return {
        id: row.id,
        sessionId: row.session_id,
        content: safeJsonParse(row.content),
        createdAt: row.created_at,
        seq: row.seq,
        localId: row.local_id
    }
}

function normalizePreviewText(text: string): string | null {
    const normalizedNewlines = text.replace(/\r\n?/g, '\n')
    const trimmedEdgeBlankLines = normalizedNewlines
        .replace(/^(?:[ \t]*\n)+/, '')
        .replace(/(?:\n[ \t]*)+$/, '')
    if (!trimmedEdgeBlankLines.trim()) {
        return null
    }
    if (trimmedEdgeBlankLines.length <= PREVIEW_TEXT_MAX_LENGTH) {
        return trimmedEdgeBlankLines
    }
    return `${trimmedEdgeBlankLines.slice(0, PREVIEW_TEXT_MAX_LENGTH - 1)}…`
}

function trimPreviewTail(text: string): string {
    if (text.length <= PREVIEW_TEXT_MAX_LENGTH) {
        return text
    }
    return `…${text.slice(Math.max(0, text.length - (PREVIEW_TEXT_MAX_LENGTH - 1)))}`
}

function buildRollingAssistantPreview(previousPreview: string | null, nextSnippet: string | null): string | null {
    const previous = previousPreview ? normalizePreviewText(previousPreview) : null
    const normalizedNext = nextSnippet ? normalizePreviewText(nextSnippet) : null
    if (!normalizedNext) {
        return previous
    }

    if (!previous) {
        return normalizedNext
    }

    if (previous === normalizedNext || previous.endsWith(`\n${normalizedNext}`)) {
        return previous
    }

    return trimPreviewTail(`${previous}\n${normalizedNext}`)
}

function isReasoningBlock(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false
    }
    const record = value as Record<string, unknown>
    return record.type === 'thinking' || record.type === 'reasoning'
}

function extractTextSnippet(value: unknown, depth: number = 0): string | null {
    if (depth > TEXT_EXTRACTION_DEPTH_LIMIT) {
        return null
    }

    if (typeof value === 'string') {
        return normalizePreviewText(value)
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            if (isReasoningBlock(item)) {
                continue
            }
            const snippet = extractTextSnippet(item, depth + 1)
            if (snippet) {
                return snippet
            }
        }
        return null
    }

    if (!value || typeof value !== 'object') {
        return null
    }

    const record = value as Record<string, unknown>

    for (const key of PRIORITY_TEXT_KEYS) {
        if (!(key in record)) {
            continue
        }
        const snippet = extractTextSnippet(record[key], depth + 1)
        if (snippet) {
            return snippet
        }
    }

    for (const [key, nested] of Object.entries(record)) {
        if (NON_CONTENT_FIELD_KEYS.has(key)) {
            continue
        }
        const snippet = extractTextSnippet(nested, depth + 1)
        if (snippet) {
            return snippet
        }
    }

    return null
}

function extractSnippetFromMessageContent(content: unknown): string | null {
    const envelope = unwrapRoleWrappedRecordEnvelope(content)
    const value = envelope ? envelope.content : content
    const outputSnippet = extractClaudeOutputSnippet(value)
    if (outputSnippet !== undefined) {
        return outputSnippet
    }
    return extractTextSnippet(value)
}

// Claude SDK passthrough records ({ type: 'output', data }) carry a lot of
// machinery: tool results, tool_progress heartbeats, model ids, system frames.
// Blindly crawling them for strings fills turn previews with shell output and
// "claude-*" model names, so only assistant text blocks may contribute.
// Returns undefined for non-output content so callers fall back to the
// generic crawler.
function extractClaudeOutputSnippet(value: unknown): string | null | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return undefined
    }
    const record = value as Record<string, unknown>
    if (record.type !== 'output') {
        return undefined
    }

    const dataValue = record.data
    if (!dataValue || typeof dataValue !== 'object' || Array.isArray(dataValue)) {
        return null
    }
    const data = dataValue as Record<string, unknown>
    if (data.isMeta || data.isCompactSummary || data.type !== 'assistant') {
        return null
    }

    const message = data.message
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return null
    }
    const blocks = (message as Record<string, unknown>).content
    if (typeof blocks === 'string') {
        return normalizePreviewText(blocks)
    }
    if (!Array.isArray(blocks)) {
        return null
    }
    for (const block of blocks) {
        if (!block || typeof block !== 'object' || Array.isArray(block)) {
            continue
        }
        const blockRecord = block as Record<string, unknown>
        if (blockRecord.type === 'text' && typeof blockRecord.text === 'string') {
            const snippet = normalizePreviewText(blockRecord.text)
            if (snippet) {
                return snippet
            }
        }
    }
    return null
}

function extractCodexFinalAssistantSnippet(content: unknown): string | null | undefined {
    const envelope = unwrapRoleWrappedRecordEnvelope(content)
    const value = envelope ? envelope.content : content
    if (!value || typeof value !== 'object') {
        return undefined
    }
    const record = value as Record<string, unknown>
    if (record.type !== 'codex') {
        return undefined
    }

    const dataValue = record.data
    if (!dataValue || typeof dataValue !== 'object') {
        return null
    }
    const data = dataValue as Record<string, unknown>
    if (data.type !== 'message') {
        return null
    }

    return typeof data.message === 'string'
        ? normalizePreviewText(data.message)
        : null
}

function classifyMessageRole(content: unknown): 'user' | 'agent' {
    const envelope = unwrapRoleWrappedRecordEnvelope(content)
    if (envelope?.role === 'user') {
        return 'user'
    }
    return 'agent'
}

function getOpenTurnRow(db: Database, sessionId: string): DbConversationTurnRow | null {
    const row = db.prepare(
        `SELECT *
         FROM conversation_turns
         WHERE session_id = ? AND status = 'open'
         ORDER BY turn_index DESC
         LIMIT 1`
    ).get(sessionId) as DbConversationTurnRow | undefined

    return row ?? null
}

function getNextTurnIndex(db: Database, sessionId: string): number {
    const row = db.prepare(
        'SELECT COALESCE(MAX(turn_index), 0) + 1 AS nextTurnIndex FROM conversation_turns WHERE session_id = ?'
    ).get(sessionId) as { nextTurnIndex: number } | undefined

    return row?.nextTurnIndex ?? 1
}

function getTurnById(db: Database, turnId: string): StoredConversationTurn | null {
    const row = db.prepare('SELECT * FROM conversation_turns WHERE id = ? LIMIT 1').get(turnId) as DbConversationTurnRow | undefined
    return row ? toStoredConversationTurn(row) : null
}

function computeTurnSeqRange(turn: StoredConversationTurn): { startSeq: number | null; endSeq: number | null } {
    const startSeq = turn.userSeq ?? turn.agentStartSeq ?? turn.agentEndSeq
    const endSeq = turn.agentEndSeq ?? turn.userSeq ?? turn.agentStartSeq
    return { startSeq, endSeq }
}

function insertTurn(db: Database, turn: MutableTurn): void {
    db.prepare(`
        INSERT INTO conversation_turns (
            id,
            session_id,
            turn_index,
            status,
            user_message_id,
            user_seq,
            agent_start_seq,
            agent_end_seq,
            message_count,
            user_preview,
            assistant_preview,
            created_at,
            updated_at
        ) VALUES (
            @id,
            @session_id,
            @turn_index,
            @status,
            @user_message_id,
            @user_seq,
            @agent_start_seq,
            @agent_end_seq,
            @message_count,
            @user_preview,
            @assistant_preview,
            @created_at,
            @updated_at
        )
    `).run({
        id: turn.id,
        session_id: turn.sessionId,
        turn_index: turn.turnIndex,
        status: turn.status,
        user_message_id: turn.userMessageId,
        user_seq: turn.userSeq,
        agent_start_seq: turn.agentStartSeq,
        agent_end_seq: turn.agentEndSeq,
        message_count: turn.messageCount,
        user_preview: turn.userPreview,
        assistant_preview: turn.assistantPreview,
        created_at: turn.createdAt,
        updated_at: turn.updatedAt
    })
}

export function createConversationTurnsSchema(db: Database): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversation_turns (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            turn_index INTEGER NOT NULL,
            status TEXT NOT NULL,
            user_message_id TEXT,
            user_seq INTEGER,
            agent_start_seq INTEGER,
            agent_end_seq INTEGER,
            message_count INTEGER NOT NULL DEFAULT 0,
            user_preview TEXT,
            assistant_preview TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
            FOREIGN KEY (user_message_id) REFERENCES messages(id) ON DELETE SET NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_turns_session_turn_index
            ON conversation_turns(session_id, turn_index);
        CREATE INDEX IF NOT EXISTS idx_conversation_turns_session_updated
            ON conversation_turns(session_id, updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_conversation_turns_session_status
            ON conversation_turns(session_id, status, turn_index DESC);
    `)
}

export function appendMessageToConversationTurns(db: Database, message: StoredMessage): StoredConversationTurn {
    const role = classifyMessageRole(message.content)
    const snippet = extractSnippetFromMessageContent(message.content)
    const codexFinalAssistantSnippet = role === 'agent'
        ? extractCodexFinalAssistantSnippet(message.content)
        : undefined
    const openTurn = getOpenTurnRow(db, message.sessionId)

    if (role === 'user') {
        if (openTurn) {
            db.prepare(
                'UPDATE conversation_turns SET status = ?, updated_at = ? WHERE id = ?'
            ).run('closed', Math.max(openTurn.updated_at, message.createdAt), openTurn.id)
        }

        const turnId = randomUUID()
        const nextTurnIndex = getNextTurnIndex(db, message.sessionId)

        db.prepare(`
            INSERT INTO conversation_turns (
                id,
                session_id,
                turn_index,
                status,
                user_message_id,
                user_seq,
                agent_start_seq,
                agent_end_seq,
                message_count,
                user_preview,
                assistant_preview,
                created_at,
                updated_at
            ) VALUES (
                @id,
                @session_id,
                @turn_index,
                'open',
                @user_message_id,
                @user_seq,
                NULL,
                NULL,
                @message_count,
                @user_preview,
                NULL,
                @created_at,
                @updated_at
            )
        `).run({
            id: turnId,
            session_id: message.sessionId,
            turn_index: nextTurnIndex,
            user_message_id: message.id,
            user_seq: message.seq,
            message_count: 1,
            user_preview: snippet,
            created_at: message.createdAt,
            updated_at: message.createdAt
        })

        const inserted = getTurnById(db, turnId)
        if (!inserted) {
            throw new Error('Failed to create conversation turn for user message')
        }
        return inserted
    }

    if (openTurn) {
        const agentStartSeq = openTurn.agent_start_seq ?? message.seq
        const assistantPreview = codexFinalAssistantSnippet === undefined
            ? buildRollingAssistantPreview(openTurn.assistant_preview, snippet)
            : codexFinalAssistantSnippet ?? openTurn.assistant_preview

        db.prepare(`
            UPDATE conversation_turns
            SET
                agent_start_seq = @agent_start_seq,
                agent_end_seq = @agent_end_seq,
                message_count = @message_count,
                assistant_preview = @assistant_preview,
                updated_at = @updated_at
            WHERE id = @id
        `).run({
            id: openTurn.id,
            agent_start_seq: agentStartSeq,
            agent_end_seq: message.seq,
            message_count: openTurn.message_count + 1,
            assistant_preview: assistantPreview,
            updated_at: message.createdAt
        })

        const updated = getTurnById(db, openTurn.id)
        if (!updated) {
            throw new Error('Failed to update conversation turn for agent message')
        }
        return updated
    }

    const turnId = randomUUID()
    const nextTurnIndex = getNextTurnIndex(db, message.sessionId)

    db.prepare(`
        INSERT INTO conversation_turns (
            id,
            session_id,
            turn_index,
            status,
            user_message_id,
            user_seq,
            agent_start_seq,
            agent_end_seq,
            message_count,
            user_preview,
            assistant_preview,
            created_at,
            updated_at
        ) VALUES (
            @id,
            @session_id,
            @turn_index,
            'open',
            NULL,
            NULL,
            @agent_start_seq,
            @agent_end_seq,
            @message_count,
            NULL,
            @assistant_preview,
            @created_at,
            @updated_at
        )
    `).run({
        id: turnId,
        session_id: message.sessionId,
        turn_index: nextTurnIndex,
        agent_start_seq: message.seq,
        agent_end_seq: message.seq,
        message_count: 1,
        assistant_preview: codexFinalAssistantSnippet === undefined ? snippet : codexFinalAssistantSnippet,
        created_at: message.createdAt,
        updated_at: message.createdAt
    })

    const inserted = getTurnById(db, turnId)
    if (!inserted) {
        throw new Error('Failed to create conversation turn for agent message')
    }
    return inserted
}

export function getConversationTurns(
    db: Database,
    sessionId: string,
    limit: number = 200,
    beforeTurnIndex?: number
): StoredConversationTurn[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200

    const rows = (beforeTurnIndex !== undefined && beforeTurnIndex !== null && Number.isFinite(beforeTurnIndex))
        ? db.prepare(
            'SELECT * FROM conversation_turns WHERE session_id = ? AND turn_index < ? ORDER BY turn_index DESC LIMIT ?'
        ).all(sessionId, beforeTurnIndex, safeLimit) as DbConversationTurnRow[]
        : db.prepare(
            'SELECT * FROM conversation_turns WHERE session_id = ? ORDER BY turn_index DESC LIMIT ?'
        ).all(sessionId, safeLimit) as DbConversationTurnRow[]

    return rows.reverse().map(toStoredConversationTurn)
}

export function getConversationTurnById(
    db: Database,
    sessionId: string,
    turnId: string
): StoredConversationTurn | null {
    const row = db.prepare(
        'SELECT * FROM conversation_turns WHERE session_id = ? AND id = ? LIMIT 1'
    ).get(sessionId, turnId) as DbConversationTurnRow | undefined

    return row ? toStoredConversationTurn(row) : null
}

export function getConversationTurnMessagesPage(
    db: Database,
    sessionId: string,
    turnId: string,
    options: { limit: number; beforeSeq: number | null }
): {
    turn: StoredConversationTurn
    messages: StoredMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
        startSeq: number | null
        endSeq: number | null
    }
} | null {
    const turn = getConversationTurnById(db, sessionId, turnId)
    if (!turn) {
        return null
    }

    const safeLimit = Number.isFinite(options.limit) ? Math.max(1, Math.min(200, options.limit)) : 200
    const safeBeforeSeq = options.beforeSeq !== null && Number.isFinite(options.beforeSeq)
        ? options.beforeSeq
        : null

    const { startSeq, endSeq } = computeTurnSeqRange(turn)

    if (startSeq === null || endSeq === null) {
        return {
            turn,
            messages: [],
            page: {
                limit: safeLimit,
                beforeSeq: safeBeforeSeq,
                nextBeforeSeq: null,
                hasMore: false,
                startSeq,
                endSeq
            }
        }
    }

    const rows = safeBeforeSeq !== null
        ? db.prepare(
            `SELECT *
             FROM messages
             WHERE session_id = ? AND seq >= ? AND seq <= ? AND seq < ?
             ORDER BY seq DESC
             LIMIT ?`
        ).all(sessionId, startSeq, endSeq, safeBeforeSeq, safeLimit) as DbMessageRow[]
        : db.prepare(
            `SELECT *
             FROM messages
             WHERE session_id = ? AND seq >= ? AND seq <= ?
             ORDER BY seq DESC
             LIMIT ?`
        ).all(sessionId, startSeq, endSeq, safeLimit) as DbMessageRow[]

    const messages = rows.reverse().map(toStoredMessage)

    let oldestSeq: number | null = null
    for (const message of messages) {
        if (oldestSeq === null || message.seq < oldestSeq) {
            oldestSeq = message.seq
        }
    }

    const nextBeforeSeq = oldestSeq
    const hasMore = nextBeforeSeq !== null && nextBeforeSeq > startSeq

    return {
        turn,
        messages,
        page: {
            limit: safeLimit,
            beforeSeq: safeBeforeSeq,
            nextBeforeSeq,
            hasMore,
            startSeq,
            endSeq
        }
    }
}

export function rebuildSessionConversationTurns(db: Database, sessionId: string): number {
    const rows = db.prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY seq ASC'
    ).all(sessionId) as DbMessageRow[]

    db.prepare('DELETE FROM conversation_turns WHERE session_id = ?').run(sessionId)

    if (rows.length === 0) {
        return 0
    }

    const turns: MutableTurn[] = []
    let openTurn: MutableTurn | null = null
    let nextTurnIndex = 1

    for (const row of rows) {
        const message = toStoredMessage(row)
        const role = classifyMessageRole(message.content)
        const snippet = extractSnippetFromMessageContent(message.content)
        const codexFinalAssistantSnippet = role === 'agent'
            ? extractCodexFinalAssistantSnippet(message.content)
            : undefined

        if (role === 'user') {
            if (openTurn) {
                openTurn.status = 'closed'
                openTurn.updatedAt = Math.max(openTurn.updatedAt, message.createdAt)
            }

            const nextTurn: MutableTurn = {
                id: randomUUID(),
                sessionId,
                turnIndex: nextTurnIndex,
                status: 'open',
                userMessageId: message.id,
                userSeq: message.seq,
                agentStartSeq: null,
                agentEndSeq: null,
                messageCount: 1,
                userPreview: snippet,
                assistantPreview: null,
                createdAt: message.createdAt,
                updatedAt: message.createdAt
            }

            turns.push(nextTurn)
            openTurn = nextTurn
            nextTurnIndex += 1
            continue
        }

        if (!openTurn) {
            const nextTurn: MutableTurn = {
                id: randomUUID(),
                sessionId,
                turnIndex: nextTurnIndex,
                status: 'open',
                userMessageId: null,
                userSeq: null,
                agentStartSeq: message.seq,
                agentEndSeq: message.seq,
                messageCount: 1,
                userPreview: null,
                assistantPreview: codexFinalAssistantSnippet === undefined ? snippet : codexFinalAssistantSnippet,
                createdAt: message.createdAt,
                updatedAt: message.createdAt
            }

            turns.push(nextTurn)
            openTurn = nextTurn
            nextTurnIndex += 1
            continue
        }

        openTurn.messageCount += 1
        if (openTurn.agentStartSeq === null) {
            openTurn.agentStartSeq = message.seq
        }
        openTurn.agentEndSeq = message.seq
        openTurn.assistantPreview = codexFinalAssistantSnippet === undefined
            ? buildRollingAssistantPreview(openTurn.assistantPreview, snippet)
            : codexFinalAssistantSnippet ?? openTurn.assistantPreview
        openTurn.updatedAt = message.createdAt
    }

    for (const turn of turns) {
        insertTurn(db, turn)
    }

    return turns.length
}

export function rebuildAllConversationTurns(db: Database): number {
    const rows = db.prepare('SELECT id FROM sessions ORDER BY created_at ASC').all() as Array<{ id: string }>
    let total = 0
    for (const row of rows) {
        total += rebuildSessionConversationTurns(db, row.id)
    }
    return total
}
