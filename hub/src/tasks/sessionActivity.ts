/** What the observer reads from a session's stored messages: when it last wrote, and the shell commands it ran. */
import { isObject } from '@hapi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import type { StoredMessage } from '../store/types'
import { extractToolBlocks } from '../sync/teams'

const SHELL_TOOLS = new Set(['Bash', 'CodexBash', 'shell', 'exec_command'])

export function sessionActivity(messages: StoredMessage[], since: number): { lastMessageAt: number; commands: string[] } {
    let lastMessageAt = 0
    const commands: string[] = []
    for (const message of messages) {
        lastMessageAt = Math.max(lastMessageAt, message.createdAt)
        if (message.createdAt <= since) continue
        const envelope = unwrapRoleWrappedRecordEnvelope(parse(message.content))
        const content = envelope && isObject(envelope.content) ? envelope.content as Record<string, unknown> : null
        if (!content) continue
        for (const block of extractToolBlocks(content)) {
            if (!SHELL_TOOLS.has(block.name)) continue
            const command = block.input.command
            if (typeof command === 'string') commands.push(command)
            else if (Array.isArray(command)) commands.push(command.map(String).join(' '))
        }
    }
    return { lastMessageAt, commands }
}

function parse(content: unknown): unknown {
    if (typeof content !== 'string') return content
    try {
        return JSON.parse(content)
    } catch {
        return null
    }
}
