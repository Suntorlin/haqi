import { Hono } from 'hono'
import { z } from 'zod'

import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'

// Same rules as session tags: a task belongs to one tag.
const tagSchema = z.string().trim().toLowerCase().min(1).max(40)
const titleSchema = z.string().trim().min(1).max(200)

const createTaskSchema = z.object({
    tag: tagSchema,
    title: titleSchema
})

const updateTaskSchema = z.object({
    title: titleSchema.optional(),
    status: z.enum(['open', 'done']).optional()
}).refine((value) => value.title !== undefined || value.status !== undefined, {
    message: 'title or status is required'
})

export function createSessionTaskRoutes(store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/session-tasks', (c) => {
        return c.json({ tasks: store.sessionTasks.list(c.get('namespace')) })
    })

    app.post('/session-tasks', async (c) => {
        const parsed = createTaskSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: tag and title are required' }, 400)
        }
        return c.json({ task: store.sessionTasks.create(c.get('namespace'), parsed.data) })
    })

    app.patch('/session-tasks/:id', async (c) => {
        const parsed = updateTaskSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: title or status is required' }, 400)
        }
        const task = store.sessionTasks.update(c.get('namespace'), c.req.param('id'), parsed.data)
        if (!task) {
            return c.json({ error: 'Task not found' }, 404)
        }
        return c.json({ task })
    })

    app.delete('/session-tasks/:id', (c) => {
        if (!store.sessionTasks.delete(c.get('namespace'), c.req.param('id'))) {
            return c.json({ error: 'Task not found' }, 404)
        }
        return c.json({ ok: true })
    })

    return app
}
