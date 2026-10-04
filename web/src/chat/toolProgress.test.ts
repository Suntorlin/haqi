import { describe, expect, it } from 'vitest'
import { extractToolProgress } from './toolProgress'
import type { DecryptedMessage } from '@/types/api'

function heartbeat(options: {
    id: string
    createdAt: number
    toolId: string
    n: number
    elapsed: number
}): DecryptedMessage {
    return {
        id: options.id,
        localId: null,
        createdAt: options.createdAt,
        content: {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'tool_progress',
                    tool_use_id: `${options.toolId}-heartbeat-${options.n}`,
                    tool_name: 'Bash',
                    parent_tool_use_id: options.toolId,
                    elapsed_time_seconds: options.elapsed,
                    heartbeat: true
                }
            }
        }
    } as unknown as DecryptedMessage
}

function textMessage(id: string, createdAt: number): DecryptedMessage {
    return {
        id,
        localId: null,
        createdAt,
        content: {
            role: 'agent',
            content: {
                type: 'output',
                data: { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }
            }
        }
    } as unknown as DecryptedMessage
}

describe('extractToolProgress', () => {
    it('keeps the newest signal per tool', () => {
        const now = 1_000_000
        const result = extractToolProgress([
            heartbeat({ id: 'm1', createdAt: now - 90_000, toolId: 'toolu_a', n: 0, elapsed: 30 }),
            textMessage('m2', now - 80_000),
            heartbeat({ id: 'm3', createdAt: now - 60_000, toolId: 'toolu_a', n: 1, elapsed: 60 }),
            heartbeat({ id: 'm4', createdAt: now - 30_000, toolId: 'toolu_b', n: 0, elapsed: 30 })
        ], now)

        expect(result?.get('toolu_a')).toEqual({ at: now - 60_000, elapsedSeconds: 60 })
        expect(result?.get('toolu_b')).toEqual({ at: now - 30_000, elapsedSeconds: 30 })
    })

    it('falls back to stripping the heartbeat suffix when parent id is missing', () => {
        const now = 1_000_000
        const message = heartbeat({ id: 'm1', createdAt: now - 10_000, toolId: 'toolu_c', n: 2, elapsed: 90 })
        delete ((message.content as any).content.data as any).parent_tool_use_id

        const result = extractToolProgress([message], now)
        expect(result?.get('toolu_c')).toEqual({ at: now - 10_000, elapsedSeconds: 90 })
    })

    it('ignores stale, malformed, and non-progress messages', () => {
        const now = 100 * 60 * 1000
        const old = heartbeat({ id: 'm1', createdAt: now - 20 * 60 * 1000, toolId: 'toolu_old', n: 0, elapsed: 30 })
        const broken = heartbeat({ id: 'm2', createdAt: now - 5_000, toolId: 'toolu_bad', n: 0, elapsed: 30 })
        ;((broken.content as any).content.data as any).elapsed_time_seconds = 'soon'

        expect(extractToolProgress([old, broken, textMessage('m3', now - 1_000)], now)).toBeNull()
    })
})
