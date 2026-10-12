import { afterEach, describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SSEManager } from '../sse/sseManager'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { SyncEngine } from './syncEngine'

type SpawnArgs = unknown[]

const cleanups: Array<() => void> = []

afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.()
})

function createDuplicateHarness(claudeAccount?: { id: string; automatic: boolean }) {
    const store = new Store(':memory:')
    const sseManager = new SSEManager(0, new VisibilityTracker())
    const engine = new SyncEngine(store, {} as Server, new RpcRegistry(), sseManager)
    cleanups.push(() => {
        engine.stop()
        sseManager.stop()
    })

    const source = store.sessions.getOrCreateSession(
        'source-session',
        {
            path: '/repo/work',
            host: 'dev',
            machineId: 'machine-1',
            flavor: 'claude',
            claudeSessionId: 'native-claude-id',
            ...(claudeAccount ? {
                claudeAccount: { ...claudeAccount, email: 'a@example.com', status: 'active', updatedAt: 1 }
            } : {})
        },
        null,
        'default'
    )

    const spawnCalls: SpawnArgs[] = []
    const internals = engine as unknown as Record<string, unknown>
    ;(internals.machineCache as { getOnlineMachinesByNamespace: () => unknown[] }).getOnlineMachinesByNamespace =
        () => [{ id: 'machine-1', metadata: { host: 'dev' } }]
    internals.spawnSession = async (...args: SpawnArgs) => {
        spawnCalls.push(args)
        return { type: 'success', sessionId: 'new-session' }
    }
    internals.waitForSessionAvailable = async () => true
    ;(internals.sessionCache as { copySessionHistory: () => Promise<void> }).copySessionHistory = async () => {}
    ;(internals.sessionCache as { renameSession: () => Promise<void> }).renameSession = async () => {}

    return { engine, sourceId: source.id, spawnCalls }
}

// spawnSession positional args: resumeSessionId = 9, claudeAccount = 11, sourceClaudeAccountId = 12
describe('SyncEngine.spawnSessionFromExisting Claude account', () => {
    it('resumes under the source session account so the transcript is found', async () => {
        const { engine, sourceId, spawnCalls } = createDuplicateHarness({ id: 'account-a', automatic: true })

        const result = await engine.spawnSessionFromExisting(sourceId, 'default', { inheritHistory: true })

        expect(result.type).toBe('success')
        expect(spawnCalls).toHaveLength(1)
        expect(spawnCalls[0][9]).toBe('native-claude-id')
        expect(spawnCalls[0][11]).toEqual({ accountId: 'account-a', automatic: true })
        expect(spawnCalls[0][12]).toBe('account-a')
    })

    it('does not pin an account when the source has none or history is not inherited', async () => {
        const noAccount = createDuplicateHarness()
        await noAccount.engine.spawnSessionFromExisting(noAccount.sourceId, 'default', { inheritHistory: true })
        expect(noAccount.spawnCalls[0][11]).toBeUndefined()

        const noHistory = createDuplicateHarness({ id: 'account-a', automatic: false })
        await noHistory.engine.spawnSessionFromExisting(noHistory.sourceId, 'default', { inheritHistory: false })
        expect(noHistory.spawnCalls[0][9]).toBeUndefined()
        expect(noHistory.spawnCalls[0][11]).toBeUndefined()
    })
})
