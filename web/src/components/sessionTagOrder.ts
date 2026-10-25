const STORAGE_KEY = 'hapi:sessionTagOrder'
const HIDDEN_STORAGE_KEY = 'hapi:hiddenSessionTags'

export function normalizeSessionTagOrder(value: string | null): string[] {
    if (!value) return []
    try {
        const parsed: unknown = JSON.parse(value)
        if (!Array.isArray(parsed)) return []
        return Array.from(new Set(parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)))
    } catch {
        return []
    }
}

function loadTagList(key: string): string[] {
    try {
        return normalizeSessionTagOrder(localStorage.getItem(key))
    } catch {
        return []
    }
}

function persistTagList(key: string, tags: string[]): void {
    try {
        localStorage.setItem(key, JSON.stringify(tags))
    } catch {
        // Ignore storage failures; the current page still keeps the new list.
    }
}

export function loadSessionTagOrder(): string[] {
    return loadTagList(STORAGE_KEY)
}

export function persistSessionTagOrder(order: string[]): void {
    persistTagList(STORAGE_KEY, order)
}

/** Tags left out of the tag filter bar. Only the bar hides them: the sessions keep their tags. */
export function loadHiddenSessionTags(): string[] {
    return loadTagList(HIDDEN_STORAGE_KEY)
}

export function persistHiddenSessionTags(tags: string[]): void {
    persistTagList(HIDDEN_STORAGE_KEY, tags)
}

export function applySessionTagOrder(tags: string[], order: string[]): string[] {
    const rank = new Map(order.map((tag, index) => [tag, index]))
    return [...tags].sort((a, b) => {
        const aRank = rank.get(a)
        const bRank = rank.get(b)
        if (aRank === undefined && bRank === undefined) return a.localeCompare(b)
        if (aRank === undefined) return 1
        if (bRank === undefined) return -1
        return aRank - bRank
    })
}

export function moveSessionTag(order: string[], sourceTag: string, targetTag: string): string[] {
    const sourceIndex = order.indexOf(sourceTag)
    const targetIndex = order.indexOf(targetTag)
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return order

    const next = [...order]
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    return next
}
