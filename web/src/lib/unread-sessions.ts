import { useSyncExternalStore } from 'react'

// Sessions that finished (ready for input) while the user was looking elsewhere. Shown as a dot on the
// session avatar; opening the session clears it. Kept in localStorage so a reload does not lose it.
const STORAGE_KEY = 'hapi:unreadSessions'
const MAX_TRACKED = 200

let unread: ReadonlySet<string> = load()
const listeners = new Set<() => void>()

function load(): ReadonlySet<string> {
    if (typeof window === 'undefined') return new Set()
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [])
    } catch {
        return new Set()
    }
}

function commit(next: ReadonlySet<string>): void {
    unread = next
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next].slice(-MAX_TRACKED)))
    } catch {
        // Ignore storage errors
    }
    for (const listener of listeners) listener()
}

export function markSessionUnread(sessionId: string): void {
    if (unread.has(sessionId)) return
    commit(new Set([...unread, sessionId]))
}

export function markSessionRead(sessionId: string): void {
    if (!unread.has(sessionId)) return
    const next = new Set(unread)
    next.delete(sessionId)
    commit(next)
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

export function useUnreadSessions(): ReadonlySet<string> {
    return useSyncExternalStore(subscribe, () => unread, () => unread)
}

/** Test helper: forget everything and re-read storage. */
export function resetUnreadSessions(): void {
    unread = load()
    for (const listener of listeners) listener()
}
