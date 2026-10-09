import { describe, expect, it } from 'vitest'
import {
    applySessionTagOrder,
    loadSessionTagOrder,
    moveSessionTag,
    normalizeSessionTagOrder,
    persistSessionTagOrder
} from './sessionTagOrder'

describe('sessionTagOrder helpers', () => {
    it('normalizes stored tags and ignores invalid values', () => {
        expect(normalizeSessionTagOrder('["model", "infra", "model", 2, ""]')).toEqual(['model', 'infra'])
        expect(normalizeSessionTagOrder('invalid')).toEqual([])
        expect(normalizeSessionTagOrder(null)).toEqual([])
    })

    it('keeps custom order and appends new tags alphabetically', () => {
        expect(applySessionTagOrder(['prod', 'agent', 'infra', 'model'], ['model', 'agent']))
            .toEqual(['model', 'agent', 'infra', 'prod'])
    })

    it('moves one tag without changing the others', () => {
        expect(moveSessionTag(['agent', 'infra', 'model', 'prod'], 'prod', 'infra'))
            .toEqual(['agent', 'prod', 'infra', 'model'])
        expect(moveSessionTag(['agent', 'infra'], 'missing', 'infra'))
            .toEqual(['agent', 'infra'])
    })

    it('persists the order locally', () => {
        persistSessionTagOrder(['model', 'agent'])
        expect(loadSessionTagOrder()).toEqual(['model', 'agent'])
    })
})
