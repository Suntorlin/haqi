/**
 * HAPI MCP server
 * Provides HAPI CLI specific tools including chat session title management
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { isLowSignalTitle, normalizeTitleCandidate } from "@/utils/titlePolicy";
import { configuration } from "@/configuration";
import { requestHubJson } from "@/api/hubHttp";
import {
    changeTitleInputSchema,
    scheduledRunDoneInputSchema,
    scheduleCreateInputSchema,
    scheduleListInputSchema,
    scheduleUpdateInputSchema,
    SCHEDULE_TOOL_DESCRIPTIONS,
    MEMORY_PROPOSE_DESCRIPTION,
    MEMORY_SEARCH_DESCRIPTION,
    memoryProposeInputSchema,
    memorySearchInputSchema,
    EMPLOYEE_WHOAMI_DESCRIPTION,
    EMPLOYEE_LOG_DESCRIPTION,
    employeeWhoamiInputSchema,
    employeeLogInputSchema,
    reportAddAssetInputSchema,
    reportCreateInputSchema,
    handoffFoldersInputSchema,
    HANDOFF_FOLDERS_DESCRIPTION,
    reportCreateShareInputSchema,
    reportGetInputSchema,
    reportListInputSchema,
    reportUpdateInputSchema,
    reviewLoopWorkerSubmitInputSchema,
    taskDraftSubmitInputSchema,
    taskPlanSubmitInputSchema,
    subtaskDoneInputSchema,
    taskDecisionAskInputSchema,
    taskIntegratedInputSchema,
    taskReviewSubmitInputSchema,
    TASK_RUN_TOOL_DESCRIPTIONS,
    TASK_DRAFT_SUBMIT_DESCRIPTION,
    reviewLoopReviewerSubmitInputSchema
} from "@/mcp/hapiMcpTools";

type JsonObject = Record<string, unknown>;

function summarizeJson(payload: unknown): string {
    return JSON.stringify(payload, null, 2);
}

export async function startHappyServer(client: ApiSessionClient) {


    /** The page is read here, on the session's machine, so the hub never reads local paths. */
    const readHtmlPage = async (path: string | undefined): Promise<string | undefined> => {
        if (!path) return undefined;
        return await readFile(path, 'utf8');
    };

    const buildToolResult = (payload: JsonObject, summary: string) => ({
        content: [
            {
                type: "text" as const,
                text: `${summary}\n\n${summarizeJson(payload)}`
            }
        ],
        isError: false
    });

    /** What happens to a handoff report, in words the agent acts on. */
    const handoffLine = (payload: JsonObject): string => {
        const handoff = payload.handoff as JsonObject | null | undefined;
        if (!handoff) return '';
        if (handoff.enabled === false) return '\nHandoff: the notes export is off on this hub. Nothing is copied.';
        if (typeof handoff.problem === 'string' && handoff.problem) {
            const choices = Array.isArray(handoff.candidates) ? handoff.candidates.map(String).slice(0, 12).join('; ') : '';
            return `\nHandoff: ${handoff.problem} Set handoff.folder with report_update.${choices ? ` Choices: ${choices}` : ''}`;
        }
        const summary = handoff.summaryMissing ? ' Add handoff.summary (the one-line index entry).' : '';
        return `\nHandoff: after the session ends, HAQI copies this report to "${String(handoff.folder)}" and lists it in the notes index.${summary}`;
    };

    const toHandoffBody = (handoff: { folder?: string; summary?: string; short_title?: string } | undefined) => handoff
        ? { folder: handoff.folder, summary: handoff.summary, shortTitle: handoff.short_title }
        : undefined;

    const buildToolError = (label: string, error: unknown) => ({
        content: [
            {
                type: "text" as const,
                text: `${label}: ${error instanceof Error ? error.message : String(error)}`
            }
        ],
        isError: true
    });

    // Handler that sends title updates via the client
    const handler = async (title: string, shortTitle?: string) => {
        const normalizedTitle = normalizeTitleCandidate(title);
        // A short title is a few words; a long one is not short and is dropped, the title still changes.
        const short = shortTitle ? normalizeTitleCandidate(shortTitle) : '';
        const normalizedShort = short.length <= 40 ? short : '';
        const currentTitle = client.getCurrentSummaryText();
        const shouldSkipLowSignalUpdate = Boolean(
            currentTitle
            && !isLowSignalTitle(currentTitle)
            && isLowSignalTitle(normalizedTitle)
        );

        logger.debug('[hapiMCP] Changing title to:', normalizedTitle);

        if (!normalizedTitle) {
            return { success: false, error: 'Title cannot be empty.' };
        }
        if (shouldSkipLowSignalUpdate) {
            logger.debug('[hapiMCP] Skipping low-signal title update', {
                currentTitle,
                requestedTitle: normalizedTitle
            });
            return { success: true, skipped: true, title: currentTitle };
        }

        try {
            // Send title as a summary message, similar to title generator
            client.sendClaudeSessionMessage({
                type: 'summary',
                summary: normalizedTitle,
                ...(normalizedShort && normalizedShort !== normalizedTitle ? { short: normalizedShort } : {}),
                leafUuid: randomUUID()
            });
            
            return { success: true, skipped: false, title: normalizedTitle };
        } catch (error) {
            return { success: false, error: String(error) };
        }
    };

    //
    // Create the MCP server
    //

    const mcp = new McpServer({
        name: "HAPI MCP",
        version: "1.0.0",
    });

    mcp.registerTool<any, any>('change_title', {
        description: 'Change the title of the current chat session',
        title: 'Change Chat Title',
        inputSchema: changeTitleInputSchema,
    }, async (args: { title: string; short_title?: string }) => {
        const response = await handler(args.title, args.short_title);
        logger.debug('[hapiMCP] Response:', response);
        
        if (response.success) {
            const message = response.skipped
                ? `Kept existing chat title: "${response.title}".`
                : `Successfully changed chat title to: "${response.title ?? args.title}"`;
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: message,
                    },
                ],
                isError: false,
            };
        } else {
            return {
                content: [
                    {
                        type: 'text' as const,
                        text: `Failed to change chat title: ${response.error || 'Unknown error'}`,
                    },
                ],
                isError: true,
            };
        }
    });

    mcp.registerTool<any, any>('report_create', {
        description: 'Create a markdown report and a public share link. Public links use /share/r/<token> (for example <report-public-base-url>/share/r/FrG7h-uOFtuKw0Ay1S8NNWhuBB9uNgDq).',
        title: 'Create Report',
        inputSchema: reportCreateInputSchema
    }, async (args: {
        session_id?: string
        task_id?: string
        title?: string
        status?: string
        markdown?: string
        html_path?: string
        metadata?: unknown
        handoff?: { folder?: string; summary?: string; short_title?: string }
        share_expires_in_hours?: number
    }) => {
        try {
            const payload = await requestHubJson('/api/reports', {
                method: 'POST',
                body: JSON.stringify({
                    sessionId: args.session_id ?? client.sessionId,
                    taskId: args.task_id,
                    title: args.title,
                    status: args.status,
                    markdown: args.markdown,
                    html: await readHtmlPage(args.html_path),
                    metadata: args.metadata,
                    handoff: toHandoffBody(args.handoff),
                    createShare: true,
                    shareExpiresInHours: args.share_expires_in_hours
                })
            });
            const report = payload.report as JsonObject | undefined;
            const shareUrl = typeof report?.publicShareUrl === 'string' ? report.publicShareUrl : null;
            const summary = (shareUrl
                ? `Report created. Public share: ${shareUrl}`
                : 'Report created.') + handoffLine(payload);
            return buildToolResult(payload, summary);
        } catch (error) {
            return buildToolError('Failed to create report', error);
        }
    });

    mcp.registerTool<any, any>('memory_propose', {
        description: MEMORY_PROPOSE_DESCRIPTION,
        title: 'Propose Memory',
        inputSchema: memoryProposeInputSchema
    }, async (args: { text: string; said_by_user?: boolean }) => {
        try {
            const payload = await requestHubJson('/api/memories/propose', {
                method: 'POST',
                body: JSON.stringify({ text: args.text, said: args.said_by_user ?? false, sessionId: client.sessionId })
            });
            const result = payload.result as JsonObject | undefined;
            const message = typeof result?.message === 'string' ? result.message : 'Memory proposed.';
            return { content: [{ type: 'text' as const, text: message }], isError: false };
        } catch (error) {
            return buildToolError('Failed to propose memory', error);
        }
    });

    mcp.registerTool<any, any>('memory_search', {
        description: MEMORY_SEARCH_DESCRIPTION,
        title: 'Search Memory',
        inputSchema: memorySearchInputSchema
    }, async (args: { query: string; limit?: number; tag?: string }) => {
        try {
            // The session id scopes the search: an employee session sees the shared pool plus its own memories only.
            const query = new URLSearchParams({ q: args.query, limit: String(args.limit ?? 8), sessionId: client.sessionId });
            if (args.tag) query.set('tag', args.tag);
            const payload = await requestHubJson(`/api/memories/search?${query.toString()}`);
            const hits = Array.isArray(payload.hits) ? payload.hits as JsonObject[] : [];
            const lines = hits.map((hit) => `- [${String(hit.level)} · ${hit.scope ? String(hit.scope) : 'global'} · ${String(hit.status)}] ${String(hit.text)}${Array.isArray(hit.tags) && hit.tags.length > 0 ? ` #${hit.tags.join(' #')}` : ''}`);
            return { content: [{ type: 'text' as const, text: lines.length > 0 ? lines.join('\n') : 'No matching memory.' }], isError: false };
        } catch (error) {
            return buildToolError('Failed to search memory', error);
        }
    });

    mcp.registerTool<any, any>('employee_whoami', {
        description: EMPLOYEE_WHOAMI_DESCRIPTION,
        title: 'Employee Identity',
        inputSchema: employeeWhoamiInputSchema
    }, async () => {
        try {
            const payload = await requestHubJson(`/api/employees/whoami?sessionId=${encodeURIComponent(client.sessionId)}`);
            return { content: [{ type: 'text' as const, text: summarizeJson(payload) }], isError: false };
        } catch (error) {
            return buildToolError('Failed to resolve employee identity', error);
        }
    });

    mcp.registerTool<any, any>('employee_log', {
        description: EMPLOYEE_LOG_DESCRIPTION,
        title: 'Employee Run Log',
        inputSchema: employeeLogInputSchema
    }, async (args: { kind: string; text: string; ref?: string }) => {
        try {
            const payload = await requestHubJson('/api/employees/log', {
                method: 'POST',
                body: JSON.stringify({ sessionId: client.sessionId, kind: args.kind, text: args.text, ref: args.ref })
            });
            const message = typeof payload.message === 'string' ? payload.message : 'Logged.';
            return { content: [{ type: 'text' as const, text: message }], isError: false };
        } catch (error) {
            return buildToolError('Failed to write employee log', error);
        }
    });

    mcp.registerTool<any, any>('report_update', {
        description: 'Update report title/status/markdown/metadata',
        title: 'Update Report',
        inputSchema: reportUpdateInputSchema
    }, async (args: {
        report_id: string
        task_id?: string
        title?: string
        status?: string
        markdown?: string
        html_path?: string
        metadata?: unknown
        handoff?: { folder?: string; summary?: string; short_title?: string }
    }) => {
        try {
            const payload = await requestHubJson(`/api/reports/${encodeURIComponent(args.report_id)}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    taskId: args.task_id,
                    title: args.title,
                    status: args.status,
                    markdown: args.markdown,
                    html: args.html_path === '' ? '' : await readHtmlPage(args.html_path),
                    metadata: args.metadata,
                    handoff: toHandoffBody(args.handoff)
                })
            });
            return buildToolResult(payload, `Report updated: ${args.report_id}${handoffLine(payload)}`);
        } catch (error) {
            return buildToolError(`Failed to update report ${args.report_id}`, error);
        }
    });

    mcp.registerTool<any, any>('handoff_folders', {
        description: HANDOFF_FOLDERS_DESCRIPTION,
        title: 'Handoff Folders',
        inputSchema: handoffFoldersInputSchema
    }, async () => {
        try {
            const payload = await requestHubJson(`/api/handoff/folders?sessionId=${encodeURIComponent(client.sessionId)}`);
            if (payload.enabled === false) {
                return { content: [{ type: 'text' as const, text: 'The notes export is off on this hub. Nothing is copied.' }], isError: false };
            }
            const folders = Array.isArray(payload.candidates) ? payload.candidates.map(String) : [];
            const text = folders.length > 0
                ? `Folders (relative to the notes root), most used first:\n${folders.map((folder) => `- ${folder}`).join('\n')}`
                : 'No folder found yet. Ask the user where handoffs of this project go.';
            return { content: [{ type: 'text' as const, text }], isError: false };
        } catch (error) {
            return buildToolError('Failed to list handoff folders', error);
        }
    });

    mcp.registerTool<any, any>('report_get', {
        description: 'Get full report details by report_id',
        title: 'Get Report',
        inputSchema: reportGetInputSchema
    }, async (args: { report_id: string }) => {
        try {
            const payload = await requestHubJson(`/api/reports/${encodeURIComponent(args.report_id)}`);
            return buildToolResult(payload, `Report loaded: ${args.report_id}`);
        } catch (error) {
            return buildToolError(`Failed to load report ${args.report_id}`, error);
        }
    });

    mcp.registerTool<any, any>('report_list', {
        description: 'List reports in current namespace',
        title: 'List Reports',
        inputSchema: reportListInputSchema
    }, async (args: { limit?: number; session_id?: string }) => {
        try {
            const query = new URLSearchParams();
            if (typeof args.limit === 'number') {
                query.set('limit', `${args.limit}`);
            }
            if (typeof args.session_id === 'string' && args.session_id.trim().length > 0) {
                query.set('sessionId', args.session_id.trim());
            }
            const suffix = query.size > 0 ? `?${query.toString()}` : '';
            const payload = await requestHubJson(`/api/reports${suffix}`);
            return buildToolResult(payload, 'Reports loaded.');
        } catch (error) {
            return buildToolError('Failed to list reports', error);
        }
    });

    mcp.registerTool<any, any>('report_add_asset', {
        description: 'Attach image/file asset to a report using base64/data-url/source-path',
        title: 'Add Report Asset',
        inputSchema: reportAddAssetInputSchema
    }, async (args: {
        report_id: string
        filename?: string
        mime_type?: string
        content_base64?: string
        content_data_url?: string
        source_path?: string
        caption?: string
    }) => {
        try {
            const content = args.content_data_url ?? args.content_base64;
            const payload = await requestHubJson(`/api/reports/${encodeURIComponent(args.report_id)}/assets`, {
                method: 'POST',
                body: JSON.stringify({
                    filename: args.filename,
                    mimeType: args.mime_type,
                    content,
                    sourcePath: args.source_path,
                    caption: args.caption
                })
            });
            return buildToolResult(payload, `Asset added to report: ${args.report_id}`);
        } catch (error) {
            return buildToolError(`Failed to add asset for report ${args.report_id}`, error);
        }
    });

    mcp.registerTool<any, any>('report_create_share', {
        description: 'Create a public share link for a report. Public links use /share/r/<token> (for example <report-public-base-url>/share/r/FrG7h-uOFtuKw0Ay1S8NNWhuBB9uNgDq).',
        title: 'Create Report Share',
        inputSchema: reportCreateShareInputSchema
    }, async (args: { report_id: string; expires_in_hours?: number; created_by?: string }) => {
        try {
            const payload = await requestHubJson(`/api/reports/${encodeURIComponent(args.report_id)}/shares`, {
                method: 'POST',
                body: JSON.stringify({
                    expiresInHours: args.expires_in_hours,
                    createdBy: args.created_by
                })
            });
            const share = payload.share as JsonObject | undefined;
            const shareUrl = typeof share?.shareUrl === 'string' ? share.shareUrl : null;
            const summary = shareUrl
                ? `Report share created: ${shareUrl}`
                : `Report share created for ${args.report_id}`;
            return buildToolResult(payload, summary);
        } catch (error) {
            return buildToolError(`Failed to create share for report ${args.report_id}`, error);
        }
    });

    const taskRunTool = (name: keyof typeof TASK_RUN_TOOL_DESCRIPTIONS, title: string, inputSchema: unknown, path: (args: any) => string, body: (args: any) => unknown) => {
        mcp.registerTool<any, any>(name, { description: TASK_RUN_TOOL_DESCRIPTIONS[name], title, inputSchema: inputSchema as any }, async (args: any) => {
            try {
                const payload = await requestHubJson(path(args), { method: 'POST', body: JSON.stringify(body(args)) });
                const message = typeof payload.message === 'string' ? payload.message : 'Done.';
                return { content: [{ type: 'text' as const, text: message }], isError: false };
            } catch (error) {
                return buildToolError(`Failed: ${title}`, error);
            }
        });
    };
    const taskPath = (args: { task_id: string }, rest: string) => `/api/tasks/${encodeURIComponent(args.task_id)}/${rest}`;
    taskRunTool('task_plan_submit', 'Submit Task Plan', taskPlanSubmitInputSchema, (a) => taskPath(a, 'plan'), (a) => ({
        subtasks: a.subtasks.map((s: any) => ({ id: s.id, title: s.title, brief: s.brief, criteria: s.criteria ?? [], dependsOn: s.depends_on ?? [] }))
    }));
    taskRunTool('subtask_done', 'Subtask Done', subtaskDoneInputSchema, (a) => taskPath(a, 'subtasks/done'), (a) => ({
        subtaskId: a.subtask_id, summary: a.summary, evidence: a.evidence ?? []
    }));
    taskRunTool('task_decision_ask', 'Ask the User to Decide', taskDecisionAskInputSchema, (a) => taskPath(a, 'decisions'), (a) => ({
        question: a.question, context: a.context, options: a.options, recommended: a.recommended, sessionId: client.sessionId
    }));
    taskRunTool('task_integrated', 'Branches Merged', taskIntegratedInputSchema, (a) => taskPath(a, 'integrated'), (a) => ({
        branch: a.branch, worktreePath: a.worktree_path, summary: a.summary
    }));
    taskRunTool('task_review_submit', 'Submit Task Review', taskReviewSubmitInputSchema, (a) => taskPath(a, 'review'), (a) => ({
        results: a.results.map((r: any) => ({ criterionId: r.criterion_id, status: r.status, evidence: r.evidence })), suggestions: a.suggestions ?? []
    }));

    type ScheduleArgs = {
        id?: string; name?: string; prompt?: string; prompt_file?: string; cron?: string; run_at?: string; timezone?: string
        directory?: string; model?: string; permission_mode?: string; max_minutes?: number; enabled?: boolean; manual?: boolean
    };
    const scheduleBody = (args: ScheduleArgs, creating: boolean): JsonObject => {
        const body: JsonObject = {};
        if (args.name !== undefined) body.name = args.name;
        if (args.prompt !== undefined) body.prompt = args.prompt;
        if (args.prompt_file !== undefined) body.promptFile = args.prompt_file;
        if (args.directory !== undefined) body.directory = args.directory;
        if (args.model !== undefined) body.model = args.model;
        if (args.permission_mode !== undefined) body.permissionMode = args.permission_mode;
        if (args.max_minutes !== undefined) body.maxMinutes = args.max_minutes;
        if (args.enabled !== undefined) body.enabled = args.enabled;
        if (args.run_at) {
            const at = Date.parse(args.run_at);
            if (!Number.isFinite(at)) throw new Error(`run_at is not an ISO 8601 time: ${args.run_at}`);
            body.spec = { kind: 'once', at };
        } else if (args.cron) {
            body.spec = { kind: 'cron', expr: args.cron.trim() };
        } else if (creating || args.manual) {
            body.spec = { kind: 'manual' };
        }
        if (args.timezone !== undefined || creating) body.timezone = args.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        return body;
    };
    const describeSchedule = (schedule: JsonObject): string => {
        const next = typeof schedule.nextRunAt === 'number' ? new Date(schedule.nextRunAt).toISOString() : 'none';
        const last = schedule.lastRun as JsonObject | null | undefined;
        const lastText = last ? `${String(last.status)}${last.summary ? ` (${String(last.summary)})` : ''}` : 'never ran';
        return `- ${String(schedule.id)} · ${String(schedule.name)} · ${JSON.stringify(schedule.spec)} ${String(schedule.timezone)} · ${schedule.enabled ? 'active' : 'paused'} · next ${next} · last ${lastText}`;
    };

    mcp.registerTool<any, any>('scheduled_run_done', {
        description: SCHEDULE_TOOL_DESCRIPTIONS.scheduled_run_done,
        title: 'Scheduled Run Done',
        inputSchema: scheduledRunDoneInputSchema
    }, async (args: { status: string; summary: string; links?: string[] }) => {
        try {
            await requestHubJson('/api/schedules/runs/done', {
                method: 'POST',
                body: JSON.stringify({ sessionId: client.sessionId, status: args.status, summary: args.summary, links: args.links ?? [] })
            });
            return { content: [{ type: 'text' as const, text: `Run recorded as ${args.status}.` }], isError: false };
        } catch (error) {
            return buildToolError('Failed to record the scheduled run', error);
        }
    });

    mcp.registerTool<any, any>('schedule_create', {
        description: SCHEDULE_TOOL_DESCRIPTIONS.schedule_create,
        title: 'Create Scheduled Task',
        inputSchema: scheduleCreateInputSchema
    }, async (args: ScheduleArgs) => {
        try {
            const payload = await requestHubJson('/api/schedules', {
                method: 'POST',
                body: JSON.stringify({ ...scheduleBody(args, true), fromSessionId: client.sessionId })
            });
            const schedule = payload.schedule as JsonObject;
            return { content: [{ type: 'text' as const, text: `Scheduled task created.\n${describeSchedule(schedule)}` }], isError: false };
        } catch (error) {
            return buildToolError('Failed to create the scheduled task', error);
        }
    });

    mcp.registerTool<any, any>('schedule_list', {
        description: SCHEDULE_TOOL_DESCRIPTIONS.schedule_list,
        title: 'List Scheduled Tasks',
        inputSchema: scheduleListInputSchema
    }, async () => {
        try {
            const payload = await requestHubJson('/api/schedules');
            const schedules = Array.isArray(payload.schedules) ? payload.schedules as JsonObject[] : [];
            return { content: [{ type: 'text' as const, text: schedules.length > 0 ? schedules.map(describeSchedule).join('\n') : 'No scheduled tasks.' }], isError: false };
        } catch (error) {
            return buildToolError('Failed to list scheduled tasks', error);
        }
    });

    mcp.registerTool<any, any>('schedule_update', {
        description: SCHEDULE_TOOL_DESCRIPTIONS.schedule_update,
        title: 'Update Scheduled Task',
        inputSchema: scheduleUpdateInputSchema
    }, async (args: ScheduleArgs & { id: string }) => {
        try {
            const payload = await requestHubJson(`/api/schedules/${encodeURIComponent(args.id)}`, {
                method: 'PATCH',
                body: JSON.stringify(scheduleBody(args, false))
            });
            return { content: [{ type: 'text' as const, text: `Scheduled task updated.\n${describeSchedule(payload.schedule as JsonObject)}` }], isError: false };
        } catch (error) {
            return buildToolError(`Failed to update scheduled task ${args.id}`, error);
        }
    });

    mcp.registerTool<any, any>('task_draft_submit', {
        description: TASK_DRAFT_SUBMIT_DESCRIPTION,
        title: 'Submit Task Draft',
        inputSchema: taskDraftSubmitInputSchema
    }, async (args: {
        task_id: string
        tag?: string
        repo_path?: string
        machine_id?: string
        machine_reason?: string
        goal: string
        non_goals?: string[]
        criteria: Array<{ text: string; source: 'principle' | 'repo' | 'inferred'; source_ref?: string; verify: string }>
        questions?: Array<{ id: string; text: string; options: Array<{ id: string; label: string; good?: string; cost?: string }>; default: string; precedent_ref?: string }>
    }) => {
        try {
            const payload = await requestHubJson(`/api/tasks/${encodeURIComponent(args.task_id)}/draft`, {
                method: 'POST',
                body: JSON.stringify({
                    tag: args.tag,
                    repoPath: args.repo_path,
                    machineId: args.machine_id,
                    machineReason: args.machine_reason,
                    goal: args.goal,
                    nonGoals: args.non_goals ?? [],
                    criteria: args.criteria.map((criterion) => ({
                        text: criterion.text,
                        source: criterion.source,
                        sourceRef: criterion.source_ref,
                        verify: criterion.verify
                    })),
                    questions: (args.questions ?? []).map((question) => ({
                        id: question.id,
                        text: question.text,
                        options: question.options,
                        default: question.default,
                        precedentRef: question.precedent_ref
                    }))
                })
            });
            const message = typeof payload.message === 'string' ? payload.message : 'Draft submitted.';
            return { content: [{ type: 'text' as const, text: message }], isError: false };
        } catch (error) {
            return buildToolError('Failed to submit the task draft', error);
        }
    });

    mcp.registerTool<any, any>('review_loop_worker_submit', {
        description: 'Submit your execution results for the current ReviewLoop round',
        title: 'Submit Review Loop Worker Output',
        inputSchema: reviewLoopWorkerSubmitInputSchema
    }, async (args: {
        loop_id: string
        round_id: string
        raw_response: string
        summary?: string
        diff: string
        files_changed: string[]
        commands: { command: string; exit_code: number; stdout: string; stderr: string }[]
        exit_status: 'success' | 'error'
    }) => {
        try {
            const payload = await requestHubJson(
                `/api/review-loops/${encodeURIComponent(args.loop_id)}/rounds/${encodeURIComponent(args.round_id)}/worker-output`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        workerOutput: {
                            rawResponse: args.raw_response,
                            summary: args.summary,
                            diff: args.diff,
                            filesChanged: args.files_changed,
                            commands: args.commands.map((c: any) => ({
                                command: c.command,
                                exitCode: c.exit_code,
                                stdout: c.stdout,
                                stderr: c.stderr
                            })),
                            exitStatus: args.exit_status
                        }
                    })
                }
            );
            return buildToolResult(payload, 'Worker output submitted successfully.');
        } catch (error) {
            return buildToolError('Failed to submit worker output', error);
        }
    });

    mcp.registerTool<any, any>('review_loop_reviewer_submit', {
        description: 'Submit your review verdict for the current ReviewLoop round',
        title: 'Submit Review Loop Verdict',
        inputSchema: reviewLoopReviewerSubmitInputSchema
    }, async (args: {
        loop_id: string
        round_id: string
        action: 'continue' | 'pass' | 'abort' | 'notify_user'
        feedback: string
        user_message?: string
        progress: number
        criteria_status: { criteria: string; status: 'met' | 'not_met' | 'unclear'; note?: string }[]
    }) => {
        try {
            const payload = await requestHubJson(
                `/api/review-loops/${encodeURIComponent(args.loop_id)}/rounds/${encodeURIComponent(args.round_id)}/verdict`,
                {
                    method: 'POST',
                    body: JSON.stringify({
                        verdict: {
                            action: args.action,
                            feedback: args.feedback,
                            userMessage: args.user_message,
                            progress: args.progress,
                            criteriaStatus: args.criteria_status.map((c: any) => ({
                                criteria: c.criteria,
                                status: c.status,
                                note: c.note
                            }))
                        }
                    })
                }
            );
            const nextAction = (payload as any)?.nextAction;
            const summary = nextAction
                ? `Verdict submitted. Next action: ${nextAction}`
                : `Verdict submitted: ${args.action}`;
            return buildToolResult(payload, summary);
        } catch (error) {
            return buildToolError('Failed to submit verdict', error);
        }
    });

    const transport = new StreamableHTTPServerTransport({
        // NOTE: Returning session id here will result in claude
        // sdk spawn to fail with `Invalid Request: Server already initialized`
        sessionIdGenerator: undefined
    });
    await mcp.connect(transport);

    //
    // Create the HTTP server
    //

    const server = createServer(async (req, res) => {
        try {
            await transport.handleRequest(req, res);
        } catch (error) {
            logger.debug("Error handling request:", error);
            if (!res.headersSent) {
                res.writeHead(500).end();
            }
        }
    });

    const baseUrl = await new Promise<URL>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
            const addr = server.address() as AddressInfo;
            resolve(new URL(`http://127.0.0.1:${addr.port}`));
        });
    });

    return {
        url: baseUrl.toString(),
        toolNames: [
            'change_title',
            'memory_propose',
            'memory_search',
            'employee_whoami',
            'employee_log',
            'report_create',
            'report_update',
            'report_get',
            'report_list',
            'report_add_asset',
            'report_create_share',
            'handoff_folders',
            'task_draft_submit',
            'task_plan_submit',
            'subtask_done',
            'task_decision_ask',
            'task_integrated',
            'task_review_submit',
            'review_loop_worker_submit',
            'review_loop_reviewer_submit',
            'scheduled_run_done',
            'schedule_create',
            'schedule_list',
            'schedule_update'
        ],
        stop: () => {
            logger.debug('[hapiMCP] Stopping server');
            mcp.close();
            server.close();
        }
    }
}
