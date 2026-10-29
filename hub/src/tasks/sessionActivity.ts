/**
 * What the observer reads from a session's stored messages: when it last wrote, the shell commands it ran, its
 * latest step in a few words for the task page, and whether its latest reply was Claude refusing for quota.
 */
import { claudeQuotaRefusal, isObject } from '@hapi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import type { StoredMessage } from '../store/types'
import { extractToolBlocks } from '../sync/teams'

const SHELL_TOOLS = new Set(['Bash', 'CodexBash', 'shell', 'exec_command'])

export type SessionActivity = {
    lastMessageAt: number
    commands: string[]
    lastStep: string | null
    /** The latest reply is the account's quota refusal ("You've hit your weekly limit · resets …"), and when. */
    quota: { text: string; at: number } | null
}

export function sessionActivity(messages: StoredMessage[], since: number): SessionActivity {
    let lastMessageAt = 0
    let lastStep: { at: number; text: string } | null = null
    let quota: SessionActivity['quota'] = null
    const commands: string[] = []
    for (const message of messages) {
        lastMessageAt = Math.max(lastMessageAt, message.createdAt)
        const envelope = unwrapRoleWrappedRecordEnvelope(parse(message.content))
        const content = envelope && isObject(envelope.content) ? envelope.content as Record<string, unknown> : null
        if (!content) continue
        const data = content.type === 'output' && isObject(content.data) ? content.data as Record<string, unknown> : null
        if (data?.type === 'assistant') {
            const refusal = claudeQuotaRefusal(data.message)
            quota = refusal ? { text: refusal, at: message.createdAt } : null
        }
        for (const block of extractToolBlocks(content)) {
            const step = describeStep(block.name, block.input)
            if (step && (!lastStep || message.createdAt >= lastStep.at)) lastStep = { at: message.createdAt, text: step }
            if (message.createdAt <= since || !SHELL_TOOLS.has(block.name)) continue
            const command = shellCommand(block.input)
            if (command) commands.push(command)
        }
    }
    return { lastMessageAt, commands, lastStep: lastStep?.text ?? null, quota }
}

function shellCommand(input: Record<string, unknown>): string | null {
    const command = input.command
    if (typeof command === 'string') return command
    if (Array.isArray(command)) return command.map(String).join(' ')
    return null
}

const STEP_MAX = 80

/** A tool call in a few words: what it ran, changed, read or searched. */
export function describeStep(tool: string, input: Record<string, unknown>): string | null {
    const file = (key: string) => typeof input[key] === 'string' ? (input[key] as string).split('/').filter(Boolean).pop() ?? null : null
    let step: string | null
    if (SHELL_TOOLS.has(tool)) step = shellCommand(input) ? `运行 ${shellCommand(input)!.split('\n')[0]}` : null
    else if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'Write' || tool === 'NotebookEdit') step = `改 ${file('file_path') ?? file('notebook_path') ?? '文件'}`
    else if (tool === 'Read') step = `读 ${file('file_path') ?? '文件'}`
    else if (tool === 'Grep' || tool === 'Glob') step = `搜索 ${typeof input.pattern === 'string' ? input.pattern : ''}`.trim()
    else if (tool === 'Task' || tool === 'Agent') step = '派了一个子 agent'
    else if (tool.startsWith('mcp__')) step = `调用 ${tool.split('__').pop()}`
    else step = tool
    return step && step.length > STEP_MAX ? `${step.slice(0, STEP_MAX - 1)}…` : step
}

function parse(content: unknown): unknown {
    if (typeof content !== 'string') return content
    try {
        return JSON.parse(content)
    } catch {
        return null
    }
}
