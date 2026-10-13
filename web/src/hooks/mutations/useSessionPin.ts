import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionResponse, SessionsResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { getUserTags, withPinTag } from '@/lib/session-pins'

type PinnableSession = { id: string; metadata?: { tags?: string[] } | null }

/** Pin / unpin a session; the pinned row updates right away, the server confirms after. */
export function useSessionPin(api: ApiClient | null): (session: PinnableSession, pinned: boolean) => Promise<void> {
    const queryClient = useQueryClient()

    return useCallback(async (session, pinned) => {
        if (!api) return
        const tags = withPinTag(getUserTags(session), pinned)
        queryClient.setQueryData<SessionsResponse>(queryKeys.sessions, (previous) => previous ? {
            ...previous,
            sessions: previous.sessions.map((item) => (
                item.id === session.id && item.metadata
                    ? { ...item, metadata: { ...item.metadata, tags } }
                    : item
            ))
        } : previous)
        queryClient.setQueryData<SessionResponse>(queryKeys.session(session.id), (previous) => (
            previous?.session.metadata
                ? { ...previous, session: { ...previous.session, metadata: { ...previous.session.metadata, tags } } }
                : previous
        ))
        try {
            await api.updateSessionTags(session.id, tags)
        } finally {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(session.id) })
        }
    }, [api, queryClient])
}
