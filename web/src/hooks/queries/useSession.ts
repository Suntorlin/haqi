import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ApiError, type ApiClient } from '@/api/client'
import type { Session } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { readCachedSessionDetail, removeCachedSessionDetail, writeCachedSessionDetail } from '@/lib/session-detail-cache'

function isNotFoundError(error: unknown): boolean {
    return error instanceof ApiError && error.status === 404
}

export function useSession(api: ApiClient | null, sessionId: string | null): {
    session: Session | null
    isLoading: boolean
    isFetching: boolean
    error: string | null
    notFound: boolean
    refetch: () => Promise<unknown>
} {
    const resolvedSessionId = sessionId ?? 'unknown'
    const query = useQuery({
        queryKey: queryKeys.session(resolvedSessionId),
        queryFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.getSession(sessionId)
        },
        enabled: Boolean(api && sessionId),
        // Cached details are stale on arrival, so the query still revalidates on mount.
        initialData: () => {
            const cached = sessionId ? readCachedSessionDetail(sessionId) : null
            return cached ? { session: cached.session } : undefined
        },
        initialDataUpdatedAt: () => (sessionId ? readCachedSessionDetail(sessionId)?.savedAt : undefined),
        retry: (failureCount, error) => !isNotFoundError(error) && failureCount < 1,
    })

    const notFound = isNotFoundError(query.error)
    const session = notFound ? null : query.data?.session ?? null

    useEffect(() => {
        if (session) {
            writeCachedSessionDetail(session, query.dataUpdatedAt)
        }
    }, [session, query.dataUpdatedAt])

    useEffect(() => {
        if (notFound && sessionId) {
            removeCachedSessionDetail(sessionId)
        }
    }, [notFound, sessionId])

    return {
        session,
        isLoading: query.isLoading,
        isFetching: query.isFetching,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load session' : null,
        notFound,
        refetch: query.refetch,
    }
}
