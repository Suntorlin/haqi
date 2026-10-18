import { describe, expect, it } from 'vitest'
import { formatSnoozeWake, getSnoozePresets, toDateTimeLocalValue } from './session-snooze'

const zh = (key: string, params?: Record<string, string | number>) => ({
    'snooze.day.today': `今天 ${params?.time}`,
    'snooze.day.tomorrow': `明天 ${params?.time}`
}[key] ?? key)

describe('snooze presets', () => {
    it('offers tonight in the afternoon and next Monday mid-week', () => {
        // Sunday 2026-10-18 is day 0; Wednesday 2026-10-21 at 14:30.
        const presets = getSnoozePresets(new Date(2026, 9, 21, 14, 30))
        expect(presets.map((preset) => preset.key)).toEqual(['hour1', 'hour3', 'tonight', 'tomorrow', 'nextWeek'])
        expect(new Date(presets[2].until)).toEqual(new Date(2026, 9, 21, 20, 0))
        expect(new Date(presets[3].until)).toEqual(new Date(2026, 9, 22, 6, 0))
        expect(new Date(presets[4].until)).toEqual(new Date(2026, 9, 26, 6, 0))
    })

    it('drops tonight late in the day and next Monday on Sunday', () => {
        const presets = getSnoozePresets(new Date(2026, 9, 18, 21, 0))
        expect(presets.map((preset) => preset.key)).toEqual(['hour1', 'hour3', 'tomorrow'])
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

describe('toDateTimeLocalValue', () => {
    it('round-trips through Date as local time', () => {
        const value = new Date(2026, 0, 5, 7, 4).getTime()
        expect(toDateTimeLocalValue(value)).toBe('2026-01-05T07:04')
        expect(new Date(toDateTimeLocalValue(value)).getTime()).toBe(value)
    })
})
