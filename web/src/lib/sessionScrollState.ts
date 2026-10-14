export type SessionScrollViewMode = 'normal' | 'cli' | 'brief'

export type SessionScrollSnapshot = {
    top: number
    topIndex?: number
    lastKey: string | null
    savedAt: number
}

const SESSION_SCROLL_STATE_STORAGE_KEY = 'hapi:sessionScrollState:v1'

type SessionScrollStateRecord = Record<string, SessionScrollSnapshot>

function buildStorageKey(sessionId: string, viewMode: SessionScrollViewMode): string {
    return `${sessionId}:${viewMode}`
}

const MAX_STORED_SNAPSHOTS = 200
const PERSIST_DELAY_MS = 400

let cache: SessionScrollStateRecord | null = null
let persistTimer: ReturnType<typeof setTimeout> | null = null
let flushListenersInstalled = false

function loadFromStorage(): SessionScrollStateRecord {
    if (typeof window === 'undefined') {
        return {}
    }
    try {
        const raw = window.localStorage.getItem(SESSION_SCROLL_STATE_STORAGE_KEY)
        if (!raw) {
            return {}
        }
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') {
            return {}
        }
        return parsed as SessionScrollStateRecord
    } catch {
        return {}
    }
}

/** Read once, then served from memory: the scroll handlers call this many times a second. */
function readAllSnapshots(): SessionScrollStateRecord {
    if (cache === null) {
        cache = loadFromStorage()
    }
    return cache
}

/** Drops the in-memory copy so the next read goes back to localStorage (tests, external edits). */
export function resetSessionScrollStateCache(): void {
    if (persistTimer !== null) {
        clearTimeout(persistTimer)
        persistTimer = null
    }
    cache = null
}

function flushSnapshots(): void {
    if (persistTimer !== null) {
        clearTimeout(persistTimer)
        persistTimer = null
    }
    if (typeof window === 'undefined' || cache === null) {
        return
    }
    // Keep the newest entries only; the record used to grow with every session ever opened.
    const entries = Object.entries(cache)
    if (entries.length > MAX_STORED_SNAPSHOTS) {
        entries.sort((a, b) => (b[1]?.savedAt ?? 0) - (a[1]?.savedAt ?? 0))
        cache = Object.fromEntries(entries.slice(0, MAX_STORED_SNAPSHOTS))
    }
    try {
        window.localStorage.setItem(SESSION_SCROLL_STATE_STORAGE_KEY, JSON.stringify(cache))
    } catch {
    }
}

function schedulePersist(): void {
    if (typeof window === 'undefined') {
        return
    }
    if (!flushListenersInstalled) {
        flushListenersInstalled = true
        window.addEventListener('pagehide', flushSnapshots)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') flushSnapshots()
        })
    }
    if (persistTimer === null) {
        persistTimer = setTimeout(flushSnapshots, PERSIST_DELAY_MS)
    }
}

export function readSessionScrollSnapshot(
    sessionId: string,
    viewMode: SessionScrollViewMode
): SessionScrollSnapshot | null {
    const snapshot = readAllSnapshots()[buildStorageKey(sessionId, viewMode)]
    if (!snapshot || typeof snapshot !== 'object') {
        return null
    }
    const top = typeof snapshot.top === 'number' && Number.isFinite(snapshot.top)
        ? Math.max(0, snapshot.top)
        : 0
    const topIndex = typeof snapshot.topIndex === 'number' && Number.isFinite(snapshot.topIndex)
        ? Math.max(0, Math.floor(snapshot.topIndex))
        : undefined
    const lastKey = typeof snapshot.lastKey === 'string' ? snapshot.lastKey : null
    const savedAt = typeof snapshot.savedAt === 'number' && Number.isFinite(snapshot.savedAt)
        ? snapshot.savedAt
        : 0
    return { top, topIndex, lastKey, savedAt }
}

export function writeSessionScrollSnapshot(
    sessionId: string,
    viewMode: SessionScrollViewMode,
    snapshot: SessionScrollSnapshot
): void {
    const all = readAllSnapshots()
    all[buildStorageKey(sessionId, viewMode)] = {
        top: Math.max(0, snapshot.top),
        topIndex: snapshot.topIndex !== undefined ? Math.max(0, Math.floor(snapshot.topIndex)) : undefined,
        lastKey: typeof snapshot.lastKey === 'string' ? snapshot.lastKey : null,
        savedAt: snapshot.savedAt
    }
    schedulePersist()
}
