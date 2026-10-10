const STORAGE_KEY = 'hapi:sessionItemOrder'

export function normalizeSessionItemOrder(value: string | null): string[] {
    if (!value) return []
    try {
        const parsed: unknown = JSON.parse(value)
        if (!Array.isArray(parsed)) return []
        return Array.from(new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    } catch {
        return []
    }
}

export function loadSessionItemOrder(): string[] {
    try {
        return normalizeSessionItemOrder(localStorage.getItem(STORAGE_KEY))
    } catch {
        return []
    }
}

export function persistSessionItemOrder(order: string[]): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(order))
    } catch {
        // ignore storage failures
    }
}

// Sessions without a saved rank (e.g. newly created) keep their default order and stay on top.
export function applySessionItemOrder<T extends { id: string }>(sessions: T[], order: string[]): T[] {
    if (sessions.length <= 1 || order.length === 0) return sessions
    const rank = new Map(order.map((id, index) => [id, index]))
    const unranked = sessions.filter((session) => !rank.has(session.id))
    const ranked = sessions
        .filter((session) => rank.has(session.id))
        .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    return [...unranked, ...ranked]
}

// `groupIds` is the current display order of one group; returns the new global order.
export function moveSessionItem(order: string[], groupIds: string[], sourceId: string, targetId: string): string[] {
    const sourceIndex = groupIds.indexOf(sourceId)
    const targetIndex = groupIds.indexOf(targetId)
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return order

    const nextGroup = [...groupIds]
    const [moved] = nextGroup.splice(sourceIndex, 1)
    nextGroup.splice(targetIndex, 0, moved)

    const inGroup = new Set(groupIds)
    return [...order.filter((id) => !inGroup.has(id)), ...nextGroup]
}
