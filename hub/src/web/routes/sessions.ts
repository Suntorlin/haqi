import { getPermissionModesForFlavor, isModelModeAllowedForFlavor, isPermissionModeAllowedForFlavor, toSessionSummary } from '@hapi/protocol'
import { ClaudeAccountSelectionSchema, ModelModeSchema, PermissionModeSchema } from '@hapi/protocol/schemas'
import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { SyncEngine, Session } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'
import { buildSessionUsageOverview } from '../../usage/sessionUsage'

const permissionModeSchema = z.object({
    mode: PermissionModeSchema
})

const modelUpdateSchema = z.object({
    model: z.string().min(1).max(255)
})

const thinkEffortUpdateSchema = z.object({
    thinkEffort: z.enum(['auto', 'low', 'medium', 'high', 'max', 'xhigh'])
})
const serviceTierUpdateSchema = z.object({
    serviceTier: z.enum(['auto', 'fast', 'flex'])
})

const collaborationModeUpdateSchema = z.object({
    mode: z.enum(['default', 'plan'])
})

const renameSessionSchema = z.object({
    name: z.string().min(1).max(255)
})

const sessionTagsSchema = z.object({
    tags: z.array(z.string().trim().min(1).max(40)).max(20)
}).strict()

function normalizeSessionTags(tags: string[]): string[] {
    return Array.from(new Set(tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean)))
}

const previewUrlSchema = z.object({
    url: z.string().max(2048).nullable()
})

const previewUrlHistoryQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional()
})

const switchClaudeAccountSchema = z.object({
    accountId: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    automatic: z.boolean().default(false)
}).strict()

const spawnFromExistingSessionSchema = z.object({
    inheritHistory: z.boolean()
})

const uploadSchema = z.object({
    filename: z.string().min(1).max(255),
    content: z.string().min(1),
    mimeType: z.string().min(1).max(255)
})

const uploadDeleteSchema = z.object({
    path: z.string().min(1)
})

const codexQueueRemoveSchema = z.object({
    id: z.string().min(1).max(255)
})

const codexQueueMoveSchema = z.object({
    id: z.string().min(1).max(255),
    toIndex: z.number().int().min(0)
})

const codexQueueEnqueueSchema = z.object({
    text: z.string(),
    meta: z.object({
        routeContext: z.object({
            groupId: z.string().min(1),
            taskId: z.string().min(1).optional(),
            traceId: z.string().min(1).optional(),
            source: z.string().min(1),
            targetSessionIds: z.array(z.string().min(1)).optional()
        }).optional()
    }).optional(),
    attachments: z.array(z.object({
        id: z.string().min(1),
        filename: z.string().min(1),
        mimeType: z.string().min(1),
        size: z.number().nonnegative(),
        path: z.string().min(1),
        previewUrl: z.string().optional()
    })).optional()
})

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024

function estimateBase64Bytes(base64: string): number {
    const len = base64.length
    if (len === 0) return 0
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    return Math.floor((len * 3) / 4) - padding
}

function normalizePreviewUrl(raw: string | null): { ok: true; value: string | null } | { ok: false; error: string } {
    if (raw === null) {
        return { ok: true, value: null }
    }

    const trimmed = raw.trim()
    if (!trimmed) {
        return { ok: true, value: null }
    }

    try {
        const url = new URL(trimmed)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return { ok: false, error: 'Preview URL must use http:// or https://' }
        }
        return { ok: true, value: url.toString() }
    } catch {
        return { ok: false, error: 'Invalid preview URL' }
    }
}

function collectAllSessionMessages(engine: SyncEngine, sessionId: string): ReturnType<SyncEngine['getMessagesAfter']> {
    const collected: ReturnType<SyncEngine['getMessagesAfter']> = []
    let beforeSeq: number | null = null
    const seenBeforeSeq = new Set<number | null>()

    while (true) {
        if (seenBeforeSeq.has(beforeSeq)) {
            break
        }
        seenBeforeSeq.add(beforeSeq)

        const page = engine.getMessagesPage(sessionId, {
            limit: 200,
            beforeSeq
        })

        if (page.messages.length === 0) {
            break
        }

        collected.unshift(...page.messages)
        if (!page.page.hasMore || page.page.nextBeforeSeq === null) {
            break
        }

        beforeSeq = page.page.nextBeforeSeq
    }

    return collected
}

export function createSessionsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    const requireQueueSession = (
        c: Context<WebAppEnv>,
        engine: SyncEngine
    ) => {
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'codex' && flavor !== 'claude' && flavor !== 'gemini') {
            return c.json({ success: false, error: 'Queue API is only supported for Codex, Claude, and Gemini sessions' })
        }

        return { ...sessionResult, flavor }
    }

    const requireActiveQueueSession = (
        c: Context<WebAppEnv>,
        engine: SyncEngine
    ) => {
        const sessionResult = requireQueueSession(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        if (!sessionResult.session.active) {
            return c.json({ success: false, error: 'Session is inactive' })
        }

        return sessionResult
    }

    const requireActiveCodexSession = (
        c: Context<WebAppEnv>,
        engine: SyncEngine
    ) => {
        const sessionResult = requireActiveQueueSession(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        if (sessionResult.flavor !== 'codex') {
            return c.json({ success: false, error: 'Codex API is only supported for Codex sessions' })
        }
        return sessionResult
    }

    app.get('/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        const sessions = engine.getSessionsByNamespace(namespace)
            .sort((a, b) => {
                // Keep the list stable while live session state changes. Activity,
                // queue depth and updatedAt are displayed as status, not ordering.
                if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
                return a.id.localeCompare(b.id)
            })
            .map(toSessionSummary)

        return c.json({ sessions })
    })

    app.get('/sessions/preview-url-history', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const parsed = previewUrlHistoryQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const namespace = c.get('namespace')
        const entries = engine.getPreviewUrlHistory(namespace, parsed.data.limit)
        return c.json({ urls: entries.map((entry) => entry.url), entries })
    })

    app.get('/sessions/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        return c.json({ session: sessionResult.session })
    })

    const handleQueueStatus = async (c: Context<WebAppEnv>) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireActiveQueueSession(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            const result = await engine.getCodexStatus(sessionResult.sessionId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get queue status'
            })
        }
    }

    const handleQueueState = async (c: Context<WebAppEnv>) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireActiveQueueSession(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            const result = sessionResult.flavor === 'claude'
                ? await engine.getClaudeQueue(sessionResult.sessionId)
                : await engine.getCodexQueue(sessionResult.sessionId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get queue'
            }, 500)
        }
    }

    const handleQueueEnqueue = async (c: Context<WebAppEnv>) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireQueueSession(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = codexQueueEnqueueSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ success: false, error: 'Invalid body' }, 400)
        }

        if (!parsed.data.text.trim() && (!parsed.data.attachments || parsed.data.attachments.length === 0)) {
            return c.json({ success: false, error: 'Message requires text or attachments' }, 400)
        }

        let targetSessionId = sessionResult.sessionId
        if (!sessionResult.session.active) {
            const namespace = c.get('namespace')
            const resumeResult = await engine.resumeSession(targetSessionId, namespace)
            if (resumeResult.type === 'error') {
                return c.json({
                    success: false,
                    error: resumeResult.message
                })
            }
            targetSessionId = resumeResult.sessionId
        }

        try {
            const result = sessionResult.flavor === 'claude'
                ? await engine.enqueueClaudeMessage(targetSessionId, {
                    text: parsed.data.text,
                    meta: parsed.data.meta,
                    attachments: parsed.data.attachments
                })
                : await engine.enqueueCodexMessage(targetSessionId, {
                    text: parsed.data.text,
                    meta: parsed.data.meta,
                    attachments: parsed.data.attachments
                })
            return c.json({
                ...result,
                sessionId: targetSessionId
            })
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to enqueue queue message'
            }, 500)
        }
    }

    const handleQueueRemove = async (c: Context<WebAppEnv>) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireActiveQueueSession(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = codexQueueRemoveSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ success: false, error: 'Invalid body' }, 400)
        }

        try {
            const result = sessionResult.flavor === 'claude'
                ? await engine.removeClaudeQueueItem(sessionResult.sessionId, parsed.data.id)
                : await engine.removeCodexQueueItem(sessionResult.sessionId, parsed.data.id)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to remove queue item'
            }, 500)
        }
    }

    const handleQueueMove = async (c: Context<WebAppEnv>) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireActiveQueueSession(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = codexQueueMoveSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ success: false, error: 'Invalid body' }, 400)
        }

        try {
            const result = sessionResult.flavor === 'claude'
                ? await engine.moveClaudeQueueItem(
                    sessionResult.sessionId,
                    parsed.data.id,
                    parsed.data.toIndex
                )
                : await engine.moveCodexQueueItem(
                    sessionResult.sessionId,
                    parsed.data.id,
                    parsed.data.toIndex
                )
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to move queue item'
            }, 500)
        }
    }

    const handleQueueClear = async (c: Context<WebAppEnv>) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireActiveQueueSession(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            const result = sessionResult.flavor === 'claude'
                ? await engine.clearClaudeQueue(sessionResult.sessionId)
                : await engine.clearCodexQueue(sessionResult.sessionId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to clear queue'
            }, 500)
        }
    }

    const handleCodexQueueStopAndPreserve = async (c: Context<WebAppEnv>) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireActiveCodexSession(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            const result = await engine.stopAndPreserveCodexQueue(sessionResult.sessionId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to stop Codex while preserving queue'
            }, 500)
        }
    }

    const queueStatusPaths = ['/sessions/:id/codex-status', '/sessions/:id/queue-status'] as const
    queueStatusPaths.forEach((path) => {
        app.get(path, handleQueueStatus)
    })

    const queuePaths = ['/sessions/:id/codex-queue', '/sessions/:id/queue'] as const
    queuePaths.forEach((path) => {
        app.get(path, handleQueueState)
    })

    const queueActionPaths = ['/sessions/:id/codex-queue', '/sessions/:id/queue'] as const
    queueActionPaths.forEach((path) => {
        app.post(`${path}/enqueue`, handleQueueEnqueue)
        app.post(`${path}/remove`, handleQueueRemove)
        app.post(`${path}/move`, handleQueueMove)
        app.post(`${path}/clear`, handleQueueClear)
    })

    app.post('/sessions/:id/codex-queue/stop-and-preserve', handleCodexQueueStopAndPreserve)

    app.get('/sessions/:id/usage', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            const messages = collectAllSessionMessages(engine, sessionResult.sessionId)
            const usage = buildSessionUsageOverview({
                sessionId: sessionResult.sessionId,
                flavor: sessionResult.session.metadata?.flavor ?? null,
                messages
            })
            return c.json({ success: true, usage })
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to compute session usage'
            }, 500)
        }
    })

    app.post('/sessions/:id/resume', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const namespace = c.get('namespace')
        const result = await engine.resumeSession(sessionResult.sessionId, namespace)
        if (result.type === 'error') {
            const status = result.code === 'no_machine_online' ? 503
                : result.code === 'access_denied' ? 403
                    : result.code === 'session_not_found' ? 404
                        : 500
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ type: 'success', sessionId: result.sessionId })
    })

    app.post('/sessions/:id/claude-account', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) return sessionResult
        const parsed = switchClaudeAccountSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: '账号选择无效' }, 400)
        const result = await engine.switchClaudeAccount(sessionResult.sessionId, c.get('namespace'), ClaudeAccountSelectionSchema.parse(parsed.data))
        if (result.type === 'error') return c.json({ error: result.message }, 409)
        return c.json(result)
    })

    app.post('/sessions/:id/spawn', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = spawnFromExistingSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const result = await engine.spawnSessionFromExisting(
            sessionResult.sessionId,
            namespace,
            { inheritHistory: parsed.data.inheritHistory }
        )

        if (result.type === 'error') {
            const status = result.code === 'no_machine_online' ? 503
                : result.code === 'access_denied' ? 403
                    : result.code === 'session_not_found' ? 404
                        : 500
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ type: 'success', sessionId: result.sessionId })
    })

    app.post('/sessions/:id/upload', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = uploadSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const estimatedBytes = estimateBase64Bytes(parsed.data.content)
        if (estimatedBytes > MAX_UPLOAD_BYTES) {
            return c.json({ success: false, error: 'File too large (max 50MB)' }, 413)
        }

        try {
            const result = await engine.uploadFile(
                sessionResult.sessionId,
                parsed.data.filename,
                parsed.data.content,
                parsed.data.mimeType
            )
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to upload file'
            }, 500)
        }
    })

    app.post('/sessions/:id/upload/delete', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = uploadDeleteSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const result = await engine.deleteUploadFile(sessionResult.sessionId, parsed.data.path)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete upload'
            }, 500)
        }
    })

    app.post('/sessions/:id/abort', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.abortSession(sessionResult.sessionId)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/archive', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.archiveSession(sessionResult.sessionId)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/switch', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.switchSession(sessionResult.sessionId, 'remote')
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/permission-mode', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = permissionModeSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        const mode = parsed.data.mode

        const allowedModes = getPermissionModesForFlavor(flavor)
        if (allowedModes.length === 0) {
            return c.json({ error: 'Permission mode not supported for session flavor' }, 400)
        }

        if (!isPermissionModeAllowedForFlavor(mode, flavor)) {
            return c.json({ error: 'Invalid permission mode for session flavor' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, { permissionMode: mode })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply permission mode'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/model', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = modelUpdateSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        const requestedModel = parsed.data.model.trim()
        if (!requestedModel) {
            return c.json({ error: 'Invalid model value' }, 400)
        }

        const parsedMode = ModelModeSchema.safeParse(requestedModel)
        const requestedMode = parsedMode.success ? parsedMode.data : undefined

        if (requestedMode && !isModelModeAllowedForFlavor(requestedMode, flavor)) {
            return c.json({ error: 'Model mode is only supported for Claude sessions' }, 400)
        }

        if (!requestedMode && flavor !== 'claude') {
            return c.json({ error: 'Custom model is only supported for Claude sessions' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, {
                modelMode: requestedMode,
                model: requestedModel
            })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply model mode'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/think-effort', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = thinkEffortUpdateSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'claude' && flavor !== 'codex') {
            return c.json({ error: 'Think level is only supported for Claude and Codex sessions' }, 400)
        }

        if (flavor === 'claude' && parsed.data.thinkEffort === 'xhigh') {
            return c.json({ error: 'Claude thinkEffort does not support xhigh (expected auto/low/medium/high)' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, {
                thinkEffort: parsed.data.thinkEffort
            })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply think level'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/service-tier', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = serviceTierUpdateSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'codex') {
            return c.json({ error: 'Service tier is only supported for Codex sessions' }, 400)
        }

        try {
            const serviceTier = parsed.data.serviceTier === 'auto'
                ? undefined
                : parsed.data.serviceTier
            await engine.applySessionConfig(sessionResult.sessionId, {
                serviceTier
            })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply service tier'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/collaboration-mode', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = collaborationModeUpdateSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        if (flavor !== 'codex') {
            return c.json({ error: 'Collaboration mode is only supported for Codex sessions' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, {
                collaborationMode: parsed.data.mode === 'plan' ? 'plan' : null
            })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply collaboration mode'
            return c.json({ error: message }, 409)
        }
    })

    app.patch('/sessions/:id/preview-url', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = previewUrlSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const previewUrl = normalizePreviewUrl(parsed.data.url)
        if (!previewUrl.ok) {
            return c.json({ error: previewUrl.error }, 400)
        }

        try {
            await engine.setSessionPreviewUrl(sessionResult.sessionId, previewUrl.value)
            return c.json({ ok: true, previewUrl: previewUrl.value })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update preview URL'
            return c.json({ error: message }, 500)
        }
    })

    app.patch('/sessions/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = renameSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: name is required' }, 400)
        }

        try {
            await engine.renameSession(sessionResult.sessionId, parsed.data.name)
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to rename session'
            // Map concurrency/version errors to 409 conflict
            if (message.includes('concurrently') || message.includes('version')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    app.patch('/sessions/:id/tags', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = sessionTagsSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: tags must contain at most 20 non-empty values' }, 400)
        }

        try {
            const tags = normalizeSessionTags(parsed.data.tags)
            await engine.setSessionTags(sessionResult.sessionId, tags)
            return c.json({ ok: true, tags })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update session tags'
            if (message.includes('concurrently') || message.includes('version')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    app.delete('/sessions/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        if (sessionResult.session.active) {
            return c.json({ error: 'Cannot delete active session. Archive it first.' }, 409)
        }

        try {
            await engine.deleteSession(sessionResult.sessionId)
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete session'
            // Map "active session" error to 409 conflict (race condition: session became active)
            if (message.includes('active')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    app.get('/sessions/:id/slash-commands', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        // Session must exist but doesn't need to be active
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        // Get agent type from session metadata, default to 'claude'
        const agent = sessionResult.session.metadata?.flavor ?? 'claude'

        try {
            const result = await engine.listSlashCommands(sessionResult.sessionId, agent)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list slash commands'
            })
        }
    })

    app.get('/sessions/:id/skills', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        // Session must exist but doesn't need to be active
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            const result = await engine.listSkills(sessionResult.sessionId)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list skills'
            })
        }
    })

    app.get('/sessions/:id/mcp', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        // Current session check requires an active CLI socket.
        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            const flavor = sessionResult.session.metadata?.flavor ?? undefined
            const result = await engine.listMcpServers(sessionResult.sessionId)
            return c.json({
                ...result,
                ...(flavor ? { flavor } : {})
            })
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to inspect MCP availability'
            })
        }
    })

    return app
}
