import { SNOOZE_WAKE_HOUR, getNextSnoozeWake } from '@/lib/session-pins'

export type SnoozePresetKey = 'tomorrow' | 'day2' | 'day3' | 'nextWeek'
export type SnoozePreset = { key: SnoozePresetKey; until: number }

const HOUR_MS = 60 * 60 * 1000
const MONDAY = 1

/** SNOOZE_WAKE_HOUR on the day `days` after today, local time. */
function wakeOnDay(now: Date, days: number): number {
    const wake = new Date(now)
    wake.setDate(wake.getDate() + days)
    wake.setHours(SNOOZE_WAKE_HOUR, 0, 0, 0)
    return wake.getTime()
}

/**
 * Quick choices in the snooze menu, all at SNOOZE_WAKE_HOUR: tomorrow, in two days, in three days,
 * next Monday. Next Monday is left out when it falls on one of the other days.
 */
export function getSnoozePresets(now: Date = new Date()): SnoozePreset[] {
    const presets: SnoozePreset[] = [
        { key: 'tomorrow', until: getNextSnoozeWake(now) },
        { key: 'day2', until: wakeOnDay(now, 2) },
        { key: 'day3', until: wakeOnDay(now, 3) }
    ]
    const nextMonday = wakeOnDay(now, ((MONDAY - now.getDay() + 7) % 7) || 7)
    if (!presets.some((preset) => preset.until === nextMonday)) {
        presets.push({ key: 'nextWeek', until: nextMonday })
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
