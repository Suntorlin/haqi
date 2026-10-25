import type { ProbedDir, ProbedRepo } from '@hapi/protocol/schemas'

/** What one machine reported, and what the hub knows about it. */
export type MachineProbe = {
    machineId: string
    dirs: ProbedDir[]
    /** Paths the user confirmed, by remote: they win over the automatic pick. */
    pins: Record<string, string>
    /** Folders sessions ran in on this machine, with the time of the latest. */
    recent: Array<{ path: string; at: number }>
}

export type RepoIssue = {
    /** block: the machine cannot take the work as it is. warn: it can, with a fix first. info: worth knowing. */
    level: 'block' | 'warn' | 'info'
    /** Stable, for code that acts on it: repo-unknown, base-missing, behind-base, deps-missing, changes, many-worktrees. */
    code: string
    text: string
}

export type RepoLocation = Omit<ProbedRepo, 'root' | 'mainRoot' | 'remotes'> & {
    path: string
    worktree: boolean
    /** Latest session in this checkout or, for a main clone, in any of its worktrees. */
    lastUsedAt: number | null
}

export type RepoOnMachine = {
    machineId: string
    /** Where work on this machine goes; null when the machine has no known checkout. */
    pick: RepoLocation | null
    pinned: boolean
    /** Every checkout found, the pick among them. */
    checkouts: number
    issues: RepoIssue[]
}

export type RepoView = {
    /** host/owner/name, or local:<folder> for a repository without a remote. */
    key: string
    name: string
    remotes: string[]
    machines: RepoOnMachine[]
}

/** A main clone with this many worktrees is probably carrying leftovers from finished work. */
const MANY_WORKTREES = 20

type Checkout = { machineId: string; repo: ProbedRepo }

function checkouts(probe: MachineProbe): Checkout[] {
    const byRoot = new Map<string, ProbedRepo>()
    for (const dir of probe.dirs) {
        for (const repo of dir.kind === 'repo' ? [dir.repo] : dir.kind === 'folder' ? dir.repos : []) byRoot.set(repo.root, repo)
    }
    return [...byRoot.values()].map((repo) => ({ machineId: probe.machineId, repo }))
}

const localKey = (repo: ProbedRepo) => `local:${repo.mainRoot.split('/').pop() ?? repo.mainRoot}`

/**
 * Checkouts that share a remote, or a main clone, are one repository. Without a remote a checkout
 * falls back to the folder name of its main clone, which can join two unrelated repositories.
 */
function group(all: Checkout[]): Checkout[][] {
    const parent = all.map((_, i) => i)
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
    const join = (a: number, b: number) => { parent[find(a)] = find(b) }
    const firstBy = new Map<string, number>()
    all.forEach((checkout, i) => {
        const keys = [`main:${checkout.machineId}:${checkout.repo.mainRoot}`]
        keys.push(...(checkout.repo.remotes.length > 0 ? checkout.repo.remotes.map((r) => `remote:${r}`) : [localKey(checkout.repo)]))
        for (const key of keys) {
            const seen = firstBy.get(key)
            if (seen === undefined) firstBy.set(key, i)
            else join(i, seen)
        }
    })
    const groups = new Map<number, Checkout[]>()
    all.forEach((checkout, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), checkout]))
    return [...groups.values()]
}

/** The remote most checkouts know, so a fork remote on one machine does not rename the repository. */
function keyOf(members: Checkout[]): { key: string; remotes: string[] } {
    const counts = new Map<string, number>()
    for (const { repo } of members) for (const remote of repo.remotes) counts.set(remote, (counts.get(remote) ?? 0) + 1)
    const remotes = [...counts.keys()].sort()
    const key = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
    return { key: key ?? localKey(members[0].repo), remotes }
}

function lastUsed(repo: ProbedRepo, all: ProbedRepo[], recent: MachineProbe['recent']): number | null {
    const roots = repo.root === repo.mainRoot ? all.filter((r) => r.mainRoot === repo.mainRoot).map((r) => r.root) : [repo.root]
    const inside = (path: string) => roots.some((root) => path === root || path.startsWith(`${root}/`))
    const times = recent.filter((r) => inside(r.path)).map((r) => r.at)
    return times.length > 0 ? Math.max(...times) : null
}

function location(repo: ProbedRepo, members: ProbedRepo[], recent: MachineProbe['recent']): RepoLocation {
    const { root, mainRoot, remotes: _remotes, ...facts } = repo
    return { ...facts, path: root, worktree: root !== mainRoot, lastUsedAt: lastUsed(repo, members, recent) }
}

/**
 * Where work on this repository goes on one machine: the confirmed path; else a main clone, since new
 * worktrees are made from it; among several, one with the base commit, then the one used last, then
 * the one with the fewest uncommitted changes.
 */
function pick(mine: ProbedRepo[], probe: MachineProbe, names: string[], base: boolean): { pick: RepoLocation | null; pinned: boolean } {
    const pinnedPath = names.map((name) => probe.pins[name]).find(Boolean)
    const pinned = mine.find((repo) => repo.root === pinnedPath)
    if (pinned) return { pick: withBase(location(pinned, mine, probe.recent), base), pinned: true }
    const mains = mine.filter((repo) => repo.root === repo.mainRoot)
    const ranked = (mains.length > 0 ? mains : mine)
        .map((repo) => location(repo, mine, probe.recent))
        .sort((a, b) => (base ? Number(a.base === 'missing') - Number(b.base === 'missing') : 0)
            || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
            || a.changed - b.changed)
    return { pick: ranked[0] ? withBase(ranked[0], base) : null, pinned: false }
}

/** The runner measures every checkout against the base; only the repository it belongs to keeps the result. */
function withBase(at: RepoLocation, base: boolean): RepoLocation {
    if (base) return at
    const { base: _unrelated, ...rest } = at
    return rest
}

function issues(at: RepoLocation | null, base: boolean): RepoIssue[] {
    if (!at) return [{ level: 'block', code: 'repo-unknown', text: '这台机器上没用过这个仓库：第一次用要确认路径，或者先克隆' }]
    const found: RepoIssue[] = []
    if (base && at.base === 'missing') found.push({ level: 'block', code: 'base-missing', text: '没有基准提交：派活前要先把它推过来' })
    else if (at.base && at.base !== 'missing' && at.base.behind > 0) found.push({ level: 'warn', code: 'behind-base', text: `比基准落后 ${at.base.behind} 个提交` })
    for (const dep of at.deps) {
        if (dep.installed === false) found.push({ level: 'warn', code: 'deps-missing', text: `${dep.manager} 依赖没装` })
    }
    if (at.changed > 0) found.push({ level: 'info', code: 'changes', text: `有 ${at.changed} 个文件改了没提交（新开的 worktree 不受影响）` })
    if (at.worktrees >= MANY_WORKTREES) found.push({ level: 'info', code: 'many-worktrees', text: `有 ${at.worktrees} 个 worktree，可能有做完没清理的` })
    return found
}

/**
 * Every repository found on any machine, with where work on it goes on each of the given machines.
 * A machine without the repository is listed too, so a caller sees it needs confirming. A base commit
 * belongs to one repository: `repo` names it, by key or by any of its remotes.
 */
export function buildRepoMap(probes: MachineProbe[], options: { base?: { repo: string; commit: string } } = {}): RepoView[] {
    const byMachine = new Map(probes.map((p) => [p.machineId, p]))
    return group(probes.flatMap(checkouts))
        .map((members) => {
            const { key, remotes } = keyOf(members)
            const base = Boolean(options.base && (options.base.repo === key || remotes.includes(options.base.repo)))
            const machines = probes.map((probe) => {
                const mine = members.filter((m) => m.machineId === probe.machineId).map((m) => m.repo)
                const chosen = pick(mine, byMachine.get(probe.machineId)!, [key, ...remotes], base)
                return { machineId: probe.machineId, ...chosen, checkouts: mine.length, issues: issues(chosen.pick, base) }
            })
            return { key, name: key.split('/').pop() ?? key, remotes, machines }
        })
        .sort((a, b) => a.key.localeCompare(b.key))
}
