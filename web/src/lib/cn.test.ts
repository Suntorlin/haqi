import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
    it('keeps a named font size next to an arbitrary text colour', () => {
        expect(cn('text-footnote text-[var(--social-fg)]')).toBe('text-footnote text-[var(--social-fg)]')
    })

    it('lets a later named font size win', () => {
        expect(cn('text-footnote', 'text-body')).toBe('text-body')
    })

    it('lets a later colour win without dropping the size', () => {
        expect(cn('text-caption text-[var(--social-fg-muted)]', 'text-[var(--social-danger)]')).toBe('text-caption text-[var(--social-danger)]')
    })
})
