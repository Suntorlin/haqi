import { useCallback, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import type { ApiClient } from '@/api/client'
import type { ConversationTurn } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

const EMPTY_TURNS: ConversationTurn[] = []
const DEFAULT_PAGE_LIMIT = 50

type TurnsPage = {
    turns: ConversationTurn[]
    page: {
        limit: number
        beforeTurnIndex: number | null
        nextBeforeTurnIndex: number | null
        hasMore: boolean
    }
}

function mergeTurns(current: ConversationTurn[], incoming: ConversationTurn[]): ConversationTurn[] {
    if (incoming.length === 0) {
        return current
    }

    const byId = new Map<string, ConversationTurn>()
    for (const turn of current) {
        byId.set(turn.id, turn)
    }
    for (const turn of incoming) {
        byId.set(turn.id, turn)
    }

    return Array.from(byId.values()).sort((left, right) => left.turnIndex - right.turnIndex)
}

/**
 * A refetch returns only the newest page. Keep any older pages the user already loaded instead of
 * replacing them (the list used to shrink back to page 1 on the next streamed message).
 */
export function mergeTurnPages(existing: TurnsPage | undefined, fresh: TurnsPage): TurnsPage {
    if (!existing || existing.turns.length === 0) {
        return fresh
    }
    const oldestExisting = existing.turns[0]?.turnIndex ?? Infinity
    const oldestFresh = fresh.turns[0]?.turnIndex ?? Infinity
    const keepsOlderPages = oldestExisting < oldestFresh
    return {
        turns: mergeTurns(existing.turns, fresh.turns),
        // The page cursor must describe the oldest loaded turn, so "load more" continues from there.
        page: keepsOlderPages ? { ...fresh.page, nextBeforeTurnIndex: existing.page.nextBeforeTurnIndex, hasMore: existing.page.hasMore } : fresh.page
    }
}

export function useConversationTurns(
    api: ApiClient | null,
    sessionId: string | null,
    options?: { enabled?: boolean }
): {
    turns: ConversationTurn[]
    warning: string | null
    isLoading: boolean
    isLoadingMore: boolean
    hasMore: boolean
    loadMore: () => Promise<void>
    refetch: () => Promise<void>
} {
    const enabled = (options?.enabled ?? true) && Boolean(api && sessionId)
    const queryClient = useQueryClient()
    const [isLoadingMore, setIsLoadingMore] = useState(false)

    const key = useMemo(
        () => (sessionId ? queryKeys.turns(sessionId) : ['turns', 'unknown'] as const),
        [sessionId]
    )

    const query = useQuery<TurnsPage, Error>({
        queryKey: key,
        enabled,
        queryFn: async () => {
            if (!api || !sessionId) {
                return {
                    turns: [],
                    page: {
                        limit: DEFAULT_PAGE_LIMIT,
                        beforeTurnIndex: null,
                        nextBeforeTurnIndex: null,
                        hasMore: false
                    }
                }
            }
            const fresh = await api.getConversationTurns(sessionId, { limit: DEFAULT_PAGE_LIMIT })
            return mergeTurnPages(queryClient.getQueryData<TurnsPage>(key), fresh)
        }
    })

    const turns = enabled ? (query.data?.turns ?? EMPTY_TURNS) : EMPTY_TURNS
    const hasMore = enabled ? (query.data?.page.hasMore ?? false) : false
    const warning = query.error ? query.error.message : null

    const loadMore = useCallback(async () => {
        if (!enabled || !api || !sessionId || isLoadingMore) {
            return
        }

        const snapshot = queryClient.getQueryData<TurnsPage>(key)
        const nextBeforeTurnIndex = snapshot?.page.nextBeforeTurnIndex ?? null
        if (nextBeforeTurnIndex === null) {
            return
        }

        setIsLoadingMore(true)
        try {
            const older = await api.getConversationTurns(sessionId, {
                limit: DEFAULT_PAGE_LIMIT,
                beforeTurnIndex: nextBeforeTurnIndex
            })

            queryClient.setQueryData<TurnsPage>(key, (prev) => {
                if (!prev) {
                    return older
                }
                return {
                    turns: mergeTurns(prev.turns, older.turns),
                    page: older.page
                }
            })
        } finally {
            setIsLoadingMore(false)
        }
    }, [api, enabled, isLoadingMore, key, queryClient, sessionId])

    const refetch = useCallback(async () => {
        if (!enabled) {
            return
        }
        await query.refetch()
    }, [enabled, query])

    return {
        turns,
        warning,
        isLoading: enabled ? query.isLoading : false,
        isLoadingMore,
        hasMore,
        loadMore,
        refetch
    }
}
