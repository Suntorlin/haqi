/**
 * What the planner needs to pick the machine for a task: how busy each online machine is, and where each recent
 * repository lives on it. The hub suggests one machine per repository; the planner may pick another for a reason in
 * the request.
 */

export type MachineOffer = {
    id: string
    name: string
    /** A laptop that may leave. */
    portable: boolean
    /** Busy cores as a share of all cores; 100 means every core has work waiting. */
    loadPct: number | null
    memFreePct: number | null
    onBattery: boolean
    /** Active sessions on the machine. */
    sessions: number
}

export type RepoPlace = {
    machineId: string
    /** Where work goes on this machine; null when the machine has no known checkout. */
    path: string | null
    /** The machine cannot take the work as it is (no checkout, no base commit). */
    blocked: boolean
    notes: string[]
}

export type RepoOffer = { name: string; places: RepoPlace[] }

/** What the planner was shown; its draft must pick a machine and a path from it. */
export type MachinesOffered = { machines: MachineOffer[]; repos: RepoOffer[] }

/** Below this gap two machines count as equally busy, and the always-on one wins. */
const EQUAL_LOAD_PCT = 20

/**
 * The machine a repository fits best: it has a checkout that can take the work, is not on battery (when another
 * machine can take it), and is the least busy. With loads within 20 points the always-on machine wins, then the one
 * with fewer sessions.
 */
export function suggestMachine(repo: RepoOffer, machines: MachineOffer[]): string | null {
    const byId = new Map(machines.map((m) => [m.id, m]))
    const able = repo.places.filter((p) => p.path && !p.blocked).map((p) => byId.get(p.machineId)).filter((m): m is MachineOffer => Boolean(m))
    const plugged = able.filter((m) => !m.onBattery)
    const ranked = (plugged.length > 0 ? plugged : able).sort((a, b) => (a.loadPct ?? 100) - (b.loadPct ?? 100))
    const idlest = ranked[0]
    if (!idlest) return null
    const close = ranked.filter((m) => (m.loadPct ?? 100) - (idlest.loadPct ?? 100) < EQUAL_LOAD_PCT)
    return close.sort((a, b) => Number(a.portable) - Number(b.portable) || a.sessions - b.sessions)[0].id
}

function describe(machine: MachineOffer, here: boolean): string {
    return [
        machine.loadPct === null ? '负载未知' : `负载 ${machine.loadPct}%`,
        machine.memFreePct === null ? null : `内存空闲 ${machine.memFreePct}%`,
        `${machine.sessions} 个活跃会话`,
        machine.portable ? (machine.onBattery ? '笔记本，正在用电池' : '笔记本') : '常开',
        here ? '你现在在这台' : null
    ].filter(Boolean).join('，')
}

/** The context pack section: the machines, then each repository's path on each machine and the suggestion. */
export function machinesSection(offered: MachinesOffered, hereId: string): string {
    const names = new Map(offered.machines.map((m) => [m.id, m.name]))
    return [
        '## 机器（你来选在哪台做）',
        '用户确认后，负责人、执行、合并和评审会话都开在你选的那台机器上。',
        ...offered.machines.map((m) => `- [machine:${m.id}] ${m.name}：${describe(m, m.id === hereId)}`),
        '',
        '各仓库在每台机器上的路径（选了机器，repo_path 就填那台机器上的路径）：',
        ...offered.repos.map((repo) => {
            const suggested = suggestMachine(repo, offered.machines)
            const places = repo.places.map((p) => {
                const name = names.get(p.machineId) ?? p.machineId
                if (!p.path) return `${name} 没有`
                return `${name} ${p.path}${p.notes.length ? `（${p.notes.join('；')}）` : ''}${p.blocked ? '（不能用）' : ''}`
            })
            return `- ${repo.name}：${places.join('；')}${suggested ? `。建议 ${names.get(suggested)}` : ''}`
        })
    ].join('\n')
}

/** The path the draft names, when the planner was shown it for that machine. */
export function offeredPath(offered: MachinesOffered, machineId: string, path: string): boolean {
    return offered.repos.some((repo) => repo.places.some((p) => p.machineId === machineId && p.path && !p.blocked && (path === p.path || path.startsWith(`${p.path}/`))))
}
