import { Hono, type Context } from 'hono'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSyncEngine } from './guards'

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional()
})

const turnsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeTurnIndex: z.coerce.number().int().min(1).optional()
})

const turnMessagesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional()
})

const createGroupSchema = z.object({
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(5000).optional(),
    noteSessionId: z.string().min(1).max(255).optional(),
    sessionMemberIds: z.array(z.string().min(1).max(255)).optional()
})

const updateGroupSchema = z.object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    noteSessionId: z.string().min(1).max(255).nullable().optional(),
    archived: z.boolean().optional()
})

const addGroupMemberSchema = z.object({
    sessionId: z.string().min(1).max(255)
})

const attachmentMetadataSchema = z.object({
    id: z.string().min(1),
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    size: z.number().nonnegative(),
    path: z.string().min(1),
    previewUrl: z.string().optional()
})

const postGroupMessageSchema = z.object({
    type: z.enum(['chat', 'command', 'task_state', 'note_state', 'system']),
    payload: z.unknown().optional(),
    text: z.string().optional(),
    attachments: z.array(attachmentMetadataSchema).optional(),
    traceId: z.string().optional(),
    taskId: z.string().optional(),
    source: z.string().min(1).max(255).optional(),
    actorSessionId: z.string().min(1).max(255).optional(),
    actorName: z.string().min(1).max(255).optional(),
    targetSessionIds: z.array(z.string().min(1).max(255)).optional(),
    quotedMessageId: z.string().min(1).max(255).optional()
})

const updateGroupNoteSchema = z.object({
    content: z.string(),
    updatedBy: z.string().max(255).optional()
})

const refreshGroupNoteSchema = z.object({
    source: z.string().min(1).max(255).optional(),
    command: z.string().min(1).max(2000).optional()
})

function toErrorResponse(c: Context<WebAppEnv>, error: unknown): Response {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (message.toLowerCase().includes('not found')) {
        return c.json({ error: message }, 404)
    }
    if (message.toLowerCase().includes('access denied')) {
        return c.json({ error: message }, 403)
    }
    if (message.toLowerCase().includes('inactive')) {
        return c.json({ error: message }, 409)
    }
    return c.json({ error: message }, 400)
}

export function createGroupsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/groups', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        const groups = engine.getGroupsByNamespace(namespace)
        return c.json({ groups })
    })

    app.post('/groups', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = createGroupSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        try {
            const group = engine.createGroup({
                namespace,
                name: parsed.data.name,
                description: parsed.data.description ?? null,
                noteSessionId: parsed.data.noteSessionId ?? null,
                sessionMemberIds: parsed.data.sessionMemberIds ?? []
            })
            return c.json({ group }, 201)
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.get('/groups/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        const groupId = c.req.param('id')
        const group = engine.getGroupByNamespace(groupId, namespace)
        if (!group) {
            return c.json({ error: 'Group not found' }, 404)
        }
        return c.json({ group })
    })

    app.patch('/groups/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = updateGroupSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        try {
            const group = engine.updateGroup({
                groupId: c.req.param('id'),
                namespace,
                name: parsed.data.name,
                description: parsed.data.description,
                noteSessionId: parsed.data.noteSessionId,
                archived: parsed.data.archived
            })
            return c.json({ group })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.delete('/groups/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        try {
            engine.deleteGroup(namespace, c.req.param('id'))
            return c.json({ success: true })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.post('/groups/:id/members', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = addGroupMemberSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        try {
            const group = engine.addGroupMember(c.req.param('id'), namespace, parsed.data.sessionId)
            return c.json({ group }, 201)
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.delete('/groups/:id/members/:sessionId', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const namespace = c.get('namespace')
        const groupId = c.req.param('id')
        const sessionId = c.req.param('sessionId')
        if (!sessionId) {
            return c.json({ error: 'sessionId is required' }, 400)
        }

        try {
            const group = engine.removeGroupMember(groupId, namespace, sessionId)
            return c.json({ group })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.get('/groups/:id/messages', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const parsed = querySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 50) : 50
        const beforeSeq = parsed.success ? (parsed.data.beforeSeq ?? null) : null

        try {
            const result = engine.getGroupMessagesPage(
                c.req.param('id'),
                c.get('namespace'),
                { limit, beforeSeq }
            )
            return c.json(result)
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.get('/groups/:id/turns', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const parsed = turnsQuerySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 50) : 50
        const beforeTurnIndex = parsed.success ? (parsed.data.beforeTurnIndex ?? null) : null

        try {
            const result = engine.getGroupConversationTurnsPage(
                c.req.param('id'),
                c.get('namespace'),
                { limit, beforeTurnIndex }
            )
            return c.json(result)
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.get('/groups/:id/turns/:turnId/messages', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const parsed = turnMessagesQuerySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 100) : 100
        const beforeSeq = parsed.success ? (parsed.data.beforeSeq ?? null) : null

        try {
            const result = engine.getGroupConversationTurnMessagesPage(
                c.req.param('id'),
                c.get('namespace'),
                c.req.param('turnId'),
                { limit, beforeSeq }
            )
            if (!result) {
                return c.json({ error: 'Turn not found' }, 404)
            }
            return c.json(result)
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.get('/groups/:id/tasks', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const parsed = querySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 100) : 100

        try {
            const tasks = engine.getGroupTasks(c.req.param('id'), c.get('namespace'), limit)
            return c.json({ tasks })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.post('/groups/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = postGroupMessageSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const fallbackPayload: Record<string, unknown> = {}
        if (parsed.data.text !== undefined) {
            fallbackPayload.text = parsed.data.text
        }
        if (parsed.data.attachments && parsed.data.attachments.length > 0) {
            fallbackPayload.attachments = parsed.data.attachments
        }

        const payload = parsed.data.payload !== undefined
            ? parsed.data.payload
            : fallbackPayload

        if (parsed.data.type === 'command') {
            const textFromPayload = (
                payload
                && typeof payload === 'object'
                && typeof (payload as { text?: unknown }).text === 'string'
            )
                ? ((payload as { text: string }).text ?? '').trim()
                : ''
            const commandText = (parsed.data.text ?? '').trim() || textFromPayload
            if (!commandText) {
                return c.json({ error: 'Command message requires text' }, 400)
            }
        }

        try {
            const result = await engine.addGroupMessage({
                groupId: c.req.param('id'),
                namespace: c.get('namespace'),
                type: parsed.data.type,
                payload,
                source: parsed.data.source,
                actorSessionId: parsed.data.actorSessionId ?? null,
                actorName: parsed.data.actorName ?? null,
                traceId: parsed.data.traceId ?? null,
                taskId: parsed.data.taskId ?? null,
                targetSessionIds: parsed.data.targetSessionIds ?? null,
                quotedMessageId: parsed.data.quotedMessageId ?? null
            })
            return c.json(result, 201)
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.get('/groups/:id/note', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        try {
            const note = engine.getGroupNote(c.req.param('id'), c.get('namespace'))
            return c.json({ note })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.patch('/groups/:id/note', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = updateGroupNoteSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const note = engine.updateGroupNote({
                groupId: c.req.param('id'),
                namespace: c.get('namespace'),
                content: parsed.data.content,
                updatedBy: parsed.data.updatedBy ?? 'user:web'
            })
            return c.json({ note })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.post('/groups/:id/note/refresh', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => ({}))
        const parsed = refreshGroupNoteSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const result = await engine.refreshGroupNote({
                groupId: c.req.param('id'),
                namespace: c.get('namespace'),
                source: parsed.data.source ?? 'user:web',
                command: parsed.data.command
            })
            return c.json(result)
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.post('/groups/:id/tasks/:taskId/claim', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }
        try {
            const task = engine.claimGroupTask(c.req.param('id'), c.req.param('taskId'), c.get('namespace'))
            return c.json({ task })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.post('/groups/:id/tasks/:taskId/done', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }
        try {
            const task = engine.doneGroupTask(c.req.param('id'), c.req.param('taskId'), c.get('namespace'))
            return c.json({ task })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.post('/groups/:id/tasks/:taskId/cancel', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }
        try {
            const task = engine.cancelGroupTask(c.req.param('id'), c.req.param('taskId'), c.get('namespace'))
            return c.json({ task })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    app.post('/groups/:id/broadcast-note', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const groupId = c.req.param('id')
        const namespace = c.get('namespace')

        try {
            await engine.broadcastGroupNote(groupId, namespace, {
                source: 'user:web',
                broadcastedBy: 'user:web'
            })
            return c.json({ success: true })
        } catch (error) {
            return toErrorResponse(c, error)
        }
    })

    return app
}
