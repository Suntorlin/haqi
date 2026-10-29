import { describe, expect, it } from 'bun:test'

import { Store } from '../store'
import { EmployeeService, type EmployeeHost } from './employeeService'

/**
 * Guards for the design decisions of the digital-employee module:
 * wake is serialized per employee, issues live in their own table with dedupe,
 * the write-back diff uses the generation snapshot as its baseline,
 * and every file operation goes to the employee's one machine — offline pauses it.
 */

type Harness = {
    service: EmployeeService
    store: Store
    files: Map<string, { content: string; mtimeMs: number }>
    fsCalls: string[]
    spawns: number
    setOnline: (online: boolean) => void
    slowSpawn: (ms: number) => void
}

function harness(): Harness {
    const store = new Store(':memory:')
    const files = new Map<string, { content: string; mtimeMs: number }>()
    const fsCalls: string[] = []
    let online = true
    let spawnDelay = 0
    let clock = 1_000_000
    const state = { spawns: 0 }
    const liveSessions = new Set<string>()

    const key = (machineId: string, home: string, path: string) => `${machineId}:${home}/${path}`
    const host: EmployeeHost = {
        machineOnline: () => online,
        spawn: async () => {
            state.spawns += 1
            if (spawnDelay > 0) await new Promise((resolve) => setTimeout(resolve, spawnDelay))
            liveSessions.add(`session-${state.spawns}`)
            return { sessionId: `session-${state.spawns}` }
        },
        resume: async () => null,
        send: async () => true,
        session: (_namespace, sessionId) => liveSessions.has(sessionId) ? { active: true, summaryText: null } : null,
        sessionEmployeeId: () => store.employees.listAll()[0]?.id ?? null,
        rename: async () => {},
        tag: async () => {},
        fs: {
            init: async (machineId, params) => { fsCalls.push(`init:${machineId}:${params.home}`) },
            read: async (machineId, params) => {
                fsCalls.push(`read:${machineId}:${params.path}`)
                const file = files.get(key(machineId, params.home, params.path))
                return file ? { exists: true, ...file } : { exists: false, content: '', mtimeMs: 0 }
            },
            write: async (machineId, params) => {
                fsCalls.push(`write:${machineId}:${params.path}`)
                clock += 1
                const slot = key(machineId, params.home, params.path)
                const existing = params.append ? files.get(slot)?.content ?? '' : ''
                files.set(slot, { content: existing + params.content, mtimeMs: clock })
                return { mtimeMs: clock }
            },
            stat: async (machineId, params) => {
                fsCalls.push(`stat:${machineId}:${params.path}`)
                const file = files.get(key(machineId, params.home, params.path))
                return file ? { exists: true, mtimeMs: file.mtimeMs } : { exists: false, mtimeMs: 0 }
            },
            list: async () => []
        },
        maintain: async () => ({}),
        changed: () => {},
        alert: async () => {},
        timezone: () => 'UTC'
    }
    const service = new EmployeeService(store, host)
    return {
        service,
        store,
        files,
        fsCalls,
        get spawns() { return state.spawns },
        setOnline: (value) => { online = value },
        slowSpawn: (ms) => { spawnDelay = ms }
    }
}

async function makeEmployee(h: Harness) {
    return await h.service.create('default', {
        name: 'Tester',
        machineId: 'machine-1',
        directory: '/tmp/work',
        agent: 'claude'
    })
}

describe('EmployeeService', () => {
    it('serializes concurrent wakes: two triggers end in one main session', async () => {
        const h = harness()
        const employee = await makeEmployee(h)
        h.slowSpawn(30)
        const [a, b] = await Promise.all([
            h.service.wake('default', employee.id, { source: 'test' }),
            h.service.wake('default', employee.id, { source: 'test' })
        ])
        // The first wake spawns; the second runs after it and reuses the stored main session (resume returns null,
        // session state is unknown, so it spawns only when there is no main session yet).
        expect(h.spawns).toBe(1)
        expect(a.sessionId).toBe(b.sessionId)
        expect(h.store.employees.get(employee.id, 'default')?.mainSessionId).toBe(a.sessionId)
    })

    it('keeps issues in their own table and dedupes by text: seen_count grows, no second row', async () => {
        const h = harness()
        const employee = await makeEmployee(h)
        await h.service.wake('default', employee.id, { source: 'test' })
        const first = await h.service.log('default', 'session-1', 'issue_open', 'baseline 没提交')
        const second = await h.service.log('default', 'session-1', 'issue_open', 'baseline 没提交')
        const open = h.store.employees.issues('default', employee.id, 'open')
        expect(open.length).toBe(1)
        expect(open[0].seenCount).toBe(2)
        expect(first.issue?.id).toBe(second.issue?.id)
        const closed = await h.service.log('default', 'session-1', 'issue_close', 'baseline 没提交')
        expect(closed.issue?.status).toBe('closed')
        expect(h.store.employees.issues('default', employee.id, 'open').length).toBe(0)
    })

    it('diffs the file against the generation snapshot: a deleted line archives, a new line is a pinned memory', async () => {
        const h = harness()
        const employee = await makeEmployee(h)
        const kept = h.store.memories.insert({
            namespace: 'default', text: '保留的事实', level: 'fact', scope: '', status: 'active', reason: null,
            source: 'propose', sourceLabel: null, sessionId: null, said: true, support: 1,
            jev: null, overridden: null, replaces: null, employeeId: employee.id
        })
        const dropped = h.store.memories.insert({
            namespace: 'default', text: '会被删掉的事实', level: 'fact', scope: '', status: 'active', reason: null,
            source: 'propose', sourceLabel: null, sessionId: null, said: true, support: 1,
            jev: null, overridden: null, replaces: null, employeeId: employee.id
        })
        const generated = await h.service.generateMemoryView('default', employee.id, 'test')
        expect(generated.content).toContain(kept.text)

        // The user edits the file: keeps one line (changed), deletes the other, writes a new one by hand.
        const edited = generated.content
            .replace(`- ${kept.text} <!-- m:${kept.id} -->`, `- 改过的事实 <!-- m:${kept.id} -->`)
            .replace(`- ${dropped.text} <!-- m:${dropped.id} -->\n`, '')
            .replace('## 经验', '## 经验\n- 用户手写的经验')
        h.files.set(`machine-1:${employee.homePath}/MEMORY.md`, { content: edited, mtimeMs: Date.now() + 10_000 })

        const result = await h.service.syncMemoryFile('default', employee.id)
        expect(result).toEqual({ state: 'synced', updated: 1, archived: 1, added: 1, closedIssues: 0 })
        expect(h.store.memories.get(kept.id, 'default')?.text).toBe('改过的事实')
        expect(h.store.memories.get(dropped.id, 'default')?.status).toBe('archived')
        const handwritten = h.store.memories.list('default').find((m) => m.text === '用户手写的经验')
        expect(handwritten?.pinned).toBe(true)
        expect(handwritten?.level).toBe('experience')
        expect(handwritten?.employeeId).toBe(employee.id)

        // The next generation renders from the database, so the user's version stays.
        const regenerated = await h.service.generateMemoryView('default', employee.id, 'test')
        expect(regenerated.content).toContain('改过的事实')
        expect(regenerated.content).toContain('用户手写的经验')
        expect(regenerated.content).not.toContain('会被删掉的事实')
    })

    it('routes every file operation to the one machine and pauses when it is offline', async () => {
        const h = harness()
        const employee = await makeEmployee(h)
        await h.service.generateMemoryView('default', employee.id, 'test')
        expect(h.fsCalls.every((call) => call.includes('machine-1'))).toBe(true)

        h.setOnline(false)
        const before = h.fsCalls.length
        expect(await h.service.syncMemoryFile('default', employee.id)).toEqual({ state: 'offline' })
        await expect(h.service.consolidate('default', employee.id)).rejects.toThrow('不在线')
        await expect(h.service.generateMemoryView('default', employee.id, 'test')).rejects.toThrow('不在线')
        // Offline means paused, not rerouted: no file call reached any machine.
        expect(h.fsCalls.length).toBe(before)

        h.setOnline(true)
        const resumed = await h.service.syncMemoryFile('default', employee.id)
        expect(resumed.state).toBe('unchanged')
    })
})
