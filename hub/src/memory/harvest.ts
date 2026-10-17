import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/**
 * Claude Code's own auto-memory: one markdown file per memory under
 * <CLAUDE_CONFIG_DIR>/projects/<encoded cwd>/memory/. HAQI runs Claude on several
 * accounts, so the same project has one such folder per account.
 */

export type ClaudeMemoryFile = {
    path: string
    hash: string
    text: string
    /** user | feedback | project | reference, from the file's frontmatter. */
    kind: string | null
    project: string | null
    mtimeMs: number
}

function configDirs(hapiHome: string): string[] {
    const dirs = new Set<string>()
    const pool = join(hapiHome, 'claude-accounts')
    if (existsSync(pool)) {
        for (const name of readdirSync(pool)) {
            const dir = join(pool, name)
            if (statSync(dir).isDirectory()) dirs.add(dir)
        }
    }
    const plain = join(homedir(), '.claude')
    if (existsSync(plain)) dirs.add(plain)
    return [...dirs]
}

/** "-Users-me-src-haqi-wt-x" -> "/Users/me/src/haqi-wt-x", resolving dashes inside names against the disk. */
export function decodeProjectDir(encoded: string): string | null {
    const parts = encoded.replace(/^-/, '').split('-')
    const walk = (base: string, index: number): string | null => {
        if (index >= parts.length) return base
        for (let end = index + 1; end <= parts.length; end++) {
            const name = parts.slice(index, end).join('-')
            const next = join(base, name)
            if (existsSync(next)) {
                const found = walk(next, end)
                if (found) return found
            }
        }
        return null
    }
    return walk('/', 0)
}

const projectCache = new Map<string, string | null>()

/** Repository name for a folder: git remote "origin" > git top-level folder > the folder name. */
export function projectNameFor(path: string): string | null {
    if (projectCache.has(path)) return projectCache.get(path) ?? null
    let name: string | null = null
    const remote = spawnSync('git', ['-C', path, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 3_000 })
    const url = remote.status === 0 ? remote.stdout.trim() : ''
    if (url) name = basename(url).replace(/\.git$/, '') || null
    if (!name) {
        const top = spawnSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 3_000 })
        name = top.status === 0 && top.stdout.trim() ? basename(top.stdout.trim()) : basename(path) || null
    }
    projectCache.set(path, name)
    return name
}

/** Folder gone: last path part, with a "-wt-…" worktree suffix dropped. */
function guessProject(encoded: string): string | null {
    const tail = encoded.split('-projects-').pop() ?? encoded
    return tail.replace(/-wt-.*$/, '') || null
}

function parseMemoryFile(raw: string): { text: string; kind: string | null } | null {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
    const front = match?.[1] ?? ''
    const body = (match ? match[2] : raw).trim()
    const field = (key: string) => front.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? null
    const description = field('description')
    const firstLine = body.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#') && !line.startsWith('**')) ?? null
    const text = (description ?? firstLine ?? '').trim()
    if (!text) return null
    return { text, kind: field('type') }
}

export function listClaudeMemoryFiles(hapiHome: string): ClaudeMemoryFile[] {
    const files: ClaudeMemoryFile[] = []
    for (const configDir of configDirs(hapiHome)) {
        const projectsDir = join(configDir, 'projects')
        if (!existsSync(projectsDir)) continue
        for (const encoded of readdirSync(projectsDir)) {
            const memoryDir = join(projectsDir, encoded, 'memory')
            if (!existsSync(memoryDir)) continue
            const folder = decodeProjectDir(encoded)
            const project = folder ? projectNameFor(folder) : guessProject(encoded)
            for (const name of readdirSync(memoryDir)) {
                if (!name.endsWith('.md') || name === 'MEMORY.md') continue
                const path = join(memoryDir, name)
                const raw = readFileSync(path, 'utf8')
                const parsed = parseMemoryFile(raw)
                if (!parsed) continue
                files.push({
                    path,
                    hash: createHash('sha256').update(raw).digest('hex').slice(0, 16),
                    text: parsed.text,
                    kind: parsed.kind,
                    project,
                    mtimeMs: statSync(path).mtimeMs
                })
            }
        }
    }
    return files
}

/** Bullet lines of the hand-written global MEMORY.md, as candidates the user said. */
export function listMemoryMdBullets(hapiHome: string): Array<{ text: string; hash: string }> {
    const path = join(hapiHome, 'MEMORY.md')
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim() ?? '')
        .filter((text) => text.length >= 6)
        .map((text) => ({ text, hash: createHash('sha256').update(text).digest('hex').slice(0, 16) }))
}
