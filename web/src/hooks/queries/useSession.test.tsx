import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '@/api/client'
import type { Session } from '@/types/api'
import { readCachedSessionDetail, writeCachedSessionDetail } from '@/lib/session-detail-cache'
import { useSession } from './useSession'

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        ...overrides
    }
}

function createWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 5_000 } } })
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
}

describe('useSession', () => {
    afterEach(() => {
        localStorage.clear()
    })

    it('renders the cached session immediately, then revalidates it', async () => {
        writeCachedSessionDetail(createSession({ thinking: true }), Date.now() - 60_000)
        let resolveFetch: (value: { session: Session }) => void = () => {}
        const getSession = vi.fn(() => new Promise<{ session: Session }>((resolve) => { resolveFetch = resolve }))
        const api = { getSession } as unknown as ApiClient

        const { result } = renderHook(() => useSession(api, 'session-1'), { wrapper: createWrapper() })

        expect(result.current.session?.thinking).toBe(true)
        await waitFor(() => expect(getSession).toHaveBeenCalledTimes(1))
        resolveFetch({ session: createSession({ thinking: false }) })
        await waitFor(() => expect(result.current.session?.thinking).toBe(false))
        expect(readCachedSessionDetail('session-1')?.session.thinking).toBe(false)
    })

    it('reports a missing session instead of loading forever, and drops its cached copy', async () => {
        writeCachedSessionDetail(createSession(), Date.now() - 60_000)
        const getSession = vi.fn().mockRejectedValue(new ApiError('HTTP 404 Not Found', 404))
        const api = { getSession } as unknown as ApiClient

        const { result } = renderHook(() => useSession(api, 'session-1'), { wrapper: createWrapper() })

        await waitFor(() => expect(result.current.notFound).toBe(true))
        expect(result.current.session).toBeNull()
        expect(getSession).toHaveBeenCalledTimes(1)
        expect(readCachedSessionDetail('session-1')).toBeNull()
    })
})
