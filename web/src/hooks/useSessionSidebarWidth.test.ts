import { describe, expect, it } from 'vitest'
import {
    clampSessionSidebarWidth,
    getDefaultSessionSidebarWidth,
    getSessionSidebarMaxWidth,
} from './useSessionSidebarWidth'

describe('useSessionSidebarWidth helpers', () => {
    it('uses xl default width for wide screens', () => {
        expect(getDefaultSessionSidebarWidth(1400)).toBe(400)
    })

    it('uses normal default width for regular screens', () => {
        expect(getDefaultSessionSidebarWidth(1100)).toBe(380)
    })

    it('clamps below min width', () => {
        expect(clampSessionSidebarWidth(120, 1200)).toBe(280)
    })

    it('clamps above max width derived from viewport', () => {
        const max = getSessionSidebarMaxWidth(1000)
        expect(clampSessionSidebarWidth(9999, 1000)).toBe(max)
    })
})
