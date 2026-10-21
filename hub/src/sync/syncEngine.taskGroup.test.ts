import { afterEach, describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SSEManager } from '../sse/sseManager'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { TASK_EVENT } from '../tasks/kernel/events'
import { SyncEngine } from './syncEngine'

const engines: Array<{ engine: SyncEngine; sse: SSEManager }> = []

function createEngine() {
    const store = new Store(':memory:')
    const sse = new SSEManager(0, new VisibilityTracker())
    const engine = new SyncEngine(store, {} as Server, new RpcRegistry(), sse)
    engines.push({ engine, sse })
    return { store, engine }
}

afterEach(() => {
    for (const { engine, sse } of engines.splice(0)) {
        engine.stop()
        sse.stop()
    }
})

describe('task groups in the group pages', () => {
    it('lists task groups with the chat groups', async () => {
        const { engine } = createEngine()
        await engine.createGroup({ namespace: 'default', name: 'chat' })
        const task = engine.getTaskService().kernel.create('default', { name: 'task', tag: 'haqi', repoPath: null, machineId: null })
        expect(engine.getGroupsByNamespace('default').map((g) => [g.group.name, g.group.kind]).sort()).toEqual([['chat', 'chat'], ['task', 'task']])
        expect(task.kind).toBe('task')
    })

    it('sends what the user says in a guiding task group to the planner as a change request', async () => {
        const { store, engine } = createEngine()
        const tasks = engine.getTaskService()
        const task = tasks.kernel.create('default', { name: 'task', tag: 'haqi', repoPath: null, machineId: null })

        await engine.addGroupMessage({ groupId: task.id, namespace: 'default', type: 'chat', payload: { text: '再加一条：不推送' } })
        await tasks.whenIdle()
        expect((store.taskEvents.latest('default', task.id, TASK_EVENT.draftReviseRequested)?.payload as { text: string }).text).toBe('再加一条：不推送')

        // A command, or a line from a session, is not the user asking for a change.
        await engine.addGroupMessage({ groupId: task.id, namespace: 'default', type: 'command', payload: { text: '@all 看一下' } })
        await engine.addGroupMessage({ groupId: task.id, namespace: 'default', type: 'chat', payload: { text: '我是会话' }, actorSessionId: 's1', source: 'session:s1' })
        expect(tasks.kernel.count('default', task.id, TASK_EVENT.draftReviseRequested)).toBe(1)

        // After the guide step, chat in the group is only chat.
        tasks.kernel.move('default', task.id, 'active')
        await engine.addGroupMessage({ groupId: task.id, namespace: 'default', type: 'chat', payload: { text: '开工吧' } })
        expect(tasks.kernel.count('default', task.id, TASK_EVENT.draftReviseRequested)).toBe(1)
    })
})
