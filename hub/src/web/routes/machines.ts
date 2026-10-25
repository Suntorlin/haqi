import { Hono } from 'hono'
import { z } from 'zod'
import {
    ClaudeAccountSelectionSchema, ClaudeAccountPoolSchema,
    CodexCredentialActivateRequestSchema,
    CodexCredentialImportRequestSchema,
    CodexCredentialSaveCurrentRequestSchema
} from '@hapi/protocol/schemas'
import { machineEnvSchema } from '../../sync/machineCache'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine } from './guards'

const spawnBodySchema = z.object({
    claudeAccount: ClaudeAccountSelectionSchema.optional(),
    directory: z.string().min(1),
    agent: z.enum(['claude', 'codex', 'cursor', 'gemini', 'opencode']).optional(),
    model: z.string().optional(),
    thinkEffort: z.enum(['auto', 'low', 'medium', 'high', 'max', 'xhigh']).optional(),
    serviceTier: z.enum(['fast', 'flex']).optional(),
    yolo: z.boolean().optional(),
    sessionType: z.enum(['simple', 'worktree']).optional(),
    worktreeName: z.string().optional(),
    previewUrl: z.string().optional()
})

const pathsExistsSchema = z.object({
    paths: z.array(z.string().min(1)).max(1000)
})

function normalizePreviewUrl(raw: string | undefined): { ok: true; value?: string } | { ok: false; error: string } {
    if (raw === undefined) {
        return { ok: true }
    }

    const trimmed = raw.trim()
    if (!trimmed) {
        return { ok: true, value: undefined }
    }

    try {
        const url = new URL(trimmed)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            return { ok: false, error: 'Preview URL must use http:// or https://' }
        }
        return { ok: true, value: url.toString() }
    } catch {
        return { ok: false, error: 'Invalid preview URL' }
    }
}

const machineSettingsSchema = z.object({
    displayName: z.string().max(80).nullable().optional(),
    role: z.enum(['always-on', 'portable']).optional(),
    env: machineEnvSchema.optional()
}).strict()

const repoMapQuerySchema = z.object({
    base: z.string().regex(/^[0-9a-f]{7,64}$/).optional(),
    repo: z.string().min(1).max(300).optional(),
    fresh: z.enum(['0', '1']).optional()
}).refine((query) => !query.base || query.repo, 'base needs repo: a base commit belongs to one repository')

const repoPinSchema = z.object({
    key: z.string().min(1).max(300),
    path: z.string().min(1).max(1000).nullable()
}).strict()

export function createMachinesRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/machines/:id/claude-accounts', async c => {
        const engine = getSyncEngine()
        if (!engine) return c.json({ error: 'Not connected' }, 503)
        const id = c.req.param('id')
        const machine = requireMachine(c, engine, id)
        if (machine instanceof Response) return machine
        try {
            const data = await engine.claudeAccounts(id, 'get') as import('@hapi/protocol/schemas').ClaudeAccountPoolView
            if (!data?.pool || !ClaudeAccountPoolSchema.safeParse(data.pool).success) throw new Error('Runner 不支持账号管理，请升级隔离版 Runner')
            const usage: Record<string, import('@hapi/protocol/schemas').ClaudeRateLimitSnapshot> = {}
            for (const session of engine.getSessionsByNamespace(c.get('namespace'))) {
                const meta = session.metadata
                if (meta?.machineId !== id || !meta.claudeAccount || !meta.rateLimitSnapshot) continue
                const snapshot = usage[meta.claudeAccount.id] ??= {}
                const { usageLimits, ...buckets } = meta.rateLimitSnapshot
                for (const [bucket, value] of Object.entries(buckets)) {
                    const key = bucket as Exclude<keyof typeof snapshot, 'usageLimits'>
                    if (value && (!snapshot[key] || value.observedAt > snapshot[key]!.observedAt)) snapshot[key] = value
                }
                if (usageLimits?.length) {
                    const newest = Math.max(...usageLimits.map(l => l.observedAt))
                    const current = snapshot.usageLimits?.length ? Math.max(...snapshot.usageLimits.map(l => l.observedAt)) : -1
                    if (newest > current) snapshot.usageLimits = usageLimits
                }
            }
            return c.json({ ...data, usage })
        } catch { return c.json({ error: '账号管理不可用：请确认隔离 Runner 已启动并支持此功能' }, 503) }
    })
    for (const operation of ['save', 'check'] as const) {
        app.post(`/machines/:id/claude-accounts/${operation}`, async c => {
            const engine = getSyncEngine()
            if (!engine) return c.json({ error: 'Not connected' }, 503)
            const id = c.req.param('id')
            const machine = requireMachine(c, engine, id)
            if (machine instanceof Response) return machine
            const schema = operation === 'save' ? z.object({ pool: ClaudeAccountPoolSchema, revision: z.string() }).strict() : z.object({ id: z.string().regex(/^[a-z0-9_-]{1,40}$/) }).strict()
            const parsed = schema.safeParse(await c.req.json().catch(() => null))
            if (!parsed.success) return c.json({ error: '账号配置无效：邮箱、标识、默认账号或顺序需要检查' }, 400)
            try {
                const result = await engine.claudeAccounts(id, operation, parsed.data)
                if (result && typeof result === 'object' && 'error' in result) return c.json({ error: String(result.error) }, 400)
                return c.json(result as object)
            } catch { return c.json({ error: '操作失败，请检查登录状态或刷新配置后重试' }, 503) }
        })
    }

    app.get('/machines', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const namespace = c.get('namespace')
        const machines = c.req.query('include') === 'offline'
            ? engine.getMachinesByNamespace(namespace)
            : engine.getOnlineMachinesByNamespace(namespace)
        return c.json({ machines })
    })

    app.patch('/machines/:id', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }
        const parsed = machineSettingsSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) {
            return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400)
        }
        const machine = engine.updateMachineSettings(c.req.param('id'), c.get('namespace'), parsed.data)
        if (!machine) {
            return c.json({ error: 'Machine not found' }, 404)
        }
        return c.json({ machine })
    })

    // Repositories on the online machines and where work on each goes; see repoMap.ts.
    app.get('/machines/repos', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }
        const parsed = repoMapQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid query' }, 400)
        }
        const namespace = c.get('namespace')
        const map = await engine.machineProbe.repos(namespace, { ...parsed.data, fresh: parsed.data.fresh === '1' })
        const machines = engine.getOnlineMachinesByNamespace(namespace)
            .map((m) => ({ id: m.id, name: m.metadata?.displayName ?? m.metadata?.host ?? m.id.slice(0, 8) }))
        return c.json({ ...map, machines })
    })

    // Confirms where a repository lives on a machine, the first time work goes there; a null path forgets it.
    app.put('/machines/:id/repos', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }
        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }
        const parsed = repoPinSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) {
            return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400)
        }
        let path = parsed.data.path
        if (path) {
            const probed = await engine.machineProbe.probeOne(machineId, path).catch(() => null)
            if (probed?.kind !== 'repo') {
                return c.json({ error: `这台机器上 ${path} 不是 git 仓库` }, 400)
            }
            const { key } = parsed.data
            if (!key.startsWith('local:') && !probed.repo.remotes.includes(key)) {
                return c.json({ error: `${path} 不是 ${key}：它的远程是 ${probed.repo.remotes.join('、') || '（无）'}` }, 400)
            }
            path = probed.repo.root
        }
        const updated = engine.updateMachineSettings(machineId, c.get('namespace'), { repo: { key: parsed.data.key, path } })
        if (!updated) {
            return c.json({ error: 'Machine not found' }, 404)
        }
        return c.json({ machine: updated })
    })

    app.post('/machines/:id/spawn', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = spawnBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const previewUrl = normalizePreviewUrl(parsed.data.previewUrl)
        if (!previewUrl.ok) {
            return c.json({ error: previewUrl.error }, 400)
        }

        if (parsed.data.agent === 'claude' && parsed.data.thinkEffort === 'xhigh') {
            return c.json({ error: 'Claude thinkEffort does not support xhigh (expected low/medium/high)' }, 400)
        }

        const result = await engine.spawnSession(
            machineId,
            parsed.data.directory,
            parsed.data.agent,
            parsed.data.model,
            parsed.data.thinkEffort,
            parsed.data.serviceTier,
            parsed.data.yolo,
            parsed.data.sessionType,
            parsed.data.worktreeName,
            undefined,
            previewUrl.value,
            parsed.data.claudeAccount
        )
        return c.json(result)
    })

    app.post('/machines/:id/paths/exists', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = pathsExistsSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const uniquePaths = Array.from(new Set(parsed.data.paths.map((path) => path.trim()).filter(Boolean)))
        if (uniquePaths.length === 0) {
            return c.json({ exists: {} })
        }

        try {
            const exists = await engine.checkPathsExist(machineId, uniquePaths)
            return c.json({ exists })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to check paths' }, 500)
        }
    })

    app.get('/machines/:id/codex-credentials', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            return c.json(await engine.getMachineCodexCredentials(machineId))
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to load Codex credentials' }, 500)
        }
    })

    app.get('/machines/:id/codex-credentials/export', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            return c.json(await engine.exportMachineCodexCredentials(machineId))
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to export Codex credentials' }, 500)
        }
    })

    app.post('/machines/:id/codex-credentials/import', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = CodexCredentialImportRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            return c.json(await engine.importMachineCodexCredentials(machineId, parsed.data))
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to import Codex credentials' }, 500)
        }
    })

    app.post('/machines/:id/codex-credentials/save-current', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => ({}))
        const parsed = CodexCredentialSaveCurrentRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            return c.json(await engine.saveCurrentMachineCodexCredentials(machineId, parsed.data))
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to save current Codex credentials' }, 500)
        }
    })

    app.post('/machines/:id/codex-credentials/activate', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = CodexCredentialActivateRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            return c.json(await engine.activateMachineCodexCredential(machineId, parsed.data.profileId))
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to activate Codex credentials' }, 500)
        }
    })

    app.delete('/machines/:id/codex-credentials/:profileId', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const profileId = c.req.param('profileId')
        if (!profileId) {
            return c.json({ error: 'profileId is required' }, 400)
        }

        try {
            return c.json(await engine.deleteMachineCodexCredential(machineId, profileId))
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to delete Codex credentials' }, 500)
        }
    })

    return app
}
