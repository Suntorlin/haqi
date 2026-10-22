import { Hono, type Context } from 'hono'
import { z } from 'zod'

import type { SyncEngine } from '../../sync/syncEngine'
import { TaskTransitionError } from '../../tasks/kernel/stateMachine'
import { TASK_FILE_LIMITS } from '../../tasks/taskFiles'
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
    fromSessionId: z.string().min(1).optional(),
    /** Reference files and images, in base64; every session the task starts gets a copy. */
    files: z.array(z.object({
        filename: z.string().trim().min(1).max(255),
        mimeType: z.string().max(255),
        content: z.string().min(1)
    })).max(TASK_FILE_LIMITS.count).optional()
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

const answerSchema = z.object({ label: z.string().trim().min(1).max(80) })
const askBackSchema = z.object({ text: z.string().trim().min(1).max(1000) })

const verdictSchema = z.object({ approved: z.boolean(), text: z.string().trim().max(2000).optional() })

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
        const sizes = (parsed.data.files ?? []).map((file) => Buffer.byteLength(file.content, 'base64'))
        if (sizes.some((size) => size > TASK_FILE_LIMITS.bytes) || sizes.reduce((sum, size) => sum + size, 0) > TASK_FILE_LIMITS.totalBytes) {
            return c.json({ error: 'Files too large: at most 10 MB each and 20 MB in total' }, 413)
        }
        return run(c, async () => ({ task: await tasks.create(c.get('namespace'), parsed.data) }))
    })

    app.get('/tasks/:id', (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const task = tasks.get(c.get('namespace'), c.req.param('id'))
        return task ? c.json({ task }) : c.json({ error: 'Task not found' }, 404)
    })

    app.get('/tasks/:id/files/:index', (c) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        const index = Number(c.req.param('index'))
        if (!Number.isInteger(index) || index < 0) return c.json({ error: 'File not found' }, 404)
        return run(c, () => ({ file: tasks.file(c.get('namespace'), c.req.param('id'), index) }))
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

    // ---- the run after the guide step: the lead, executors and the reviewer call these through MCP tools ----

    const withRuns = (c: Context<WebAppEnv>) => {
        const tasks = withTasks(c)
        if (tasks instanceof Response) return tasks
        return tasks.runs ?? c.json({ error: 'Task runs are not available' }, 503)
    }
    const runRoute = (path: string, call: (runs: NonNullable<TaskService['runs']>, namespace: string, id: string, body: unknown, c: Context<WebAppEnv>) => unknown) => {
        app.post(path, async (c) => {
            const runs = withRuns(c)
            if (runs instanceof Response) return runs
            const body = await c.req.json().catch(() => null)
            return run(c, () => call(runs, c.get('namespace'), c.req.param('id') ?? '', body, c))
        })
    }

    runRoute('/tasks/:id/plan', (runs, ns, id, body) => runs.submitPlan(ns, id, body))
    runRoute('/tasks/:id/subtasks/done', (runs, ns, id, body) => runs.subtaskDone(ns, id, body))
    runRoute('/tasks/:id/integrated', (runs, ns, id, body) => runs.integrated(ns, id, body))
    runRoute('/tasks/:id/review', (runs, ns, id, body) => runs.reviewSubmitted(ns, id, body))
    runRoute('/tasks/:id/decisions', (runs, ns, id, body) => runs.askDecision(ns, id, body))
    runRoute('/tasks/:id/decisions/:decisionId', async (runs, ns, id, body, c) => {
        const parsed = answerSchema.safeParse(body)
        if (!parsed.success) throw new TaskError('Invalid body: label is required')
        await runs.answerDecision(ns, id, c.req.param('decisionId') ?? '', parsed.data.label)
        return { task: getSyncEngine()!.getTaskService().get(ns, id) }
    })
    runRoute('/tasks/:id/decisions/:decisionId/ask', async (runs, ns, id, body, c) => {
        const parsed = askBackSchema.safeParse(body)
        if (!parsed.success) throw new TaskError('Invalid body: text is required')
        const result = await runs.askAboutDecision(ns, id, c.req.param('decisionId') ?? '', parsed.data.text)
        return { ...result, task: getSyncEngine()!.getTaskService().get(ns, id) }
    })
    runRoute('/tasks/:id/verdict', async (runs, ns, id, body) => {
        const parsed = verdictSchema.safeParse(body)
        if (!parsed.success) throw new TaskError('Invalid body: approved is required')
        await runs.verdict(ns, id, parsed.data)
        return { task: getSyncEngine()!.getTaskService().get(ns, id) }
    })
    runRoute('/tasks/:id/reopen', async (runs, ns, id) => {
        await runs.reopen(ns, id)
        return { task: getSyncEngine()!.getTaskService().get(ns, id) }
    })

    return app
}
