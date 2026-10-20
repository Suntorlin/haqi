import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionResponse, SessionsResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { withPinTag, withSnoozeTag, withTaskTag } from '@/lib/session-pins'

type TaggableSession = { id: string; metadata?: { tags?: string[] } | null }

/** Save a full tag list; the row updates right away, the server confirms after. */
function useOptimisticSessionTags(api: ApiClient | null): (sessionId: string, tags: string[]) => Promise<void> {
    const queryClient = useQueryClient()

    return useCallback(async (sessionId, tags) => {
        if (!api) return
        queryClient.setQueryData<SessionsResponse>(queryKeys.sessions, (previous) => previous ? {
            ...previous,
            sessions: previous.sessions.map((item) => (
                item.id === sessionId && item.metadata
                    ? { ...item, metadata: { ...item.metadata, tags } }
                    : item
            ))
        } : previous)
        queryClient.setQueryData<SessionResponse>(queryKeys.session(sessionId), (previous) => (
            previous?.session.metadata
                ? { ...previous, session: { ...previous.session, metadata: { ...previous.session.metadata, tags } } }
                : previous
        ))
        try {
            await api.updateSessionTags(sessionId, tags)
        } finally {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        }
    }, [api, queryClient])
}

/** Pin / unpin a session. */
export function useSessionPin(api: ApiClient | null): (session: TaggableSession, pinned: boolean) => Promise<void> {
    const saveTags = useOptimisticSessionTags(api)
    return useCallback(
        (session, pinned) => saveTags(session.id, withPinTag(session, pinned)),
        [saveTags]
    )
}

/** Snooze a session until `until` (epoch ms), or wake it now with null. */
export function useSessionSnooze(api: ApiClient | null): (session: TaggableSession, until: number | null) => Promise<void> {
    const saveTags = useOptimisticSessionTags(api)
    return useCallback(
        (session, until) => saveTags(session.id, withSnoozeTag(session, until)),
        [saveTags]
    )
}

/** Join a session to a task, or take it out. */
export function useSessionTaskLink(api: ApiClient | null): (
    session: TaggableSession,
    task: { id: string; tag: string },
    linked: boolean
) => Promise<void> {
    const saveTags = useOptimisticSessionTags(api)
    return useCallback(
        (session, task, linked) => saveTags(session.id, withTaskTag(session, task, linked)),
        [saveTags]
    )
}
