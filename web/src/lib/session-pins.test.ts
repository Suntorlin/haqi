import { describe, expect, it } from 'vitest'
import { PINNED_TAG, getUserTags, isSessionPinned, withPinTag } from './session-pins'

describe('session pins', () => {
    it('hides the system tag from user tags', () => {
        const session = { metadata: { tags: ['agent', PINNED_TAG, 'prod'] } }
        expect(isSessionPinned(session)).toBe(true)
        expect(getUserTags(session)).toEqual(['agent', 'prod'])
    })

    it('keeps the pin when user tags are edited, and drops it on unpin', () => {
        expect(withPinTag(['agent'], true)).toEqual(['agent', PINNED_TAG])
        expect(withPinTag(['agent', PINNED_TAG], true)).toEqual(['agent', PINNED_TAG])
        expect(withPinTag(['agent', PINNED_TAG], false)).toEqual(['agent'])
    })

    it('treats sessions without metadata as unpinned', () => {
        expect(isSessionPinned({ metadata: null })).toBe(false)
        expect(getUserTags({ metadata: null })).toEqual([])
    })
})
