import { describe, expect, it } from 'bun:test'
import { mergeSessionMetadata } from './sessionCache'

describe('mergeSessionMetadata', () => {
    it('keeps tags and name when merging a respawned session without them', () => {
        const result = mergeSessionMetadata(
            { path: '/tmp/project', host: 'mac', name: 'Pinned', tags: ['prod'] },
            { path: '/tmp/project', host: 'mac', claudeSessionId: 'new-id' }
        )

        expect(result).toEqual({
            path: '/tmp/project',
            host: 'mac',
            claudeSessionId: 'new-id',
            name: 'Pinned',
            tags: ['prod']
        })
    })

    it('does not resurrect tags the new session explicitly cleared', () => {
        const result = mergeSessionMetadata(
            { path: '/tmp/project', tags: ['prod'] },
            { path: '/tmp/project', tags: [] }
        ) as Record<string, unknown>

        expect(result.tags).toEqual([])
    })

    it('returns new metadata untouched when nothing needs preserving', () => {
        const incoming = { path: '/tmp/project', host: 'mac' }
        expect(mergeSessionMetadata({ summary: { text: 'x' } }, incoming)).toBe(incoming)
    })
})
