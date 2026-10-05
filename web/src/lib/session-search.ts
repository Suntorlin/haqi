import type { SessionSummary } from '@/types/api'
import { getSessionTitle } from '@/lib/session-title'

function normalizeQuery(query: string): string {
    return query.trim().toLowerCase()
}

function buildSessionSearchFields(session: SessionSummary): string[] {
    const title = getSessionTitle(session, { fallbackIdLength: 12 }).toLowerCase()
    const name = (session.metadata?.name ?? '').toLowerCase()
    const summary = (session.metadata?.summary?.text ?? '').toLowerCase()
    const path = (session.metadata?.path ?? '').toLowerCase()
    const tags = (session.metadata?.tags ?? []).map((tag) => tag.toLowerCase())
    const sessionId = session.id.toLowerCase()
    return [title, name, summary, path, sessionId, ...tags]
}

export function matchesSessionSearch(session: SessionSummary, query: string): boolean {
    const normalizedQuery = normalizeQuery(query)
    if (!normalizedQuery) {
        return true
    }
    return buildSessionSearchFields(session).some((field) => field.includes(normalizedQuery))
}

export function filterSessionsBySearch(sessions: SessionSummary[], query: string): SessionSummary[] {
    const normalizedQuery = normalizeQuery(query)
    if (!normalizedQuery) {
        return sessions
    }
    return sessions.filter((session) => matchesSessionSearch(session, normalizedQuery))
}
