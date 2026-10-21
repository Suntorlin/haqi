import { Hono } from 'hono'
import { z } from 'zod'
import { projectNameFor } from '../../memory/harvest'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const LevelSchema = z.enum(['fact', 'experience', 'principle'])

const proposeSchema = z.object({
    text: z.string().trim().min(1).max(2000),
    said: z.boolean().optional(),
    sessionId: z.string().trim().min(1).max(255).optional(),
    project: z.string().trim().min(1).max(255).optional()
})

const editSchema = z.object({
    text: z.string().trim().min(1).max(2000).optional(),
    level: LevelSchema.optional(),
    scope: z.string().trim().max(255).optional()
}).refine((value) => value.text !== undefined || value.level !== undefined || value.scope !== undefined, 'Nothing to change')

const csv = <T extends string>(values: readonly [T, ...T[]]) => z.string().optional()
    .transform((raw) => raw ? raw.split(',').map((part) => part.trim()).filter(Boolean) : undefined)
    .pipe(z.array(z.enum(values)).optional())

const searchSchema = z.object({
    q: z.string().trim().min(1).max(500),
    limit: z.coerce.number().int().min(1).max(30).optional(),
    level: csv(['fact', 'experience', 'principle'] as const),
    status: csv(['active', 'pending', 'candidate', 'archived'] as const),
    project: z.string().trim().min(1).max(200).optional(),
    tag: z.string().trim().toLowerCase().min(1).max(40).optional()
})

const idsSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(1).max(50) })
const mergeSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).min(2).max(20), text: z.string().max(2000).optional() })

const confirmAllSchema = z.object({ ids: z.array(z.string().trim().min(1).max(64)).max(500).optional() })

const settingsSchema = z.object({
    mode: z.enum(['off', 'record']).optional(),
    projects: z.array(z.string().trim().min(1).max(255)).max(50).optional()
})

/** Memories captured from sessions, judged by Jev; the web page and the agents' memory_propose tool use these. */
export function createMemoriesRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/memories', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json(await engine.getMemoryService().snapshot(c.get('namespace')))
    })

    app.post('/memories/propose', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = proposeSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const namespace = c.get('namespace')
        let project = parsed.data.project ?? null
        let sessionLabel: string | null = null
        if (parsed.data.sessionId) {
            const session = engine.getSessionByNamespace(parsed.data.sessionId, namespace)
            const metadata = (session?.metadata ?? null) as { path?: unknown; name?: unknown; summary?: { text?: unknown } } | null
            if (!project && typeof metadata?.path === 'string') project = projectNameFor(metadata.path)
            const title = typeof metadata?.name === 'string' && metadata.name.trim()
                ? metadata.name.trim()
                : typeof metadata?.summary?.text === 'string' ? metadata.summary.text.trim() : ''
            sessionLabel = title ? `会话 · ${title}` : '会话'
        }
        const result = await engine.getMemoryService().propose({
            namespace,
            text: parsed.data.text,
            said: parsed.data.said ?? false,
            source: 'propose',
            sourceLabel: sessionLabel,
            sessionId: parsed.data.sessionId ?? null,
            project
        })
        return c.json({ result })
    })

    app.patch('/memories/settings', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = settingsSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        return c.json({ settings: await engine.getMemoryService().updateSettings(parsed.data) })
    })

    app.post('/memories/import', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json(await engine.getMemoryService().importMemoryMd(c.get('namespace')))
    })

    app.post('/memories/harvest', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json(await engine.getMemoryService().harvestClaude(c.get('namespace')))
    })

    app.post('/memories/read-messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json(await engine.getMemoryService().readUserMessages(c.get('namespace')))
    })

    app.post('/memories/confirm-all', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = confirmAllSchema.safeParse(await c.req.json().catch(() => ({})))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const namespace = c.get('namespace')
        const confirmed = engine.getMemoryService().confirmAll(namespace, parsed.data.ids)
        return c.json({ confirmed })
    })

    app.get('/memories/search', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = searchSchema.safeParse({
            q: c.req.query('q'),
            limit: c.req.query('limit'),
            level: c.req.query('level'),
            status: c.req.query('status'),
            project: c.req.query('project'),
            tag: c.req.query('tag')
        })
        if (!parsed.success) return c.json({ error: 'Invalid query' }, 400)
        const { q, limit, level, status, project, tag } = parsed.data
        const hits = await engine.getMemoryService().search(c.get('namespace'), q, limit, { levels: level, statuses: status, project, tag })
        return c.json({ hits: hits.map((hit) => ({ ...hit.memory, score: hit.score })) })
    })

    app.post('/memories/maintain', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json(await engine.getMemoryService().maintain(c.get('namespace')))
    })

    app.get('/memories/:id/related', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const hits = await engine.getMemoryService().related(c.get('namespace'), c.req.param('id'))
        return c.json({ hits: hits.map((hit) => ({ ...hit.memory, score: hit.score, same: hit.same })) })
    })

    app.post('/memories/merge/preview', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = mergeSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const preview = await engine.getMemoryService().previewMerge(c.get('namespace'), parsed.data.ids)
        return preview ? c.json(preview) : c.json({ error: 'Need two memories that are not archived' }, 404)
    })

    app.post('/memories/merge', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = mergeSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const merged = await engine.getMemoryService().mergeMany(c.get('namespace'), parsed.data.ids, parsed.data.text)
        return merged ? c.json(merged) : c.json({ error: 'Need two memories that are not archived' }, 404)
    })

    app.post('/memories/merge/:eventId/undo', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const memory = engine.getMemoryService().undoMerge(c.get('namespace'), c.req.param('eventId'))
        return memory ? c.json({ memory }) : c.json({ error: 'Merge not found' }, 404)
    })

    app.post('/memories/archive', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = idsSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        return c.json({ archived: engine.getMemoryService().archiveMany(c.get('namespace'), parsed.data.ids) })
    })

    app.patch('/memories/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = editSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        const memory = engine.getMemoryService().edit(c.get('namespace'), c.req.param('id'), parsed.data)
        return memory ? c.json({ memory }) : c.json({ error: 'Memory not found' }, 404)
    })

    app.post('/memories/:id/confirm', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const memory = engine.getMemoryService().confirm(c.get('namespace'), c.req.param('id'))
        return memory ? c.json({ memory }) : c.json({ error: 'Memory not found' }, 404)
    })

    app.post('/memories/:id/dismiss', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return engine.getMemoryService().dismiss(c.get('namespace'), c.req.param('id'))
            ? c.json({ ok: true })
            : c.json({ error: 'Memory not found' }, 404)
    })

    app.delete('/memories/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return engine.getMemoryService().remove(c.get('namespace'), c.req.param('id'))
            ? c.json({ ok: true })
            : c.json({ error: 'Memory not found' }, 404)
    })

    return app
}
