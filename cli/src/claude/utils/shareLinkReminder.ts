import type { ClaudeHookEvent, HookResponse } from '@/claude/hooks';

/** A report share link (`https://<host>/share/r/<token>`), the public link the user reads a turn's result through. */
const SHARE_LINK = /https:\/\/[^\s)>\]]+\/share\/r\/[A-Za-z0-9_-]{16,}/;

const REASON = [
    '最终回复里没有公网链接。按用户的规则，每次对话的最终回复都要带公网链接。',
    '请用 haqi MCP 的 report_create（截图用 report_add_asset）发布本轮的结论或证据，',
    '用 curl 确认链接返回 200，再把 /share/r/<token> 链接写进最终回复。'
].join('');

/**
 * With `settings.json` `requireShareLink` on, a Stop whose last reply has no share link is held once: Claude gets
 * the reason and goes on to publish one. A Stop that a hook already held (`stop_hook_active`) passes, so the
 * agent is never held twice in a row.
 */
export function shareLinkReminder(event: ClaudeHookEvent, enabled: boolean): HookResponse | undefined {
    if (!enabled || event.hook_event_name !== 'Stop' || event.stop_hook_active) return undefined;
    const reply = event.last_assistant_message?.trim();
    if (!reply || SHARE_LINK.test(reply)) return undefined;
    return { exit_code: 0, stdout: JSON.stringify({ decision: 'block', reason: REASON }) };
}
