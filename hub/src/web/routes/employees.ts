import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { EmployeeInputSchema, EmployeeLogKindSchema, EmployeePatchSchema } from '@hapi/protocol/schemas'

import { EmployeeError, type EmployeeService } from '../../sync/employeeService'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const wakeSchema = z.object({
    text: z.string().trim().max(20_000).optional(),
    source: z.string().trim().min(1).max(40).optional()
})

const logSchema = z.object({
    sessionId: z.string().min(1),
    kind: EmployeeLogKindSchema,
    text: z.string().trim().min(1).max(2000),
    ref: z.string().trim().min(1).max(500).optional()
})

async function run(c: Context<WebAppEnv>, work: () => unknown | Promise<unknown>): Promise<Response> {
    try {
        return c.json(await work() as object)
    } catch (error) {
        if (error instanceof EmployeeError) return c.json({ error: error.message }, error.status as 400)
        throw error
    }
}

function firstIssue(error: z.ZodError): string {
    const issue = error.issues[0]
    return issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid body'
}

export function createEmployeeRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    const withEmployees = (c: Context<WebAppEnv>): { engine: SyncEngine; employees: EmployeeService } | Response => {
        const engine = requireSyncEngine(c, getSyncEngine)
        return engine instanceof Response ? engine : { engine, employees: engine.getEmployeeService() }
    }

    app.get('/employees', (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        return c.json({ employees: ctx.employees.list(c.get('namespace')) })
    })

    app.post('/employees', async (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        const parsed = EmployeeInputSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400)
        return run(c, async () => ({ employee: await ctx.employees.create(c.get('namespace'), parsed.data) }))
    })

    /** The employee a session acts as, plus its state package; the employee_whoami tool. */
    app.get('/employees/whoami', (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        const sessionId = c.req.query('sessionId')
        if (!sessionId) return c.json({ error: 'sessionId is required' }, 400)
        const namespace = c.get('namespace')
        return run(c, async () => {
            const employee = ctx.employees.employeeForSession(namespace, sessionId)
            const statePackage = await ctx.employees.buildStatePackage(namespace, employee)
            const openIssues = ctx.employees.issues(namespace, employee.id, 'open')
            return { employee, openIssues, statePackage }
        })
    })

    /** One run-log line from an employee session; the employee_log tool. */
    app.post('/employees/log', async (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        const parsed = logSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400)
        const { sessionId, kind, text, ref } = parsed.data
        return run(c, () => ctx.employees.log(c.get('namespace'), sessionId, kind, text, ref))
    })

    app.get('/employees/:id', (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        const namespace = c.get('namespace')
        const id = c.req.param('id')
        return run(c, () => ({
            employee: ctx.employees.get(namespace, id),
            openIssues: ctx.employees.issues(namespace, id, 'open')
        }))
    })

    app.patch('/employees/:id', async (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        const parsed = EmployeePatchSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400)
        return run(c, () => ({ employee: ctx.employees.update(c.get('namespace'), c.req.param('id'), parsed.data) }))
    })

    app.delete('/employees/:id', (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        return run(c, () => {
            ctx.employees.delete(c.get('namespace'), c.req.param('id'))
            return { ok: true }
        })
    })

    app.post('/employees/:id/wake', async (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        const parsed = wakeSchema.safeParse(await c.req.json().catch(() => ({})))
        if (!parsed.success) return c.json({ error: firstIssue(parsed.error) }, 400)
        return run(c, async () => await ctx.employees.wake(c.get('namespace'), c.req.param('id'), {
            source: parsed.data.source ?? 'api',
            text: parsed.data.text
        }))
    })

    app.get('/employees/:id/issues', (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        const status = c.req.query('status')
        return run(c, () => ({
            issues: ctx.employees.issues(c.get('namespace'), c.req.param('id'), status === 'open' || status === 'closed' ? status : undefined)
        }))
    })

    /** Rebuild MEMORY.md from the database now (also saves the diff snapshot). */
    app.post('/employees/:id/memory/generate', (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        return run(c, async () => await ctx.employees.generateMemoryView(c.get('namespace'), c.req.param('id'), '手动生成'))
    })

    /** Read the user's MEMORY.md edits back into the database now (the 5-minute sweep, on demand). */
    app.post('/employees/:id/memory/sync', (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        return run(c, async () => await ctx.employees.syncMemoryFile(c.get('namespace'), c.req.param('id')))
    })

    /** The nightly consolidation, on demand: write back, housekeep, regenerate, record changes. */
    app.post('/employees/:id/maintain', (c) => {
        const ctx = withEmployees(c)
        if (ctx instanceof Response) return ctx
        return run(c, async () => await ctx.employees.consolidate(c.get('namespace'), c.req.param('id')))
    })

    return app
}
