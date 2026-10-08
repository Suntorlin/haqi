import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiClient, ApiError } from '@/api/client'
import type { AuthResponse } from '@/types/api'

export type AuthSource =
    | { type: 'telegram'; initData: string }
    | { type: 'accessToken'; token: string }

function decodeJwtExpMs(token: string): number | null {
    const parts = token.split('.')
    if (parts.length < 2) return null

    const payloadBase64Url = parts[1] ?? ''
    const payloadBase64 = payloadBase64Url
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(payloadBase64Url.length / 4) * 4, '=')

    try {
        const decoded = globalThis.atob(payloadBase64)
        const payload = JSON.parse(decoded) as { exp?: unknown }
        if (typeof payload.exp !== 'number') return null
        return payload.exp * 1000
    } catch {
        return null
    }
}

function getAuthPayload(source: AuthSource): { initData: string } | { accessToken: string } {
    if (source.type === 'telegram') {
        return { initData: source.initData }
    }
    return { accessToken: source.token }
}

function isNotBoundError(error: unknown): boolean {
    return error instanceof ApiError && error.status === 401 && error.code === 'not_bound'
}

function isUnauthorizedAuthError(error: unknown): boolean {
    return error instanceof ApiError && error.status === 401 && error.code !== 'not_bound'
}

// Reusing a still-valid JWT on reload skips the /api/auth round trip before any data loads.
const AUTH_CACHE_PREFIX = 'hapi_auth_cache::'
const CACHED_TOKEN_MIN_TTL_MS = 2 * 60_000

type CachedAuth = {
    token: string
    user: AuthResponse['user']
    source: string
}

function getAuthCacheKey(baseUrl: string): string {
    return `${AUTH_CACHE_PREFIX}${baseUrl}`
}

// FNV-1a of the access token: detects a changed token without storing it twice.
function fingerprintAuthSource(source: AuthSource): string | null {
    if (source.type !== 'accessToken') {
        return null
    }
    let hash = 0x811c9dc5
    for (let i = 0; i < source.token.length; i += 1) {
        hash ^= source.token.charCodeAt(i)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(16)
}

function readCachedAuth(baseUrl: string, source: AuthSource): CachedAuth | null {
    const fingerprint = fingerprintAuthSource(source)
    if (!fingerprint) {
        return null
    }
    try {
        const raw = localStorage.getItem(getAuthCacheKey(baseUrl))
        if (!raw) {
            return null
        }
        const parsed = JSON.parse(raw) as Partial<CachedAuth>
        if (parsed.source !== fingerprint || typeof parsed.token !== 'string' || !parsed.user || typeof parsed.user !== 'object') {
            return null
        }
        const expMs = decodeJwtExpMs(parsed.token)
        if (!expMs || expMs - Date.now() < CACHED_TOKEN_MIN_TTL_MS) {
            return null
        }
        return { token: parsed.token, user: parsed.user, source: fingerprint }
    } catch {
        return null
    }
}

function writeCachedAuth(baseUrl: string, source: AuthSource, auth: AuthResponse): void {
    const fingerprint = fingerprintAuthSource(source)
    if (!fingerprint) {
        return
    }
    try {
        const cached: CachedAuth = { token: auth.token, user: auth.user, source: fingerprint }
        localStorage.setItem(getAuthCacheKey(baseUrl), JSON.stringify(cached))
    } catch {
        // Ignore storage errors
    }
}

function clearCachedAuth(baseUrl: string): void {
    try {
        localStorage.removeItem(getAuthCacheKey(baseUrl))
    } catch {
        // Ignore storage errors
    }
}

export function useAuth(authSource: AuthSource | null, baseUrl: string): {
    token: string | null
    user: AuthResponse['user'] | null
    api: ApiClient | null
    isLoading: boolean
    error: string | null
    needsBinding: boolean
    requiresLogin: boolean
    bind: (accessToken: string) => Promise<void>
} {
    const [token, setToken] = useState<string | null>(null)
    const [user, setUser] = useState<AuthResponse['user'] | null>(null)
    const [isLoading, setIsLoading] = useState<boolean>(false)
    const [error, setError] = useState<string | null>(null)
    const [needsBinding, setNeedsBinding] = useState<boolean>(false)
    const [requiresLogin, setRequiresLogin] = useState<boolean>(false)
    const refreshPromiseRef = useRef<Promise<string | null> | null>(null)
    const tokenRef = useRef<string | null>(null)
    const lastRefreshAttemptRef = useRef<number>(0)

    // Stable reference for auth source to use in effects
    const authSourceRef = useRef(authSource)
    authSourceRef.current = authSource
    tokenRef.current = token

    const refreshAuth = useCallback(async (options?: {
        minTtlMs?: number
        hardFail?: boolean
        force?: boolean
    }): Promise<string | null> => {
        const currentSource = authSourceRef.current
        const currentToken = tokenRef.current
        if (!currentSource) {
            return null
        }

        const expMs = currentToken ? decodeJwtExpMs(currentToken) : null
        const minTtlMs = options?.minTtlMs ?? 0
        const now = Date.now()
        const ttlMs = expMs ? expMs - now : null
        const needsRefreshForTtl = ttlMs !== null && ttlMs <= minTtlMs
        if (!options?.force && ttlMs !== null && ttlMs > minTtlMs) {
            return currentToken
        }
        if (!options?.force && !needsRefreshForTtl && now - lastRefreshAttemptRef.current < 15_000) {
            return currentToken
        }
        if (refreshPromiseRef.current) {
            return await refreshPromiseRef.current
        }

        const run = async () => {
            lastRefreshAttemptRef.current = now

            try {
                const client = new ApiClient('', { baseUrl })
                const auth = await client.authenticate(getAuthPayload(currentSource))
                writeCachedAuth(baseUrl, currentSource, auth)
                tokenRef.current = auth.token
                setToken(auth.token)
                setUser(auth.user)
                setError(null)
                setNeedsBinding(false)
                setRequiresLogin(false)
                return auth.token
            } catch (error) {
                if (currentSource.type === 'telegram' && isNotBoundError(error)) {
                    tokenRef.current = null
                    setToken(null)
                    setUser(null)
                    setError(null)
                    setNeedsBinding(true)
                    setRequiresLogin(false)
                    return null
                }
                if (isUnauthorizedAuthError(error)) {
                    clearCachedAuth(baseUrl)
                    tokenRef.current = null
                    setToken(null)
                    setUser(null)
                    setNeedsBinding(false)
                    setRequiresLogin(true)
                    const msg = currentSource.type === 'telegram'
                        ? 'Session expired. Reopen the Mini App from Telegram.'
                        : 'Session expired. Please login again.'
                    setError(msg)
                    return null
                }
                throw error
            }
        }

        const refreshPromise = run()
        refreshPromiseRef.current = refreshPromise

        try {
            return await refreshPromise
        } finally {
            if (refreshPromiseRef.current === refreshPromise) {
                refreshPromiseRef.current = null
            }
        }
    }, [baseUrl])

    const bind = useCallback(async (accessToken: string) => {
        const currentSource = authSourceRef.current
        if (!currentSource || currentSource.type !== 'telegram') {
            setError('Binding is only supported in Telegram.')
            return
        }

        setIsLoading(true)
        setError(null)
        try {
            const client = new ApiClient('', { baseUrl })
            const auth = await client.bind({ initData: currentSource.initData, accessToken })
            tokenRef.current = auth.token
            setToken(auth.token)
            setUser(auth.user)
            setNeedsBinding(false)
            setRequiresLogin(false)
        } catch (error) {
            setError(error instanceof Error ? error.message : 'Binding failed')
            throw error
        } finally {
            setIsLoading(false)
        }
    }, [baseUrl])

    const api = useMemo(() => (
        token
            ? new ApiClient(token, {
                baseUrl,
                getToken: () => tokenRef.current,
                onUnauthorized: () => refreshAuth({ force: true })
            })
            : null
    ), [baseUrl, refreshAuth, token])

    // Declared before the auth effect so a server switch resets state before the
    // auth effect restores or requests a token for the new server.
    const lastBaseUrlRef = useRef(baseUrl)
    useEffect(() => {
        if (lastBaseUrlRef.current === baseUrl) {
            return
        }
        lastBaseUrlRef.current = baseUrl
        tokenRef.current = null
        refreshPromiseRef.current = null
        lastRefreshAttemptRef.current = 0
        setToken(null)
        setUser(null)
        setError(null)
        setNeedsBinding(false)
        setRequiresLogin(false)
    }, [baseUrl])

    useEffect(() => {
        let isCancelled = false

        async function run() {
            if (!authSource) {
                // No auth source - waiting for login
                setNeedsBinding(false)
                setRequiresLogin(false)
                return
            }

            const cached = readCachedAuth(baseUrl, authSource)
            if (cached) {
                tokenRef.current = cached.token
                setToken(cached.token)
                setUser(cached.user)
                setError(null)
                setNeedsBinding(false)
                setRequiresLogin(false)
                setIsLoading(false)
                return
            }

            setIsLoading(true)
            setError(null)
            setNeedsBinding(false)
            setRequiresLogin(false)
            try {
                const client = new ApiClient('', { baseUrl }) // temporary for auth call
                const auth = await client.authenticate(getAuthPayload(authSource))
                if (isCancelled) return
                writeCachedAuth(baseUrl, authSource, auth)
                setToken(auth.token)
                setUser(auth.user)
                setNeedsBinding(false)
                setRequiresLogin(false)
            } catch (e) {
                if (isCancelled) return
                if (authSource.type === 'telegram' && isNotBoundError(e)) {
                    setToken(null)
                    setUser(null)
                    setError(null)
                    setNeedsBinding(true)
                    setRequiresLogin(false)
                    return
                }
                const rejected = authSource.type === 'accessToken' && isUnauthorizedAuthError(e)
                if (rejected) {
                    clearCachedAuth(baseUrl)
                }
                setNeedsBinding(false)
                setRequiresLogin(rejected)
                setError(e instanceof Error ? e.message : 'Auth failed')
            } finally {
                if (!isCancelled) {
                    setIsLoading(false)
                }
            }
        }

        run()

        return () => {
            isCancelled = true
        }
    }, [authSource, baseUrl])

    useEffect(() => {
        if (!token || !authSource) {
            return
        }

        const expMs = decodeJwtExpMs(token)
        if (!expMs) {
            return
        }

        let isCancelled = false
        let timeout: ReturnType<typeof setTimeout> | null = null

        const schedule = (delayMs: number) => {
            if (timeout) {
                clearTimeout(timeout)
            }
            timeout = setTimeout(() => void refresh(), Math.max(0, delayMs))
        }

        const refresh = async () => {
            if (isCancelled) return
            let refreshed: string | null = null
            try {
                refreshed = await refreshAuth({ force: true })
            } catch {
                refreshed = null
            }
            if (isCancelled) return
            if (!refreshed) {
                schedule(15_000)
            }
        }

        schedule(expMs - 60_000 - Date.now())

        return () => {
            isCancelled = true
            if (timeout) {
                clearTimeout(timeout)
            }
        }
    }, [authSource, refreshAuth, token])

    useEffect(() => {
        if (!authSource) {
            return
        }

        const handleActive = () => {
            void refreshAuth({ minTtlMs: 60_000 }).catch(() => {})
        }

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                handleActive()
            }
        }

        window.addEventListener('focus', handleActive)
        document.addEventListener('visibilitychange', handleVisibilityChange)

        return () => {
            window.removeEventListener('focus', handleActive)
            document.removeEventListener('visibilitychange', handleVisibilityChange)
        }
    }, [authSource, refreshAuth])

    return { token, user, api, isLoading, error, needsBinding, requiresLogin, bind }
}
