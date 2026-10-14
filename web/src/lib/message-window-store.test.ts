import { afterEach, describe, expect, it } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { DecryptedMessage } from '@/types/api'
import { clearMessageWindow, fetchLatestMessages, getMessageWindowState } from './message-window-store'

function message(seq: number): DecryptedMessage {
    return {
        id: `m${seq}`,
        seq,
        localId: null,
        content: { role: 'agent', content: { type: 'text', text: String(seq) } },
        createdAt: seq
    }
}

function apiReturning(...pages: DecryptedMessage[][]): ApiClient {
    let call = 0
    return {
        getMessages: async () => ({ messages: pages[call++] ?? [], page: { hasMore: true } })
    } as unknown as ApiClient
}

describe('fetchLatestMessages', () => {
    const sessionId = 'session-gap'

    afterEach(() => clearMessageWindow(sessionId))

    it('merges a latest page that overlaps the window', async () => {
        await fetchLatestMessages(apiReturning([message(1), message(2), message(3)]), sessionId)
        await fetchLatestMessages(apiReturning([message(3), message(4)]), sessionId)

        expect(getMessageWindowState(sessionId).messages.map((m) => m.seq)).toEqual([1, 2, 3, 4])
    })

    it('starts over when the latest page begins past the window (reconnect after a long gap)', async () => {
        await fetchLatestMessages(apiReturning([message(1), message(2), message(3)]), sessionId)
        await fetchLatestMessages(apiReturning([message(50), message(51)]), sessionId)

        const state = getMessageWindowState(sessionId)
        expect(state.messages.map((m) => m.seq)).toEqual([50, 51])
        expect(state.hasMore).toBe(true)
    })
})
