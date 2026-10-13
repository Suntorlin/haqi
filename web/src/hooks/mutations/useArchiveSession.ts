import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import { isSessionPinned } from '@/lib/session-pins'
import { useSessionPin } from '@/hooks/mutations/useSessionPin'

/**
 * Archive (stop) a session. A pinned session is unpinned too, so it does not stay in the pinned
 * row as an offline avatar. Every archive entry point goes through here.
 */
export function useArchiveSession(api: ApiClient | null): (sessionId: string) => Promise<void> {
    const queryClient = useQueryClient()
    const pinSession = useSessionPin(api)

    return useCallback(async (sessionId) => {
        if (!api) {
            throw new Error('Session unavailable')
        }
        await api.archiveSession(sessionId)
        try {
            // Fresh tags, so unpinning keeps tags added elsewhere in the meantime.
            const { session } = await api.getSession(sessionId)
            if (isSessionPinned(session)) {
                await pinSession(session, false)
            }
        } catch (error) {
            // The archive went through; a failed unpin only leaves the avatar in the pinned row.
            console.error('Failed to unpin archived session', error)
        } finally {
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        }
    }, [api, pinSession, queryClient])
}
