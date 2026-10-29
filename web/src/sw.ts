/// <reference lib="webworker" />
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

declare const self: ServiceWorkerGlobalScope & {
    __WB_MANIFEST: Array<string | { url: string; revision?: string }>
}

type PushPayload = {
    title: string
    body?: string
    icon?: string
    badge?: string
    tag?: string
    data?: {
        type?: string
        sessionId?: string
        url?: string
    }
}

// Activate new SW immediately and control existing pages to avoid stale bundles.
self.skipWaiting()
self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim())
})

// Allow workbox-window / virtual:pwa-register to trigger immediate activation.
self.addEventListener('message', (event) => {
    const data = event.data as { type?: string } | undefined
    if (data?.type === 'SKIP_WAITING') {
        self.skipWaiting()
    }
})

precacheAndRoute(self.__WB_MANIFEST)

// Deep links (/sessions/<id>...) open the app shell even with no network; server-rendered and API
// paths are left alone.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/share\//, /^\/socket\.io\//, /^\/health/, /^\/sw\.js$/, /^\/manifest\.webmanifest$/]
}))

// Hashed build files never change: whatever was not precached is kept after its first download.
registerRoute(
    ({ url }) => url.pathname.startsWith('/assets/'),
    new CacheFirst({
        cacheName: 'assets-runtime',
        plugins: [new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 60 * 60 * 24 * 30 })]
    })
)

registerRoute(
    ({ url }) => url.pathname === '/api/sessions',
    new NetworkFirst({
        cacheName: 'api-sessions',
        networkTimeoutSeconds: 10,
        plugins: [
            new ExpirationPlugin({
                maxEntries: 10,
                maxAgeSeconds: 60 * 5
            })
        ]
    })
)

registerRoute(
    ({ url }) => /^\/api\/sessions\/[^/]+$/.test(url.pathname),
    new NetworkFirst({
        cacheName: 'api-session-detail',
        networkTimeoutSeconds: 10,
        plugins: [
            new ExpirationPlugin({
                maxEntries: 20,
                maxAgeSeconds: 60 * 5
            })
        ]
    })
)

registerRoute(
    ({ url }) => url.pathname === '/api/machines',
    new NetworkFirst({
        cacheName: 'api-machines',
        networkTimeoutSeconds: 10,
        plugins: [
            new ExpirationPlugin({
                maxEntries: 5,
                maxAgeSeconds: 60 * 10
            })
        ]
    })
)

registerRoute(
    /^https:\/\/cdn\.socket\.io\/.*/,
    new CacheFirst({
        cacheName: 'cdn-socketio',
        plugins: [
            new ExpirationPlugin({
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 30
            })
        ]
    })
)

registerRoute(
    /^https:\/\/telegram\.org\/.*/,
    new CacheFirst({
        cacheName: 'cdn-telegram',
        plugins: [
            new ExpirationPlugin({
                maxEntries: 5,
                maxAgeSeconds: 60 * 60 * 24 * 7
            })
        ]
    })
)

self.addEventListener('push', (event) => {
    const payload = event.data?.json() as PushPayload | undefined
    if (!payload) {
        return
    }

    const title = payload.title || 'HAPI'
    const body = payload.body ?? ''
    const icon = payload.icon ?? '/pwa-192x192.png'
    const badge = payload.badge ?? '/badge-96x96.png?v=4'
    const data = payload.data
    const tag = payload.tag

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon,
            badge,
            data,
            tag
        })
    )
})

self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    const data = event.notification.data as { url?: string } | undefined
    const target = new URL(data?.url ?? '/', self.location.origin).href
    // Reuse an open window instead of stacking a new one for every notification.
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
        const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
        if (existing) {
            try {
                const navigated = await existing.navigate(target)
                await (navigated ?? existing).focus()
                return
            } catch {
                // fall through to a new window
            }
        }
        await self.clients.openWindow(target)
    })())
})
