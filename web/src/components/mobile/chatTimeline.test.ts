import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '@/chat/types'
import { TIME_SEPARATOR_GAP_MS, computeTimeSeparators, formatChatTimestamp } from '@/components/mobile/chatTimeline'

const MINUTE = 60_000

function userText(id: string, createdAt: number): ChatBlock {
    return { kind: 'user-text', id, localId: null, createdAt, text: id }
}

function agentText(id: string, createdAt: number): ChatBlock {
    return { kind: 'agent-text', id, localId: null, createdAt, text: id }
}

describe('computeTimeSeparators', () => {
    it('marks the first message and messages after a long gap', () => {
        const separators = computeTimeSeparators([
            userText('u1', 0),
            agentText('a1', 1 * MINUTE),
            userText('u2', 2 * MINUTE),
            userText('u3', 2 * MINUTE + TIME_SEPARATOR_GAP_MS)
        ])

        expect([...separators.keys()]).toEqual(['user:u1', 'user:u3'])
    })

    it('ignores gaps inside one merged assistant turn', () => {
        const separators = computeTimeSeparators([
            userText('u1', 0),
            agentText('a1', 1 * MINUTE),
            agentText('a2', 30 * MINUTE),
            userText('u2', 31 * MINUTE)
        ])

        // a2 is merged into the assistant message that starts at a1, so it cannot carry a separator.
        expect([...separators.keys()]).toEqual(['user:u1'])
    })
})

describe('formatChatTimestamp', () => {
    const now = new Date(2026, 9, 13, 18, 0).getTime()

    it('shows only the time for today and a label for yesterday', () => {
        expect(formatChatTimestamp(new Date(2026, 9, 13, 9, 5).getTime(), 'en-GB', 'Yesterday', now)).toBe('09:05')
        expect(formatChatTimestamp(new Date(2026, 9, 12, 23, 30).getTime(), 'en-GB', 'Yesterday', now)).toBe('Yesterday 23:30')
    })
})
