import { userText } from './extract'

/**
 * Which stored messages the user really typed. HAQI itself puts user-role messages into sessions (group routing,
 * review loops, team control, task guides); memory and the message classifier must not read those as the user.
 */

/** Meta keys HAQI sets on the messages it sends on its own. */
const INJECTED_META = ['routeContext', 'teamControl', 'taskGuide', 'taskWork'] as const

/** `meta.source` values of messages HAQI sends into employee sessions (wakes, scheduled prompts, deliveries, inbound). */
const INJECTED_SOURCES = new Set(['employee-wake', 'scheduled-task', 'task-deliver', 'inbound'])

/**
 * Claude echoes a queued message back without its meta, so the injected ones are also known by their text.
 * Each pattern matches what one HAQI sender writes.
 */
const INJECTED_TEXT = [
    /\[HAQI_GROUP_TASK_CONTEXT\]/,
    /^\[SYSTEM\] You are (?:in a ReviewLoop|a ReviewLoop Reviewer)/,
    /^📝 \*\*Group Note Broadcast\*\*/,
    /^You are coordinating the Claude agent team /,
    /^\[HAQI_TASK_GUIDE\]/,
    /^\[HAQI_TASK_WORK\]/,
    /^\[HAQI 状态包\]/,
    /^\[HAQI 任务交付\]/,
    /^\[HAQI 入站消息/,
    // The compaction flush prompt the CLI injects before /compact (compactPilot's FLUSH_MESSAGE).
    /^上下文快满了。用 employee_log 工具/
]

/** A message that is only a slash command ("/compact", "/note refresh") runs a command; the user did not say anything. */
const SLASH_COMMAND = /^\/[a-z][\w-]*(?::[\w-]+)?(?:[ \t][^\n]*)?$/

type StoredMessage = {
    role?: unknown
    content?: { type?: unknown; text?: unknown }
    meta?: Record<string, unknown> | null
}

function parse(content: string | StoredMessage): StoredMessage | null {
    if (typeof content !== 'string') return content
    try {
        const parsed = JSON.parse(content) as unknown
        return parsed && typeof parsed === 'object' ? parsed as StoredMessage : null
    } catch {
        return null
    }
}

/** The text of a message the user typed themselves, or null for anything else. */
export function realUserText(content: string | StoredMessage): string | null {
    const message = parse(content)
    if (message?.role !== 'user' || message.content?.type !== 'text' || typeof message.content.text !== 'string') return null
    const meta = message.meta && typeof message.meta === 'object' ? message.meta : {}
    if (INJECTED_META.some((key) => meta[key] !== undefined && meta[key] !== null)) return null
    if (typeof meta.source === 'string' && INJECTED_SOURCES.has(meta.source)) return null
    const raw = message.content.text
    if (INJECTED_TEXT.some((pattern) => pattern.test(raw))) return null
    if (SLASH_COMMAND.test(raw.trim())) return null
    return userText(raw)
}
