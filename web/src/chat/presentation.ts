import type { AgentEvent } from '@/chat/types'
import { en } from '@/lib/locales'

export function formatUnixTimestamp(value: number): string {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    const date = new Date(ms)
    if (Number.isNaN(date.getTime())) return String(value)
    return date.toLocaleString()
}

function formatDuration(ms: number): string {
    const seconds = ms / 1000
    if (seconds < 60) return `${seconds.toFixed(1)}s`
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return `${mins}m ${secs}s`
}

export type EventPresentation = {
    icon: string | null
    text: string
}

type Translate = (key: string, params?: Record<string, string | number>) => string

function interpolate(text: string, params?: Record<string, string | number>): string {
    if (!params) return text
    return text.replace(/\{(\w+)\}/g, (match, name: string) => (params[name] !== undefined ? String(params[name]) : match))
}

const englishStrings: Record<string, string> = en
const translateEnglish: Translate = (key, params) => interpolate(englishStrings[key] ?? key, params)

/** Known plain-text messages the CLI sends as session events. */
const KNOWN_EVENT_MESSAGES: Record<string, string> = {
    'Aborted by user': 'event.abortedByUser'
}

export function getEventPresentation(event: AgentEvent, t: Translate = translateEnglish): EventPresentation {
    if (event.type === 'api-error') {
        const { retryAttempt, maxRetries } = event as { retryAttempt: number; maxRetries: number }
        if (maxRetries > 0 && retryAttempt >= maxRetries) {
            return { icon: '⚠️', text: t('event.apiError.maxRetries') }
        }
        if (maxRetries > 0) {
            return { icon: '⏳', text: t('event.apiError.retrying', { n: retryAttempt, max: maxRetries }) }
        }
        if (retryAttempt > 0) {
            return { icon: '⏳', text: t('event.apiError.retryingShort') }
        }
        return { icon: '⚠️', text: t('event.apiError') }
    }
    if (event.type === 'switch') {
        return { icon: '🔄', text: event.mode === 'local' ? t('event.switched.local') : t('event.switched.remote') }
    }
    if (event.type === 'title-changed') {
        const title = typeof event.title === 'string' ? event.title : ''
        return { icon: null, text: title ? t('event.titleChanged', { title }) : t('event.titleChangedShort') }
    }
    if (event.type === 'permission-mode-changed') {
        const modeValue = (event as Record<string, unknown>).mode
        const mode = typeof modeValue === 'string' ? modeValue : 'default'
        const modeKey = `permissionMode.${mode}`
        const modeText = t(modeKey) === modeKey ? mode : t(modeKey)
        return { icon: '🔐', text: t('event.permissionMode', { mode: modeText }) }
    }
    if (event.type === 'limit-reached') {
        const endsAt = typeof event.endsAt === 'number' ? event.endsAt : null
        return {
            icon: '⏳',
            text: endsAt ? t('event.limitReachedUntil', { time: formatUnixTimestamp(endsAt) }) : t('event.limitReached')
        }
    }
    if (event.type === 'message') {
        if (typeof event.message !== 'string') return { icon: null, text: t('event.message') }
        const known = KNOWN_EVENT_MESSAGES[event.message]
        return { icon: null, text: known ? t(known) : event.message }
    }
    if (event.type === 'turn-duration') {
        const ms = typeof event.durationMs === 'number' ? event.durationMs : 0
        return { icon: '⏱️', text: t('event.turnDuration', { d: formatDuration(ms) }) }
    }
    if (event.type === 'microcompact') {
        const saved = typeof event.tokensSaved === 'number' ? event.tokensSaved : 0
        const formatted = saved >= 1000 ? `${Math.round(saved / 1000)}K` : String(saved)
        return { icon: '📦', text: t('event.microcompact', { n: formatted }) }
    }
    if (event.type === 'compact') {
        return { icon: '📦', text: t('event.compact') }
    }
    if (event.type === 'rate-limit') {
        const limitType = typeof event.rateLimitType === 'string' && event.rateLimitType ? ` (${event.rateLimitType})` : ''
        const text = typeof event.resetsAt === 'number' && event.resetsAt > 0
            ? t('event.rateLimitedUntil', { time: formatUnixTimestamp(event.resetsAt) })
            : t('event.rateLimited')
        return { icon: '⏳', text: `${text}${limitType}` }
    }
    try {
        return { icon: null, text: JSON.stringify(event) }
    } catch {
        return { icon: null, text: String(event.type) }
    }
}

export function renderEventLabel(event: AgentEvent): string {
    return getEventPresentation(event).text
}
