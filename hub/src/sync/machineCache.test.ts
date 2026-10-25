import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { MachineCache, machineEnvSchema } from './machineCache'

function createCache() {
    const events: SyncEvent[] = []
    const publisher = { emit: (event: SyncEvent) => events.push(event) } as unknown as EventPublisher
    return new MachineCache(new Store(':memory:'), publisher)
}

const reported = (overrides: Record<string, string> = {}) => ({
    host: 'laptop.local',
    platform: 'darwin',
    happyCliVersion: '1.0.0',
    homeDir: '/Users/me',
    happyHomeDir: '/Users/me/.hapi',
    happyLibDir: '/Users/me/haqi/cli',
    fingerprint: 'aaaa',
    ...overrides
})

describe('MachineCache.registerRunner', () => {
    it('refreshes what the runner reports and keeps the name, role and env set from the web', () => {
        const cache = createCache()
        cache.registerRunner('m1', reported(), null, 'default')
        cache.updateSettings('m1', 'default', { displayName: 'Desk Mac', role: 'portable', env: { TEST_DB_URL: 'mongodb://db' } })

        const result = cache.registerRunner('m1', reported({ host: 'new-name.local', happyCliVersion: '2.0.0' }), null, 'default')

        expect(result.type).toBe('ok')
        const metadata = result.type === 'ok' ? result.machine.metadata : null
        expect(metadata?.host).toBe('new-name.local')
        expect(metadata?.happyCliVersion).toBe('2.0.0')
        expect(metadata?.displayName).toBe('Desk Mac')
        expect(metadata?.role).toBe('portable')
        expect(metadata?.env).toEqual({ TEST_DB_URL: 'mongodb://db' })
    })

    it('refuses a second computer with the same machine id while the first one is online', () => {
        const cache = createCache()
        cache.registerRunner('m1', reported(), null, 'default')
        cache.handleMachineAlive({ machineId: 'm1', time: Date.now() })

        const result = cache.registerRunner('m1', reported({ fingerprint: 'bbbb', host: 'other.local' }), null, 'default')

        expect(result).toEqual({ type: 'conflict', host: 'laptop.local', happyHomeDir: '/Users/me/.hapi' })
    })

    it('lets the same computer re-register, and lets the id move when the first computer is offline', () => {
        const cache = createCache()
        cache.registerRunner('m1', reported(), null, 'default')
        cache.handleMachineAlive({ machineId: 'm1', time: Date.now() })
        expect(cache.registerRunner('m1', reported(), null, 'default').type).toBe('ok')

        cache.expireInactive(Date.now() + 60_000)
        const moved = cache.registerRunner('m1', reported({ fingerprint: 'bbbb', host: 'other.local' }), null, 'default')
        expect(moved.type).toBe('ok')
        expect(moved.type === 'ok' ? moved.machine.metadata?.host : null).toBe('other.local')
    })
})

describe('MachineCache.updateSettings', () => {
    it('clears the name and env when given empty values', () => {
        const cache = createCache()
        cache.registerRunner('m1', reported(), null, 'default')
        cache.updateSettings('m1', 'default', { displayName: 'Desk Mac', env: { A: '1' } })

        const machine = cache.updateSettings('m1', 'default', { displayName: '  ', env: {} })

        expect(machine?.metadata?.displayName).toBeUndefined()
        expect(machine?.metadata?.env).toBeUndefined()
        expect(machine?.metadata?.host).toBe('laptop.local')
    })

    it('returns null for a machine in another namespace', () => {
        const cache = createCache()
        cache.registerRunner('m1', reported(), null, 'default')
        expect(cache.updateSettings('m1', 'other', { role: 'portable' })).toBeNull()
    })
})

describe('machineEnvSchema', () => {
    it('rejects variables the runner owns', () => {
        expect(machineEnvSchema.safeParse({ TEST_MONGO_CONNECTION_URL: 'mongodb://db' }).success).toBe(true)
        expect(machineEnvSchema.safeParse({ HAPI_HOME: '/tmp' }).success).toBe(false)
        expect(machineEnvSchema.safeParse({ CLAUDE_CONFIG_DIR: '/tmp' }).success).toBe(false)
        expect(machineEnvSchema.safeParse({ 'lower-case': 'x' }).success).toBe(false)
    })
})
