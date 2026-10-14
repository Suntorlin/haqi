import { describe, expect, it } from 'vitest'
import type { ConversationTurn } from '@/types/api'
import { mergeTurnPages } from './useConversationTurns'

function turn(turnIndex: number): ConversationTurn {
    return { id: `t${turnIndex}`, turnIndex } as unknown as ConversationTurn
}

function page(indexes: number[], nextBeforeTurnIndex: number | null, hasMore: boolean) {
    return { turns: indexes.map(turn), page: { limit: 50, beforeTurnIndex: null, nextBeforeTurnIndex, hasMore } }
}

describe('mergeTurnPages', () => {
    it('keeps older pages the user loaded when the newest page is refetched', () => {
        const loaded = page([1, 2, 3, 4, 5, 6], 1, true)
        const fresh = page([5, 6, 7], 5, true)

        const merged = mergeTurnPages(loaded, fresh)

        expect(merged.turns.map((t) => t.turnIndex)).toEqual([1, 2, 3, 4, 5, 6, 7])
        expect(merged.page.nextBeforeTurnIndex).toBe(1)
    })

    it('uses the fresh cursor when nothing older was loaded', () => {
        const merged = mergeTurnPages(page([5, 6], 5, true), page([5, 6, 7], 5, true))

        expect(merged.turns.map((t) => t.turnIndex)).toEqual([5, 6, 7])
        expect(merged.page.nextBeforeTurnIndex).toBe(5)
    })
})
