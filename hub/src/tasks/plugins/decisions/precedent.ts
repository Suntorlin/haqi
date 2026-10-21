/**
 * Precedents: a decision the user already made in a similar situation. With a close match whose choice is one of
 * the options, HAQI answers by the precedent instead of asking, and lists it in the report so the user can overturn it.
 */

export const PRECEDENT_MIN_SCORE = 0.82

export type PrecedentHit = { memoryId: string; text: string; score: number }

/** The experience text is "情境：…；选项：…；你选了：X". */
export function choiceOf(text: string): string | null {
    const match = /你选了：(.+)$/.exec(text.trim())
    return match ? match[1]!.trim() : null
}

export function matchPrecedent(options: string[], hits: PrecedentHit[]): { label: string; memoryId: string } | null {
    for (const hit of hits) {
        if (hit.score < PRECEDENT_MIN_SCORE) continue
        const chosen = choiceOf(hit.text)
        if (!chosen) continue
        const label = options.find((option) => option === chosen)
        if (label) return { label, memoryId: hit.memoryId }
    }
    return null
}
