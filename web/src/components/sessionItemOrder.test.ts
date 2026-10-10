import { describe, expect, it } from 'vitest'
import { applySessionItemOrder, moveSessionItem, normalizeSessionItemOrder } from './sessionItemOrder'

describe('sessionItemOrder helpers', () => {
    it('normalizes persisted payload', () => {
        expect(normalizeSessionItemOrder('["a","b","a",1,""]')).toEqual(['a', 'b'])
        expect(normalizeSessionItemOrder('bad')).toEqual([])
    })

    it('keeps unranked sessions on top in default order', () => {
        const sessions = [{ id: 'new' }, { id: 'a' }, { id: 'b' }]
        expect(applySessionItemOrder(sessions, ['b', 'a']).map((s) => s.id)).toEqual(['new', 'b', 'a'])
    })

    it('moves a session within its group and keeps other groups ranks', () => {
        expect(moveSessionItem(['x', 'y'], ['a', 'b', 'c'], 'c', 'a')).toEqual(['x', 'y', 'c', 'a', 'b'])
        expect(moveSessionItem(['x'], ['a', 'b'], 'a', 'missing')).toEqual(['x'])
    })
})
