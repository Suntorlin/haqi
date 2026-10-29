import { Hono } from 'hono'

import { INBOUND_CHANNELS } from '../../inbound/channels'
import { EmployeeError } from '../../sync/employeeService'
import type { SyncEngine } from '../../sync/syncEngine'
import type { Store } from '../../store'

/**
 * The public inbound hook, outside the JWT wall (like /share/r/:token). The slug is the secret: a random
 * base64url token on employees.webhook_slug, minted and rotated through POST /api/employees/:id/webhook.
 * A wrong slug answers 404 without touching anything.
 */
export function createInboundRoutes(options: { store: Store; getSyncEngine: () => SyncEngine | null }): Hono {
    const app = new Hono()

    app.post('/hooks/inbound/:channel/:slug', async (c) => {
        const channel = INBOUND_CHANNELS[c.req.param('channel') ?? '']
        if (!channel) return c.json({ error: 'Unknown channel' }, 404)
        const slug = c.req.param('slug') ?? ''
        const employee = slug.length >= 16 ? options.store.employees.getBySlug(slug) : null
        if (!employee) return c.json({ error: 'Not found' }, 404)
        if (employee.status !== 'active') return c.json({ error: 'The employee is not active' }, 409)
        const engine = options.getSyncEngine()
        if (!engine) return c.json({ error: 'Hub is starting' }, 503)
        const message = channel.parse(await c.req.json().catch(() => null))
        if ('error' in message) return c.json({ error: message.error }, 400)
        try {
            const woken = await engine.getEmployeeService().inbound(employee, message)
            return c.json({ ok: true, sessionId: woken.sessionId, outcome: woken.outcome })
        } catch (error) {
            if (error instanceof EmployeeError) return c.json({ error: error.message }, error.status as 400)
            throw error
        }
    })

    return app
}
