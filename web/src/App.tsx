import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation, useMatchRoute, useRouter } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { getTelegramWebApp, isTelegramApp } from '@/hooks/useTelegram'
import { initializeTheme } from '@/hooks/useTheme'
import { useAuth } from '@/hooks/useAuth'
import { useAuthSource } from '@/hooks/useAuthSource'
import { useServerUrl } from '@/hooks/useServerUrl'
import { useSSE } from '@/hooks/useSSE'
import { useSyncingState } from '@/hooks/useSyncingState'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import { useVisibilityReporter } from '@/hooks/useVisibilityReporter'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { queryKeys } from '@/lib/query-keys'
import { AppContextProvider } from '@/lib/app-context'
import { fetchLatestMessages } from '@/lib/message-window-store'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useTranslation } from '@/lib/use-translation'
import { VoiceProvider } from '@/lib/voice-context'
import { requireHubUrlForLogin } from '@/lib/runtime-config'
import { LoginPrompt } from '@/components/LoginPrompt'
import { InstallPrompt } from '@/components/InstallPrompt'
import { OfflineBanner } from '@/components/OfflineBanner'
import { SyncingBanner } from '@/components/SyncingBanner'
import { ReconnectingBanner } from '@/components/ReconnectingBanner'
import { VoiceErrorBanner } from '@/components/VoiceErrorBanner'
import { LoadingState } from '@/components/LoadingState'
import { DesktopNavRail } from '@/components/mobile/MobileTabBar'
import { ToastContainer } from '@/components/ToastContainer'
import { ToastProvider, useToast } from '@/lib/toast-context'
import type { SyncEvent } from '@/types/api'

type ToastEvent = Extract<SyncEvent, { type: 'toast' }>

const REQUIRE_SERVER_URL = requireHubUrlForLogin()

const SESSIONS_STALE_MS = 60_000

export function App() {
    return (
        <ToastProvider>
            <AppInner />
        </ToastProvider>
    )
}

function AppInner() {
    const { t } = useTranslation()
    const { serverUrl, baseUrl, setServerUrl, clearServerUrl } = useServerUrl()
    const { authSource, isLoading: isAuthSourceLoading, setAccessToken } = useAuthSource(baseUrl)
    const { token, api, isLoading: isAuthLoading, error: authError, needsBinding, requiresLogin, bind } = useAuth(authSource, baseUrl)
    const goBack = useAppGoBack()
    const pathname = useLocation({ select: (location) => location.pathname })
    const matchRoute = useMatchRoute()
    const router = useRouter()
    const { addToast } = useToast()
    const isMobileLayout = useIsMobileLayout()

    // Minimal monochrome palette for every layout (see index.css); set on <html> so portals match.
    useLayoutEffect(() => {
        document.documentElement.classList.add('social-app')
    }, [])

    useEffect(() => {
        const tg = getTelegramWebApp()
        tg?.ready()
        tg?.expand()
        initializeTheme()
    }, [])

    useEffect(() => {
        const preventDefault = (event: Event) => {
            event.preventDefault()
        }

        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey) {
                event.preventDefault()
            }
        }

        const onKeyDown = (event: KeyboardEvent) => {
            const modifier = event.ctrlKey || event.metaKey
            if (!modifier) return
            if (event.key === '+' || event.key === '-' || event.key === '=' || event.key === '0') {
                event.preventDefault()
            }
        }

        document.addEventListener('gesturestart', preventDefault as EventListener, { passive: false })
        document.addEventListener('gesturechange', preventDefault as EventListener, { passive: false })
        document.addEventListener('gestureend', preventDefault as EventListener, { passive: false })

        window.addEventListener('wheel', onWheel, { passive: false })
        window.addEventListener('keydown', onKeyDown)

        return () => {
            document.removeEventListener('gesturestart', preventDefault as EventListener)
            document.removeEventListener('gesturechange', preventDefault as EventListener)
            document.removeEventListener('gestureend', preventDefault as EventListener)

            window.removeEventListener('wheel', onWheel)
            window.removeEventListener('keydown', onKeyDown)
        }
    }, [])

    useEffect(() => {
        const tg = getTelegramWebApp()
        const backButton = tg?.BackButton
        if (!backButton) return

        if (pathname === '/' || pathname === '/sessions') {
            backButton.offClick(goBack)
            backButton.hide()
            return
        }

        backButton.show()
        backButton.onClick(goBack)
        return () => {
            backButton.offClick(goBack)
            backButton.hide()
        }
    }, [goBack, pathname])
    const queryClient = useQueryClient()
    const sessionMatch = matchRoute({ to: '/sessions/$sessionId' })
    const selectedSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null
    const groupMatch = matchRoute({ to: '/groups/$groupId' })
    const selectedGroupId = groupMatch ? groupMatch.groupId : null
    const { isSyncing, startSync, endSync } = useSyncingState()
    const [sseDisconnected, setSseDisconnected] = useState(false)
    const [sseDisconnectReason, setSseDisconnectReason] = useState<string | null>(null)
    const syncTokenRef = useRef(0)
    const needsFullRefreshRef = useRef(true)
    const lastSessionsRefreshAtRef = useRef(0)
    const isFirstConnectRef = useRef(true)
    const baseUrlRef = useRef(baseUrl)
    const pushPromptedRef = useRef(false)
    const { isSupported: isPushSupported, permission: pushPermission, requestPermission, subscribe } = usePushNotifications(api)

    useEffect(() => {
        if (baseUrlRef.current === baseUrl) {
            return
        }
        baseUrlRef.current = baseUrl
        isFirstConnectRef.current = true
        syncTokenRef.current = 0
        queryClient.clear()
    }, [baseUrl, queryClient])

    // Clean up URL params after successful auth (for direct access links)
    useEffect(() => {
        if (!token || !api) return
        const { pathname, search, hash, state } = router.history.location
        const searchParams = new URLSearchParams(search)
        if (!searchParams.has('server') && !searchParams.has('hub') && !searchParams.has('token')) {
            return
        }
        searchParams.delete('server')
        searchParams.delete('hub')
        searchParams.delete('token')
        const nextSearch = searchParams.toString()
        const nextHref = `${pathname}${nextSearch ? `?${nextSearch}` : ''}${hash}`
        router.history.replace(nextHref, state)
    }, [token, api, router])

    useEffect(() => {
        if (!api || !token) {
            pushPromptedRef.current = false
            return
        }
        if (isTelegramApp() || !isPushSupported) {
            return
        }
        if (pushPromptedRef.current) {
            return
        }
        pushPromptedRef.current = true

        const run = async () => {
            if (pushPermission === 'granted') {
                await subscribe()
                return
            }
            if (pushPermission === 'default') {
                const granted = await requestPermission()
                if (granted) {
                    await subscribe()
                }
            }
        }

        void run()
    }, [api, isPushSupported, pushPermission, requestPermission, subscribe, token])

    const handleSseConnect = useCallback(() => {
        // Clear disconnected state on successful connection
        setSseDisconnected(false)
        setSseDisconnectReason(null)

        // Increment token to track this specific connection
        const token = ++syncTokenRef.current

        // Only force show banner on first connect (page load)
        // Subsequent connects (session switches) use non-forced mode
        // which only shows banner when returning from background
        if (isFirstConnectRef.current) {
            isFirstConnectRef.current = false
            startSync({ force: true })
        } else {
            startSync()
        }
        // The stream reopens on every session switch. The session list is kept live by SSE patches, so only
        // refetch it (900+ rows) on page load, after a real disconnect, or when it has gone stale.
        const needsFullRefresh = needsFullRefreshRef.current
            || Date.now() - lastSessionsRefreshAtRef.current > SESSIONS_STALE_MS
        needsFullRefreshRef.current = false
        if (needsFullRefresh) {
            lastSessionsRefreshAtRef.current = Date.now()
        }
        const invalidations = [
            ...(needsFullRefresh ? [
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
                queryClient.invalidateQueries({ queryKey: queryKeys.memory })
            ] : []),
            ...(selectedSessionId ? [
                queryClient.invalidateQueries({ queryKey: queryKeys.session(selectedSessionId) })
            ] : []),
            ...(selectedGroupId ? [
                queryClient.invalidateQueries({ queryKey: queryKeys.groups }),
                queryClient.invalidateQueries({ queryKey: queryKeys.group(selectedGroupId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.groupMessages(selectedGroupId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.groupTasks(selectedGroupId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.groupNote(selectedGroupId) })
            ] : [])
        ]
        const refreshMessages = (selectedSessionId && api)
            ? fetchLatestMessages(api, selectedSessionId)
            : Promise.resolve()
        Promise.all([...invalidations, refreshMessages])
            .catch((error) => {
                console.error('Failed to invalidate queries on SSE connect:', error)
            })
            .finally(() => {
                // Only end sync if this is still the latest connection
                if (syncTokenRef.current === token) {
                    endSync()
                }
            })
    }, [api, queryClient, selectedSessionId, selectedGroupId, startSync, endSync])

    const handleSseDisconnect = useCallback((reason: string) => {
        needsFullRefreshRef.current = true
        // Only show reconnecting banner if we've already connected once
        if (!isFirstConnectRef.current) {
            setSseDisconnected(true)
            setSseDisconnectReason(reason)
        }
    }, [])

    const handleSseEvent = useCallback(() => {}, [])
    const handleToast = useCallback((event: ToastEvent) => {
        addToast({
            title: event.data.title,
            body: event.data.body,
            sessionId: event.data.sessionId,
            url: event.data.url
        })
    }, [addToast])

    const eventSubscription = useMemo(() => {
        if (selectedSessionId) {
            // `all` keeps the sidebar live while a chat is open; the hub still sends message events only
            // for `sessionId`, so message traffic is unchanged.
            return { all: true, sessionId: selectedSessionId }
        }
        if (selectedGroupId) {
            // Group pages also need session lifecycle events to keep member status fresh.
            // Keep groupId filter for group events, but subscribe to all session updates.
            return { all: true, groupId: selectedGroupId }
        }
        return { all: true }
    }, [selectedSessionId, selectedGroupId])

    const { subscriptionId } = useSSE({
        enabled: Boolean(api && token),
        token: token ?? '',
        baseUrl,
        subscription: eventSubscription,
        onConnect: handleSseConnect,
        onDisconnect: handleSseDisconnect,
        onEvent: handleSseEvent,
        onToast: handleToast
    })

    useVisibilityReporter({
        api,
        subscriptionId,
        enabled: Boolean(api && token)
    })

    // Loading auth source
    if (isAuthSourceLoading) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading')} className="text-[13px]" />
            </div>
        )
    }

    // No auth source (browser environment, not logged in)
    if (!authSource) {
        return (
            <LoginPrompt
                onLogin={setAccessToken}
                baseUrl={baseUrl}
                serverUrl={serverUrl}
                setServerUrl={setServerUrl}
                clearServerUrl={clearServerUrl}
                requireServerUrl={REQUIRE_SERVER_URL}
            />
        )
    }

    if (needsBinding) {
        return (
            <LoginPrompt
                mode="bind"
                onBind={bind}
                baseUrl={baseUrl}
                serverUrl={serverUrl}
                setServerUrl={setServerUrl}
                clearServerUrl={clearServerUrl}
                requireServerUrl={REQUIRE_SERVER_URL}
                error={authError ?? undefined}
            />
        )
    }

    // Authenticating (also covers the gap before useAuth effect starts)
    if (isAuthLoading || (authSource && !token && !authError)) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('authorizing')} className="text-[13px]" />
            </div>
        )
    }

    // Auth error
    if (authError || !token || !api) {
        // Only real token rejection should send browser users back to login.
        if (authSource.type === 'accessToken' && requiresLogin) {
            return (
                <LoginPrompt
                    onLogin={setAccessToken}
                    baseUrl={baseUrl}
                    serverUrl={serverUrl}
                    setServerUrl={setServerUrl}
                    clearServerUrl={clearServerUrl}
                    requireServerUrl={REQUIRE_SERVER_URL}
                    error={authError ?? t('login.error.authFailed')}
                />
            )
        }

        if (authSource.type === 'accessToken') {
            return (
                <div className="p-4 space-y-3">
                    <div className="text-base font-semibold">{t('login.title')}</div>
                    <div className="text-[13px] text-[var(--social-danger)]">
                        {authError ?? t('login.error.authFailed')}
                    </div>
                    <div className="text-xs text-[var(--social-fg-muted)]">
                        {t('login.error.networkHint')}
                    </div>
                </div>
            )
        }

        // Telegram auth failed
        return (
            <div className="p-4 space-y-3">
                <div className="text-base font-semibold">{t('login.title')}</div>
                <div className="text-[13px] text-[var(--social-danger)]">
                    {authError ?? t('login.error.authFailed')}
                </div>
                <div className="text-xs text-[var(--social-fg-muted)]">
                    {t('login.error.telegramHint')}
                </div>
            </div>
        )
    }

    return (
        <AppContextProvider value={{ api, token, baseUrl }}>
            <VoiceProvider>
                <SyncingBanner isSyncing={isSyncing} />
                <ReconnectingBanner
                    isReconnecting={sseDisconnected && !isSyncing}
                    reason={sseDisconnectReason}
                />
                <VoiceErrorBanner />
                <OfflineBanner />
                {isMobileLayout ? (
                    <div className="h-full flex flex-col">
                        <Outlet />
                    </div>
                ) : (
                    <div className="flex h-full">
                        <DesktopNavRail />
                        <div className="flex h-full min-w-0 flex-1 flex-col">
                            <Outlet />
                        </div>
                    </div>
                )}
                <ToastContainer />
                <InstallPrompt />
            </VoiceProvider>
        </AppContextProvider>
    )
}
