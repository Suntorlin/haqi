import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { MachineProbeRequest, MachineProbeResponse, ProbedDir, ProbedRepo } from '@hapi/protocol/schemas'

/** A slow command gives up after this; one stuck checkout must not hold up the rest. */
const GIT_TIMEOUT_MS = 5_000
/** Checkouts probed at once. */
const PARALLEL = 8
/** A plain folder with more checkouts than this is not a workspace worth reading in full. */
const MAX_CHILDREN = 50

/**
 * Package managers by lockfile, and the folder each installs into. A manager without a local folder
 * (go, cargo) still reports its lockfile, so two machines can be compared.
 */
const PACKAGE_MANAGERS: Array<{ manager: string; lockfiles: string[]; installDir: string | null }> = [
    { manager: 'bun', lockfiles: ['bun.lock', 'bun.lockb'], installDir: 'node_modules' },
    { manager: 'pnpm', lockfiles: ['pnpm-lock.yaml'], installDir: 'node_modules' },
    { manager: 'yarn', lockfiles: ['yarn.lock'], installDir: 'node_modules' },
    { manager: 'npm', lockfiles: ['package-lock.json'], installDir: 'node_modules' },
    { manager: 'uv', lockfiles: ['uv.lock'], installDir: '.venv' },
    { manager: 'poetry', lockfiles: ['poetry.lock'], installDir: '.venv' },
    { manager: 'go', lockfiles: ['go.sum'], installDir: null },
    { manager: 'cargo', lockfiles: ['Cargo.lock'], installDir: null }
]

function git(dir: string, args: string[]): Promise<string | null> {
    return new Promise((resolve) => {
        execFile('git', ['-C', dir, ...args], { timeout: GIT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
            resolve(error ? null : stdout.trim())
        })
    })
}

const exists = (path: string) => stat(path).then(() => true, () => false)

/** git@github.com:Owner/app.git and https://github.com/Owner/app both become github.com/owner/app. */
export function normalizeRemote(url: string): string {
    return url.trim()
        .replace(/^[a-z+]+:\/\//i, '')
        .replace(/^[^@/]+@/, '')
        .replace(/^([^/:]+):(?!\d+\/)/, '$1/')
        .replace(/^([^/:]+):\d+\//, '$1/')
        .replace(/\.git\/?$/, '')
        .replace(/\/+$/, '')
        .toLowerCase()
}

const gap = (counts: string | null) => {
    const [behind, ahead] = (counts ?? '').split(/\s+/).map(Number)
    return Number.isInteger(behind) && Number.isInteger(ahead) ? { behind, ahead } : null
}

async function deps(root: string): Promise<ProbedRepo['deps']> {
    const found: ProbedRepo['deps'] = []
    for (const { manager, lockfiles, installDir } of PACKAGE_MANAGERS) {
        for (const lockfile of lockfiles) {
            const content = await readFile(join(root, lockfile)).catch(() => null)
            if (!content) continue
            found.push({
                manager,
                lockfile,
                lockHash: createHash('sha256').update(content).digest('hex').slice(0, 12),
                ...(installDir ? { installed: await exists(join(root, installDir)) } : {})
            })
            break
        }
    }
    return found
}

/** The checkout `dir` is in, or null when it is not in one. */
export async function probeRepo(dir: string, base?: string): Promise<ProbedRepo | null> {
    const top = await git(dir, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])
    if (!top) return null
    const [root, commonDir] = top.split('\n')
    if (!root || !commonDir) return null
    const mainRoot = commonDir.endsWith('/.git') ? commonDir.slice(0, -'/.git'.length) : commonDir

    const [head, branch, status, remotes, worktrees, upstreamName, upstream, baseGap, hasBase, lockfiles] = await Promise.all([
        git(root, ['log', '-1', '--format=%H %ct']),
        git(root, ['symbolic-ref', '--quiet', '--short', 'HEAD']),
        git(root, ['status', '--porcelain']),
        git(root, ['remote', '-v']),
        git(root, ['worktree', 'list', '--porcelain']),
        git(root, ['rev-parse', '--abbrev-ref', '@{upstream}']),
        git(root, ['rev-list', '--left-right', '--count', '@{upstream}...HEAD']),
        base ? git(root, ['rev-list', '--left-right', '--count', `${base}...HEAD`]) : Promise.resolve(null),
        base ? git(root, ['cat-file', '-e', `${base}^{commit}`]) : Promise.resolve(null),
        deps(root)
    ])
    const [sha = '', time = '0'] = (head ?? '').split(' ')
    const lines = status ? status.split('\n') : []
    const upstreamGap = gap(upstream)
    return {
        root,
        mainRoot,
        remotes: [...new Set((remotes ?? '').split('\n')
            .filter((line) => line.endsWith('(fetch)'))
            .map((line) => normalizeRemote(line.split(/\s+/)[1] ?? ''))
            .filter(Boolean))].sort(),
        branch: branch || null,
        head: sha.slice(0, 12),
        headTime: Number(time),
        changed: lines.filter((line) => !line.startsWith('??')).length,
        untracked: lines.filter((line) => line.startsWith('??')).length,
        worktrees: Math.max(0, (worktrees ?? '').split('\n').filter((line) => line.startsWith('worktree ')).length - 1),
        ...(upstreamName && upstreamGap ? { upstream: { name: upstreamName, ...upstreamGap } } : {}),
        // `cat-file -e` prints nothing and succeeds when the commit is there; null means it failed.
        ...(base ? { base: hasBase === null ? 'missing' as const : gap(baseGap) ?? 'missing' as const } : {}),
        deps: lockfiles
    }
}

async function inParallel<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const i = next++
            results[i] = await run(items[i])
        }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker))
    return results
}

async function probeDir(dir: string, base?: string): Promise<ProbedDir> {
    if (!(await exists(dir))) return { dir, kind: 'missing' }
    const repo = await probeRepo(dir, base)
    if (repo) return { dir, kind: 'repo', repo }
    // A plain folder: the checkouts directly inside it, like ~/dev holding several repositories.
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    const children = (await Promise.all(entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules')
        .map(async (entry) => (await exists(join(dir, entry.name, '.git')) ? join(dir, entry.name) : null))))
        .filter((child): child is string => child !== null)
        .slice(0, MAX_CHILDREN)
    const repos = await inParallel(children, (child) => probeRepo(child, base))
    return { dir, kind: 'folder', repos: repos.filter((repo): repo is ProbedRepo => repo !== null) }
}

/**
 * What the hub asked about each folder. A worktree also brings its main clone, which is where new
 * worktrees are made from, even when no session ever ran there.
 */
export async function probeMachine(request: MachineProbeRequest): Promise<MachineProbeResponse> {
    const asked = [...new Set(request.dirs)]
    const dirs = await inParallel(asked, (dir) => probeDir(dir, request.base))
    const seen = new Set(dirs.flatMap((d) => (d.kind === 'repo' ? [d.repo.root] : d.kind === 'folder' ? d.repos.map((r) => r.root) : [])))
    const mainRoots = [...new Set(dirs.flatMap((d) => (d.kind === 'repo' ? [d.repo.mainRoot] : [])))].filter((root) => !seen.has(root))
    const mains = await inParallel(mainRoots, (root) => probeDir(root, request.base))
    return { dirs: [...dirs, ...mains] }
}
