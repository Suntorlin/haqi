import type { ChatBlock } from '@/chat/types'

/** Show a centered timestamp when the conversation resumes after this long (WeChat uses ~5 minutes). */
export const TIME_SEPARATOR_GAP_MS = 5 * 60 * 1000

type ThreadRole = 'user' | 'assistant' | 'system'

function getThreadRole(block: ChatBlock): ThreadRole {
    if (block.kind === 'user-text') return 'user'
    if (block.kind === 'agent-event') return 'system'
    if (block.kind === 'cli-output') return block.source === 'user' ? 'user' : 'assistant'
    return 'assistant'
}

/** Mirrors the message ids produced by `toThreadMessageLike` in lib/assistant-runtime. */
function getThreadMessageId(block: ChatBlock): string {
    switch (block.kind) {
        case 'user-text':
            return `user:${block.id}`
        case 'agent-text':
        case 'agent-reasoning':
            return `assistant:${block.id}`
        case 'agent-event':
            return `event:${block.id}`
        case 'cli-output':
            return `cli:${block.id}`
        default:
            return `tool:${block.id}`
    }
}

/**
 * Returns thread message id -> timestamp for messages that should be preceded by a time
 * separator. Consecutive assistant blocks are merged into one thread message by assistant-ui,
 * so only blocks that start a new thread message are considered.
 */
export function computeTimeSeparators(blocks: readonly ChatBlock[]): Map<string, number> {
    const separators = new Map<string, number>()
    let previousRole: ThreadRole | null = null
    let previousAt: number | null = null

    for (const block of blocks) {
        const role = getThreadRole(block)
        const startsMessage = !(role === 'assistant' && previousRole === 'assistant')
        if (startsMessage && Number.isFinite(block.createdAt)) {
            if (previousAt === null || block.createdAt - previousAt >= TIME_SEPARATOR_GAP_MS) {
                separators.set(getThreadMessageId(block), block.createdAt)
            }
        }
        previousRole = role
        if (Number.isFinite(block.createdAt)) {
            previousAt = block.createdAt
        }
    }

    return separators
}

function startOfDay(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** WeChat-style chat timestamp: "14:32", "昨天 14:32", "星期二 14:32", "10月3日 14:32". */
export function formatChatTimestamp(
    at: number,
    locale: string,
    yesterdayLabel: string,
    now: number = Date.now()
): string {
    const date = new Date(at)
    const time = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false })
    const dayDiff = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86_400_000)

    if (dayDiff <= 0) return time
    if (dayDiff === 1) return `${yesterdayLabel} ${time}`
    if (dayDiff < 7) {
        return `${date.toLocaleDateString(locale, { weekday: 'long' })} ${time}`
    }
    if (date.getFullYear() === new Date(now).getFullYear()) {
        return `${date.toLocaleDateString(locale, { month: 'long', day: 'numeric' })} ${time}`
    }
    return `${date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })} ${time}`
}

export type RunStats = {
    /** When the turn started: the user's message if the run answers one, else the first agent block. */
    startAt: number
    /** Latest activity inside the run (block creation or tool completion). */
    endAt: number
    /** The run starts at the first loaded block, so older parts may still be unloaded. */
    partial: boolean
}

function getBlockEndAt(block: ChatBlock): number {
    if (block.kind === 'tool-call') {
        return Math.max(block.createdAt, block.tool.startedAt ?? 0, block.tool.completedAt ?? 0)
    }
    return block.createdAt
}

/** Thread message id of each merged assistant run -> its start/end time (for "用时" and live timers). */
export function computeRunStats(blocks: readonly ChatBlock[]): Map<string, RunStats> {
    const stats = new Map<string, RunStats>()
    let previousRole: ThreadRole | null = null
    let lastUserAt: number | null = null
    let current: RunStats | null = null

    for (const block of blocks) {
        const role = getThreadRole(block)
        if (role === 'assistant') {
            const endAt = getBlockEndAt(block)
            if (previousRole === 'assistant' && current) {
                current.endAt = Math.max(current.endAt, endAt)
            } else {
                const startAt = previousRole === 'user' && lastUserAt !== null ? lastUserAt : block.createdAt
                current = { startAt, endAt: Math.max(startAt, endAt), partial: previousRole === null }
                stats.set(getThreadMessageId(block), current)
            }
        } else {
            current = null
            if (role === 'user') {
                lastUserAt = block.createdAt
            }
        }
        previousRole = role
    }

    return stats
}

export function formatElapsed(
    ms: number,
    t: (key: string, params?: Record<string, string | number>) => string
): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000))
    if (totalSeconds < 60) return t('mobile.duration.seconds', { s: totalSeconds })
    const minutes = Math.floor(totalSeconds / 60)
    if (minutes < 60) return t('mobile.duration.minutes', { m: minutes, s: totalSeconds % 60 })
    return t('mobile.duration.hours', { h: Math.floor(minutes / 60), m: minutes % 60 })
}

/**
 * Last readable paragraph of agent text as plain text, used as the "latest progress" line
 * while a turn is still running.
 */
export function getLatestProgressText(text: string, maxLength = 160): string | null {
    const paragraphs = text.split(/\n{2,}/)
    for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
        const plain = paragraphs[index]
            .replace(/```[\s\S]*?(```|$)/g, ' ')
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/[`*_>#|]/g, '')
            .replace(/^\s*[-+]\s+/gm, '')
            .replace(/\s+/g, ' ')
            .trim()
        if (plain) {
            return plain.length > maxLength ? `…${plain.slice(-maxLength)}` : plain
        }
    }
    return null
}
