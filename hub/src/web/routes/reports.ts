import { Hono } from 'hono'
import { readFile, mkdir, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

import type { Store, StoredReport, StoredReportAsset, StoredReportShare } from '../../store'
import type { HandoffService } from '../../handoff/handoffService'
import type { WebAppEnv } from '../middleware/auth'
import {
    saveReportPublicBaseUrlSetting,
    type ReportPublicBaseUrlSettings
} from '../../config/reportPublicBaseUrl'

const MAX_MARKDOWN_CHARS = 400_000
const MAX_ASSET_BYTES = 20 * 1024 * 1024
/** A full HTML page for the share link; empty string removes it. */
const MAX_PAGE_CHARS = 10 * 1024 * 1024

const listReportsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    sessionId: z.string().min(1).max(255).optional()
})

/** Marks a report as a handoff: the hub copies it into the user's notes folder after the session ends. */
const handoffSchema = z.object({
    folder: z.string().trim().min(1).max(500).optional(),
    summary: z.string().trim().min(1).max(600).optional(),
    shortTitle: z.string().trim().min(1).max(60).optional()
})

const createReportSchema = z.object({
    sessionId: z.string().min(1).max(255).optional().nullable(),
    taskId: z.string().min(1).max(120).optional().nullable(),
    title: z.string().trim().min(1).max(200).optional(),
    status: z.string().trim().min(1).max(40).optional(),
    markdown: z.string().max(MAX_MARKDOWN_CHARS).optional(),
    html: z.string().max(MAX_PAGE_CHARS).optional(),
    metadata: z.unknown().optional(),
    handoff: handoffSchema.optional(),
    createShare: z.boolean().optional(),
    shareExpiresInHours: z.number().positive().max(24 * 365).optional()
})

const updateReportSchema = z.object({
    taskId: z.string().min(1).max(120).nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    status: z.string().trim().min(1).max(40).optional(),
    markdown: z.string().max(MAX_MARKDOWN_CHARS).optional(),
    html: z.string().max(MAX_PAGE_CHARS).optional(),
    metadata: z.unknown().optional(),
    handoff: handoffSchema.optional()
})

const createAssetSchema = z.object({
    filename: z.string().trim().min(1).max(255).optional(),
    mimeType: z.string().trim().min(1).max(255).optional(),
    content: z.string().min(1).optional(),
    sourcePath: z.string().min(1).optional(),
    caption: z.string().trim().max(500).optional()
}).superRefine((data, ctx) => {
    const hasContent = typeof data.content === 'string' && data.content.length > 0
    const hasSourcePath = typeof data.sourcePath === 'string' && data.sourcePath.length > 0
    if (!hasContent && !hasSourcePath) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Either content or sourcePath is required'
        })
    }
    if (hasContent && hasSourcePath) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'content and sourcePath cannot be used together'
        })
    }
})

const createShareSchema = z.object({
    expiresInHours: z.number().positive().max(24 * 365).optional(),
    createdBy: z.string().trim().min(1).max(255).optional()
})

const updateReportDomainSchema = z.object({
    domain: z.string().trim().min(1).max(2048).nullable()
})

/** The metadata with the handoff fields laid over its existing `handoff` part. */
function withHandoff(metadata: unknown, handoff: z.infer<typeof handoffSchema> | undefined): unknown {
    if (!handoff) return metadata
    const base = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {}
    const current = base.handoff && typeof base.handoff === 'object' ? base.handoff as Record<string, unknown> : {}
    return { ...base, handoff: { ...current, ...handoff } }
}

function estimateBase64Bytes(base64: string): number {
    const trimmed = base64.trim()
    const len = trimmed.length
    if (len === 0) return 0
    const padding = trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0
    return Math.floor((len * 3) / 4) - padding
}

function parseDataUrl(base64OrDataUrl: string): { mimeType: string | null; base64: string } {
    const match = base64OrDataUrl.match(/^data:([^;,]+);base64,(.+)$/s)
    if (!match) {
        return {
            mimeType: null,
            base64: base64OrDataUrl.trim()
        }
    }
    return {
        mimeType: match[1]?.trim() || null,
        base64: match[2]?.trim() || ''
    }
}

function sanitizeFileName(raw: string): string {
    const base = basename(raw).replace(/[\\/]+/g, '-').trim()
    const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, '_')
    return cleaned.length > 0 ? cleaned.slice(0, 120) : 'asset.bin'
}

function inferMimeType(fileName: string): string {
    const ext = extname(fileName).toLowerCase()
    switch (ext) {
        case '.png': return 'image/png'
        case '.jpg':
        case '.jpeg': return 'image/jpeg'
        case '.webp': return 'image/webp'
        case '.gif': return 'image/gif'
        case '.svg': return 'image/svg+xml'
        case '.txt': return 'text/plain'
        case '.md': return 'text/markdown'
        case '.pdf': return 'application/pdf'
        default: return 'application/octet-stream'
    }
}

function toAbsoluteUrl(requestUrl: string, path: string, publicBaseUrl?: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const candidate = (publicBaseUrl ?? '').trim().replace(/\/+$/, '')
    if (candidate.length > 0) {
        return `${candidate}${normalizedPath}`
    }
    const base = new URL(requestUrl)
    return `${base.origin}${normalizedPath}`
}

function isShareActive(share: StoredReportShare): boolean {
    if (share.revokedAt !== null) {
        return false
    }
    if (share.expiresAt !== null && Date.now() > share.expiresAt) {
        return false
    }
    return true
}

function reportStorageDir(root: string, reportId: string): string {
    return join(root, reportId)
}

function reportAssetPath(root: string, reportId: string, storageKey: string): string {
    return join(reportStorageDir(root, reportId), storageKey)
}

function toContentDisposition(fileName: string, mode: 'inline' | 'attachment'): string {
    const safeFileName = fileName.replace(/"/g, '')
    return `${mode}; filename="${safeFileName}"`
}

function toApiAsset(
    report: StoredReport,
    asset: StoredReportAsset,
    requestUrl: string,
    publicBaseUrl?: string
) {
    const assetPath = `/api/reports/${encodeURIComponent(report.id)}/assets/${encodeURIComponent(asset.id)}`
    return {
        ...asset,
        assetUrl: toAbsoluteUrl(requestUrl, assetPath, publicBaseUrl),
        markdownRef: `asset://${asset.id}`
    }
}

function toApiShare(share: StoredReportShare, requestUrl: string, publicBaseUrl?: string) {
    const sharePath = `/share/r/${encodeURIComponent(share.token)}`
    return {
        ...share,
        active: isShareActive(share),
        shareUrl: toAbsoluteUrl(requestUrl, sharePath, publicBaseUrl)
    }
}

function toApiReport(
    report: StoredReport,
    assets: StoredReportAsset[],
    shares: StoredReportShare[],
    requestUrl: string,
    publicBaseUrl?: string,
    hasPage?: boolean
) {
    const mappedShares = shares.map((share) => toApiShare(share, requestUrl, publicBaseUrl))
    const activeShare = mappedShares.find((share) => share.active)

    return {
        ...report,
        hasPage: hasPage ?? false,
        reportUrl: toAbsoluteUrl(requestUrl, `/api/reports/${encodeURIComponent(report.id)}`, publicBaseUrl),
        publicShareUrl: activeShare?.shareUrl ?? null,
        assets: assets.map((asset) => toApiAsset(report, asset, requestUrl, publicBaseUrl)),
        shares: mappedShares
    }
}

function parseShareExpiration(hours?: number): number | null {
    if (!hours || !Number.isFinite(hours)) {
        return null
    }
    return Date.now() + Math.floor(hours * 60 * 60 * 1000)
}

async function resolveAssetInput(payload: z.infer<typeof createAssetSchema>): Promise<{
    fileName: string
    mimeType: string
    bytes: Buffer
}> {
    if (payload.sourcePath) {
        const bytes = await readFile(payload.sourcePath)
        const fileName = sanitizeFileName(payload.filename ?? basename(payload.sourcePath))
        const mimeType = payload.mimeType ?? inferMimeType(fileName)
        return { fileName, mimeType, bytes }
    }

    if (!payload.content) {
        throw new Error('content is required')
    }

    const parsed = parseDataUrl(payload.content)
    const estimatedBytes = estimateBase64Bytes(parsed.base64)
    if (estimatedBytes > MAX_ASSET_BYTES) {
        throw new Error(`Asset too large (max ${MAX_ASSET_BYTES / 1024 / 1024}MB)`)
    }

    const bytes = Buffer.from(parsed.base64, 'base64')
    const fileName = sanitizeFileName(payload.filename ?? `asset-${Date.now()}.bin`)
    const mimeType = payload.mimeType ?? parsed.mimeType ?? inferMimeType(fileName)

    return {
        fileName,
        mimeType,
        bytes
    }
}

export function createReportsRoutes(options: {
    store: Store
    reportsStorageDir: string
    getReportPublicBaseUrl: () => ReportPublicBaseUrlSettings
    setReportPublicBaseUrl: (settings: ReportPublicBaseUrlSettings) => void
    dataDir: string
    fallbackPublicUrl: string
    getHandoffService?: () => HandoffService | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    const resolvePublicBaseUrl = (): string => options.getReportPublicBaseUrl().value

    app.get('/reports/domain', (c) => {
        return c.json({
            settings: options.getReportPublicBaseUrl()
        })
    })

    app.patch('/reports/domain', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = updateReportDomainSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const current = options.getReportPublicBaseUrl()
        if (current.envOverride) {
            return c.json({
                error: 'Report public domain is controlled by environment variable HAPI_REPORT_PUBLIC_BASE_URL'
            }, 409)
        }

        try {
            const next = await saveReportPublicBaseUrlSetting({
                dataDir: options.dataDir,
                domain: parsed.data.domain,
                fallbackPublicUrl: options.fallbackPublicUrl
            })
            options.setReportPublicBaseUrl(next)
            return c.json({ settings: next })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update report domain'
            return c.json({ error: message }, 400)
        }
    })

    app.get('/handoff/folders', async (c) => {
        const service = options.getHandoffService?.()
        if (!service) return c.json({ enabled: false, candidates: [] })
        const sessionId = c.req.query('sessionId')?.trim() || null
        return c.json(await service.candidates(c.get('namespace'), sessionId))
    })

    app.post('/handoff/:reportId/export', async (c) => {
        const service = options.getHandoffService?.()
        if (!service) return c.json({ error: 'Handoff export is not available' }, 503)
        const report = options.store.reports.getReportByNamespace(c.req.param('reportId'), c.get('namespace'))
        if (!report) return c.json({ error: 'Report not found' }, 404)
        await service.process(report.id, Date.now(), { force: true })
        return c.json({ handoff: await service.check(report), export: options.store.handoffs.get(report.id) })
    })

    app.get('/reports', (c) => {
        const namespace = c.get('namespace')
        const parsed = listReportsQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const reports = options.store.reports.listReportsByNamespace(namespace, {
            limit: parsed.data.limit,
            sessionId: parsed.data.sessionId
        })

        const payload = reports.map((report) => {
            const assets = options.store.reports.listAssetsByNamespace(report.id, namespace)
            const shares = options.store.reports.listSharesByNamespace(report.id, namespace)
            return toApiReport(report, assets, shares, c.req.url, resolvePublicBaseUrl(), options.store.reports.hasPage(report.id))
        })

        return c.json({ reports: payload })
    })

    app.post('/reports', async (c) => {
        const namespace = c.get('namespace')
        const body = await c.req.json().catch(() => null)
        const parsed = createReportSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const sessionId = parsed.data.sessionId ?? null
        if (sessionId) {
            const session = options.store.sessions.getSessionByNamespace(sessionId, namespace)
            if (!session) {
                return c.json({ error: 'Session not found in namespace' }, 404)
            }
        }

        const report = options.store.reports.createReport({
            namespace,
            sessionId,
            taskId: parsed.data.taskId ?? null,
            title: parsed.data.title ?? null,
            status: parsed.data.status ?? null,
            markdown: parsed.data.markdown ?? '',
            metadata: withHandoff(parsed.data.metadata, parsed.data.handoff)
        })
        if (parsed.data.html) options.store.reports.setPage(report.id, namespace, parsed.data.html)

        if (parsed.data.createShare) {
            options.store.reports.createShare({
                reportId: report.id,
                namespace,
                expiresAt: parseShareExpiration(parsed.data.shareExpiresInHours),
                createdBy: `user:${c.get('userId')}`
            })
        }

        const assets = options.store.reports.listAssetsByNamespace(report.id, namespace)
        const shares = options.store.reports.listSharesByNamespace(report.id, namespace, { includeRevoked: true })
        const handoff = await options.getHandoffService?.()?.check(report) ?? null
        return c.json({ report: toApiReport(report, assets, shares, c.req.url, resolvePublicBaseUrl(), options.store.reports.hasPage(report.id)), handoff }, 201)
    })

    app.get('/reports/:id', (c) => {
        const namespace = c.get('namespace')
        const reportId = c.req.param('id')

        const report = options.store.reports.getReportByNamespace(reportId, namespace)
        if (!report) {
            return c.json({ error: 'Report not found' }, 404)
        }

        const assets = options.store.reports.listAssetsByNamespace(report.id, namespace)
        const shares = options.store.reports.listSharesByNamespace(report.id, namespace, { includeRevoked: true })
        return c.json({ report: toApiReport(report, assets, shares, c.req.url, resolvePublicBaseUrl(), options.store.reports.hasPage(report.id)) })
    })

    app.patch('/reports/:id', async (c) => {
        const namespace = c.get('namespace')
        const reportId = c.req.param('id')

        const body = await c.req.json().catch(() => null)
        const parsed = updateReportSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const existing = parsed.data.handoff ? options.store.reports.getReportByNamespace(reportId, namespace) : null
        const report = options.store.reports.updateReport({
            id: reportId,
            namespace,
            taskId: parsed.data.taskId,
            title: parsed.data.title,
            status: parsed.data.status,
            markdown: parsed.data.markdown,
            metadata: parsed.data.handoff
                ? withHandoff(parsed.data.metadata !== undefined ? parsed.data.metadata : existing?.metadata, parsed.data.handoff)
                : parsed.data.metadata
        })

        if (!report) {
            return c.json({ error: 'Report not found' }, 404)
        }

        if (parsed.data.html !== undefined) options.store.reports.setPage(report.id, namespace, parsed.data.html || null)

        const assets = options.store.reports.listAssetsByNamespace(report.id, namespace)
        const shares = options.store.reports.listSharesByNamespace(report.id, namespace, { includeRevoked: true })
        const handoff = await options.getHandoffService?.()?.check(report) ?? null
        return c.json({ report: toApiReport(report, assets, shares, c.req.url, resolvePublicBaseUrl(), options.store.reports.hasPage(report.id)), handoff })
    })

    app.post('/reports/:id/assets', async (c) => {
        const namespace = c.get('namespace')
        const reportId = c.req.param('id')

        const report = options.store.reports.getReportByNamespace(reportId, namespace)
        if (!report) {
            return c.json({ error: 'Report not found' }, 404)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createAssetSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        let resolved
        try {
            resolved = await resolveAssetInput(parsed.data)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Invalid asset payload'
            return c.json({ error: message }, 400)
        }

        if (resolved.bytes.length > MAX_ASSET_BYTES) {
            return c.json({ error: `Asset too large (max ${MAX_ASSET_BYTES / 1024 / 1024}MB)` }, 413)
        }

        await mkdir(reportStorageDir(options.reportsStorageDir, report.id), { recursive: true })

        const storageKey = `${Date.now()}-${randomUUID().slice(0, 8)}-${sanitizeFileName(resolved.fileName)}`
        const filePath = reportAssetPath(options.reportsStorageDir, report.id, storageKey)

        try {
            await Bun.write(filePath, resolved.bytes)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to save report asset'
            return c.json({ error: message }, 500)
        }

        try {
            const asset = options.store.reports.createAsset({
                reportId: report.id,
                namespace,
                fileName: resolved.fileName,
                storageKey,
                mimeType: resolved.mimeType,
                size: resolved.bytes.length,
                caption: parsed.data.caption ?? null
            })

            return c.json({
                asset: toApiAsset(report, asset, c.req.url, resolvePublicBaseUrl())
            }, 201)
        } catch (error) {
            await unlink(filePath).catch(() => undefined)
            const message = error instanceof Error ? error.message : 'Failed to save report asset metadata'
            return c.json({ error: message }, 500)
        }
    })

    app.get('/reports/:id/assets/:assetId', (c) => {
        const namespace = c.get('namespace')
        const reportId = c.req.param('id')
        const assetId = c.req.param('assetId')
        const download = c.req.query('download') === '1'

        const report = options.store.reports.getReportByNamespace(reportId, namespace)
        if (!report) {
            return c.json({ error: 'Report not found' }, 404)
        }

        const asset = options.store.reports.getAssetByNamespace(reportId, assetId, namespace)
        if (!asset) {
            return c.json({ error: 'Asset not found' }, 404)
        }

        const filePath = reportAssetPath(options.reportsStorageDir, reportId, asset.storageKey)
        return new Response(Bun.file(filePath), {
            headers: {
                'Content-Type': asset.mimeType,
                'Cache-Control': 'private, max-age=3600',
                'X-Content-Type-Options': 'nosniff',
                'Content-Disposition': toContentDisposition(asset.fileName, download ? 'attachment' : 'inline')
            }
        })
    })

    app.get('/reports/:id/shares', (c) => {
        const namespace = c.get('namespace')
        const reportId = c.req.param('id')

        const report = options.store.reports.getReportByNamespace(reportId, namespace)
        if (!report) {
            return c.json({ error: 'Report not found' }, 404)
        }

        const shares = options.store.reports
            .listSharesByNamespace(report.id, namespace, { includeRevoked: true })
            .map((share) => toApiShare(share, c.req.url, resolvePublicBaseUrl()))

        return c.json({ shares })
    })

    app.post('/reports/:id/shares', async (c) => {
        const namespace = c.get('namespace')
        const reportId = c.req.param('id')

        const report = options.store.reports.getReportByNamespace(reportId, namespace)
        if (!report) {
            return c.json({ error: 'Report not found' }, 404)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createShareSchema.safeParse(body ?? {})
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const share = options.store.reports.createShare({
            reportId: report.id,
            namespace,
            expiresAt: parseShareExpiration(parsed.data.expiresInHours),
            createdBy: parsed.data.createdBy ?? `user:${c.get('userId')}`
        })

        return c.json({ share: toApiShare(share, c.req.url, resolvePublicBaseUrl()) }, 201)
    })

    app.delete('/reports/:id/shares/:shareId', (c) => {
        const namespace = c.get('namespace')
        const reportId = c.req.param('id')
        const shareId = c.req.param('shareId')

        const report = options.store.reports.getReportByNamespace(reportId, namespace)
        if (!report) {
            return c.json({ error: 'Report not found' }, 404)
        }

        const share = options.store.reports.revokeShareByNamespace(report.id, shareId, namespace)
        if (!share) {
            return c.json({ error: 'Share not found' }, 404)
        }

        return c.json({ share: toApiShare(share, c.req.url, resolvePublicBaseUrl()) })
    })

    return app
}
