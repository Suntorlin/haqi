import { z } from 'zod'
import type { MachineLoad } from '@hapi/protocol/schemas'
import type { Store } from '../store'
import { clampAliveTime } from './aliveTime'
import { EventPublisher } from './eventPublisher'

const machineMetadataSchema = z.object({
    host: z.string().optional(),
    platform: z.string().optional(),
    happyCliVersion: z.string().optional(),
    displayName: z.string().optional(),
    homeDir: z.string().optional(),
    happyHomeDir: z.string().optional(),
    happyLibDir: z.string().optional(),
    role: z.enum(['always-on', 'portable']).optional(),
    env: z.record(z.string(), z.string()).optional(),
    /** Confirmed checkout path by repository key (host/owner/name); set from the web. */
    repos: z.record(z.string(), z.string()).optional(),
    fingerprint: z.string().optional()
})

export type MachineRole = 'always-on' | 'portable'

/** Fields the runner reports about itself on every start. Everything else (name, role, env) is set from the web. */
const RUNNER_REPORTED_KEYS = ['host', 'platform', 'happyCliVersion', 'homeDir', 'happyHomeDir', 'happyLibDir', 'fingerprint'] as const

const MACHINE_TIMEOUT_MS = 45_000

/** Variables the runner sets or strips itself; a machine's env may not override them. */
const RESERVED_ENV = /^(HAPI_|ANTHROPIC_|CLAUDE_CODE_|CLAUDE_CONFIG_DIR$|PATH$|HOME$)/

export const machineEnvSchema = z.record(
    z.string().regex(/^[A-Z_][A-Z0-9_]*$/).refine((key) => !RESERVED_ENV.test(key), 'reserved variable'),
    z.string().max(4096)
).refine((env) => Object.keys(env).length <= 50, 'too many variables')

export type MachineSettingsPatch = {
    displayName?: string | null
    role?: MachineRole
    env?: Record<string, string>
    /** Confirms where a repository lives on this machine; a null path forgets it. */
    repo?: { key: string; path: string | null }
}

export type RegisterRunnerResult =
    | { type: 'ok'; machine: Machine }
    | { type: 'conflict'; host: string | null; happyHomeDir: string | null }

export interface Machine {
    id: string
    namespace: string
    seq: number
    createdAt: number
    updatedAt: number
    active: boolean
    activeAt: number
    metadata: {
        host: string
        platform: string
        happyCliVersion: string
        displayName?: string
        homeDir?: string
        happyHomeDir?: string
        happyLibDir?: string
        role?: MachineRole
        env?: Record<string, string>
        repos?: Record<string, string>
    } | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    /** From the latest heartbeat; kept in memory only. */
    load?: MachineLoad | null
}

export class MachineCache {
    private readonly machines: Map<string, Machine> = new Map()
    private readonly lastBroadcastAtByMachineId: Map<string, number> = new Map()

    constructor(
        private readonly store: Store,
        private readonly publisher: EventPublisher
    ) {
    }

    getMachines(): Machine[] {
        return Array.from(this.machines.values())
    }

    getMachinesByNamespace(namespace: string): Machine[] {
        return this.getMachines().filter((machine) => machine.namespace === namespace)
    }

    getMachine(machineId: string): Machine | undefined {
        return this.machines.get(machineId)
    }

    getMachineByNamespace(machineId: string, namespace: string): Machine | undefined {
        const machine = this.machines.get(machineId)
        if (!machine || machine.namespace !== namespace) {
            return undefined
        }
        return machine
    }

    getOnlineMachines(): Machine[] {
        return this.getMachines().filter((machine) => machine.active)
    }

    getOnlineMachinesByNamespace(namespace: string): Machine[] {
        return this.getMachinesByNamespace(namespace).filter((machine) => machine.active)
    }

    getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): Machine {
        const stored = this.store.machines.getOrCreateMachine(id, metadata, runnerState, namespace)
        return this.refreshMachine(stored.id) ?? (() => { throw new Error('Failed to load machine') })()
    }

    /**
     * A runner (re)registers. The runner's own facts (host, version, paths, fingerprint) replace the stored ones,
     * so the hub never shows a stale host or version; the name, role and env set from the web are kept.
     * A second computer that reuses a machine id (copied settings.json) is refused while the first one is online.
     */
    registerRunner(id: string, reported: unknown, runnerState: unknown, namespace: string): RegisterRunnerResult {
        const stored = this.store.machines.getMachine(id)
        if (!stored) {
            return { type: 'ok', machine: this.getOrCreateMachine(id, reported, runnerState, namespace) }
        }
        if (stored.namespace !== namespace) {
            throw new Error('Machine namespace mismatch')
        }

        const current = machineMetadataSchema.safeParse(stored.metadata)
        const currentData = current.success ? current.data : {}
        const incoming = machineMetadataSchema.safeParse(reported)
        const incomingData = incoming.success ? incoming.data : {}

        const cached = this.machines.get(id)
        const online = Boolean(cached?.active && Date.now() - cached.activeAt <= MACHINE_TIMEOUT_MS)
        if (currentData.fingerprint && incomingData.fingerprint && currentData.fingerprint !== incomingData.fingerprint) {
            if (online) {
                return { type: 'conflict', host: currentData.host ?? null, happyHomeDir: currentData.happyHomeDir ?? null }
            }
            console.warn(`[machines] machine ${id} moved to another computer (${currentData.host ?? '?'} -> ${incomingData.host ?? '?'})`)
        }

        const merged: Record<string, unknown> = { ...currentData }
        for (const key of RUNNER_REPORTED_KEYS) {
            if (incomingData[key] !== undefined) merged[key] = incomingData[key]
        }
        const changed = RUNNER_REPORTED_KEYS.some((key) => merged[key] !== currentData[key])
        if (changed) {
            this.writeMetadata(id, namespace, merged, stored.metadataVersion)
        }
        return { type: 'ok', machine: this.refreshMachine(id) ?? (() => { throw new Error('Failed to load machine') })() }
    }

    /** Name, role and env set from the web. Returns null when the machine does not exist in this namespace. */
    updateSettings(id: string, namespace: string, patch: MachineSettingsPatch): Machine | null {
        const stored = this.store.machines.getMachine(id)
        if (!stored || stored.namespace !== namespace) return null
        const current = machineMetadataSchema.safeParse(stored.metadata)
        const merged: Record<string, unknown> = { ...(current.success ? current.data : {}) }
        if (patch.displayName !== undefined) {
            const name = patch.displayName?.trim()
            if (name) merged.displayName = name
            else delete merged.displayName
        }
        if (patch.role !== undefined) merged.role = patch.role
        if (patch.env !== undefined) {
            if (Object.keys(patch.env).length > 0) merged.env = patch.env
            else delete merged.env
        }
        if (patch.repo !== undefined) {
            const repos: Record<string, string> = { ...(current.success ? current.data.repos : {}) }
            if (patch.repo.path) repos[patch.repo.key] = patch.repo.path
            else delete repos[patch.repo.key]
            if (Object.keys(repos).length > 0) merged.repos = repos
            else delete merged.repos
        }
        this.writeMetadata(id, namespace, merged, stored.metadataVersion)
        return this.refreshMachine(id)
    }

    private writeMetadata(id: string, namespace: string, metadata: Record<string, unknown>, expectedVersion: number): void {
        let result = this.store.machines.updateMachineMetadata(id, metadata, expectedVersion, namespace)
        if (result.result === 'version-mismatch') {
            result = this.store.machines.updateMachineMetadata(id, metadata, result.version, namespace)
        }
        if (result.result !== 'success') {
            throw new Error(`Failed to update machine ${id} metadata`)
        }
    }

    refreshMachine(machineId: string): Machine | null {
        const stored = this.store.machines.getMachine(machineId)
        if (!stored) {
            const existed = this.machines.delete(machineId)
            if (existed) {
                this.publisher.emit({ type: 'machine-updated', machineId, data: null })
            }
            return null
        }

        const existing = this.machines.get(machineId)

        const metadata = (() => {
            const parsed = machineMetadataSchema.safeParse(stored.metadata)
            if (!parsed.success) return null
            const data = parsed.data
            const host = typeof data.host === 'string' ? data.host : 'unknown'
            const platform = typeof data.platform === 'string' ? data.platform : 'unknown'
            const happyCliVersion = typeof data.happyCliVersion === 'string' ? data.happyCliVersion : 'unknown'
            const displayName = typeof data.displayName === 'string' ? data.displayName : undefined
            const homeDir = typeof data.homeDir === 'string' ? data.homeDir : undefined
            const happyHomeDir = typeof data.happyHomeDir === 'string' ? data.happyHomeDir : undefined
            const happyLibDir = typeof data.happyLibDir === 'string' ? data.happyLibDir : undefined
            return { host, platform, happyCliVersion, displayName, homeDir, happyHomeDir, happyLibDir, role: data.role, env: data.env, repos: data.repos }
        })()

        const storedActiveAt = stored.activeAt ?? stored.createdAt
        const existingActiveAt = existing?.activeAt ?? 0
        const useStoredActivity = storedActiveAt > existingActiveAt

        const machine: Machine = {
            id: stored.id,
            namespace: stored.namespace,
            seq: stored.seq,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            active: useStoredActivity ? stored.active : (existing?.active ?? stored.active),
            activeAt: useStoredActivity ? storedActiveAt : (existingActiveAt || storedActiveAt),
            metadata,
            metadataVersion: stored.metadataVersion,
            runnerState: stored.runnerState,
            runnerStateVersion: stored.runnerStateVersion,
            load: existing?.load ?? null
        }

        this.machines.set(machineId, machine)
        this.publisher.emit({ type: 'machine-updated', machineId, data: machine })
        return machine
    }

    reloadAll(): void {
        const machines = this.store.machines.getMachines()
        for (const machine of machines) {
            this.refreshMachine(machine.id)
        }
    }

    handleMachineAlive(payload: { machineId: string; time: number; load?: MachineLoad }): void {
        const t = clampAliveTime(payload.time)
        if (!t) return

        const machine = this.machines.get(payload.machineId) ?? this.refreshMachine(payload.machineId)
        if (!machine) return

        const wasActive = machine.active
        machine.active = true
        machine.activeAt = Math.max(machine.activeAt, t)
        machine.load = payload.load ?? null

        const now = Date.now()
        const lastBroadcastAt = this.lastBroadcastAtByMachineId.get(machine.id) ?? 0
        const shouldBroadcast = (!wasActive && machine.active) || (now - lastBroadcastAt > 10_000)
        if (shouldBroadcast) {
            this.lastBroadcastAtByMachineId.set(machine.id, now)
            this.publisher.emit({ type: 'machine-updated', machineId: machine.id, data: machine })
        }
    }

    expireInactive(now: number = Date.now()): void {
        for (const machine of this.machines.values()) {
            if (!machine.active) continue
            if (now - machine.activeAt <= MACHINE_TIMEOUT_MS) continue
            machine.active = false
            this.publisher.emit({ type: 'machine-updated', machineId: machine.id, data: { active: false } })
        }
    }
}
