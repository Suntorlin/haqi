import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'

import { Store } from './index'

function closeStore(store: Store): void {
    (store as unknown as { db: Database }).db.close()
}

describe('MemoryStore', () => {
    it('stores memories, links and events per namespace', () => {
        const store = new Store(':memory:')
        const base = { level: 'experience' as const, scope: 'haqi', status: 'active' as const, reason: null, source: 'propose', sourceLabel: null, sessionId: null, said: false, support: 1, jev: { keep: 0.9 }, overridden: null, replaces: null }
        const fact = store.memories.insert({ ...base, namespace: 'default', text: 'sw.js copied first, white page', level: 'fact' })
        const lesson = store.memories.insert({ ...base, namespace: 'default', text: 'copy entry files last' })
        store.memories.insert({ ...base, namespace: 'other', text: 'not visible' })
        store.memories.link('default', fact.id, lesson.id)

        expect(store.memories.list('default').map((m) => m.text).sort()).toEqual(['copy entry files last', 'sw.js copied first, white page'])
        expect(store.memories.links('default')).toEqual([expect.objectContaining({ fromId: fact.id, toId: lesson.id })])
        expect(store.memories.get(lesson.id, 'other')).toBeNull()

        const edited = store.memories.update(lesson.id, 'default', { text: 'copy sw.js and index.html last', overridden: { level: 'principle' }, bumpVersion: true })
        expect(edited).toMatchObject({ text: 'copy sw.js and index.html last', version: 2, overridden: { level: 'principle' }, jev: { keep: 0.9 } })

        store.memories.addEvent({ namespace: 'default', memoryId: lesson.id, action: 'added', text: lesson.text, reason: null, source: 'propose', sourceLabel: null, sourceRef: null, hash: 'abc', sessionId: null, jev: null, costUsd: 0.00005, latencyMs: 400 })
        expect(store.memories.hasEventHash('default', 'abc')).toBe(true)
        expect(store.memories.hasEventHash('other', 'abc')).toBe(false)

        expect(store.memories.delete(fact.id, 'default')).toBe(true)
        expect(store.memories.links('default')).toEqual([])
        expect(store.memories.events('default', 10)[0]).toMatchObject({ action: 'added', memoryId: lesson.id })
        closeStore(store)
    })
})
