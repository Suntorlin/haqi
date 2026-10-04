import { describe, expect, it } from 'vitest'
import { normalizeDecryptedMessage } from './normalize'
import type { DecryptedMessage } from '@/types/api'

function agentOutput(data: Record<string, unknown>): DecryptedMessage {
    return {
        id: 'message-1',
        localId: null,
        createdAt: 1_700_000_000_000,
        content: { role: 'agent', content: { type: 'output', data } }
    } as unknown as DecryptedMessage
}

describe('normalizeDecryptedMessage SDK passthrough types', () => {
    it('drops tool_progress heartbeats instead of rendering raw JSON', () => {
        const normalized = normalizeDecryptedMessage(agentOutput({
            type: 'tool_progress',
            tool_use_id: 'toolu_01-heartbeat-3',
            tool_name: 'Bash',
            parent_tool_use_id: 'toolu_01',
            elapsed_time_seconds: 120,
            heartbeat: true
        }))

        expect(normalized).toBeNull()
    })

    it('drops other unhandled output types instead of rendering raw JSON', () => {
        expect(normalizeDecryptedMessage(agentOutput({
            type: 'command_lifecycle',
            subtype: 'start'
        }))).toBeNull()
    })

    it('still renders assistant output', () => {
        const normalized = normalizeDecryptedMessage(agentOutput({
            type: 'assistant',
            uuid: 'uuid-1',
            message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
        }))

        expect(normalized).not.toBeNull()
        expect(normalized?.role).toBe('agent')
    })
})
