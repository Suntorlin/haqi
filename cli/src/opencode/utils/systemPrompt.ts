/**
 * OpenCode-specific system prompt for change_title tool.
 *
 * OpenCode exposes MCP tools with the naming pattern: <server-name>_<tool-name>
 * The haqi MCP server exposes `change_title`, so it's called as `haqi_change_title`.
 */

import { trimIdent } from '@/utils/trimIdent';
import { buildPromptWithHaqiAgentInstructions, isPureContextModeEnabled } from '@/agent/utils/haqiAgentInstructions';

/**
 * Title instruction for OpenCode to call the haqi MCP tool.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    ALWAYS when you start a new chat - you must call the tool "haqi_change_title" to set a chat title.
    Keep the title specific and stable across follow-up steps.
    Also pass short_title: the same title in a few words (at most 6 Chinese characters or 3 English words), shown where space is narrow.
    Title must summarize the most important outcome of the session, not a secondary step.
    If you implemented a feature and also ran tests, title the feature work, not test execution.
    Do NOT downgrade to generic action-only titles like "Commit changes".
    If the main topic changes significantly, call the tool again to update the title.
    This title is needed to easily find the chat in the future. Help human.

    When the user states a lasting preference or rule, or you learn a durable lesson about this project (a pitfall, a build / deploy / test step that matters), call the tool "haqi_memory_propose" with one short sentence; set said_by_user when the user said it. Do not propose task progress, temporary details, secrets, or anything the code or git history already shows. A few per session at most.
`);

/**
 * The system prompt to inject for OpenCode sessions.
 */
export const opencodeSystemPrompt = TITLE_INSTRUCTION;

export function buildOpencodeSystemPrompt(startDir: string): string {
    if (isPureContextModeEnabled()) {
        return '';
    }
    return buildPromptWithHaqiAgentInstructions(opencodeSystemPrompt, startDir);
}
