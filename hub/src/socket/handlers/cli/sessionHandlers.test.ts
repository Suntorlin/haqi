import { describe, expect, it } from 'bun:test'
import { preserveWebSessionMetadata } from './sessionHandlers'

describe('preserveWebSessionMetadata', () => {
    it('keeps tags and name when an older CLI snapshot omits them', () => {
        const result = preserveWebSessionMetadata(
            { path: '/tmp/project', host: 'mac', name: 'Pinned', tags: ['agent'] },
            { path: '/tmp/project', host: 'mac', summary: { text: 'new summary' } }
        )

        expect(result).toEqual({
            path: '/tmp/project',
            host: 'mac',
            summary: { text: 'new summary' },
            name: 'Pinned',
            tags: ['agent']
        })
    })

    it('allows explicit tag edits, including clearing all tags', () => {
        expect(preserveWebSessionMetadata(
            { path: '/tmp/project', host: 'mac', tags: ['agent'] },
            { path: '/tmp/project', host: 'mac', tags: [] }
        )).toEqual({ path: '/tmp/project', host: 'mac', tags: [] })
    })
})
