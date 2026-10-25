import { ScheduleSpecSchema, isValidTimezone, validateSpec, type ScheduleSpec } from '@hapi/protocol/schedules'
import { ApiError } from '@/api/client'

export type ScheduleKind = ScheduleSpec['kind']

export const SCHEDULE_KINDS: readonly ScheduleKind[] = ['manual', 'hourly', 'daily', 'weekdays', 'weekly', 'cron', 'once']

/** The schedule part of the form, as the inputs hold it (strings for text and number fields). */
export type SpecDraft = {
    kind: ScheduleKind
    minute: string
    time: string
    /** 0 is Sunday. */
    weekday: number
    cron: string
    /** `YYYY-MM-DDTHH:MM`, a wall-clock time in the task's timezone (datetime-local value). */
    onceAt: string
}

export function browserTimezone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
        return 'UTC'
    }
}

function wallParts(at: number, timezone: string): Record<string, number> {
    const format = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hourCycle: 'h23',
        year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'
    })
    const parts: Record<string, number> = {}
    for (const part of format.formatToParts(new Date(at))) {
        if (part.type !== 'literal') parts[part.type] = Number(part.value)
    }
    return parts
}

/** How far the timezone's wall clock is ahead of UTC at `at`, in ms. */
function zoneOffset(at: number, timezone: string): number {
    const parts = wallParts(at, timezone)
    const asUtc = Date.UTC(parts.year ?? 1970, (parts.month ?? 1) - 1, parts.day ?? 1, (parts.hour ?? 0) % 24, parts.minute ?? 0, parts.second ?? 0)
    return asUtc - Math.floor(at / 1000) * 1000
}

/** A datetime-local value read as a wall-clock time in the timezone; null when either is not valid. */
export function wallInputToEpoch(value: string, timezone: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
    if (!match) return null
    const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]))
    try {
        // Second pass: the offset at the result can differ from the guess's near a DST change.
        const first = guess - zoneOffset(guess, timezone)
        return guess - zoneOffset(first, timezone)
    } catch {
        return null
    }
}

/** The datetime-local value of an instant in the timezone; '' when the timezone is not valid. */
export function epochToWallInput(at: number, timezone: string): string {
    try {
        const parts = wallParts(at, timezone)
        const pad = (value: number | undefined) => String(value ?? 0).padStart(2, '0')
        return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad((parts.hour ?? 0) % 24)}:${pad(parts.minute)}`
    } catch {
        return ''
    }
}

export function specToDraft(spec: ScheduleSpec | null, timezone: string): SpecDraft {
    const draft: SpecDraft = { kind: 'daily', minute: '0', time: '09:00', weekday: 1, cron: '0 9 * * 1-5', onceAt: '' }
    if (!spec) return draft
    draft.kind = spec.kind
    if (spec.kind === 'hourly') draft.minute = String(spec.minute)
    if (spec.kind === 'daily' || spec.kind === 'weekdays' || spec.kind === 'weekly') draft.time = spec.time
    if (spec.kind === 'weekly') draft.weekday = spec.weekday
    if (spec.kind === 'cron') draft.cron = spec.expr
    if (spec.kind === 'once') draft.onceAt = epochToWallInput(spec.at, timezone)
    return draft
}

export type SpecCheck = { spec: ScheduleSpec; error: null } | { spec: null; error: SpecError }

/** Why the schedule cannot be saved: a fixed reason (for an i18n key) or the parser's own message. */
export type SpecError = { key: 'timezone' | 'minute' | 'time' | 'onceAt' } | { message: string }

/** Turns the form's schedule inputs into a spec the hub accepts, or says what is wrong. */
export function draftToSpec(draft: SpecDraft, timezone: string): SpecCheck {
    if (draft.kind !== 'manual' && !isValidTimezone(timezone.trim())) return { spec: null, error: { key: 'timezone' } }
    let candidate: unknown
    switch (draft.kind) {
        case 'manual': candidate = { kind: 'manual' }; break
        case 'hourly': {
            const minute = draft.minute.trim() === '' ? Number.NaN : Number(draft.minute)
            if (!Number.isInteger(minute) || minute < 0 || minute > 59) return { spec: null, error: { key: 'minute' } }
            candidate = { kind: 'hourly', minute }
            break
        }
        case 'daily':
        case 'weekdays': candidate = { kind: draft.kind, time: draft.time }; break
        case 'weekly': candidate = { kind: 'weekly', weekday: draft.weekday, time: draft.time }; break
        case 'cron': candidate = { kind: 'cron', expr: draft.cron.trim() }; break
        case 'once': {
            const at = wallInputToEpoch(draft.onceAt, timezone.trim())
            if (at === null) return { spec: null, error: { key: 'onceAt' } }
            candidate = { kind: 'once', at }
            break
        }
    }
    const parsed = ScheduleSpecSchema.safeParse(candidate)
    if (!parsed.success) {
        if (draft.kind === 'daily' || draft.kind === 'weekdays' || draft.kind === 'weekly') return { spec: null, error: { key: 'time' } }
        return { spec: null, error: { message: parsed.error.issues[0]?.message ?? 'Invalid schedule' } }
    }
    try {
        validateSpec(parsed.data)
    } catch (error) {
        return { spec: null, error: { message: error instanceof Error ? error.message : 'Invalid schedule' } }
    }
    return { spec: parsed.data, error: null }
}

/** The hub's own words for a failed call (`{ error }`), else the error's message. */
export function apiErrorText(error: unknown): string {
    if (error instanceof ApiError) return error.code ?? error.message
    return error instanceof Error ? error.message : String(error)
}

/** An absolute time in the browser's timezone, such as "10月26日 周一 09:00". */
export function formatScheduleTime(at: number, locale: string, now: number = Date.now()): string {
    const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear()
    return new Intl.DateTimeFormat(locale, {
        ...(sameYear ? {} : { year: 'numeric' }),
        month: 'short', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).format(new Date(at))
}

type Translate = (key: string, params?: Record<string, string | number>) => string

/** How long until `at`: "in 5 minutes", "in 3 hours", "in 2 days". */
export function formatUntil(at: number, now: number, t: Translate): string {
    const minutes = Math.round((at - now) / 60_000)
    if (minutes < 1) return t('scheduled.time.soon')
    if (minutes < 60) return t('scheduled.time.inMinutes', { n: minutes })
    const hours = Math.round(minutes / 60)
    if (hours < 24) return t('scheduled.time.inHours', { n: hours })
    return t('scheduled.time.inDays', { n: Math.round(hours / 24) })
}

/** "12 min", "1 h 5 min": how long a run took. */
export function formatDuration(ms: number, t: Translate): string {
    const minutes = Math.max(1, Math.round(ms / 60_000))
    if (minutes < 60) return t('scheduled.time.minutes', { n: minutes })
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest === 0 ? t('scheduled.time.hours', { n: hours }) : t('scheduled.time.hoursMinutes', { h: hours, m: rest })
}
