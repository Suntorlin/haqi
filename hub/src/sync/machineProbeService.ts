import type { MachineProbeRequest, MachineProbeResponse } from '@hapi/protocol/schemas'
import { buildRepoMap, type MachineProbe, type RepoView } from './repoMap'

/** A probe is reused for this long, so a task page and a planner asking together run it once. */
const CACHE_MS = 60_000
/** Folders of the newest sessions probed per machine; older ones are confirmed again on first use. */
const RECENT_DIRS = 40

export type ProbeHost = {
    machines: (namespace: string) => Array<{ id: string; repos?: Record<string, string> }>
    sessions: (namespace: string) => Array<{ machineId: string | null; path: string | null; updatedAt: number }>
    probe: (machineId: string, request: MachineProbeRequest) => Promise<MachineProbeResponse>
}

export type RepoMap = {
    repos: RepoView[]
    /** Online machines that did not answer. */
    failed: Array<{ machineId: string; error: string }>
    probedAt: number
}

/**
 * Finds the repositories on each online machine. It reads only folders sessions ran in, and paths
 * the user confirmed; it never walks the disk, so a probe takes about a second.
 */
export class MachineProbeService {
    private readonly cache = new Map<string, { at: number; result: Promise<MachineProbeResponse> }>()

    constructor(private readonly host: ProbeHost) {}

    /** With a base commit, `repo` names the repository it belongs to. */
    async repos(namespace: string, options: { base?: string; repo?: string; fresh?: boolean } = {}): Promise<RepoMap> {
        const sessions = this.host.sessions(namespace).sort((a, b) => b.updatedAt - a.updatedAt)
        const outcomes = await Promise.all(this.host.machines(namespace).map(async (machine) => {
            const recent = sessions
                .filter((s): s is { machineId: string; path: string; updatedAt: number } => s.machineId === machine.id && Boolean(s.path))
                .map((s) => ({ path: s.path, at: s.updatedAt }))
            const dirs = [...new Set([...new Set(recent.map((r) => r.path))].slice(0, RECENT_DIRS).concat(Object.values(machine.repos ?? {})))]
            try {
                const response = await this.probe(machine.id, { dirs, ...(options.base ? { base: options.base } : {}) }, options.fresh)
                return { ok: true as const, probe: { machineId: machine.id, dirs: response.dirs, pins: machine.repos ?? {}, recent } }
            } catch (error) {
                return { ok: false as const, machineId: machine.id, error: error instanceof Error ? error.message : String(error) }
            }
        }))
        const probes: MachineProbe[] = outcomes.flatMap((o) => (o.ok ? [o.probe] : []))
        const repos = buildRepoMap(probes, options.base && options.repo ? { base: { repo: options.repo, commit: options.base } } : {})
        return {
            repos: options.repo ? repos.filter((r) => r.key === options.repo || r.remotes.includes(options.repo!)) : repos,
            failed: outcomes.flatMap((o) => (o.ok ? [] : [{ machineId: o.machineId, error: o.error }])),
            probedAt: Date.now()
        }
    }

    /** Probes one folder now, to check a path before it is confirmed. */
    async probeOne(machineId: string, dir: string): Promise<MachineProbeResponse['dirs'][number] | null> {
        return (await this.host.probe(machineId, { dirs: [dir] })).dirs[0] ?? null
    }

    private probe(machineId: string, request: MachineProbeRequest, fresh = false): Promise<MachineProbeResponse> {
        const key = JSON.stringify([machineId, request.base ?? '', [...request.dirs].sort()])
        const cached = this.cache.get(key)
        if (!fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.result
        const result = this.host.probe(machineId, request)
        for (const [old, entry] of this.cache) if (Date.now() - entry.at >= CACHE_MS) this.cache.delete(old)
        this.cache.set(key, { at: Date.now(), result })
        // A failed probe is not kept: the next ask tries again.
        result.catch(() => this.cache.delete(key))
        return result
    }
}
