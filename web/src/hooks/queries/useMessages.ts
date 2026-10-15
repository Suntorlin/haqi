import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage } from '@/types/api'
import {
    clearMessageWindow,
    fetchLatestMessages,
    fetchOlderMessages,
    flushPendingMessages,
    getMessageWindowState,
    setAtBottom as setMessageWindowAtBottom,
    subscribeMessageWindow,
    type MessageWindowState,
} from '@/lib/message-window-store'

const EMPTY_STATE: MessageWindowState = {
    sessionId: 'unknown',
    messages: [],
    pending: [],
    pendingCount: 0,
    hasMore: false,
    oldestSeq: null,
    newestSeq: null,
    isLoading: false,
    isLoadingMore: false,
    warning: null,
    atBottom: true,
    messagesVersion: 0,
}

export function useMessages(
    api: ApiClient | null,
    sessionId: string | null,
    options?: { enabled?: boolean }
): {
    messages: DecryptedMessage[]
    warning: string | null
    isLoading: boolean
    isLoadingMore: boolean
    hasMore: boolean
    newestSeq: number | null
    pendingCount: number
    messagesVersion: number
    loadMore: (options?: { limit?: number }) => Promise<unknown>
    refetch: () => Promise<unknown>
    flushPending: () => Promise<void>
    setAtBottom: (atBottom: boolean) => void
} {
    const enabled = options?.enabled ?? true
    const state = useSyncExternalStore(
        useCallback((listener) => {
            if (!sessionId || !enabled) {
                return () => {}
            }
            return subscribeMessageWindow(sessionId, listener)
        }, [enabled, sessionId]),
        useCallback(() => {
            if (!sessionId || !enabled) {
                return EMPTY_STATE
            }
            return getMessageWindowState(sessionId)
        }, [enabled, sessionId]),
        () => EMPTY_STATE
    )

    useEffect(() => {
        if (!api || !sessionId || !enabled) {
            return
        }
        void fetchLatestMessages(api, sessionId)
    }, [api, enabled, sessionId])

    useEffect(() => {
        if (!sessionId) {
            return
        }
        return () => {
            clearMessageWindow(sessionId)
        }
    }, [sessionId])

    const loadMore = useCallback(async (options?: { limit?: number }) => {
        if (!api || !sessionId || !enabled) return
        if (!state.hasMore || state.isLoadingMore) return
        // Button handlers pass a click event here, so accept only a numeric limit.
        const limit = typeof options?.limit === 'number' ? options.limit : undefined
        await fetchOlderMessages(api, sessionId, limit)
    }, [api, enabled, sessionId, state.hasMore, state.isLoadingMore])

    const refetch = useCallback(async () => {
        if (!api || !sessionId || !enabled) return
        await fetchLatestMessages(api, sessionId)
    }, [api, enabled, sessionId])

    const flushPending = useCallback(async () => {
        if (!sessionId || !enabled) return
        const needsRefresh = flushPendingMessages(sessionId)
        if (needsRefresh && api) {
            await fetchLatestMessages(api, sessionId)
        }
    }, [api, enabled, sessionId])

    const setAtBottom = useCallback((atBottom: boolean) => {
        if (!sessionId || !enabled) return
        setMessageWindowAtBottom(sessionId, atBottom)
    }, [enabled, sessionId])

    return {
        messages: state.messages,
        warning: state.warning,
        isLoading: state.isLoading,
        isLoadingMore: state.isLoadingMore,
        hasMore: state.hasMore,
        newestSeq: state.newestSeq,
        pendingCount: state.pendingCount,
        messagesVersion: state.messagesVersion,
        loadMore,
        refetch,
        flushPending,
        setAtBottom,
    }
}
