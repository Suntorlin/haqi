import { Hono } from 'hono'
import { z } from 'zod'

import { BACKFILL_DAYS } from '../../tasks/loadService'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const reportSchema = z.object({ days: z.coerce.number().int().min(1).max(90).optional() })

/** The cognitive-load baseline: why the user had to speak, per session, over the last days. */
export function createInsightsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/insights/load', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        const parsed = reportSchema.safeParse({ days: c.req.query('days') })
        if (!parsed.success) return c.json({ error: 'Invalid query' }, 400)
        return c.json(engine.getLoadService().report(c.get('namespace'), parsed.data.days ?? BACKFILL_DAYS))
    })

    /** Classifies the last BACKFILL_DAYS days in the background. Costs money: about $0.00006 per message. */
    app.post('/insights/load/backfill', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine
        return c.json(engine.getLoadService().startBackfill(c.get('namespace')))
    })

    return app
}
