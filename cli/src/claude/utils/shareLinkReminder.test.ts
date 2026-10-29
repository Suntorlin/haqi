import { describe, expect, it } from 'vitest';

import type { ClaudeHookEvent } from '@/claude/hooks';
import { shareLinkReminder } from './shareLinkReminder';

function stop(message: string | undefined, active = false): ClaudeHookEvent {
    return {
        session_id: 's1',
        hook_event_name: 'Stop',
        stop_hook_active: active,
        last_assistant_message: message
    } as ClaudeHookEvent;
}

describe('shareLinkReminder', () => {
    it('holds a reply without a share link once', () => {
        const response = shareLinkReminder(stop('改好了，测试全过。'), true);
        expect(response?.exit_code).toBe(0);
        expect(JSON.parse(response!.stdout!)).toMatchObject({ decision: 'block' });
    });

    it('lets a reply with a share link through', () => {
        expect(shareLinkReminder(stop('报告：https://reports.example.com/share/r/T-NFLcAlOHr5C3I9_cB79ookZ5y9jfsU'), true)).toBeUndefined();
    });

    it('never holds twice in a row, when off, or without the last reply', () => {
        expect(shareLinkReminder(stop('改好了。', true), true)).toBeUndefined();
        expect(shareLinkReminder(stop('改好了。'), false)).toBeUndefined();
        expect(shareLinkReminder(stop(undefined), true)).toBeUndefined();
    });

    it('does not count a localhost link or another URL as a share link', () => {
        expect(shareLinkReminder(stop('看这里 http://localhost:3006/share/r/abcdefghijklmnopqrstu'), true)).toBeDefined();
        expect(shareLinkReminder(stop('PR：https://github.com/org/repo/pull/12'), true)).toBeDefined();
    });
});
