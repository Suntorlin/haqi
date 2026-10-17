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
