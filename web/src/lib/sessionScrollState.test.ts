import { beforeEach, describe, expect, it } from 'vitest'
import { readSessionScrollSnapshot, resetSessionScrollStateCache, writeSessionScrollSnapshot } from './sessionScrollState'

describe('sessionScrollState', () => {
    beforeEach(() => {
        window.localStorage.clear()
        resetSessionScrollStateCache()
    })

    it('persists dom scroll snapshot by session + view mode', () => {
        writeSessionScrollSnapshot('session-1', 'normal', {
            top: 128,
            lastKey: '42',
            savedAt: 1
        })

        expect(readSessionScrollSnapshot('session-1', 'normal')).toEqual({
            top: 128,
            topIndex: undefined,
            lastKey: '42',
            savedAt: 1
        })
        expect(readSessionScrollSnapshot('session-1', 'cli')).toBeNull()
    })

    it('normalizes invalid stored values', () => {
        window.localStorage.setItem('hapi:sessionScrollState:v1', JSON.stringify({
            'session-1:brief': {
                top: -50,
                topIndex: 3.8,
                lastKey: 123,
                savedAt: 'bad'
            }
        }))

        expect(readSessionScrollSnapshot('session-1', 'brief')).toEqual({
            top: 0,
            topIndex: 3,
            lastKey: null,
            savedAt: 0
        })
    })
})
