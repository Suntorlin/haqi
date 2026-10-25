import { Hono } from 'hono'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { encryptFileForDownload, MAX_FILE_DOWNLOAD_BYTES } from '@hapi/protocol/fileTransfer'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

const fileSearchSchema = z.object({
    query: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional()
})

const directorySchema = z.object({
    path: z.string().optional()
})

const fileReadSchema = z.object({
    path: z.string().min(1),
    maxBytes: z.coerce.number().int().min(0).max(25 * 1024 * 1024).optional()
})

const pathOnlySchema = fileReadSchema.pick({ path: true })
const fileDownloadSchema = z.object({
    path: z.string().min(1),
    publicKey: z.string().min(1).max(200)
})
const gitSnapshotSchema = z.object({
    path: z.string().min(1),
    source: z.enum(['head', 'index'])
})

const YOLO_PERMISSION_MODES = new Set(['yolo', 'bypassPermissions', 'auto-approve'])
const WINDOWS_ABSOLUTE_PATH_REGEX = /^[A-Za-z]:[\\/]/

function parseBooleanParam(value: string | undefined): boolean | undefined {
    if (value === 'true') return true
    if (value === 'false') return false
    return undefined
}

async function runRpc<T>(fn: () => Promise<T>): Promise<T | { success: false; error: string }> {
    try {
        return await fn()
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
}

function hasParentTraversal(path: string): boolean {
    const normalized = path.replace(/\\/g, '/')
    return normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')
}

function isOutsideWorkspacePath(path: string): boolean {
    return isAbsolute(path) || WINDOWS_ABSOLUTE_PATH_REGEX.test(path) || hasParentTraversal(path)
}

function isYoloPermissionMode(mode: string | undefined): boolean {
    if (!mode) return false
    return YOLO_PERMISSION_MODES.has(mode)
}

export function createGitRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions/:id/git-status', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const result = await runRpc(() => engine.getGitStatus(sessionResult.sessionId, sessionPath))
        return c.json(result)
    })

    app.get('/sessions/:id/git-diff-numstat', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const staged = parseBooleanParam(c.req.query('staged'))
        const result = await runRpc(() => engine.getGitDiffNumstat(sessionResult.sessionId, { cwd: sessionPath, staged }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-diff-file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = pathOnlySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid file path' }, 400)
        }

        const staged = parseBooleanParam(c.req.query('staged'))
        const result = await runRpc(() => engine.getGitDiffFile(sessionResult.sessionId, {
            cwd: sessionPath,
            filePath: parsed.data.path,
            staged
        }))
        return c.json(result)
    })

    app.get('/sessions/:id/git-read-snapshot', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = gitSnapshotSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid git snapshot request' }, 400)
        }

        const result = await runRpc(() => engine.readGitSnapshot(sessionResult.sessionId, {
            cwd: sessionPath,
            filePath: parsed.data.path,
            source: parsed.data.source
        }))
        return c.json(result)
    })

    app.get('/sessions/:id/file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = fileReadSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid file path' }, 400)
        }

        const allowOutsideWorkingDirectory = isOutsideWorkspacePath(parsed.data.path)
        if (allowOutsideWorkingDirectory && !isYoloPermissionMode(sessionResult.session.permissionMode)) {
            return c.json({
                success: false,
                error: 'Outside-workspace paths require YOLO permission mode'
            }, 403)
        }

        const result = await runRpc(() => engine.readSessionFile(sessionResult.sessionId, parsed.data.path, {
            maxBytes: parsed.data.maxBytes,
            allowOutsideWorkingDirectory
        }))
        return c.json(result)
    })

    // The browser sends a one-time public key; the response body is the encrypted file.
    app.post('/sessions/:id/file/download', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        if (!sessionResult.session.metadata?.path) {
            return c.json({ success: false, error: 'Session path not available' }, 409)
        }

        const parsed = fileDownloadSchema.safeParse(await c.req.json().catch(() => null))
        if (!parsed.success) {
            return c.json({ success: false, error: 'Invalid download request' }, 400)
        }

        const allowOutsideWorkingDirectory = isOutsideWorkspacePath(parsed.data.path)
        if (allowOutsideWorkingDirectory && !isYoloPermissionMode(sessionResult.session.permissionMode)) {
            return c.json({
                success: false,
                error: 'Outside-workspace paths require YOLO permission mode'
            }, 403)
        }

        const result = await runRpc(() => engine.readSessionFile(sessionResult.sessionId, parsed.data.path, {
            maxBytes: MAX_FILE_DOWNLOAD_BYTES,
            allowOutsideWorkingDirectory
        }))
        if (!result.success) {
            return c.json({ success: false, error: result.error ?? 'Failed to read file' }, 502)
        }
        if (result.truncated) {
            return c.json({
                success: false,
                error: `File is larger than ${MAX_FILE_DOWNLOAD_BYTES / 1024 / 1024} MB`
            }, 413)
        }

        let envelope: Uint8Array<ArrayBuffer>
        try {
            envelope = await encryptFileForDownload(
                parsed.data.publicKey,
                new Uint8Array(Buffer.from(result.content ?? '', 'base64')),
                parsed.data.path
            )
        } catch {
            return c.json({ success: false, error: 'Invalid public key' }, 400)
        }

        return new Response(envelope, {
            headers: {
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'no-store'
            }
        })
    })

    app.get('/sessions/:id/files', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = fileSearchSchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const query = parsed.data.query?.trim() ?? ''
        const limit = parsed.data.limit ?? 200
        const args = ['--files']
        if (query) {
            args.push('--iglob', `*${query}*`)
        }

        const result = await runRpc(() => engine.runRipgrep(sessionResult.sessionId, args, sessionPath))
        if (!result.success) {
            return c.json({ success: false, error: result.error ?? 'Failed to list files' })
        }

        const stdout = result.stdout ?? ''
        const files = stdout
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .slice(0, limit)
            .map((fullPath) => {
                const parts = fullPath.split('/')
                const fileName = parts[parts.length - 1] || fullPath
                const filePath = parts.slice(0, -1).join('/')
                return {
                    fileName,
                    filePath,
                    fullPath,
                    fileType: 'file' as const
                }
            })

        return c.json({ success: true, files })
    })

    app.get('/sessions/:id/directory', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionPath = sessionResult.session.metadata?.path
        if (!sessionPath) {
            return c.json({ success: false, error: 'Session path not available' })
        }

        const parsed = directorySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const path = parsed.data.path ?? ''
        const result = await runRpc(() => engine.listDirectory(sessionResult.sessionId, path))
        return c.json(result)
    })

    return app
}
