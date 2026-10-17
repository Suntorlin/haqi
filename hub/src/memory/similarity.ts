/** Character-bigram Dice similarity: cheap, works for Chinese and English alike. */

function bigrams(text: string): Set<string> {
    const clean = text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
    const grams = new Set<string>()
    for (let i = 0; i < clean.length - 1; i++) grams.add(clean.slice(i, i + 2))
    return grams
}

export function similarity(a: string, b: string): number {
    const x = bigrams(a)
    const y = bigrams(b)
    if (x.size === 0 || y.size === 0) return 0
    let shared = 0
    for (const gram of x) if (y.has(gram)) shared += 1
    return (2 * shared) / (x.size + y.size)
}

/** The few existing memories worth showing Jev as "is it the same as one of these?". */
export function mostSimilar<T extends { text: string }>(candidate: string, items: T[], limit = 8, floor = 0.12): T[] {
    return items
        .map((item) => ({ item, score: similarity(candidate, item.text) }))
        .filter((entry) => entry.score >= floor)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.item)
}
