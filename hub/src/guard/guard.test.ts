import { describe, expect, it } from 'bun:test'

import { Store } from '../store'
import { GUARD, nextGuard, type GuardState } from './guard'
import { GuardService, selectRules } from './guardService'

describe('nextGuard', () => {
    const violation = (memoryId: string, yes = 0.9) => ({ memoryId, text: `规则 ${memoryId}`, yes })
    const clean = { violations: [], corrected: false }

    it('one violation turns the light yellow, the same rule again turns it red', () => {
        const first = nextGuard(null, { violations: [violation('m1')], corrected: false })
        expect(first.status).toBe('warn')
        expect(first.reason).toContain('违反了')
        expect(first.strikes.m1).toBe(1)

        const second = nextGuard(first, { violations: [violation('m1')], corrected: false })
        expect(second.status).toBe('alert')
        expect(second.reason).toContain('第 2 次')
        expect(second.memoryId).toBe('m1')
    })

    it('a correction turns green to yellow and holds an alert', () => {
        const corrected = nextGuard(null, { violations: [], corrected: true })
        expect(corrected.status).toBe('warn')

        const alert: GuardState = { status: 'alert', reason: '又违反了', memoryId: 'm1', strikes: { m1: 2 }, cleanStreak: 2 }
        const held = nextGuard(alert, { violations: [], corrected: true })
        expect(held.status).toBe('alert')
        expect(held.cleanStreak).toBe(0)
    })

    it('a clean turn clears a warn at once; an alert needs the full clean streak and then resets the strikes', () => {
        const warn = nextGuard(null, { violations: [violation('m1')], corrected: false })
        expect(nextGuard(warn, clean).status).toBe('ok')

        let state: GuardState = { status: 'alert', reason: '又违反了', memoryId: 'm1', strikes: { m1: 2 }, cleanStreak: 0 }
        for (let i = 1; i < GUARD.forgiveAfter; i++) {
            state = nextGuard(state, clean)
            expect(state.status).toBe('alert')
        }
        state = nextGuard(state, clean)
        expect(state.status).toBe('ok')
        expect(state.strikes).toEqual({})
    })

    it('a new violation while on alert keeps the light red', () => {
        const alert: GuardState = { status: 'alert', reason: '又违反了', memoryId: 'm1', strikes: { m1: 2 }, cleanStreak: 1 }
        const next = nextGuard(alert, { violations: [violation('m2')], corrected: false })
        expect(next.status).toBe('alert')
        expect(next.strikes).toEqual({ m1: 2, m2: 1 })
    })
})

function makeUserMessage(text: string): unknown {
    return { role: 'user', content: { type: 'text', text } }
}

function makeAgentTextMessage(text: string): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }
        }
    }
}

function insertPrinciple(store: Store, text: string, extra: Partial<Parameters<Store['memories']['insert']>[0]> = {}) {
    return store.memories.insert({
        namespace: 'default', text, level: 'principle', scope: '', status: 'active', reason: null,
        source: 'propose', sourceLabel: null, sessionId: null, said: true, support: 1,
        jev: null, overridden: null, replaces: null, ...extra
    })
}

/** A fake Jev: every rule question answers `violate`, the classifier question answers `klass`. */
function fakeJev(calls: string[], answer: () => { violate: number; klass: string }): typeof fetch {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> }
        const keys = Object.keys(body.questions)
        calls.push(keys.join(','))
        const current = answer()
        const answers: Record<string, unknown> = {}
        for (const key of keys) {
            answers[key] = key === 'why'
                ? { type: 'choice', choice: current.klass, probabilities: { [current.klass]: 0.9 }, confidence: 0.9 }
                : { type: 'noul', noul: current.violate }
        }
        return new Response(JSON.stringify({ answers, usage: { cost: 0.0001 }, model: 'jev-test' }), { status: 200 })
    }) as typeof fetch
}

describe('selectRules', () => {
    it('keeps only active principles of the project, project-scoped first, capped', () => {
        const store = new Store(':memory:')
        insertPrinciple(store, '全局原则')
        insertPrinciple(store, '本项目原则', { scope: 'haqi', support: 1 })
        insertPrinciple(store, '别的项目的原则', { scope: 'other' })
        insertPrinciple(store, '只是经验', { level: 'experience' })
        insertPrinciple(store, '还没转正', { status: 'candidate' })

        const rules = selectRules(store.memories.list('default'), 'haqi')
        expect(rules.map((rule) => rule.text)).toEqual(['本项目原则', '全局原则'])
    })
})

describe('GuardService.check', () => {
    const previousKey = process.env.JEV_API_KEY

    function setup(answer: () => { violate: number; klass: string }) {
        process.env.JEV_API_KEY = 'test-key'
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('guard-test', {}, null, 'default')
        const memory = insertPrinciple(store, '所有输出用中文')
        const calls: string[] = []
        const changes: string[] = []
        const service = new GuardService(store, {
            jevKey: async () => 'test-key',
            onChange: (sessionId) => changes.push(sessionId),
            fetchFn: fakeJev(calls, answer)
        })
        return { store, session, memory, service, calls, changes }
    }

    it('checks the newest turn once, stores the light, and does not pay for the same turn twice', async () => {
        const { store, session, memory, service, calls, changes } = setup(() => ({ violate: 0.9, klass: 'request' }))
        store.messages.addMessage(session.id, makeUserMessage('写个函数'))
        store.messages.addMessage(session.id, makeAgentTextMessage('Here is the function, in English.'))

        await service.check(session.id)
        const guard = store.guards.get(session.id)
        expect(guard?.status).toBe('warn')
        expect(guard?.memoryId).toBe(memory.id)
        expect(guard?.checkedTurns).toBe(1)
        expect(guard?.costUsd).toBeGreaterThan(0)
        expect(changes).toEqual([session.id])

        const callsBefore = calls.length
        await service.check(session.id)
        expect(calls.length).toBe(callsBefore)
        expect(store.guards.get(session.id)?.checkedTurns).toBe(1)

        // The same rule broken in the next turn turns the light red.
        store.messages.addMessage(session.id, makeUserMessage('再写一个'))
        store.messages.addMessage(session.id, makeAgentTextMessage('Another one, still in English.'))
        await service.check(session.id)
        expect(store.guards.get(session.id)?.status).toBe('alert')
        if (previousKey === undefined) delete process.env.JEV_API_KEY
        else process.env.JEV_API_KEY = previousKey
    })

    it('a clean turn with a correcting user message turns the light yellow and stores the class', async () => {
        const { store, session, service } = setup(() => ({ violate: 0.1, klass: 'correction' }))
        store.messages.addMessage(session.id, makeUserMessage('不对，你改错文件了'))
        store.messages.addMessage(session.id, makeAgentTextMessage('抱歉，已经改回来了。'))

        await service.check(session.id)
        const guard = store.guards.get(session.id)
        expect(guard?.status).toBe('warn')
        expect(guard?.reason).toContain('纠正')

        const turn = store.turns.getTurns(session.id, 1).at(-1)!
        expect(store.messageClasses.has(turn.userMessageId!)).toBe(true)
        if (previousKey === undefined) delete process.env.JEV_API_KEY
        else process.env.JEV_API_KEY = previousKey
    })
})
