import { Hono } from 'hono'
import { z } from 'zod'

import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { omitInlineMedia } from '../inlineMedia'
import { requireSessionFromParam, requireSyncEngine } from './guards'

const turnsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeTurnIndex: z.coerce.number().int().min(1).optional()
})

const turnMessagesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional()
})

export function createTurnsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions/:id/turns', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const parsed = turnsQuerySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 50) : 50
        const beforeTurnIndex = parsed.success ? (parsed.data.beforeTurnIndex ?? null) : null

        return c.json(engine.getConversationTurnsPage(sessionId, { limit, beforeTurnIndex }))
    })

    app.get('/sessions/:id/turns/:turnId/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId
        const turnId = c.req.param('turnId')

        const parsed = turnMessagesQuerySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 100) : 100
        const beforeSeq = parsed.success ? (parsed.data.beforeSeq ?? null) : null

        const result = engine.getConversationTurnMessagesPage(sessionId, turnId, { limit, beforeSeq })
        if (!result) {
            return c.json({ error: 'Turn not found' }, 404)
        }

        return c.json(omitInlineMedia(result))
    })

    return app
}
