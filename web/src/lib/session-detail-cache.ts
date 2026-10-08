import { SessionSchema } from '@hapi/protocol/schemas'
import type { Session } from '@/types/api'

// Last-known session details, so reopening a session renders immediately while
// the query revalidates in the background instead of blocking on the network.
const ENTRY_KEY_PREFIX = 'hapi:sessionDetail:v1:'
const INDEX_KEY = 'hapi:sessionDetail:v1:index'
const MAX_ENTRIES = 20

export type CachedSessionDetail = {
    session: Session
    savedAt: number
}

function getStorage(): Storage | null {
    if (typeof window === 'undefined') {
        return null
    }
    try {
        return window.localStorage
    } catch {
        return null
    }
}

function readIndex(storage: Storage): string[] {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(INDEX_KEY) ?? '[]')
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
    } catch {
        return []
    }
}

export function readCachedSessionDetail(sessionId: string): CachedSessionDetail | null {
    const storage = getStorage()
    if (!storage) {
        return null
    }
    try {
        const raw = storage.getItem(`${ENTRY_KEY_PREFIX}${sessionId}`)
        if (!raw) {
            return null
        }
        const parsed = JSON.parse(raw) as { savedAt?: unknown; session?: unknown }
        if (typeof parsed.savedAt !== 'number') {
            return null
        }
        const result = SessionSchema.safeParse(parsed.session)
        if (!result.success || result.data.id !== sessionId) {
            return null
        }
        // Keep the stored object: schema parsing strips fields the protocol may add later.
        return { session: parsed.session as Session, savedAt: parsed.savedAt }
    } catch {
        return null
    }
}

export function writeCachedSessionDetail(session: Session, savedAt: number): void {
    const storage = getStorage()
    if (!storage) {
        return
    }
    try {
        storage.setItem(`${ENTRY_KEY_PREFIX}${session.id}`, JSON.stringify({ savedAt, session }))
        const index = readIndex(storage)
        if (index[0] === session.id) {
            return
        }
        const next = [session.id, ...index.filter((id) => id !== session.id)]
        for (const evictedId of next.slice(MAX_ENTRIES)) {
            storage.removeItem(`${ENTRY_KEY_PREFIX}${evictedId}`)
        }
        storage.setItem(INDEX_KEY, JSON.stringify(next.slice(0, MAX_ENTRIES)))
    } catch {
        // Best effort: quota or privacy mode only costs the instant reopen.
    }
}

export function removeCachedSessionDetail(sessionId: string): void {
    const storage = getStorage()
    if (!storage) {
        return
    }
    try {
        storage.removeItem(`${ENTRY_KEY_PREFIX}${sessionId}`)
        const index = readIndex(storage)
        if (index.includes(sessionId)) {
            storage.setItem(INDEX_KEY, JSON.stringify(index.filter((id) => id !== sessionId)))
        }
    } catch {
        // Ignore storage errors
    }
}
