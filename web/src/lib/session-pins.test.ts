import { describe, expect, it } from 'vitest'
import {
    PINNED_TAG,
    SNOOZE_FOREVER,
    getNextSnoozeWake,
    getSnoozeUntil,
    getUserTags,
    isSessionPinned,
    isSessionSnoozed,
    withPinTag,
    withSnoozeTag,
    withTaskOwnTag,
    withUserTags
} from './session-pins'

const tagged = (...tags: string[]) => ({ metadata: { tags } })

describe('session pins', () => {
    it('hides the system tags from user tags', () => {
        const session = tagged('agent', PINNED_TAG, 'snooze:1000', 'prod')
        expect(isSessionPinned(session)).toBe(true)
        expect(getUserTags(session)).toEqual(['agent', 'prod'])
    })

    it('keeps the pin and the snooze when user tags are edited', () => {
        expect(withUserTags(tagged('agent', PINNED_TAG, 'snooze:1000'), ['ops'])).toEqual(['ops', PINNED_TAG, 'snooze:1000'])
        expect(withUserTags(tagged('agent'), [])).toEqual([])
    })

    it('sets and clears the pin without touching other tags', () => {
        expect(withPinTag(tagged('agent'), true)).toEqual(['agent', PINNED_TAG])
        expect(withPinTag(tagged('agent', PINNED_TAG), true)).toEqual(['agent', PINNED_TAG])
        expect(withPinTag(tagged('agent', PINNED_TAG, 'snooze:1000'), false)).toEqual(['agent', 'snooze:1000'])
    })

    it('treats sessions without metadata as unpinned and awake', () => {
        expect(isSessionPinned({ metadata: null })).toBe(false)
        expect(isSessionSnoozed({ metadata: null })).toBe(false)
        expect(getUserTags({ metadata: null })).toEqual([])
    })
})

describe('session snooze', () => {
    it('is snoozed until the wake time passes', () => {
        const session = tagged('agent', 'snooze:2000')
        expect(getSnoozeUntil(session)).toBe(2000)
        expect(isSessionSnoozed(session, 1999)).toBe(true)
        expect(isSessionSnoozed(session, 2000)).toBe(false)
    })

    it('wakes early while a request waits for approval', () => {
        const session = { ...tagged('snooze:2000'), active: true, pendingRequestsCount: 1 }
        expect(isSessionSnoozed(session, 1000)).toBe(false)
        expect(isSessionSnoozed({ ...session, active: false }, 1000)).toBe(true)
    })

    it('replaces the snooze tag on re-snooze and drops it on wake', () => {
        expect(withSnoozeTag(tagged('agent', 'snooze:1000'), 3000)).toEqual(['agent', 'snooze:3000'])
        expect(withSnoozeTag(tagged('agent', 'snooze:1000'), null)).toEqual(['agent'])
    })

    it('stores a no-end snooze as snooze:forever and keeps it snoozed', () => {
        const tags = withSnoozeTag(tagged('agent'), SNOOZE_FOREVER)
        expect(tags).toEqual(['agent', 'snooze:forever'])
        expect(getSnoozeUntil({ metadata: { tags } })).toBe(SNOOZE_FOREVER)
        expect(isSessionSnoozed({ metadata: { tags } }, new Date(2099, 0, 1).getTime())).toBe(true)
        expect(withSnoozeTag({ metadata: { tags } }, null)).toEqual(['agent'])
    })

    it('ignores a malformed snooze tag', () => {
        expect(getSnoozeUntil(tagged('snooze:abc'))).toBeNull()
        expect(isSessionSnoozed(tagged('snooze:abc'), 0)).toBe(false)
    })

    it('wakes at 6:00 the next morning, or the same morning after midnight', () => {
        const evening = new Date(2026, 9, 18, 21, 30)
        expect(new Date(getNextSnoozeWake(evening))).toEqual(new Date(2026, 9, 19, 6, 0))
        const night = new Date(2026, 9, 19, 1, 15)
        expect(new Date(getNextSnoozeWake(night))).toEqual(new Date(2026, 9, 19, 6, 0))
    })
})

describe('session tasks', () => {
    const task = { id: 'abc123', tag: 'haqi' }

    it('joining a task adds its tag once and keeps every other tag', () => {
        const session = tagged('fish', PINNED_TAG)
        const joined = withTaskOwnTag(session, task.tag)
        expect(joined).toEqual(['haqi', 'fish', PINNED_TAG])
        expect(getUserTags(tagged(...joined))).toEqual(['haqi', 'fish'])
        const already = tagged('haqi')
        expect(withTaskOwnTag(already, task.tag)).toBe(already.metadata.tags)
    })

    it('editing user tags keeps an old task tag hidden and in place', () => {
        expect(withUserTags(tagged('haqi', 'task:abc123'), ['fish'])).toEqual(['fish', 'task:abc123'])
    })
})
