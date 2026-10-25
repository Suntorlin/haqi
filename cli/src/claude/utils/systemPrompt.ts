import { trimIdent } from "@/utils/trimIdent";
import { shouldIncludeCoAuthoredBy } from "./claudeSettings";
import { buildPromptWithHaqiAgentInstructions, isPureContextModeEnabled } from "@/agent/utils/haqiAgentInstructions";

/**
 * Base system prompt shared across all configurations
 */
const BASE_SYSTEM_PROMPT = (() => trimIdent(`
    ALWAYS when you start a new chat - you must call a tool "mcp__haqi__change_title" to set a chat title.
    Keep the title specific and stable across follow-up steps.
    Also pass short_title: the same title in a few words (at most 6 Chinese characters or 3 English words), shown where space is narrow.
    Title must summarize the most important outcome of the session, not a secondary step.
    If you implemented a feature and also ran tests, title the feature work, not test execution.
    Do NOT downgrade to generic action-only titles like "Commit changes".
    If the main topic changes significantly, call the tool again to update the title.
    This title is needed to easily find the chat in the future. Help human.

    When the user states a lasting preference or rule, or you learn a durable lesson about this project (a pitfall, a build / deploy / test step that matters), call "mcp__haqi__memory_propose" with one short sentence; set said_by_user when the user said it. Do not propose task progress, temporary details, secrets, or anything the code or git history already shows. A few per session at most.
`))();

/**
 * Co-authored-by credits to append when enabled
 */
const CO_AUTHORED_CREDITS = (() => trimIdent(`
    When making commit messages, you SHOULD also give credit to HAQI like so:

    <main commit message>

    via [HAQI](https://hapi.run)

    Co-Authored-By: HAQI <noreply@hapi.run>
`))();

/**
 * System prompt with conditional Co-Authored-By lines based on Claude's settings.json configuration.
 * Settings are read once on startup for performance.
 */
export const systemPrompt = (() => {
  const includeCoAuthored = shouldIncludeCoAuthoredBy();
  
  if (includeCoAuthored) {
    return BASE_SYSTEM_PROMPT + '\n\n' + CO_AUTHORED_CREDITS;
  } else {
    return BASE_SYSTEM_PROMPT;
  }
})();

export function buildClaudeSystemPrompt(startDir: string): string {
  if (isPureContextModeEnabled()) {
    return '';
  }
  return buildPromptWithHaqiAgentInstructions(systemPrompt, startDir);
}
