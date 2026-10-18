import { describe, expect, it } from 'vitest'
import { SNOOZE_FOREVER } from './session-pins'
import { formatSnoozeStatus, formatSnoozeWake, getSnoozePresets, toDateTimeLocalValue } from './session-snooze'

const zh = (key: string, params?: Record<string, string | number>) => ({
    'snooze.day.today': `今天 ${params?.time}`,
    'snooze.day.tomorrow': `明天 ${params?.time}`,
    'snooze.untilWoken': '手动取消',
    'session.snooze.indefinite': '不限时',
    'session.snooze.wakesAt': `${params?.time} 回来`
}[key] ?? key)

describe('snooze presets', () => {
    it('offers tomorrow, in two days, in three days and next Monday at 6:00', () => {
        // Wednesday 2026-10-21 at 14:30.
        const presets = getSnoozePresets(new Date(2026, 9, 21, 14, 30))
        expect(presets.map((preset) => preset.key)).toEqual(['tomorrow', 'day2', 'day3', 'nextWeek', 'forever'])
        expect(presets.slice(0, 4).map((preset) => new Date(preset.until))).toEqual([
            new Date(2026, 9, 22, 6, 0),
            new Date(2026, 9, 23, 6, 0),
            new Date(2026, 9, 24, 6, 0),
            new Date(2026, 9, 26, 6, 0)
        ])
    })

    it('drops next Monday when it is one of the other days', () => {
        // Friday: next Monday is in three days.
        expect(getSnoozePresets(new Date(2026, 9, 23, 10, 0)).map((preset) => preset.key)).toEqual(['tomorrow', 'day2', 'day3', 'forever'])
        // Sunday: next Monday is tomorrow.
        expect(getSnoozePresets(new Date(2026, 9, 18, 21, 0)).map((preset) => preset.key)).toEqual(['tomorrow', 'day2', 'day3', 'forever'])
    })

    it('counts days from today after midnight', () => {
        const presets = getSnoozePresets(new Date(2026, 9, 21, 1, 0))
        expect(new Date(presets[0].until)).toEqual(new Date(2026, 9, 21, 6, 0))
        expect(new Date(presets[1].until)).toEqual(new Date(2026, 9, 23, 6, 0))
    })
})

describe('formatSnoozeWake', () => {
    const now = new Date(2026, 9, 21, 14, 30).getTime()

    it('says today / tomorrow, then the weekday, then the date', () => {
        expect(formatSnoozeWake(new Date(2026, 9, 21, 20, 0).getTime(), now, 'zh-CN', zh)).toBe('今天 20:00')
        expect(formatSnoozeWake(new Date(2026, 9, 22, 6, 0).getTime(), now, 'zh-CN', zh)).toBe('明天 06:00')
        expect(formatSnoozeWake(new Date(2026, 9, 26, 6, 0).getTime(), now, 'zh-CN', zh)).toBe('周一 06:00')
        expect(formatSnoozeWake(new Date(2026, 10, 3, 9, 15).getTime(), now, 'zh-CN', zh)).toBe('11月3日 09:15')
    })
})

describe('no-end snooze', () => {
    it('is the last quick choice and reads as no end', () => {
        const now = new Date(2026, 9, 21, 14, 30).getTime()
        const last = getSnoozePresets(new Date(now)).at(-1)
        expect(last).toEqual({ key: 'forever', until: SNOOZE_FOREVER })
        expect(formatSnoozeWake(SNOOZE_FOREVER, now, 'zh-CN', zh)).toBe('手动取消')
        expect(formatSnoozeStatus(SNOOZE_FOREVER, now, 'zh-CN', zh)).toBe('不限时')
        expect(formatSnoozeStatus(new Date(2026, 9, 22, 6, 0).getTime(), now, 'zh-CN', zh)).toBe('明天 06:00 回来')
    })
})

describe('toDateTimeLocalValue', () => {
    it('round-trips through Date as local time', () => {
        const value = new Date(2026, 0, 5, 7, 4).getTime()
        expect(toDateTimeLocalValue(value)).toBe('2026-01-05T07:04')
        expect(new Date(toDateTimeLocalValue(value)).getTime()).toBe(value)
    })
})
