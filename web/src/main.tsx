import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import './index.css'
import { registerSW } from 'virtual:pwa-register'
import { initializeFontScale } from '@/hooks/useFontScale'
import { getTelegramWebApp, isTelegramEnvironment, loadTelegramSdk } from './hooks/useTelegram'
import { queryClient } from './lib/query-client'
import { createAppRouter } from './router'
import { I18nProvider } from './lib/i18n-context'
import { installIOSViewportFit } from './lib/ios-viewport'

function isSafariEngine(): boolean {
    const ua = window.navigator.userAgent
    const platform = window.navigator.platform
    const maxTouchPoints = window.navigator.maxTouchPoints ?? 0
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)

    if (isIOS) {
        // iOS browsers are all WebKit-based and have shown update-reload loops.
        return true
    }

    const isSafariDesktop = /Safari/.test(ua) && !/Chrome|Chromium|Edg|OPR/.test(ua)
    return isSafariDesktop
}

async function disableServiceWorkerForSafari(): Promise<void> {
    if (!('serviceWorker' in navigator)) {
        return
    }

    try {
        const registrations = await navigator.serviceWorker.getRegistrations()
        await Promise.allSettled(registrations.map((registration) => registration.unregister()))
    } catch {
        // ignore unsupported API/errors
    }

    if (!('caches' in window)) {
        return
    }

    try {
        const names = await caches.keys()
        await Promise.allSettled(names.map((name) => caches.delete(name)))
    } catch {
        // ignore cache deletion failures
    }
}

function getStartParam(): string | null {
    const query = new URLSearchParams(window.location.search)
    const fromQuery = query.get('startapp') || query.get('tgWebAppStartParam')
    if (fromQuery) return fromQuery

    return getTelegramWebApp()?.initDataUnsafe?.start_param ?? null
}

function getDeepLinkedSessionId(): string | null {
    const startParam = getStartParam()
    if (startParam?.startsWith('session_')) {
        return startParam.slice('session_'.length)
    }
    return null
}

function getInitialPath(): string {
    const sessionId = getDeepLinkedSessionId()
    return sessionId ? `/sessions/${sessionId}` : '/sessions'
}

// A tab left open across a deploy still asks for chunk files the new build no longer has. Reload once
// to pick up the new build instead of leaving a lazy page blank.
window.addEventListener('vite:preloadError', (event) => {
    try {
        const key = 'hapi:preload-reload'
        if (sessionStorage.getItem(key) === '1') {
            return
        }
        sessionStorage.setItem(key, '1')
        event.preventDefault()
        window.location.reload()
    } catch {
        // storage blocked: leave the error to surface
    }
})

async function bootstrap() {
    initializeFontScale()
    if (!isTelegramEnvironment()) {
        installIOSViewportFit()
    }

    // Only load Telegram SDK in Telegram environment (with 3s timeout)
    const isTelegram = isTelegramEnvironment()
    if (isTelegram) {
        await loadTelegramSdk()
    }

    if (isSafariEngine()) {
        // Hard disable SW on Safari/WebKit to avoid auto-refresh loops.
        await disableServiceWorkerForSafari()
    } else {
        const updateSW = registerSW({
            onNeedRefresh() {
                // Auto-apply updates to avoid users being stuck on stale hashed bundles.
                try {
                    const key = 'hapi:pwa-updating'
                    if (sessionStorage.getItem(key) === '1') {
                        return
                    }
                    sessionStorage.setItem(key, '1')
                } catch {
                    // If storage is blocked, skip auto-reload to avoid potential refresh loops.
                    return
                }
                updateSW(true)
            },
            onOfflineReady() {
                console.log('App ready for offline use')
            },
            onRegistered(registration) {
                if (registration) {
                    void registration.update()
                    setInterval(() => {
                        registration.update()
                    }, 5 * 60 * 1000)
                }
            },
            onRegisterError(error) {
                console.error('SW registration error:', error)
            }
        })
    }

    const history = isTelegram
        ? createMemoryHistory({ initialEntries: [getInitialPath()] })
        : undefined
    const router = createAppRouter(history)

    ReactDOM.createRoot(document.getElementById('root')!).render(
        <React.StrictMode>
            <I18nProvider>
                <QueryClientProvider client={queryClient}>
                    <RouterProvider router={router} />
                    {import.meta.env.DEV ? <ReactQueryDevtools initialIsOpen={false} /> : null}
                </QueryClientProvider>
            </I18nProvider>
        </React.StrictMode>
    )
}

bootstrap()
