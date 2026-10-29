import { describe, expect, it } from 'bun:test'

import { Store } from '../store'
import { agentAnswer, GUARD, nextGuard, type GuardState } from './guard'
import { GuardService, selectRules } from './guardService'

describe('nextGuard', () => {
    const violation = (memoryId: string, yes = 0.9) => ({ memoryId, text: `规则 ${memoryId}`, yes })
    const clean = { violations: [], corrected: false }
    const broke = (memoryId: string) => ({ violations: [violation(memoryId)], corrected: false })

    it('one violation turns the light yellow; the same rule broken alertStrikes times in the window turns it red', () => {
        let state = nextGuard(null, broke('m1'), 1)
        expect(state.status).toBe('warn')
        expect(state.reason).toContain('违反了')
        expect(state.strikes.m1).toEqual([1])

        for (let turn = 2; turn <= GUARD.alertStrikes; turn++) state = nextGuard(state, broke('m1'), turn)
        expect(state.status).toBe('alert')
        expect(state.reason).toContain(`${GUARD.alertStrikes} 次`)
        expect(state.memoryId).toBe('m1')
    })

    it('different rules broken once each stay yellow', () => {
        let state = nextGuard(null, broke('m1'), 1)
        state = nextGuard(state, broke('m2'), 2)
        state = nextGuard(state, broke('m3'), 3)
        expect(state.status).toBe('warn')
    })

    it('an alert holds on clean turns while the strikes stay in the window, then clears by itself', () => {
        let state: GuardState | null = null
        for (let turn = 1; turn <= GUARD.alertStrikes; turn++) state = nextGuard(state, broke('m1'), turn)
        const ruleTexts = { m1: '规则 m1' }

        let turn = GUARD.alertStrikes + 1
        state = nextGuard(state, { ...clean, ruleTexts }, turn)
        expect(state.status).toBe('alert')
        expect(state.reason).toContain('规则 m1')

        // The first strike leaves the window once `window` turns have passed since it.
        while (turn < GUARD.window + 1) state = nextGuard(state, { ...clean, ruleTexts }, ++turn)
        expect(state.status).toBe('ok')
        expect(state.strikes.m1?.length).toBe(GUARD.alertStrikes - 1)
    })

    it('strikes spread wider than the window never turn the light red', () => {
        let state: GuardState | null = null
        for (let i = 0; i < 10; i++) state = nextGuard(state, broke('m1'), 1 + i * GUARD.window)
        expect(state!.status).toBe('warn')
    })

    it('a correction turns green to yellow but does not make red', () => {
        const corrected = nextGuard(null, { violations: [], corrected: true }, 1)
        expect(corrected.status).toBe('warn')
        expect(corrected.reason).toContain('纠正')
        expect(corrected.cleanStreak).toBe(0)
        expect(nextGuard(corrected, clean, 2).status).toBe('ok')
    })
})

describe('agentAnswer', () => {
    it('drops the CLI event lines and keeps the agent words', () => {
        expect(agentAnswer('改好了，测试全过。\n账号已核验：a@b.c；自动切换开启')).toBe('改好了，测试全过。')
    })

    it('has nothing to judge in an aborted turn or a usage-limit notice', () => {
        expect(agentAnswer("I'll count how often it fires. Aborted by user")).toBe("I'll count how often it fires. Aborted by user")
        expect(agentAnswer("I'll count how often it fires.\nAborted by user")).toBeNull()
        expect(agentAnswer("You've hit your weekly limit · resets Oct 31 at 4pm\n账号已核验：a@b.c；自动切换开启")).toBeNull()
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

/** A fake Jev: every rule question answers `violate` (`applies` when given), the classifier question answers `klass`. */
function fakeJev(calls: string[], answer: () => { violate: number; applies?: number; klass: string }): typeof fetch {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> }
        const keys = Object.keys(body.questions)
        calls.push(keys.join(','))
        const current = answer()
        const answers: Record<string, unknown> = {}
        for (const key of keys) {
            answers[key] = key === 'why'
                ? { type: 'choice', choice: current.klass, probabilities: { [current.klass]: 0.9 }, confidence: 0.9 }
                : { type: 'noul', noul: key.startsWith('applies') ? current.applies ?? current.violate : current.violate }
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

    function setup(answer: () => { violate: number; applies?: number; klass: string }) {
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

        // The same rule broken again in the next turns turns the light red.
        for (let i = 1; i < GUARD.alertStrikes; i++) {
            store.messages.addMessage(session.id, makeUserMessage(`再写一个 ${i}`))
            store.messages.addMessage(session.id, makeAgentTextMessage(`Another one ${i}, still in English.`))
            await service.check(session.id)
        }
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

    it('a rule Jev says does not apply to the turn is no violation', async () => {
        const { store, session, service } = setup(() => ({ violate: 0.95, applies: 0.2, klass: 'request' }))
        store.messages.addMessage(session.id, makeUserMessage('写个函数'))
        store.messages.addMessage(session.id, makeAgentTextMessage('写好了。'))

        await service.check(session.id)
        expect(store.guards.get(session.id)?.status).toBe('ok')
        if (previousKey === undefined) delete process.env.JEV_API_KEY
        else process.env.JEV_API_KEY = previousKey
    })

    it('a turn that only carries a usage-limit notice is not sent to Jev', async () => {
        const { store, session, service, calls } = setup(() => ({ violate: 0.95, klass: 'request' }))
        store.messages.addMessage(session.id, makeUserMessage('继续'))
        store.messages.addMessage(session.id, makeAgentTextMessage("You've hit your weekly limit · resets Oct 31 at 4pm"))

        await service.check(session.id)
        expect(calls.length).toBe(0)
        expect(store.guards.get(session.id)).toBeNull()
        if (previousKey === undefined) delete process.env.JEV_API_KEY
        else process.env.JEV_API_KEY = previousKey
    })
})
