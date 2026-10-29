import { z } from 'zod'

/**
 * A scheduled task: a saved prompt that HAQI sends to a new session on a machine at the times its schedule names.
 * The hub keeps the clock, so a task runs while the hub and the machine's runner are up; no browser has to be open.
 */

export const SCHEDULE_AGENTS = ['claude', 'codex', 'cursor', 'gemini', 'opencode'] as const
export type ScheduleAgent = typeof SCHEDULE_AGENTS[number]

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')

export const ScheduleSpecSchema = z.discriminatedUnion('kind', [
    /** No clock: it runs only when the user taps Run now. */
    z.object({ kind: z.literal('manual') }),
    z.object({ kind: z.literal('hourly'), minute: z.number().int().min(0).max(59) }),
    z.object({ kind: z.literal('daily'), time: timeSchema }),
    z.object({ kind: z.literal('weekdays'), time: timeSchema }),
    /** weekday: 0 is Sunday. */
    z.object({ kind: z.literal('weekly'), weekday: z.number().int().min(0).max(6), time: timeSchema }),
    z.object({ kind: z.literal('cron'), expr: z.string().trim().min(9).max(120) }),
    /** One run at an exact time; the task pauses itself after it. */
    z.object({ kind: z.literal('once'), at: z.number().int().positive() })
])
export type ScheduleSpec = z.infer<typeof ScheduleSpecSchema>

export type ScheduledRunStatus = 'running' | 'waiting' | 'done' | 'failed' | 'skipped'
/** schedule: on time; catchup: late, because the hub or the machine was down at the planned time; manual: Run now. */
export type ScheduledRunTrigger = 'schedule' | 'catchup' | 'manual'
/**
 * no_start: no session could start (every account failed, or the machine was offline);
 * timeout: it ran past the task's limit; no_result: the session stopped without calling scheduled_run_done;
 * self_reported: the session reported failed.
 */
export type ScheduledRunFailure = 'no_start' | 'timeout' | 'no_result' | 'self_reported'

/**
 * Where a run bound to an employee goes. isolated: a fresh session each run, its result only enters the run log
 * (never the main session); main: the employee's main session; named:<key>: one long-lived session per key.
 */
export const SessionTargetSchema = z.string().regex(/^(isolated|main|named:[A-Za-z0-9_-]{1,40})$/, 'Use isolated, main or named:<key>')
export type SessionTarget = z.infer<typeof SessionTargetSchema>
/** What the session said with scheduled_run_done. skipped: it found nothing to do, such as a report already sent. */
export type ScheduledRunReport = 'success' | 'failed' | 'skipped'

export type ScheduledRun = {
    id: string
    scheduleId: string
    trigger: ScheduledRunTrigger
    status: ScheduledRunStatus
    /** The planned time; null for a manual run. */
    scheduledFor: number | null
    startedAt: number
    finishedAt: number | null
    sessionId: string | null
    failure: ScheduledRunFailure | null
    reported: ScheduledRunReport | null
    /** The session's one-line result, or why the run failed or was skipped. */
    summary: string | null
    links: string[]
    /** The Claude account the session started with, and how many starts it took. */
    accountId: string | null
    attempts: number
}

export const ScheduledRunDoneSchema = z.object({
    sessionId: z.string().min(1),
    status: z.enum(['success', 'failed', 'skipped']),
    summary: z.string().trim().min(1).max(2000),
    links: z.array(z.string().trim().min(1).max(2000)).max(20).optional()
})
export type ScheduledRunDone = z.infer<typeof ScheduledRunDoneSchema>

export type ScheduledTask = {
    id: string
    namespace: string
    name: string
    /** What to do. With a prompt file, extra words sent after the file's instructions; may be empty. */
    prompt: string
    /** A file on the machine with the instructions; the session reads it fresh on every run. */
    promptFile: string | null
    machineId: string
    directory: string
    agent: ScheduleAgent
    model: string | null
    thinkEffort: string | null
    permissionMode: string | null
    /** Claude: the account to start with; the rest of its trust group follow. Null: the pool's default account. */
    accountId: string | null
    /** Each run gets its own git worktree, so it never touches the folder's uncommitted work. */
    worktree: boolean
    /** A run still open after this many minutes fails and its session stops. */
    maxMinutes: number
    /** The digital employee this task belongs to; its runs carry the employee identity. Null: a plain task. */
    employeeId: string | null
    /** Only read when employeeId is set; isolated is the default. */
    sessionTarget: SessionTarget
    spec: ScheduleSpec
    /** IANA name; the schedule's times are wall-clock times in it. */
    timezone: string
    enabled: boolean
    nextRunAt: number | null
    createdAt: number
    updatedAt: number
    lastRun: ScheduledRun | null
}

export const DEFAULT_MAX_MINUTES = 90

const scheduledTaskFields = {
    name: z.string().trim().min(1).max(120),
    prompt: z.string().trim().max(20_000),
    promptFile: z.string().trim().min(1).max(1000).nullable().optional(),
    machineId: z.string().min(1),
    directory: z.string().trim().min(1),
    agent: z.enum(SCHEDULE_AGENTS),
    model: z.string().trim().min(1).max(100).nullable().optional(),
    thinkEffort: z.enum(['auto', 'low', 'medium', 'high', 'max', 'xhigh']).nullable().optional(),
    permissionMode: z.string().trim().min(1).max(40).nullable().optional(),
    accountId: z.string().regex(/^[a-z0-9_-]{1,40}$/).nullable().optional(),
    worktree: z.boolean().optional(),
    maxMinutes: z.number().int().min(1).max(24 * 60).optional(),
    employeeId: z.string().trim().min(1).max(40).nullable().optional(),
    sessionTarget: SessionTargetSchema.optional(),
    spec: ScheduleSpecSchema,
    timezone: z.string().trim().min(1).max(80),
    enabled: z.boolean().optional()
}

export const ScheduledTaskInputSchema = z.object({
    ...scheduledTaskFields,
    prompt: scheduledTaskFields.prompt.default(''),
    agent: scheduledTaskFields.agent.default('claude')
})
    .refine((value) => value.prompt.length > 0 || Boolean(value.promptFile), { message: 'Give a prompt or a prompt file' })
export type ScheduledTaskInput = z.infer<typeof ScheduledTaskInputSchema>

export const ScheduledTaskPatchSchema = z.object(scheduledTaskFields).partial()
export type ScheduledTaskPatch = z.infer<typeof ScheduledTaskPatchSchema>

// ─── Cron ────────────────────────────────────────────────────────────────────────

/** A parsed five-field cron expression: minute hour day-of-month month day-of-week (0 is Sunday). */
export type Cron = {
    minute: Set<number>
    hour: Set<number>
    day: Set<number>
    month: Set<number>
    weekday: Set<number>
    /** Standard cron: when both day fields are restricted, a day matches if either one does. */
    dayAny: boolean
    weekdayAny: boolean
}

function parseField(field: string, min: number, max: number): Set<number> {
    const values = new Set<number>()
    for (const part of field.split(',')) {
        const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part)
        if (!match) throw new Error(`Bad cron field: ${field}`)
        const step = match[4] ? Number(match[4]) : 1
        let from = min
        let to = max
        if (match[1] !== '*') {
            from = Number(match[2])
            to = match[3] !== undefined ? Number(match[3]) : (match[4] ? max : from)
        }
        if (step < 1 || from < min || to > max || from > to) throw new Error(`Bad cron field: ${field}`)
        for (let value = from; value <= to; value += step) values.add(value)
    }
    return values
}

export function parseCron(expr: string): Cron {
    const fields = expr.trim().split(/\s+/)
    if (fields.length !== 5) throw new Error('A cron expression has five fields: minute hour day month weekday')
    const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string]
    return {
        minute: parseField(minute, 0, 59),
        hour: parseField(hour, 0, 23),
        day: parseField(day, 1, 31),
        month: parseField(month, 1, 12),
        weekday: parseField(weekday, 0, 6),
        dayAny: day === '*',
        weekdayAny: weekday === '*'
    }
}

function pad(value: number): string {
    return String(value).padStart(2, '0')
}

function splitTime(time: string): [number, number] {
    const [h, m] = time.split(':').map(Number) as [number, number]
    return [h, m]
}

/** The cron expression of a clock schedule; null for manual and once. */
export function specToCron(spec: ScheduleSpec): string | null {
    switch (spec.kind) {
        case 'hourly': return `${spec.minute} * * * *`
        case 'daily': { const [h, m] = splitTime(spec.time); return `${m} ${h} * * *` }
        case 'weekdays': { const [h, m] = splitTime(spec.time); return `${m} ${h} * * 1-5` }
        case 'weekly': { const [h, m] = splitTime(spec.time); return `${m} ${h} * * ${spec.weekday}` }
        case 'cron': return spec.expr
        default: return null
    }
}

/** Throws with a readable message when the spec cannot run. */
export function validateSpec(spec: ScheduleSpec): void {
    const cron = specToCron(spec)
    if (cron) parseCron(cron)
}

type Wall = { year: number; month: number; day: number; hour: number; minute: number; weekday: number }

const formatters = new Map<string, Intl.DateTimeFormat>()

function wallClock(at: number, timezone: string): Wall {
    let format = formatters.get(timezone)
    if (!format) {
        format = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone, hourCycle: 'h23',
            year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
        })
        formatters.set(timezone, format)
    }
    const parts: Record<string, number> = {}
    for (const part of format.formatToParts(new Date(at))) {
        if (part.type !== 'literal') parts[part.type] = Number(part.value)
    }
    const year = parts.year ?? 1970
    const month = parts.month ?? 1
    const day = parts.day ?? 1
    return {
        year, month, day,
        hour: (parts.hour ?? 0) % 24,
        minute: parts.minute ?? 0,
        weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    }
}

export function isValidTimezone(timezone: string): boolean {
    try {
        wallClock(0, timezone)
        return true
    } catch {
        return false
    }
}

const MINUTE = 60_000

/** The first minute after `after` that the cron matches in the timezone, or null when none comes within ~5 years. */
export function nextCronTime(cron: Cron, timezone: string, after: number): number | null {
    let at = Math.floor(after / MINUTE) * MINUTE + MINUTE
    // Hour steps over unmatched days keep this bounded: about 44k steps for five years.
    for (let steps = 0; steps < 60_000; steps++) {
        const wall = wallClock(at, timezone)
        const dayHit = cron.dayAny && cron.weekdayAny
            ? true
            : cron.dayAny ? cron.weekday.has(wall.weekday)
            : cron.weekdayAny ? cron.day.has(wall.day)
            : cron.day.has(wall.day) || cron.weekday.has(wall.weekday)
        if (!cron.month.has(wall.month) || !dayHit || !cron.hour.has(wall.hour)) {
            at += (60 - wall.minute) * MINUTE
            continue
        }
        if (!cron.minute.has(wall.minute)) {
            at += MINUTE
            continue
        }
        return at
    }
    return null
}

/** When the task should next run after `after`; null when its schedule never runs again. */
export function nextRunTime(spec: ScheduleSpec, timezone: string, after: number): number | null {
    if (spec.kind === 'manual') return null
    if (spec.kind === 'once') return spec.at > after ? spec.at : null
    const cron = specToCron(spec)
    return cron ? nextCronTime(parseCron(cron), timezone, after) : null
}

/** The next few run times, for the form's preview. */
export function upcomingRunTimes(spec: ScheduleSpec, timezone: string, after: number, count: number): number[] {
    const times: number[] = []
    let from = after
    for (let i = 0; i < count; i++) {
        const next = nextRunTime(spec, timezone, from)
        if (next === null) break
        times.push(next)
        from = next
    }
    return times
}

const WEEKDAY_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const WEEKDAY_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A short label for the schedule, such as "每天 09:00". */
export function describeSpec(spec: ScheduleSpec, timezone: string, lang: 'zh' | 'en' = 'zh'): string {
    const zh = lang === 'zh'
    switch (spec.kind) {
        case 'manual': return zh ? '手动' : 'Manual'
        case 'hourly': return zh ? `每小时第 ${spec.minute} 分` : `Hourly at :${pad(spec.minute)}`
        case 'daily': return zh ? `每天 ${spec.time}` : `Daily ${spec.time}`
        case 'weekdays': return zh ? `工作日 ${spec.time}` : `Weekdays ${spec.time}`
        case 'weekly': return zh ? `每${WEEKDAY_ZH[spec.weekday]} ${spec.time}` : `${WEEKDAY_EN[spec.weekday]} ${spec.time}`
        case 'cron': {
            // The common shapes read as their preset; anything else shows the expression.
            const m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(spec.expr.trim())
            if (m && Number(m[1]) < 60 && Number(m[2]) < 24) {
                const time = `${pad(Number(m[2]))}:${pad(Number(m[1]))}`
                if (m[3] === '*') return describeSpec({ kind: 'daily', time }, timezone, lang)
                if (m[3] === '1-5') return describeSpec({ kind: 'weekdays', time }, timezone, lang)
                return describeSpec({ kind: 'weekly', weekday: Number(m[3]), time }, timezone, lang)
            }
            return `cron ${spec.expr}`
        }
        case 'once': {
            const wall = wallClock(spec.at, timezone)
            const text = `${wall.year}-${pad(wall.month)}-${pad(wall.day)} ${pad(wall.hour)}:${pad(wall.minute)}`
            return zh ? `一次 ${text}` : `Once ${text}`
        }
    }
}
