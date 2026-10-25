import { describe, expect, it } from 'vitest'
import { draftToSpec, epochToWallInput, specToDraft, wallInputToEpoch } from './schedules'

describe('wall-clock input in a timezone', () => {
    it('reads a datetime-local value in the given timezone, also across a DST change', () => {
        expect(wallInputToEpoch('2026-10-26T09:00', 'Asia/Shanghai')).toBe(Date.UTC(2026, 9, 26, 1, 0))
        // New York: EDT (UTC-4) in July, EST (UTC-5) in December.
        expect(wallInputToEpoch('2026-07-01T09:00', 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 13, 0))
        expect(wallInputToEpoch('2026-12-01T09:00', 'America/New_York')).toBe(Date.UTC(2026, 11, 1, 14, 0))
        expect(epochToWallInput(Date.UTC(2026, 11, 1, 14, 0), 'America/New_York')).toBe('2026-12-01T09:00')
        expect(wallInputToEpoch('2026-12-01T09:00', 'Not/AZone')).toBeNull()
    })

    it('round-trips a once spec through the form draft', () => {
        const at = Date.UTC(2026, 11, 24, 10, 30)
        const draft = specToDraft({ kind: 'once', at }, 'Europe/Berlin')
        expect(draft.onceAt).toBe('2026-12-24T11:30')
        expect(draftToSpec(draft, 'Europe/Berlin')).toEqual({ spec: { kind: 'once', at }, error: null })
    })

    it('says what is wrong with a bad schedule', () => {
        const draft = specToDraft(null, 'UTC')
        expect(draftToSpec({ ...draft, kind: 'hourly', minute: '75' }, 'UTC').error).toEqual({ key: 'minute' })
        expect(draftToSpec(draft, 'Mars/Base').error).toEqual({ key: 'timezone' })
        expect(draftToSpec({ ...draft, kind: 'cron', cron: '0 25 * * *' }, 'UTC').error).toHaveProperty('message')
    })
})
