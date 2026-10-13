import { describe, expect, it } from 'vitest'
import type { ChatBlock } from '@/chat/types'
import {
    TIME_SEPARATOR_GAP_MS,
    computeRunStats,
    computeTimeSeparators,
    formatChatTimestamp,
    getLatestProgressText
} from '@/components/mobile/chatTimeline'

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

function toolCall(id: string, createdAt: number, completedAt: number): ChatBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt,
        children: [],
        tool: { id, name: 'Bash', state: 'completed', input: {}, createdAt, startedAt: createdAt, completedAt, description: null }
    }
}

describe('computeRunStats', () => {
    it('times a run from the user message to its last activity', () => {
        const stats = computeRunStats([
            userText('u1', 0),
            agentText('a1', 5_000),
            toolCall('t1', 10_000, 70_000),
            agentText('a2', 80_000),
            userText('u2', 200_000),
            agentText('a3', 205_000)
        ])

        expect(stats.get('assistant:a1')).toEqual({ startAt: 0, endAt: 80_000 })
        expect(stats.get('assistant:a3')).toEqual({ startAt: 200_000, endAt: 205_000 })
        expect(stats.has('tool:t1')).toBe(false)
    })
})

describe('getLatestProgressText', () => {
    it('returns the last readable paragraph as plain text', () => {
        expect(getLatestProgressText('先看一下日志。\n\n定位到 **reducer** 里的 `merge` 有问题，正在修。\n\n```ts\ncode\n```')).toBe('定位到 reducer 里的 merge 有问题，正在修。')
        expect(getLatestProgressText('```\nonly code\n```')).toBeNull()
    })
})
