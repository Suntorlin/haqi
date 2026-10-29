import { describe, expect, it } from 'bun:test'
import type { TaskSignal, TaskSubtask } from '@hapi/protocol/types'
import { OBSERVER_LIMITS, observe, type WatchedSession } from './observer'

const subtask: TaskSubtask = {
    id: 'api', title: '接口', brief: '', criteria: [], dependsOn: [], fix: false, state: 'running', sessionId: 's1', branch: 'hapi-x', summary: null, startedAt: 0, doneAt: null
}
const now = 100 * 60_000
const base: WatchedSession = { subtask, active: true, thinking: false, lastMessageAt: now - 60_000, pendingRequests: [], newCommands: [] }
const signal = (key: string, kind: TaskSignal['kind'], sessionId = 's1'): TaskSignal => ({ key, kind, text: '', sessionId, at: 0, notified: false })

describe('observer', () => {
    it('stays quiet while the session works', () => {
        expect(observe([base], [], now)).toEqual([])
        expect(observe([{ ...base, thinking: true, lastMessageAt: 0 }], [], now)).toEqual([])
    })

    it('tells the user about an approval, and clears it once answered', () => {
        const actions = observe([{ ...base, pendingRequests: [{ id: 'r1', tool: 'Bash', detail: 'rm -rf build' }] }], [], now)
        expect(actions).toMatchObject([{ type: 'signal', notify: true, signal: { key: 'approval:r1', kind: 'approval' } }])
        expect(observe([base], [signal('approval:r1', 'approval')], now)).toEqual([{ type: 'clear', key: 'approval:r1' }])
    })

    it('flags a push or a deploy, once', () => {
        const actions = observe([{ ...base, newCommands: ['npm test', 'git push origin hapi-x'] }], [], now)
        expect(actions).toMatchObject([{ type: 'signal', notify: true, signal: { kind: 'danger' } }])
        const key = (actions[0] as { signal: { key: string } }).signal.key
        expect(observe([{ ...base, newCommands: ['git push'] }], [signal(key, 'danger')], now)).toEqual([])
    })

    it('marks a stopped session', () => {
        expect(observe([{ ...base, active: false }], [], now)).toMatchObject([
            { type: 'state', subtaskId: 'api', state: 'stopped' },
            { type: 'signal', notify: true, signal: { key: 'stopped:api', kind: 'stopped' } }
        ])
    })

    it('reminds a silent executor first, and tells the user only if it stays silent', () => {
        const silent = { ...base, lastMessageAt: now - OBSERVER_LIMITS.silentRemindMs - 1 }
        expect(observe([silent], [], now)).toMatchObject([{ type: 'remind' }, { type: 'signal', notify: false, signal: { kind: 'reminded' } }])
        expect(observe([silent], [signal('reminded:api', 'reminded')], now)).toEqual([])
        const stuck = { ...base, lastMessageAt: now - OBSERVER_LIMITS.silentStuckMs - 1 }
        expect(observe([stuck], [signal('reminded:api', 'reminded')], now)).toMatchObject([
            { type: 'state', state: 'stuck' },
            { type: 'signal', notify: true, signal: { key: 'stuck:api', kind: 'stuck' } }
        ])
        // It moves again: the stuck mark goes.
        expect(observe([{ ...base, subtask: { ...subtask, state: 'stuck' } }], [signal('reminded:api', 'reminded'), signal('stuck:api', 'stuck')], now)).toEqual([
            { type: 'state', subtaskId: 'api', state: 'running' },
            { type: 'clear', key: 'stuck:api' },
            { type: 'clear', key: 'reminded:api' }
        ])
    })

    it('does not remind a session its quota refuses; tells the user once the account switch had its time', () => {
        const refused = { ...base, lastMessageAt: now - OBSERVER_LIMITS.silentRemindMs - 1, quota: { text: "You've hit your weekly limit · resets Oct 31 at 4pm", at: now - 60_000 } }
        // Within the grace: the session may still be moving to the next account.
        expect(observe([refused], [], now)).toEqual([])
        const late = { ...refused, quota: { ...refused.quota, at: now - OBSERVER_LIMITS.quotaGraceMs } }
        expect(observe([late], [], now)).toMatchObject([
            { type: 'state', subtaskId: 'api', state: 'stuck' },
            { type: 'signal', notify: true, signal: { key: 'quota:api', kind: 'stuck' } }
        ])
        expect(observe([{ ...late, subtask: { ...subtask, state: 'stuck' } }], [signal('quota:api', 'stuck')], now)).toEqual([])
        // Another account took over and it works again.
        expect(observe([{ ...base, subtask: { ...subtask, state: 'stuck' } }], [signal('quota:api', 'stuck')], now)).toEqual([
            { type: 'clear', key: 'quota:api' },
            { type: 'state', subtaskId: 'api', state: 'running' }
        ])
    })
})
