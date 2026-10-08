import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAuth, type AuthSource } from './useAuth'

function createJwt(expiresInMs: number): string {
    const payload = btoa(JSON.stringify({ exp: Math.floor((Date.now() + expiresInMs) / 1000) }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    return `header.${payload}.signature`
}

function mockJsonResponse(status: number, body: unknown, statusText: string = 'OK'): Response {
    return new Response(JSON.stringify(body), {
        status,
        statusText,
        headers: { 'content-type': 'application/json' }
    })
}

describe('useAuth', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        localStorage.clear()
    })

    it('keeps browser auth source and avoids login redirect on transient auth failure', async () => {
        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
        vi.stubGlobal('fetch', fetchMock)

        const authSource: AuthSource = { type: 'accessToken', token: 'cli-token' }
        const { result } = renderHook(() => useAuth(authSource, 'http://localhost:3016'))

        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.token).toBeNull()
        expect(result.current.requiresLogin).toBe(false)
        expect(result.current.error).toContain('Failed to fetch')
    })

    it('requires login again only when access token is rejected', async () => {
        const fetchMock = vi.fn().mockResolvedValue(
            mockJsonResponse(401, { error: 'unauthorized' }, 'Unauthorized')
        )
        vi.stubGlobal('fetch', fetchMock)

        const authSource: AuthSource = { type: 'accessToken', token: 'cli-token' }
        const { result } = renderHook(() => useAuth(authSource, 'http://localhost:3016'))

        await waitFor(() => expect(result.current.isLoading).toBe(false))

        expect(result.current.token).toBeNull()
        expect(result.current.requiresLogin).toBe(true)
        expect(result.current.error).toContain('HTTP 401 Unauthorized')
    })

    it('reuses a cached unexpired token on reload without calling /api/auth', async () => {
        const jwt = createJwt(10 * 60_000)
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            mockJsonResponse(200, { token: jwt, user: { id: 1, firstName: 'Web User' } })
        ))
        const authSource: AuthSource = { type: 'accessToken', token: 'cli-token' }
        const first = renderHook(() => useAuth(authSource, 'http://localhost:3016'))
        await waitFor(() => expect(first.result.current.token).toBe(jwt))
        first.unmount()

        const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
        vi.stubGlobal('fetch', fetchMock)
        const { result } = renderHook(() => useAuth(authSource, 'http://localhost:3016'))

        await waitFor(() => expect(result.current.token).toBe(jwt))
        expect(result.current.api).not.toBeNull()
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('authenticates again when the cached token belongs to another access token', async () => {
        const cachedJwt = createJwt(10 * 60_000)
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
            mockJsonResponse(200, { token: cachedJwt, user: { id: 1 } })
        ))
        const cachedSource: AuthSource = { type: 'accessToken', token: 'cli-token' }
        const first = renderHook(() => useAuth(cachedSource, 'http://localhost:3016'))
        await waitFor(() => expect(first.result.current.token).toBe(cachedJwt))
        first.unmount()

        const freshJwt = createJwt(15 * 60_000)
        const fetchMock = vi.fn().mockResolvedValue(mockJsonResponse(200, { token: freshJwt, user: { id: 1 } }))
        vi.stubGlobal('fetch', fetchMock)
        const otherSource: AuthSource = { type: 'accessToken', token: 'cli-token:other' }
        const { result } = renderHook(() => useAuth(otherSource, 'http://localhost:3016'))

        await waitFor(() => expect(result.current.token).toBe(freshJwt))
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })
})
