/**
 * Codex-specific system prompt for local mode.
 *
 * This prompt instructs Codex to call the haqi__change_title function
 * to set appropriate chat session titles.
 */

import { trimIdent } from '@/utils/trimIdent';
import {
    buildPromptWithHaqiAgentInstructions,
    isCodexReportPromptEnabledInSettings,
    isPureContextModeEnabled
} from '@/agent/utils/haqiAgentInstructions';

const ENABLED_VALUES = new Set(['1', 'true', 'yes', 'on']);

/**
 * Title instruction for Codex to call the haqi MCP tool.
 * Note: Codex exposes MCP tools under the `functions.` namespace,
 * so the tool is called as `functions.haqi__change_title`.
 */
export const TITLE_INSTRUCTION = trimIdent(`
    Based on this message, call functions.haqi__change_title to set a useful chat session title for the main task.
    Keep titles specific and stable across follow-up steps.
    Also pass short_title: the same title in a few words (at most 6 Chinese characters or 3 English words), shown where space is narrow.
    Title must summarize the most important outcome of the session, not a secondary step.
    If you implemented a feature and also ran tests, title the feature work, not test execution.
    Do NOT downgrade to generic action-only titles like "Commit changes".
    Only change the title when the main topic changes significantly.

    When the user states a lasting preference or rule, or you learn a durable lesson about this project (a pitfall, a build / deploy / test step that matters), call functions.haqi__memory_propose with one short sentence; set said_by_user when the user said it. Do not propose task progress, temporary details, secrets, or anything the code or git history already shows. A few per session at most.
`);

export const REPORT_INSTRUCTION = trimIdent(`
    Report rule:
    - Publish a report via MCP tools only for:
      - complex research/investigation tasks (multi-step findings or non-trivial analysis), or
      - E2E/browser/UI testing tasks where image evidence (screenshots) is useful.
    - For routine code edits, simple Q&A, or lightweight checks, do NOT create a report by default.
    - Preferred flow:
      1) functions.haqi__report_create (it creates a public share by default),
      2) functions.haqi__report_add_asset (attach screenshots/log images when available),
      3) functions.haqi__report_update (final markdown polish).
    - Screenshot/file hygiene for report assets:
      - Never save screenshots under the project/workspace directory.
      - Always use an organized external directory such as:
        - $HAPI_HOME/tmp/report-assets/<session-or-task-id>/, or
        - ~/.hapi/tmp/report-assets/<session-or-task-id>/ (fallback).
      - When screenshot tools support "filename"/"save_as", pass the full path explicitly.
      - After successful upload via report_add_asset, clean up temporary local files when possible.
    - report_create creates a public share by default; use functions.haqi__report_create_share only when you need an additional/new share.
    - Public share URLs use the /share/r/<token> form, for example:
      - <report-public-base-url>/share/r/FrG7h-uOFtuKw0Ay1S8NNWhuBB9uNgDq
      - The domain can vary, but the public path format stays /share/r/<token>.
    - If a report is created, include the public share URL in your final answer.
    - If the user explicitly asks to skip report creation, follow that request.
`);

export function isCodexReportPromptEnabled(): boolean {
    const raw = process.env.HAPI_CODEX_ENABLE_REPORT_PROMPT?.trim().toLowerCase();
    if (raw) {
        return ENABLED_VALUES.has(raw);
    }
    return isCodexReportPromptEnabledInSettings();
}

export function getCodexSystemPrompt(): string {
    if (!isCodexReportPromptEnabled()) {
        return TITLE_INSTRUCTION;
    }
    return `${TITLE_INSTRUCTION}

${REPORT_INSTRUCTION}`;
}

/**
 * The system prompt to inject via developer_instructions in local mode.
 */
export function buildCodexSystemPrompt(startDir: string): string {
    if (isPureContextModeEnabled()) {
        return '';
    }
    return buildPromptWithHaqiAgentInstructions(getCodexSystemPrompt(), startDir);
}
