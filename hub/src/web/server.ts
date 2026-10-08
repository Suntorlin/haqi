import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { join, resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { configuration } from '../configuration'
import { PROTOCOL_VERSION } from '@hapi/protocol'
import type { SyncEngine } from '../sync/syncEngine'
import { createAuthMiddleware, type WebAppEnv } from './middleware/auth'
import { createAuthRoutes } from './routes/auth'
import { createBindRoutes } from './routes/bind'
import { createEventsRoutes } from './routes/events'
import { createSessionsRoutes } from './routes/sessions'
import { createMessagesRoutes } from './routes/messages'
import { createTeamControlRoutes } from './routes/teamControl'
import { createTurnsRoutes } from './routes/turns'
import { createPermissionsRoutes } from './routes/permissions'
import { createMachinesRoutes } from './routes/machines'
import { createGitRoutes } from './routes/git'
import { createCliRoutes } from './routes/cli'
import { createPushRoutes } from './routes/push'
import { createVoiceRoutes } from './routes/voice'
import { createUsageRoutes } from './routes/usage'
import { createGroupsRoutes } from './routes/groups'
import { createReviewLoopsRoutes } from './routes/reviewLoops'
import { createMemoryRoutes } from './routes/memory'
import { createReportsRoutes } from './routes/reports'
import { createPublicReportsRoutes } from './routes/publicReports'
import type { ReportPublicBaseUrlSettings } from '../config/reportPublicBaseUrl'
import { createSettingsRoutes } from './routes/settings'
import type { SSEManager } from '../sse/sseManager'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import type { Server as BunServer } from 'bun'
import type { Server as SocketEngine } from '@socket.io/bun-engine'
import type { WebSocketData } from '@socket.io/bun-engine'
import { loadEmbeddedAssetMap, type EmbeddedWebAsset } from './embeddedAssets'
import { isBunCompiled } from '../utils/bunCompiled'
import type { Store } from '../store'

function findWebappDistDir(): { distDir: string; indexHtmlPath: string } {
    const candidates = [
        join(process.cwd(), '..', 'web', 'dist'),
        join(import.meta.dir, '..', '..', '..', 'web', 'dist'),
        join(process.cwd(), 'web', 'dist')
    ]

    for (const distDir of candidates) {
        const indexHtmlPath = join(distDir, 'index.html')
        if (existsSync(indexHtmlPath)) {
            return { distDir, indexHtmlPath }
        }
    }

    const distDir = candidates[0]
    return { distDir, indexHtmlPath: join(distDir, 'index.html') }
}

// Vite fingerprints everything under /assets/, so those can be cached forever. The entry
// points that reference them must revalidate: Cloudflare caches .js at the edge for hours,
// which kept serving the previous sw.js (and its precached index.html) after a deploy.
function webCacheControl(pathname: string): string | null {
    if (pathname.startsWith('/assets/')) {
        return 'public, max-age=31536000, immutable'
    }
    if (pathname === '/sw.js' || pathname === '/index.html' || pathname === '/manifest.webmanifest') {
        return 'no-cache'
    }
    return null
}

function serveEmbeddedAsset(asset: EmbeddedWebAsset, pathname: string): Response {
    const headers: Record<string, string> = { 'Content-Type': asset.mimeType }
    const cacheControl = webCacheControl(pathname)
    if (cacheControl) {
        headers['Cache-Control'] = cacheControl
    }
    return new Response(Bun.file(asset.sourcePath), { headers })
}

function isStaticAssetRequest(pathname: string): boolean {
    return /\.(?:js|css|map|json|webmanifest|wasm|png|jpe?g|gif|svg|webp|ico|woff2?|ttf)$/i.test(pathname)
}

function createWebApp(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    reportsStorageDir: string
    reportPublicBaseUrl: ReportPublicBaseUrlSettings
    dataDir: string
    fallbackPublicUrl: string
    corsOrigins?: string[]
    embeddedAssetMap: Map<string, EmbeddedWebAsset> | null
    relayMode?: boolean
    officialWebUrl?: string
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.use('*', logger())

    // Health check endpoint (no auth required)
    app.get('/health', (c) => c.json({ status: 'ok', protocolVersion: PROTOCOL_VERSION }))

    const corsOrigins = options.corsOrigins ?? configuration.corsOrigins
    const corsOriginOption = corsOrigins.includes('*') ? '*' : corsOrigins
    const corsMiddleware = cors({
        origin: corsOriginOption,
        allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['authorization', 'content-type']
    })
    app.use('/api/*', corsMiddleware)
    app.use('/cli/*', corsMiddleware)

    app.route('/cli', createCliRoutes(options.getSyncEngine))

    app.route('/api', createAuthRoutes(options.jwtSecret, options.store))
    app.route('/api', createBindRoutes(options.jwtSecret, options.store))

    app.use('/api/*', createAuthMiddleware(options.jwtSecret))
    app.route('/api', createEventsRoutes(options.getSseManager, options.getSyncEngine, options.getVisibilityTracker))
    app.route('/api', createSessionsRoutes(options.getSyncEngine))
    app.route('/api', createMessagesRoutes(options.getSyncEngine))
    app.route('/api', createTeamControlRoutes(options.getSyncEngine))
    app.route('/api', createTurnsRoutes(options.getSyncEngine))
    app.route('/api', createPermissionsRoutes(options.getSyncEngine))
    app.route('/api', createMachinesRoutes(options.getSyncEngine))
    app.route('/api', createGitRoutes(options.getSyncEngine))
    app.route('/api', createPushRoutes(options.store, options.vapidPublicKey))
    app.route('/api', createVoiceRoutes())
    app.route('/api', createUsageRoutes())
    app.route('/api', createGroupsRoutes(options.getSyncEngine))
    app.route('/api', createReviewLoopsRoutes(options.getSyncEngine))
    app.route('/api', createMemoryRoutes())
    app.route('/api', createSettingsRoutes(options.store))
    const reportPublicBaseUrlState: { value: ReportPublicBaseUrlSettings } = {
        value: options.reportPublicBaseUrl
    }

    app.route('/api', createReportsRoutes({
        store: options.store,
        reportsStorageDir: options.reportsStorageDir,
        getReportPublicBaseUrl: () => reportPublicBaseUrlState.value,
        setReportPublicBaseUrl: (settings) => {
            reportPublicBaseUrlState.value = settings
        },
        dataDir: options.dataDir,
        fallbackPublicUrl: options.fallbackPublicUrl
    }))

    app.route('/', createPublicReportsRoutes({
        store: options.store,
        reportsStorageDir: options.reportsStorageDir
    }))

    // Skip static serving in relay mode, show helpful message on root
    if (options.relayMode) {
        const officialUrl = options.officialWebUrl || 'https://app.hapi.run'
        app.get('/', (c) => {
            return c.html(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>HAQI Hub</title></head>
<body style="font-family: system-ui; padding: 2rem; max-width: 600px;">
<h1>HAQI Hub</h1>
<p>This hub is running in relay mode. Please use the official web app:</p>
<p><a href="${officialUrl}">${officialUrl}</a></p>
<details>
<summary>Why am I seeing this?</summary>
<p style="margin-top: 0.5rem; color: #666;">
When relay mode is enabled, all traffic flows through our relay infrastructure with end-to-end encryption.
To reduce bandwidth and improve performance, the frontend is served separately
from GitHub Pages instead of through the relay tunnel.
</p>
</details>
</body>
</html>`)
        })
        return app
    }

    if (options.embeddedAssetMap) {
        const embeddedAssetMap = options.embeddedAssetMap
        const indexHtmlAsset = embeddedAssetMap.get('/index.html')

        if (!indexHtmlAsset) {
            app.get('*', (c) => {
                return c.text(
                    'Embedded Mini App is missing index.html. Rebuild the executable after running bun run build:web.',
                    503
                )
            })
            return app
        }

        app.use('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                return await next()
            }

            if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
                return await next()
            }

            const asset = embeddedAssetMap.get(c.req.path)
            if (asset) {
                return serveEmbeddedAsset(asset, c.req.path)
            }

            if (c.req.path.startsWith('/assets/') || isStaticAssetRequest(c.req.path)) {
                return c.text('Asset not found', 404)
            }

            return await next()
        })

        app.get('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                await next()
                return
            }

            return serveEmbeddedAsset(indexHtmlAsset, '/index.html')
        })

        return app
    }

    const { distDir, indexHtmlPath } = findWebappDistDir()

    if (!existsSync(indexHtmlPath)) {
        app.get('/', (c) => {
            return c.text(
                'Mini App is not built.\n\nRun:\n  cd web\n  bun install\n  bun run build\n',
                503
            )
        })
        return app
    }

    // Hono's Bun serveStatic adapter does not finalize the context reliably on
    // the Bun versions used by the isolated runner. Serve the built files
    // explicitly so every branch returns a Response (and never leaks paths).
    const serveBuiltFile = (pathname: string): Response | null => {
        const filePath = resolve(distDir, `.${pathname}`)
        const root = resolve(distDir)
        if (filePath !== root && !filePath.startsWith(`${root}/`)) return null
        if (!existsSync(filePath)) return null
        const cacheControl = webCacheControl(pathname)
        return new Response(Bun.file(filePath), cacheControl ? { headers: { 'Cache-Control': cacheControl } } : undefined)
    }

    app.get('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            return await next()
        }

        if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return await next()
        if (isStaticAssetRequest(c.req.path) || c.req.path.startsWith('/assets/')) {
            return serveBuiltFile(c.req.path) ?? c.text('Asset not found', 404)
        }
        return serveBuiltFile('/index.html') ?? c.text('Mini App is not built', 503)
    })

    return app
}

export async function startWebServer(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    reportsStorageDir: string
    reportPublicBaseUrl: ReportPublicBaseUrlSettings
    dataDir: string
    fallbackPublicUrl: string
    socketEngine: SocketEngine
    corsOrigins?: string[]
    relayMode?: boolean
    officialWebUrl?: string
}): Promise<BunServer<WebSocketData>> {
    const isCompiled = isBunCompiled()
    const embeddedAssetMap = isCompiled ? await loadEmbeddedAssetMap() : null
    const app = createWebApp({
        getSyncEngine: options.getSyncEngine,
        getSseManager: options.getSseManager,
        getVisibilityTracker: options.getVisibilityTracker,
        jwtSecret: options.jwtSecret,
        store: options.store,
        vapidPublicKey: options.vapidPublicKey,
        reportsStorageDir: options.reportsStorageDir,
        reportPublicBaseUrl: options.reportPublicBaseUrl,
        dataDir: options.dataDir,
        fallbackPublicUrl: options.fallbackPublicUrl,
        corsOrigins: options.corsOrigins,
        embeddedAssetMap,
        relayMode: options.relayMode,
        officialWebUrl: options.officialWebUrl
    })

    const socketHandler = options.socketEngine.handler()

    const server = Bun.serve({
        hostname: configuration.listenHost,
        port: configuration.listenPort,
        idleTimeout: Math.max(30, socketHandler.idleTimeout),
        maxRequestBodySize: socketHandler.maxRequestBodySize,
        websocket: socketHandler.websocket,
        fetch: (req, server) => {
            const url = new URL(req.url)
            if (url.pathname.startsWith('/socket.io/')) {
                return socketHandler.fetch(req, server)
            }
            return app.fetch(req)
        }
    })

    console.log(`[Web] hub listening on ${configuration.listenHost}:${configuration.listenPort}`)
    console.log(`[Web] public URL: ${configuration.publicUrl}`)

    return server
}
