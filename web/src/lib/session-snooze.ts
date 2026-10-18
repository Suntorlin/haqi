import { SNOOZE_WAKE_HOUR, getNextSnoozeWake } from '@/lib/session-pins'

export type SnoozePresetKey = 'hour1' | 'hour3' | 'tonight' | 'tomorrow' | 'nextWeek'
export type SnoozePreset = { key: SnoozePresetKey; until: number }

const HOUR_MS = 60 * 60 * 1000
const TONIGHT_HOUR = 20
const MONDAY = 1

/** Quick choices in the snooze dialog. "Tonight" only before 19:00; "next Monday" only when it is not tomorrow. */
export function getSnoozePresets(now: Date = new Date()): SnoozePreset[] {
    const presets: SnoozePreset[] = [
        { key: 'hour1', until: now.getTime() + HOUR_MS },
        { key: 'hour3', until: now.getTime() + 3 * HOUR_MS }
    ]

    const tonight = new Date(now)
    tonight.setHours(TONIGHT_HOUR, 0, 0, 0)
    if (tonight.getTime() - now.getTime() >= HOUR_MS) {
        presets.push({ key: 'tonight', until: tonight.getTime() })
    }

    const tomorrow = getNextSnoozeWake(now)
    presets.push({ key: 'tomorrow', until: tomorrow })

    const nextMonday = new Date(now)
    nextMonday.setDate(nextMonday.getDate() + (((MONDAY - now.getDay() + 7) % 7) || 7))
    nextMonday.setHours(SNOOZE_WAKE_HOUR, 0, 0, 0)
    if (nextMonday.getTime() !== tomorrow) {
        presets.push({ key: 'nextWeek', until: nextMonday.getTime() })
    }

    return presets
}

function startOfDay(value: number): number {
    const day = new Date(value)
    day.setHours(0, 0, 0, 0)
    return day.getTime()
}

/** Wake time for people: "今天 18:00" / "明天 06:00" / "周一 06:00" / "10月30日 06:00". */
export function formatSnoozeWake(
    until: number,
    now: number,
    locale: string,
    t: (key: string, params?: Record<string, string | number>) => string
): string {
    const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(until)
    const days = Math.round((startOfDay(until) - startOfDay(now)) / (24 * HOUR_MS))
    if (days <= 0) return t('snooze.day.today', { time })
    if (days === 1) return t('snooze.day.tomorrow', { time })
    const day = days < 7
        ? new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(until)
        : new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(until)
    return `${day} ${time}`
}

/** Value for an <input type="datetime-local">, in local time. */
export function toDateTimeLocalValue(value: number): string {
    const date = new Date(value)
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
