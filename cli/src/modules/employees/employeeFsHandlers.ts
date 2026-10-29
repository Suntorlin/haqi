import { mkdir, readdir, readFile, stat, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, resolve, sep } from 'path'

import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { readSettings } from '@/persistence'
import { logger } from '@/ui/logger'
import { getErrorMessage, rpcError } from '../common/rpcResponses'

/**
 * Machine-level RPCs for the digital-employee home folders under the vault. The hub routes them to the employee's
 * default machine only (the single reader-writer rule), so this machine is the one place the shared files are
 * read and written.
 *
 * The vault root comes from HAPI_VAULT_ROOT or the runner's settings.json (`vaultRoot`), an interim source until
 * the multi-machine module provides it.
 */

const MAX_READ_BYTES = 512 * 1024

export async function resolveVaultRoot(): Promise<string | null> {
    const fromEnv = process.env.HAPI_VAULT_ROOT?.trim()
    if (fromEnv) return fromEnv
    const settings = await readSettings()
    const fromSettings = settings.vaultRoot?.trim()
    return fromSettings || null
}

/** The employee home and the path inside it, both resolved and fenced into the vault. */
async function resolveEmployeePath(home: string, path: string): Promise<{ root: string; target: string } | { error: string }> {
    const vaultRoot = await resolveVaultRoot()
    if (!vaultRoot) return { error: 'vaultRoot is not configured on this machine (settings.json or HAPI_VAULT_ROOT)' }
    const vault = resolve(vaultRoot)
    const root = resolve(vault, home)
    if (root !== vault && !root.startsWith(vault + sep)) return { error: 'Employee home escapes the vault root' }
    const target = resolve(root, path)
    if (target !== root && !target.startsWith(root + sep)) return { error: 'Path escapes the employee home' }
    return { root, target }
}

const SOUL_TEMPLATE = (name: string, emoji: string | null) => `# ${emoji ? `${emoji} ` : ''}${name}

（人设、语气、边界。这一份由人写，agent 只读。）

- 我是谁：
- 我的语气：
- 我的边界：
`

const AGENTS_TEMPLATE = (name: string) => `# ${name} 的工作规程

（职责、交付标准、什么时候建任务、什么时候找人、压缩时保留什么。这一份由人写，agent 只读。）

## 职责

## 交付标准

## 压缩时保留
- 当前目标、未完成事项、文件路径、已做决策
`

export function registerEmployeeFsHandlers(rpcHandlerManager: RpcHandlerManager): void {
    rpcHandlerManager.registerHandler<{ home: string; name: string; emoji?: string | null }, object>('employee-dir-init', async (params) => {
        try {
            const resolved = await resolveEmployeePath(params?.home ?? '', '.')
            if ('error' in resolved) return rpcError(resolved.error)
            const { root } = resolved
            await mkdir(join(root, 'memory'), { recursive: true })
            await mkdir(join(root, 'skills', '_proposed'), { recursive: true })
            const seeds: Array<[string, string]> = [
                ['SOUL.md', SOUL_TEMPLATE(params.name, params.emoji ?? null)],
                ['AGENTS.md', AGENTS_TEMPLATE(params.name)],
                ['MEMORY.md', `# ${params.name} 的长期记忆\n`],
                ['CHANGES.md', `# ${params.name} 的记忆改动记录\n`]
            ]
            for (const [file, content] of seeds) {
                const target = join(root, file)
                if (!existsSync(target)) await writeFile(target, content, 'utf8')
            }
            logger.debug('[employee-fs] initialized home', root)
            return { root }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to initialize employee home'))
        }
    })

    rpcHandlerManager.registerHandler<{ home: string; path: string }, object>('employee-fs-read', async (params) => {
        try {
            const resolved = await resolveEmployeePath(params?.home ?? '', params?.path ?? '')
            if ('error' in resolved) return rpcError(resolved.error)
            if (!existsSync(resolved.target)) return { exists: false, content: '', mtimeMs: 0 }
            const stats = await stat(resolved.target)
            if (!stats.isFile()) return rpcError('Path is not a regular file')
            if (stats.size > MAX_READ_BYTES) return rpcError(`File larger than ${MAX_READ_BYTES} bytes`)
            const content = await readFile(resolved.target, 'utf8')
            return { exists: true, content, mtimeMs: stats.mtimeMs }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to read employee file'))
        }
    })

    rpcHandlerManager.registerHandler<{ home: string; path: string; content: string; append?: boolean }, object>('employee-fs-write', async (params) => {
        try {
            if (typeof params?.content !== 'string') return rpcError('content is required')
            const resolved = await resolveEmployeePath(params?.home ?? '', params?.path ?? '')
            if ('error' in resolved) return rpcError(resolved.error)
            await mkdir(join(resolved.target, '..'), { recursive: true })
            await writeFile(resolved.target, params.content, { encoding: 'utf8', flag: params.append ? 'a' : 'w' })
            const stats = await stat(resolved.target)
            return { mtimeMs: stats.mtimeMs }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to write employee file'))
        }
    })

    rpcHandlerManager.registerHandler<{ home: string; path: string }, object>('employee-fs-stat', async (params) => {
        try {
            const resolved = await resolveEmployeePath(params?.home ?? '', params?.path ?? '')
            if ('error' in resolved) return rpcError(resolved.error)
            if (!existsSync(resolved.target)) return { exists: false, mtimeMs: 0 }
            const stats = await stat(resolved.target)
            return { exists: true, mtimeMs: stats.mtimeMs }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to stat employee file'))
        }
    })

    rpcHandlerManager.registerHandler<{ home: string; path: string }, object>('employee-fs-list', async (params) => {
        try {
            const resolved = await resolveEmployeePath(params?.home ?? '', params?.path ?? '')
            if ('error' in resolved) return rpcError(resolved.error)
            if (!existsSync(resolved.target)) return { entries: [] }
            const entries = await readdir(resolved.target, { withFileTypes: true })
            return { entries: entries.map((entry) => ({ name: entry.name, dir: entry.isDirectory() })) }
        } catch (error) {
            return rpcError(getErrorMessage(error, 'Failed to list employee folder'))
        }
    })
}
