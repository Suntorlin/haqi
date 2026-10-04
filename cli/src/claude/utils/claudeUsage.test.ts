import { describe, expect, it } from 'vitest';
import { parseUsageLimits } from './claudeUsage';

const now = 1_760_000_000_000;

describe('parseUsageLimits', () => {
    it('maps the oauth usage limits projection including model-scoped buckets', () => {
        const limits = parseUsageLimits({
            limits: [
                { kind: 'session', group: 'session', percent: 65, severity: 'normal', resets_at: '2026-10-04T08:29:59.757856+00:00', scope: null, is_active: true },
                { kind: 'weekly_all', group: 'weekly', percent: 11, severity: 'normal', resets_at: '2026-10-10T06:59:59.757876+00:00', scope: null, is_active: false },
                { kind: 'weekly_scoped', group: 'weekly', percent: 17, severity: 'normal', resets_at: '2026-10-10T06:59:59.758027+00:00', scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false }
            ]
        }, now);
        expect(limits).toEqual([
            { kind: 'session', percent: 65, severity: 'normal', resetsAt: Math.floor(Date.parse('2026-10-04T08:29:59.757856+00:00') / 1000), observedAt: now },
            { kind: 'weekly_all', percent: 11, severity: 'normal', resetsAt: Math.floor(Date.parse('2026-10-10T06:59:59.757876+00:00') / 1000), observedAt: now },
            { kind: 'weekly_scoped', label: 'Fable', percent: 17, severity: 'normal', resetsAt: Math.floor(Date.parse('2026-10-10T06:59:59.758027+00:00') / 1000), observedAt: now }
        ]);
    });

    it('tolerates null fields and skips invalid payloads instead of guessing', () => {
        expect(parseUsageLimits({ limits: [{ kind: 'session', percent: null, resets_at: null, severity: null, scope: null }] }, now))
            .toEqual([{ kind: 'session', observedAt: now }]);
        expect(parseUsageLimits({ limits: 'nope' }, now)).toBeNull();
        expect(parseUsageLimits(null, now)).toBeNull();
    });

    it('clamps out-of-range percents into the schema bounds', () => {
        expect(parseUsageLimits({ limits: [{ kind: 'session', percent: 140 }] }, now))
            .toEqual([{ kind: 'session', percent: 100, observedAt: now }]);
        expect(parseUsageLimits({ limits: [{ kind: 'session', percent: -5 }] }, now))
            .toEqual([{ kind: 'session', observedAt: now }]);
    });
});
