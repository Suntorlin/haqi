import { afterEach, describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SSEManager } from '../sse/sseManager'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { SyncEngine } from './syncEngine'

const cleanups: Array<() => void> = []

afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
})

function createHarness() {
    const store = new Store(':memory:')
    const sseManager = new SSEManager(0, new VisibilityTracker())
    const engine = new SyncEngine(store, {} as Server, new RpcRegistry(), sseManager)
    cleanups.push(() => {
        engine.stop()
        sseManager.stop()
    })
    const internals = engine as unknown as Record<string, unknown>
    ;(internals.machineCache as { getOnlineMachinesByNamespace: () => unknown[] }).getOnlineMachinesByNamespace =
        () => [{ id: 'machine-1', metadata: { host: 'dev' } }]
    const rpcCalls: unknown[][] = []
    // A resume reuses the same hub session id, so no merge is needed.
    const spawnedSessionId = { value: '' }
    ;(internals.rpcGateway as { spawnSession: (...args: unknown[]) => Promise<unknown> }).spawnSession = async (...args) => {
        rpcCalls.push(args)
        return { type: 'success', sessionId: spawnedSessionId.value }
    }
    return { engine, store, rpcCalls, internals, spawnedSessionId }
}

// rpcGateway.spawnSession positional args: model = 3, thinkEffort = 4, serviceTier = 5, yolo = 6, resumeSessionId = 9
describe('SyncEngine.resumeSession settings', () => {
    it('wakes a session with the model, effort and YOLO it was started with', async () => {
        const { engine, store, rpcCalls, internals, spawnedSessionId } = createHarness()
        const session = store.sessions.getOrCreateSession(
            'old-session',
            { path: '/repo', host: 'dev', machineId: 'machine-1', flavor: 'claude', claudeSessionId: 'native-id', model: 'claude-opus-5-5', thinkEffort: 'high' },
            null,
            'default'
        )
        ;(internals.sessionCache as { applySessionConfig: (id: string, c: unknown) => void }).applySessionConfig(
            session.id,
            { permissionMode: 'bypassPermissions' }
        )
        spawnedSessionId.value = session.id
        internals.waitForSessionActive = async () => true

        const result = await engine.resumeSession(session.id, 'default')

        expect(result.type).toBe('success')
        expect(rpcCalls).toHaveLength(1)
        expect(rpcCalls[0]![3]).toBe('claude-opus-5-5')
        expect(rpcCalls[0]![4]).toBe('high')
        expect(rpcCalls[0]![6]).toBe(true)
        expect(rpcCalls[0]![9]).toBe('native-id')
    })

    it('does not turn YOLO on for a session that was not in YOLO', async () => {
        const { engine, store, rpcCalls, internals, spawnedSessionId } = createHarness()
        const session = store.sessions.getOrCreateSession(
            'plain-session',
            { path: '/repo', host: 'dev', machineId: 'machine-1', flavor: 'claude' },
            null,
            'default'
        )
        spawnedSessionId.value = session.id
        internals.waitForSessionActive = async () => true

        await engine.resumeSession(session.id, 'default')

        expect(rpcCalls[0]![6]).toBeUndefined()
    })
})

describe('SyncEngine.spawnSession YOLO', () => {
    it('records the requested YOLO on the new session before the agent reports it', async () => {
        const { engine, store, internals } = createHarness()
        const created = store.sessions.getOrCreateSession(
            'new-session',
            { path: '/repo', host: 'dev', machineId: 'machine-1', flavor: 'claude' },
            null,
            'default'
        )
        ;(internals.rpcGateway as { spawnSession: (...args: unknown[]) => Promise<unknown> }).spawnSession =
            async () => ({ type: 'success', sessionId: created.id })

        await engine.spawnSession('machine-1', '/repo', 'claude', undefined, undefined, undefined, true)

        expect(engine.getSession(created.id)?.permissionMode).toBe('bypassPermissions')
    })
})
