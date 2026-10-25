import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { ScheduledRunDoneSchema, ScheduledTaskInputSchema, ScheduledTaskPatchSchema } from '@hapi/protocol/schedules'

import { ScheduleError, type ScheduleService } from '../../schedules/scheduleService'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

/** A session can create a task for itself: machine, folder, agent and model default to the session's own. */
const fromSessionSchema = z.object({ fromSessionId: z.string().min(1).optional() }).passthrough()

async function run(c: Context<WebAppEnv>, work: () => unknown | Promise<unknown>): Promise<Response> {
    try {
        return c.json(await work() as object)
    } catch (error) {
        if (error instanceof ScheduleError) return c.json({ error: error.message }, error.status)
        throw error
    }
}

function firstIssue(error: z.ZodError): string {
    const issue = error.issues[0]
    return issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid body'
}

export function createScheduleRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    const withSchedules = (c: Context<WebAppEnv>): { engine: SyncEngine; schedules: ScheduleService } | Response => {
        const engine = requireSyncEngine(c, getSyncEngine)
        return engine instanceof Response ? engine : { engine, schedules: engine.getScheduleService() }
    }

    app.get('/schedules', (c) => {
        const ctx = withSchedules(c)
        if (ctx instanceof Response) return ctx
        return c.json({ schedules: ctx.schedules.list(c.get('namespace')) })
    })

    app.post('/schedules', async (c) => {
        const ctx = withSchedules(c)
        if (ctx instanceof Response) return ctx
        const raw = fromSessionSchema.safeParse(await c.req.json().catch(() => null))
        if (!raw.success) return c.json({ error: 'Invalid body' }, 400)
        const { fromSessionId, ...body } = raw.data
        const namespace = c.get('namespace')
        let defaults: Record<string, unknown> = {}
        if (fromSessionId) {
            const session = ctx.engine.getSessionByNamespace(fromSessionId, namespace)
            if (!session) return c.json({ error: 'Session not found' }, 404)
            const metadata = session.metadata
            defaults = {
                machineId: metadata?.machineId,
                directory: metadata?.worktree?.basePath ?? metadata?.path,
                agent: metadata?.flavor ?? 'claude',
                ...(metadata?.model ? { model: metadata.model } : {})
            }
        }
        const parsed = ScheduledTaskInputSchema.safeParse({ ...defaults, ...body })
        if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400)
        return run(c, () => ({ schedule: ctx.schedules.create(namespace, parsed.data) }))
    })

    /** Called by a scheduled run's session, through the scheduled_run_done tool. */
    app.post('/schedules/runs/done', async (c) => {
        const ctx = withSchedules(c)
        if (ctx instanceof Response) return ctx
        const parsed = ScheduledRunDoneSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400)
        return run(c, () => ({ run: ctx.schedules.reportDone(c.get('namespace'), parsed.data) }))
    })

    app.get('/schedules/:id', (c) => {
        const ctx = withSchedules(c)
        if (ctx instanceof Response) return ctx
        return run(c, () => ctx.schedules.get(c.get('namespace'), c.req.param('id')))
    })

    app.patch('/schedules/:id', async (c) => {
        const ctx = withSchedules(c)
        if (ctx instanceof Response) return ctx
        const parsed = ScheduledTaskPatchSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400)
        return run(c, () => ({ schedule: ctx.schedules.update(c.get('namespace'), c.req.param('id'), parsed.data) }))
    })

    app.delete('/schedules/:id', (c) => {
        const ctx = withSchedules(c)
        if (ctx instanceof Response) return ctx
        return run(c, () => {
            ctx.schedules.delete(c.get('namespace'), c.req.param('id'))
            return { ok: true }
        })
    })

    app.post('/schedules/:id/run', (c) => {
        const ctx = withSchedules(c)
        if (ctx instanceof Response) return ctx
        return run(c, async () => ({ run: await ctx.schedules.runNow(c.get('namespace'), c.req.param('id')) }))
    })

    return app
}
