/**
 * HAPI MCP server
 * Provides HAPI CLI specific tools including chat session title management
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { AddressInfo } from "node:net";
import { logger } from "@/ui/logger";
import { ApiSessionClient } from "@/api/apiSession";
import { randomUUID } from "node:crypto";
import { isLowSignalTitle, normalizeTitleCandidate } from "@/utils/titlePolicy";
import { configuration } from "@/configuration";
import { getAuthToken } from "@/api/auth";
import {
    changeTitleInputSchema,
    MEMORY_PROPOSE_DESCRIPTION,
    MEMORY_SEARCH_DESCRIPTION,
    memoryProposeInputSchema,
    memorySearchInputSchema,
    reportAddAssetInputSchema,
    reportCreateInputSchema,
    reportCreateShareInputSchema,
    reportGetInputSchema,
    reportListInputSchema,
    reportUpdateInputSchema,
    reviewLoopWorkerSubmitInputSchema,
    taskDraftSubmitInputSchema,
    TASK_DRAFT_SUBMIT_DESCRIPTION,
    reviewLoopReviewerSubmitInputSchema
} from "@/mcp/hapiMcpTools";

type JsonObject = Record<string, unknown>;

function summarizeJson(payload: unknown): string {
    return JSON.stringify(payload, null, 2);
}

export async function startHappyServer(client: ApiSessionClient) {
    let cachedWebToken: { token: string; expiresAt: number } | null = null;

    const resolveHubUrl = (path: string): string => {
        const normalizedBase = configuration.apiUrl.endsWith("/")
            ? configuration.apiUrl
            : `${configuration.apiUrl}/`;
        return new URL(path, normalizedBase).toString();
    };

    const getWebToken = async (): Promise<string> => {
        if (cachedWebToken && cachedWebToken.expiresAt > Date.now()) {
            return cachedWebToken.token;
        }

        const response = await fetch(resolveHubUrl("/api/auth"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ accessToken: getAuthToken() })
        });

        const payload = await response.json().catch(() => null) as JsonObject | null;
        if (!response.ok) {
            const message = typeof payload?.error === "string"
                ? payload.error
                : `Auth failed (${response.status})`;
            throw new Error(message);
        }

        const token = typeof payload?.token === "string" ? payload.token : "";
        if (!token) {
            throw new Error("Auth succeeded but token is missing");
        }

        cachedWebToken = {
            token,
            expiresAt: Date.now() + 13 * 60 * 1000
        };
        return token;
    };

    const requestHubJson = async (path: string, init?: RequestInit): Promise<JsonObject> => {
        const doRequest = async (token: string): Promise<Response> => {
            const headers = new Headers(init?.headers);
            headers.set("Authorization", `Bearer ${token}`);
            if (init?.body !== undefined && !headers.has("Content-Type")) {
                headers.set("Content-Type", "application/json");
            }
            return await fetch(resolveHubUrl(path), {
                ...init,
                headers
            });
        };

        let response = await doRequest(await getWebToken());
        if (response.status === 401) {
            cachedWebToken = null;
            response = await doRequest(await getWebToken());
        }

        const payload = await response.json().catch(() => null) as JsonObject | null;
        if (!response.ok) {
            const message = typeof payload?.error === "string"
                ? payload.error
                : `Request failed (${response.status})`;
            throw new Error(message);
        }

        return payload ?? {};
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
    const handler = async (title: string) => {
        const normalizedTitle = normalizeTitleCandidate(title);
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
    }, async (args: { title: string }) => {
        const response = await handler(args.title);
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
        metadata?: unknown
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
                    metadata: args.metadata,
                    createShare: true,
                    shareExpiresInHours: args.share_expires_in_hours
                })
            });
            const report = payload.report as JsonObject | undefined;
            const shareUrl = typeof report?.publicShareUrl === 'string' ? report.publicShareUrl : null;
            const summary = shareUrl
                ? `Report created. Public share: ${shareUrl}`
                : 'Report created.';
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
            const query = new URLSearchParams({ q: args.query, limit: String(args.limit ?? 8) });
            if (args.tag) query.set('tag', args.tag);
            const payload = await requestHubJson(`/api/memories/search?${query.toString()}`);
            const hits = Array.isArray(payload.hits) ? payload.hits as JsonObject[] : [];
            const lines = hits.map((hit) => `- [${String(hit.level)} · ${hit.scope ? String(hit.scope) : 'global'} · ${String(hit.status)}] ${String(hit.text)}${Array.isArray(hit.tags) && hit.tags.length > 0 ? ` #${hit.tags.join(' #')}` : ''}`);
            return { content: [{ type: 'text' as const, text: lines.length > 0 ? lines.join('\n') : 'No matching memory.' }], isError: false };
        } catch (error) {
            return buildToolError('Failed to search memory', error);
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
        metadata?: unknown
    }) => {
        try {
            const payload = await requestHubJson(`/api/reports/${encodeURIComponent(args.report_id)}`, {
                method: 'PATCH',
                body: JSON.stringify({
                    taskId: args.task_id,
                    title: args.title,
                    status: args.status,
                    markdown: args.markdown,
                    metadata: args.metadata
                })
            });
            return buildToolResult(payload, `Report updated: ${args.report_id}`);
        } catch (error) {
            return buildToolError(`Failed to update report ${args.report_id}`, error);
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

    mcp.registerTool<any, any>('task_draft_submit', {
        description: TASK_DRAFT_SUBMIT_DESCRIPTION,
        title: 'Submit Task Draft',
        inputSchema: taskDraftSubmitInputSchema
    }, async (args: {
        task_id: string
        tag?: string
        repo_path?: string
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
            'report_create',
            'report_update',
            'report_get',
            'report_list',
            'report_add_asset',
            'report_create_share',
            'task_draft_submit',
            'review_loop_worker_submit',
            'review_loop_reviewer_submit'
        ],
        stop: () => {
            logger.debug('[hapiMCP] Stopping server');
            mcp.close();
            server.close();
        }
    }
}
