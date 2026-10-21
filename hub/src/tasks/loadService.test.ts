import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'

import { Store } from '../store'
import { LoadService } from './loadService'
import { percentiles } from './plugins/classifier/classifier'

/** A fake Jev that classifies by keywords; "boom" fails like a Jev error. */
function fakeJev(seen: Array<Record<string, unknown>>): typeof fetch {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { state: { message: string; task_goal: string } }
        seen.push(body.state)
        const message = body.state.message
        if (message.includes('boom')) return new Response('down', { status: 503 })
        const choice = message.includes('好了吗') ? 'progress' : message.includes('不对') ? 'correction' : message.includes('可以') ? 'decision' : 'request'
        return new Response(JSON.stringify({ answers: { why: { type: 'choice', choice, probabilities: {}, confidence: 0.8 } }, usage: { cost: 0.00006 } }), { status: 200 })
    }) as typeof fetch
}

function seed(store: Store, rows: Array<{ session: string; text: string; meta?: Record<string, unknown>; at: number }>): void {
    const db = (store as unknown as { db: Database }).db
    const sessions = new Set(rows.map((row) => row.session))
    for (const id of sessions) {
        db.prepare("INSERT INTO sessions (id, tag, namespace, created_at, updated_at, metadata, metadata_version, agent_state_version, active, active_at, seq) VALUES (?, NULL, 'default', 0, 0, '{}', 1, 1, 0, 0, 0)").run(id)
    }
    for (const row of rows) {
        const message = store.messages.addMessage(row.session, { role: 'user', content: { type: 'text', text: row.text }, meta: row.meta ?? { sentFrom: 'webapp' } })
        // Storing a user message opens its turn; move the turn to the wanted time.
        db.prepare('UPDATE conversation_turns SET created_at = ? WHERE user_message_id = ?').run(row.at, message.id)
    }
}

describe('LoadService', () => {
    it('classifies only what the user typed, retries failures, and adds up per task and per session', async () => {
        const store = new Store(':memory:')
        const now = Date.now()
        seed(store, [
            { session: 's1', text: '帮我加一个导出按钮', at: now - 3000 },
            { session: 's1', text: '做好了吗，进展怎么样', at: now - 2000 },
            { session: 's1', text: '这个不对，按钮放错地方了', at: now - 1000 },
            { session: 's2', text: '可以，按方案 2 来', at: now - 900 },
            { session: 's2', text: '[SYSTEM] You are in a ReviewLoop (loop=l, round=r). Execute.', at: now - 800 },
            { session: 's2', text: '路由注入的消息不算', meta: { routeContext: { groupId: 'g' } }, at: now - 700 },
            { session: 's2', text: 'boom 这条 Jev 会失败', at: now - 600 }
        ])
        const seen: Array<Record<string, unknown>> = []
        const service = new LoadService(store, {
            jevKey: async () => 'test-key',
            goals: () => new Map([['s1', '导出功能']]),
            fetchFn: fakeJev(seen)
        })
        const run = await service.classifyRecent()
        expect([run.classified, run.failed]).toEqual([4, 1])
        expect(seen.find((state) => state.message === '帮我加一个导出按钮')?.task_goal).toBe('导出功能')
        expect(seen.some((state) => String(state.message).includes('ReviewLoop') || String(state.message).includes('路由注入'))).toBe(false)

        expect(service.taskLoad('default', ['s1'], now - 10_000)).toEqual({ progress: 1, correction: 1, decision: 0, request: 1 })
        expect(service.taskLoad('default', ['nobody'], 0)).toBeNull()

        const again = await service.classifyRecent()
        expect([again.classified, again.failed]).toEqual([0, 1])

        const report = service.report('default', 30)
        expect(report.messages).toBe(4)
        expect(report.byClass).toEqual({ progress: 1, correction: 1, decision: 1, request: 1 })
        expect(report.sessions).toBe(2)
        expect(report.perSession.load).toEqual({ median: 1, p75: 2, p90: 2 })
        expect(report.costUsd).toBeCloseTo(0.00024, 8)
    })

    it('does nothing without a Jev key', async () => {
        const store = new Store(':memory:')
        seed(store, [{ session: 's1', text: '帮我加一个导出按钮', at: Date.now() }])
        const service = new LoadService(store, { jevKey: async () => null, fetchFn: fakeJev([]) })
        expect((await service.classifyRecent()).classified).toBe(0)
    })

    it('takes percentiles by nearest rank', () => {
        expect(percentiles([])).toEqual({ median: 0, p75: 0, p90: 0 })
        expect(percentiles([5, 1, 3, 2, 4, 6, 7, 8, 9, 10])).toEqual({ median: 5, p75: 8, p90: 9 })
    })
})
