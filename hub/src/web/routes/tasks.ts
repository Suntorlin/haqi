import { Hono, type Context } from 'hono'
import { z } from 'zod'

import type { SyncEngine } from '../../sync/syncEngine'
import { TaskTransitionError } from '../../tasks/kernel/stateMachine'
import { TaskError, type TaskService } from '../../tasks/taskService'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

// Same rules as session tags.
const tagSchema = z.string().trim().toLowerCase().min(1).max(40)

const createSchema = z.object({
    text: z.string().trim().min(1).max(4000),
    /** The planner picks a tag when none is given. */
    tag: tagSchema.optional(),
    /** false: start right away, without the guide step (a plain discussion). */
    draft: z.boolean().optional(),
    machineId: z.string().min(1).optional(),
    directory: z.string().min(1).optional(),
    fromSessionId: z.string().min(1).optional()
})

const retrySchema = z.object({
    machineId: z.string().min(1).optional(),
    directory: z.string().min(1).optional()
})

const reviseSchema = z.object({ text: z.string().trim().min(1).max(2000) })

const patchSchema = z.object({
    status: z.enum(['guiding', 'active', 'done', 'abandoned']).optional(),
    tag: tagSchema.optional(),
    name: z.string().trim().min(1).max(200).optional()
}).refine((value) => Object.values(value).some((v) => v !== undefined), { message: 'Nothing to change' })

const memberSchema = z.object({ sessionId: z.string().min(1) })

async function run(c: Context<WebAppEnv>, work: () => unknown | Promise<unknown>): Promise<Response> {
    try {
        return c.json(await work() as object)
    } catch (error) {
        if (error instanceof TaskError) return c.json({ error: error.message }, error.status)
        if (error instanceof TaskTransitionError) return c.json({ error: error.message }, 409)
        throw error
    }
}

export function createTaskRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    const withTasks = (c: Context<WebAppEnv>): TaskService | Response => {
        const engine = requireSyncEngine(c, getSyncEngine)
        return engine instanceof Response ? engine : engine.getTaskService()
    }

    app.get('/tasks', (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const tag = c.req.query('tag')?.trim().toLowerCase() || undefined
        return c.json({ tasks: tasks.list(c.get('namespace'), tag) })
    })

    app.post('/tasks', async (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const parsed = createSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body: text and tag are required' }, 400)
        return run(c, async () => ({ task: await tasks.create(c.get('namespace'), parsed.data) }))
    })

    app.get('/tasks/:id', (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const task = tasks.get(c.get('namespace'), c.req.param('id'))
        return task ? c.json({ task }) : c.json({ error: 'Task not found' }, 404)
    })

    app.patch('/tasks/:id', async (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const parsed = patchSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body: status, tag or name is required' }, 400)
        return run(c, () => ({ task: tasks.update(c.get('namespace'), c.req.param('id'), parsed.data) }))
    })

    app.delete('/tasks/:id', (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        return tasks.delete(c.get('namespace'), c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'Task not found' }, 404)
    })

    /** From the planner's task_draft_submit tool. */
    app.post('/tasks/:id/draft', async (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const body = await c.req.json().catch(() => null)
        return run(c, () => tasks.submitDraft(c.get('namespace'), c.req.param('id'), body))
    })

    app.post('/tasks/:id/revise', async (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const parsed = reviseSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body: text is required' }, 400)
        return run(c, async () => ({ task: await tasks.revise(c.get('namespace'), c.req.param('id'), parsed.data.text) }))
    })

    app.post('/tasks/:id/confirm', async (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const body = await c.req.json().catch(() => null)
        return run(c, async () => ({ task: await tasks.confirm(c.get('namespace'), c.req.param('id'), body) }))
    })

    app.post('/tasks/:id/retry', async (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const parsed = retrySchema.safeParse(await c.req.json().catch(() => ({})))
        if (!parsed.success) return c.json({ error: 'Invalid body' }, 400)
        return run(c, async () => ({ task: await tasks.retry(c.get('namespace'), c.req.param('id'), parsed.data) }))
    })

    app.post('/tasks/:id/members', async (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const parsed = memberSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: 'Invalid body: sessionId is required' }, 400)
        return run(c, () => ({ task: tasks.addMember(c.get('namespace'), c.req.param('id'), parsed.data.sessionId) }))
    })

    app.delete('/tasks/:id/members/:sessionId', (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        return run(c, () => ({ task: tasks.removeMember(c.get('namespace'), c.req.param('id'), c.req.param('sessionId')) }))
    })

    return app
}
