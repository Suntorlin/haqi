import { describe, expect, it } from 'vitest'

/*
 * Text that does not fit goes through <FitText kind=...> / <FitLine> (web/DESIGN.md "Text that does
 * not fit"). Cutting text by hand — `truncate` / `line-clamp-*` classes or a truncate() helper — is
 * for FitText.tsx only.
 */
const CUT = /\btruncate\b|\bline-clamp-\d\b/g
const SOURCES = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../components/ui/FitText.tsx'], { query: '?raw', import: 'default', eager: true })

describe('text fitting', () => {
    it('cuts text only inside FitText', () => {
        const cuts = Object.entries(SOURCES)
            .map(([path, source]) => [path.replace(/^\.\.\//, ''), source.match(CUT)?.length ?? 0] as const)
            .filter(([, count]) => count > 0)
            .map(([file, count]) => `${file}: ${count}`)
        expect(cuts, 'Use <FitText kind=...> or <FitLine> instead of truncate / line-clamp (web/DESIGN.md)').toEqual([])
    })
})
