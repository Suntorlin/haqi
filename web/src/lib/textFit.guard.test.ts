import { describe, expect, it } from 'vitest'
import baseline from './textFit.baseline.json'

/*
 * Text that does not fit goes through <FitText kind=...> (web/DESIGN.md "Text that does not fit").
 * Cutting text by hand with `truncate` / `line-clamp-*` belongs in FitText only.
 * The places that still do it are listed in textFit.baseline.json; the list may only shrink.
 */
const CUT = /\btruncate\b|\bline-clamp-\d\b/g
const SOURCES = import.meta.glob<string>(['../**/*.tsx', '!../**/*.test.tsx', '!../components/ui/FitText.tsx'], { query: '?raw', import: 'default', eager: true })

function handCuts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const [path, source] of Object.entries(SOURCES)) {
        const count = source.match(CUT)?.length ?? 0
        if (count) counts[path.replace(/^\.\.\//, '')] = count
    }
    return counts
}

describe('text fitting', () => {
    it('does not cut text by hand outside the listed places', () => {
        const allowed = baseline as Record<string, number>
        const grown = Object.entries(handCuts())
            .filter(([file, count]) => count > (allowed[file] ?? 0))
            .map(([file, count]) => `${file}: ${count} (listed ${allowed[file] ?? 0})`)
        expect(grown, 'Use <FitText kind=...> instead of truncate / line-clamp (web/DESIGN.md)').toEqual([])
    })

    it('keeps the list of places as short as the code', () => {
        const actual = handCuts()
        const stale = Object.entries(baseline as Record<string, number>)
            .filter(([file, count]) => (actual[file] ?? 0) < count)
            .map(([file, count]) => `${file}: listed ${count}, now ${actual[file] ?? 0}`)
        expect(stale, 'Lower these counts in src/lib/textFit.baseline.json').toEqual([])
    })
})
