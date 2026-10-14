import { beforeEach, describe, expect, it } from 'vitest'
import { markSessionRead, markSessionUnread, resetUnreadSessions } from './unread-sessions'

describe('unread sessions', () => {
    beforeEach(() => {
        window.localStorage.clear()
        resetUnreadSessions()
    })

    it('keeps a finished session unread until it is opened, and survives a reload', () => {
        markSessionUnread('a')
        markSessionUnread('b')
        resetUnreadSessions() // re-read storage, as after a reload
        expect(JSON.parse(window.localStorage.getItem('hapi:unreadSessions') ?? '[]')).toEqual(['a', 'b'])

        markSessionRead('a')
        expect(JSON.parse(window.localStorage.getItem('hapi:unreadSessions') ?? '[]')).toEqual(['b'])
    })
})
