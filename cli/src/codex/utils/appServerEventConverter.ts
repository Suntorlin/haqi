import { logger } from '@/ui/logger';

type ConvertedEvent = {
    type: string;
    [key: string]: unknown;
};

type GenericToolMeta = {
    name: string;
    input: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
}

function asNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) return null;
    const values = value.filter((part): part is string => typeof part === 'string' && part.length > 0);
    return values.length > 0 ? values : null;
}

function joinStringParts(value: unknown): string | null {
    if (typeof value === 'string' && value.length > 0) return value;

    const values = asStringArray(value);
    if (!values) return null;

    return values.join('\n\n');
}

function extractErrorMessage(value: unknown): string | null {
    const direct = asString(value);
    if (direct) return direct;

    const record = asRecord(value);
    if (!record) return null;

    return asString(record.message ?? record.error ?? record.reason);
}

function extractItemId(params: Record<string, unknown>): string | null {
    const direct = asString(params.itemId ?? params.item_id ?? params.id);
    if (direct) return direct;

    const item = asRecord(params.item);
    if (item) {
        return asString(item.id ?? item.itemId ?? item.item_id);
    }

    return null;
}

function extractItem(params: Record<string, unknown>): Record<string, unknown> | null {
    const item = asRecord(params.item);
    return item ?? params;
}

function normalizeItemType(value: unknown): string | null {
    const raw = asString(value);
    if (!raw) return null;
    return raw.toLowerCase().replace(/[\s_-]/g, '');
}

function extractCommand(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
        const parts = value.filter((part): part is string => typeof part === 'string');
        return parts.length > 0 ? parts.join(' ') : null;
    }
    return null;
}

function extractChanges(value: unknown): Record<string, unknown> | null {
    if (Array.isArray(value)) {
        const changes: Record<string, unknown> = {};
        for (const entry of value) {
            const entryRecord = asRecord(entry);
            if (!entryRecord) continue;
            const path = asString(entryRecord.path ?? entryRecord.file ?? entryRecord.filePath ?? entryRecord.file_path);
            if (path) {
                changes[path] = entryRecord;
            }
        }
        return Object.keys(changes).length > 0 ? changes : null;
    }

    const record = asRecord(value);
    if (record) return record;

    return null;
}

function extractWebSearchQuery(item: Record<string, unknown>): string | null {
    const directQuery = asString(item.query);
    if (directQuery) return directQuery;

    const action = asRecord(item.action);
    if (!action) return null;

    const actionQuery = asString(action.query)
        ?? asString(action.url)
        ?? asString(action.pageUrl ?? action.page_url)
        ?? asString(action.pattern);
    if (actionQuery) return actionQuery;

    const queries = asStringArray(action.queries);
    return queries?.[0] ?? null;
}

function sanitizeToolPart(value: unknown): string {
    const raw = asString(value) ?? 'unknown';
    const sanitized = raw
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();

    return sanitized.length > 0 ? sanitized : 'unknown';
}

function buildMcpToolName(server: unknown, tool: unknown): string {
    return `mcp__${sanitizeToolPart(server)}__${sanitizeToolPart(tool)}`;
}

function toSnakeCase(value: unknown): string {
    const raw = asString(value) ?? 'tool';
    const withUnderscores = raw
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();

    return withUnderscores.length > 0 ? withUnderscores : 'tool';
}

function isCompletedStatus(status: unknown): boolean | null {
    const value = asString(status);
    if (!value) return null;

    const normalized = value.toLowerCase();
    if (normalized === 'completed' || normalized === 'complete' || normalized === 'success' || normalized === 'succeeded' || normalized === 'applied') {
        return true;
    }
    if (normalized === 'failed' || normalized === 'declined' || normalized === 'error' || normalized === 'canceled' || normalized === 'cancelled') {
        return false;
    }

    return null;
}

function extractTextFromContent(value: unknown): string | null {
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }

    if (!Array.isArray(value)) {
        return null;
    }

    const chunks: string[] = [];
    for (const entry of value) {
        const record = asRecord(entry);
        if (!record) continue;
        const text = asString(record.text ?? record.message ?? record.content);
        if (text) {
            chunks.push(text);
        }
    }

    if (chunks.length === 0) {
        return null;
    }

    return chunks.join('');
}

function extractItemText(item: Record<string, unknown>): string | null {
    return asString(item.text ?? item.message) ?? extractTextFromContent(item.content);
}

function extractReasoningText(item: Record<string, unknown>): string | null {
    const direct = extractItemText(item);
    if (direct) {
        return direct;
    }

    const summary = item.summary_text ?? item.summaryText;
    if (Array.isArray(summary)) {
        const chunks = summary.filter((part): part is string => typeof part === 'string' && part.length > 0);
        if (chunks.length > 0) {
            return chunks.join('\n');
        }
    }

    return null;
}

export class AppServerEventConverter {
    private readonly agentMessageBuffers = new Map<string, string>();
    private readonly reasoningSummaryBuffers = new Map<string, string>();
    private readonly reasoningContentBuffers = new Map<string, string>();
    private readonly planBuffers = new Map<string, string>();

    private readonly commandOutputBuffers = new Map<string, string>();
    private readonly commandInputBuffers = new Map<string, string[]>();
    private readonly fileChangeOutputBuffers = new Map<string, string>();

    private readonly commandMeta = new Map<string, Record<string, unknown>>();
    private readonly fileChangeMeta = new Map<string, Record<string, unknown>>();
    private readonly genericToolMeta = new Map<string, GenericToolMeta>();
    private readonly genericToolProgress = new Map<string, string[]>();
    private readonly completedAgentMessageItems = new Set<string>();
    private readonly completedReasoningItems = new Set<string>();
    private readonly reasoningSectionBreakKeys = new Set<string>();
    private readonly lastAgentMessageDeltaByItemId = new Map<string, string>();
    private readonly lastReasoningDeltaByItemId = new Map<string, string>();
    private readonly lastCommandOutputDeltaByItemId = new Map<string, string>();

    private beginGenericToolCall(events: ConvertedEvent[], itemId: string, name: string, input: unknown): void {
        this.genericToolMeta.set(itemId, { name, input });
        events.push({
            type: 'tool_call_begin',
            call_id: itemId,
            name,
            input
        });
    }

    private completeGenericToolCall(events: ConvertedEvent[], itemId: string, fallbackName: string, output: Record<string, unknown>): void {
        const meta = this.genericToolMeta.get(itemId);
        const progress = this.genericToolProgress.get(itemId);
        if (progress && progress.length > 0) {
            output.progress = progress;
        }

        events.push({
            type: 'tool_call_end',
            call_id: itemId,
            name: meta?.name ?? fallbackName,
            output
        });

        this.genericToolMeta.delete(itemId);
        this.genericToolProgress.delete(itemId);
    }

    private handleWrappedCodexEvent(paramsRecord: Record<string, unknown>): ConvertedEvent[] | null {
        const msg = asRecord(paramsRecord.msg);
        if (!msg) {
            return [];
        }

        const msgType = asString(msg.type);
        if (!msgType) {
            return [];
        }

        if (msgType === 'item_started' || msgType === 'item_completed') {
            const itemMethod = msgType === 'item_started' ? 'item/started' : 'item/completed';
            const item = asRecord(msg.item) ?? {};
            const params: Record<string, unknown> = {
                item,
                itemId: asString(msg.item_id ?? msg.itemId ?? item.id),
                threadId: asString(msg.thread_id ?? msg.threadId),
                turnId: asString(msg.turn_id ?? msg.turnId)
            };
            return this.handleNotification(itemMethod, params);
        }

        if (
            msgType === 'task_started'
            || msgType === 'task_complete'
            || msgType === 'turn_aborted'
            || msgType === 'task_failed'
        ) {
            const turnId = asString(msg.turn_id ?? msg.turnId);
            if ((msgType === 'task_complete' || msgType === 'turn_aborted' || msgType === 'task_failed') && !turnId) {
                logger.debug('[AppServerEventConverter] Ignoring wrapped terminal event without turn_id', { msgType });
                return [];
            }

            const event: ConvertedEvent = { type: msgType };
            if (turnId) {
                event.turn_id = turnId;
            }
            if (msgType === 'task_failed') {
                const error = asString(msg.error ?? msg.message ?? asRecord(msg.error)?.message);
                if (error) {
                    event.error = error;
                }
            }
            return [event];
        }

        if (msgType === 'agent_message_delta' || msgType === 'agent_message_content_delta') {
            const itemId = asString(msg.item_id ?? msg.itemId ?? msg.id) ?? 'agent-message';
            const delta = asString(msg.delta ?? msg.text ?? msg.message);
            if (!delta) return [];
            return this.handleNotification('item/agentMessage/delta', { itemId, delta });
        }

        if (msgType === 'reasoning_content_delta') {
            const itemId = asString(msg.item_id ?? msg.itemId ?? msg.id) ?? 'reasoning';
            const delta = asString(msg.delta ?? msg.text ?? msg.message);
            if (!delta) return [];
            return this.handleNotification('item/reasoning/summaryTextDelta', { itemId, delta });
        }

        if (msgType === 'agent_reasoning_section_break') {
            const itemId = asString(msg.item_id ?? msg.itemId ?? msg.id) ?? 'reasoning';
            const summaryIndex = asNumber(msg.summary_index ?? msg.summaryIndex);
            return this.handleNotification('item/reasoning/summaryPartAdded', {
                itemId,
                ...(summaryIndex !== null ? { summaryIndex } : {})
            });
        }

        if (msgType === 'agent_reasoning_delta' || msgType === 'agent_reasoning' || msgType === 'agent_message') {
            return [];
        }

        if (msgType === 'exec_command_output_delta') {
            const itemId = asString(msg.call_id ?? msg.callId ?? msg.item_id ?? msg.itemId ?? msg.id);
            const delta = asString(msg.delta ?? msg.output ?? msg.stdout ?? msg.text);
            if (!itemId || !delta) return [];
            return this.handleNotification('item/commandExecution/outputDelta', { itemId, delta });
        }

        if (msgType === 'error') {
            const errorRecord = asRecord(msg.error);
            const willRetry = asBoolean(msg.will_retry ?? msg.willRetry ?? errorRecord?.will_retry ?? errorRecord?.willRetry) ?? false;
            if (willRetry) {
                return [];
            }
            const error = asString(msg.message ?? msg.reason ?? errorRecord?.message);
            return error ? [{ type: 'task_failed', error }] : [];
        }

        if (
            msgType === 'mcp_startup_update'
            || msgType === 'mcp_startup_complete'
            || msgType === 'plan_update'
            || msgType === 'skills_update_available'
            || msgType === 'stream_error'
            || msgType === 'warning'
            || msgType === 'context_compacted'
            || msgType === 'terminal_interaction'
            || msgType === 'user_message'
        ) {
            return [];
        }

        return [msg as ConvertedEvent];
    }

    handleNotification(method: string, params: unknown): ConvertedEvent[] {
        const events: ConvertedEvent[] = [];
        const paramsRecord = asRecord(params) ?? {};

        if (method.startsWith('codex/event/')) {
            return this.handleWrappedCodexEvent(paramsRecord) ?? events;
        }

        if (method === 'account/rateLimits/updated') {
            return events;
        }

        if (method === 'thread/started' || method === 'thread/resumed') {
            const thread = asRecord(paramsRecord.thread) ?? paramsRecord;
            const threadId = asString(thread.threadId ?? thread.thread_id ?? thread.id);
            if (threadId) {
                events.push({ type: 'thread_started', thread_id: threadId });
            }
            return events;
        }

        if (method === 'thread/compacted') {
            const threadId = asString(paramsRecord.threadId ?? paramsRecord.thread_id);
            const turnId = asString(paramsRecord.turnId ?? paramsRecord.turn_id);
            events.push({
                type: 'context_compacted',
                ...(threadId ? { thread_id: threadId } : {}),
                ...(turnId ? { turn_id: turnId } : {})
            });
            return events;
        }

        if (method === 'turn/started') {
            const turn = asRecord(paramsRecord.turn) ?? paramsRecord;
            const turnId = asString(turn.turnId ?? turn.turn_id ?? turn.id);
            events.push({ type: 'task_started', ...(turnId ? { turn_id: turnId } : {}) });
            return events;
        }

        if (method === 'turn/completed') {
            const turn = asRecord(paramsRecord.turn) ?? paramsRecord;
            const statusRaw = asString(paramsRecord.status ?? turn.status);
            const status = statusRaw?.toLowerCase();
            const turnId = asString(turn.turnId ?? turn.turn_id ?? turn.id);
            const errorMessage = extractErrorMessage(paramsRecord.error)
                ?? extractErrorMessage(paramsRecord.message)
                ?? extractErrorMessage(paramsRecord.reason)
                ?? extractErrorMessage(asRecord(turn.error)?.message ?? turn.error);

            if (status === 'interrupted' || status === 'cancelled' || status === 'canceled') {
                events.push({ type: 'turn_aborted', ...(turnId ? { turn_id: turnId } : {}) });
                return events;
            }

            if (status === 'failed' || status === 'error') {
                events.push({ type: 'task_failed', ...(turnId ? { turn_id: turnId } : {}), ...(errorMessage ? { error: errorMessage } : {}) });
                return events;
            }

            events.push({ type: 'task_complete', ...(turnId ? { turn_id: turnId } : {}) });
            return events;
        }

        if (method === 'turn/diff/updated') {
            const diff = asString(paramsRecord.diff ?? paramsRecord.unified_diff ?? paramsRecord.unifiedDiff);
            if (diff) {
                events.push({ type: 'turn_diff', unified_diff: diff });
            }
            return events;
        }

        if (method === 'turn/plan/updated') {
            const explanation = asString(paramsRecord.explanation);
            const plan = Array.isArray(paramsRecord.plan) ? paramsRecord.plan : [];
            events.push({
                type: 'turn_plan_updated',
                ...(explanation ? { explanation } : {}),
                plan
            });
            return events;
        }

        if (method === 'model/rerouted') {
            const fromModel = asString(paramsRecord.fromModel ?? paramsRecord.from_model);
            const toModel = asString(paramsRecord.toModel ?? paramsRecord.to_model);
            const reason = asString(paramsRecord.reason);
            events.push({
                type: 'model_rerouted',
                ...(fromModel ? { from_model: fromModel } : {}),
                ...(toModel ? { to_model: toModel } : {}),
                ...(reason ? { reason } : {})
            });
            return events;
        }

        if (method === 'thread/tokenUsage/updated') {
            const info = asRecord(paramsRecord.tokenUsage ?? paramsRecord.token_usage ?? paramsRecord) ?? {};
            events.push({ type: 'token_count', info });
            return events;
        }

        if (method === 'error') {
            const willRetry = asBoolean(paramsRecord.will_retry ?? paramsRecord.willRetry) ?? false;
            if (willRetry) return events;
            const message = extractErrorMessage(paramsRecord.message)
                ?? extractErrorMessage(paramsRecord.error)
                ?? extractErrorMessage(paramsRecord);
            if (message) {
                events.push({ type: 'task_failed', error: message });
            }
            return events;
        }

        if (method === 'item/agentMessage/delta') {
            const itemId = extractItemId(paramsRecord);
            const delta = asString(paramsRecord.delta ?? paramsRecord.text ?? paramsRecord.message);
            if (itemId && delta) {
                const lastDelta = this.lastAgentMessageDeltaByItemId.get(itemId);
                if (lastDelta === delta) {
                    return events;
                }
                this.lastAgentMessageDeltaByItemId.set(itemId, delta);
                const prev = this.agentMessageBuffers.get(itemId) ?? '';
                this.agentMessageBuffers.set(itemId, prev + delta);
            }
            return events;
        }

        if (method === 'item/plan/delta') {
            const itemId = extractItemId(paramsRecord) ?? 'plan';
            const delta = asString(paramsRecord.delta ?? paramsRecord.text ?? paramsRecord.message);
            if (delta) {
                const prev = this.planBuffers.get(itemId) ?? '';
                this.planBuffers.set(itemId, prev + delta);
                events.push({ type: 'plan_delta', item_id: itemId, delta });
            }
            return events;
        }

        if (method === 'item/reasoning/textDelta' || method === 'item/reasoning/summaryTextDelta') {
            const itemId = extractItemId(paramsRecord) ?? 'reasoning';
            const delta = asString(paramsRecord.delta ?? paramsRecord.text ?? paramsRecord.message);
            if (delta) {
                const lastDelta = this.lastReasoningDeltaByItemId.get(itemId);
                if (lastDelta === delta) {
                    return events;
                }
                this.lastReasoningDeltaByItemId.set(itemId, delta);
                if (method === 'item/reasoning/summaryTextDelta') {
                    const prev = this.reasoningSummaryBuffers.get(itemId) ?? '';
                    this.reasoningSummaryBuffers.set(itemId, prev + delta);
                } else {
                    const prev = this.reasoningContentBuffers.get(itemId) ?? '';
                    this.reasoningContentBuffers.set(itemId, prev + delta);
                }

                events.push({
                    type: 'agent_reasoning_delta',
                    item_id: itemId,
                    delta
                });
            }
            return events;
        }

        if (method === 'item/reasoning/summaryPartAdded') {
            const itemId = extractItemId(paramsRecord) ?? 'reasoning';
            const summaryIndex = asNumber(paramsRecord.summaryIndex ?? paramsRecord.summary_index);
            if (summaryIndex !== null) {
                const key = `${itemId}:${summaryIndex}`;
                if (this.reasoningSectionBreakKeys.has(key)) {
                    return events;
                }
                this.reasoningSectionBreakKeys.add(key);
            }
            events.push({
                type: 'agent_reasoning_section_break',
                ...(itemId ? { item_id: itemId } : {}),
                ...(summaryIndex !== null ? { summary_index: summaryIndex } : {})
            });
            return events;
        }

        if (method === 'item/commandExecution/outputDelta') {
            const itemId = extractItemId(paramsRecord);
            const delta = asString(paramsRecord.delta ?? paramsRecord.text ?? paramsRecord.output ?? paramsRecord.stdout);
            if (itemId && delta) {
                const lastDelta = this.lastCommandOutputDeltaByItemId.get(itemId);
                if (lastDelta === delta) {
                    return events;
                }
                this.lastCommandOutputDeltaByItemId.set(itemId, delta);
                const prev = this.commandOutputBuffers.get(itemId) ?? '';
                this.commandOutputBuffers.set(itemId, prev + delta);
            }
            return events;
        }

        if (method === 'item/commandExecution/terminalInteraction') {
            const itemId = extractItemId(paramsRecord);
            const stdin = asString(paramsRecord.stdin);
            const processId = asString(paramsRecord.processId ?? paramsRecord.process_id);

            if (itemId && stdin) {
                const prev = this.commandInputBuffers.get(itemId) ?? [];
                prev.push(stdin);
                this.commandInputBuffers.set(itemId, prev);

                events.push({
                    type: 'exec_command_terminal_input',
                    call_id: itemId,
                    stdin,
                    ...(processId ? { process_id: processId } : {})
                });
            }
            return events;
        }

        if (method === 'item/fileChange/outputDelta') {
            const itemId = extractItemId(paramsRecord);
            const delta = asString(paramsRecord.delta ?? paramsRecord.text ?? paramsRecord.output ?? paramsRecord.stdout);
            if (itemId && delta) {
                const prev = this.fileChangeOutputBuffers.get(itemId) ?? '';
                this.fileChangeOutputBuffers.set(itemId, prev + delta);
            }
            return events;
        }

        if (method === 'item/mcpToolCall/progress') {
            const itemId = extractItemId(paramsRecord);
            const message = asString(paramsRecord.message ?? paramsRecord.delta ?? paramsRecord.text);
            if (itemId && message) {
                const prev = this.genericToolProgress.get(itemId) ?? [];
                prev.push(message);
                this.genericToolProgress.set(itemId, prev);

                events.push({
                    type: 'tool_call_progress',
                    call_id: itemId,
                    message
                });
            }
            return events;
        }

        if (method === 'item/started' || method === 'item/completed') {
            const item = extractItem(paramsRecord);
            if (!item) return events;

            const itemType = normalizeItemType(item.type ?? item.itemType ?? item.kind);
            const itemId = extractItemId(paramsRecord) ?? asString(item.id ?? item.itemId ?? item.item_id);

            if (!itemType || !itemId) {
                return events;
            }

            if (itemType === 'agentmessage') {
                if (method === 'item/completed') {
                    if (this.completedAgentMessageItems.has(itemId)) {
                        return events;
                    }
                    const text = extractItemText(item) ?? this.agentMessageBuffers.get(itemId);
                    if (text) {
                        events.push({ type: 'agent_message', message: text });
                        this.completedAgentMessageItems.add(itemId);
                        this.agentMessageBuffers.delete(itemId);
                    }
                    this.lastAgentMessageDeltaByItemId.delete(itemId);
                }
                return events;
            }

            if (itemType === 'reasoning') {
                if (method === 'item/completed') {
                    if (this.completedReasoningItems.has(itemId)) {
                        return events;
                    }
                    const summary = joinStringParts(item.summary)
                        ?? joinStringParts(item.summary_text ?? item.summaryText)
                        ?? this.reasoningSummaryBuffers.get(itemId);
                    const content = joinStringParts(item.content)
                        ?? asString(item.text ?? item.message)
                        ?? this.reasoningContentBuffers.get(itemId);

                    const text = summary ?? content;

                    if (text) {
                        events.push({ type: 'agent_reasoning', text });
                        this.completedReasoningItems.add(itemId);
                    }

                    this.reasoningSummaryBuffers.delete(itemId);
                    this.reasoningContentBuffers.delete(itemId);
                    this.lastReasoningDeltaByItemId.delete(itemId);
                }
                return events;
            }

            if (itemType === 'commandexecution') {
                if (method === 'item/started') {
                    const command = extractCommand(item.command ?? item.cmd ?? item.args);
                    const cwd = asString(item.cwd ?? item.workingDirectory ?? item.working_directory);
                    const autoApproved = asBoolean(item.autoApproved ?? item.auto_approved);
                    const processId = asString(item.processId ?? item.process_id);
                    const commandActions = Array.isArray(item.commandActions ?? item.command_actions)
                        ? item.commandActions ?? item.command_actions
                        : null;

                    const meta: Record<string, unknown> = {};
                    if (command) meta.command = command;
                    if (cwd) meta.cwd = cwd;
                    if (processId) meta.process_id = processId;
                    if (commandActions) meta.command_actions = commandActions;
                    if (autoApproved !== null) meta.auto_approved = autoApproved;
                    this.commandMeta.set(itemId, meta);

                    events.push({
                        type: 'exec_command_begin',
                        call_id: itemId,
                        ...meta
                    });
                }

                if (method === 'item/completed') {
                    const meta = this.commandMeta.get(itemId) ?? {};
                    const output = asString(item.output ?? item.result ?? item.stdout ?? item.aggregatedOutput ?? item.aggregated_output)
                        ?? this.commandOutputBuffers.get(itemId);
                    const stderr = asString(item.stderr);
                    const error = extractErrorMessage(item.error);
                    const exitCode = asNumber(item.exitCode ?? item.exit_code ?? item.exitcode);
                    const status = asString(item.status);
                    const durationMs = asNumber(item.durationMs ?? item.duration_ms);
                    const terminalInputs = this.commandInputBuffers.get(itemId);

                    events.push({
                        type: 'exec_command_end',
                        call_id: itemId,
                        ...meta,
                        ...(output ? { output } : {}),
                        ...(stderr ? { stderr } : {}),
                        ...(error ? { error } : {}),
                        ...(exitCode !== null ? { exit_code: exitCode } : {}),
                        ...(status ? { status } : {}),
                        ...(durationMs !== null ? { duration_ms: durationMs } : {}),
                        ...(terminalInputs && terminalInputs.length > 0 ? { terminal_input: terminalInputs } : {})
                    });

                    this.commandMeta.delete(itemId);
                    this.commandOutputBuffers.delete(itemId);
                    this.commandInputBuffers.delete(itemId);
                    this.lastCommandOutputDeltaByItemId.delete(itemId);
                }

                return events;
            }

            if (itemType === 'filechange') {
                if (method === 'item/started') {
                    const changes = extractChanges(item.changes ?? item.change ?? item.diff);
                    const autoApproved = asBoolean(item.autoApproved ?? item.auto_approved);
                    const meta: Record<string, unknown> = {};
                    if (changes) meta.changes = changes;
                    if (autoApproved !== null) meta.auto_approved = autoApproved;
                    this.fileChangeMeta.set(itemId, meta);

                    events.push({
                        type: 'patch_apply_begin',
                        call_id: itemId,
                        ...meta
                    });
                }

                if (method === 'item/completed') {
                    const meta = this.fileChangeMeta.get(itemId) ?? {};
                    const stdout = asString(item.stdout ?? item.output) ?? this.fileChangeOutputBuffers.get(itemId);
                    const stderr = asString(item.stderr);
                    const status = asString(item.status);
                    const explicitSuccess = asBoolean(item.success ?? item.ok ?? item.applied);
                    const statusSuccess = isCompletedStatus(status);
                    const success = explicitSuccess ?? statusSuccess ?? false;

                    events.push({
                        type: 'patch_apply_end',
                        call_id: itemId,
                        ...meta,
                        ...(stdout ? { stdout } : {}),
                        ...(stderr ? { stderr } : {}),
                        ...(status ? { status } : {}),
                        success
                    });

                    this.fileChangeMeta.delete(itemId);
                    this.fileChangeOutputBuffers.delete(itemId);
                }

                return events;
            }

            if (itemType === 'plan') {
                const text = asString(item.text) ?? this.planBuffers.get(itemId);

                if (method === 'item/completed') {
                    events.push({
                        type: 'plan_proposal',
                        item_id: itemId,
                        ...(text ? { text } : {})
                    });
                    this.planBuffers.delete(itemId);
                }

                return events;
            }

            if (itemType === 'websearch') {
                const query = extractWebSearchQuery(item);
                const action = item.action;
                const status = asString(item.status) ?? (method === 'item/completed' ? 'completed' : null);

                if (method === 'item/started') {
                    this.beginGenericToolCall(events, itemId, 'WebSearch', {
                        ...(query ? { query } : {}),
                        ...(action !== undefined ? { action } : {})
                    });
                }

                if (method === 'item/completed') {
                    this.completeGenericToolCall(events, itemId, 'WebSearch', {
                        ...(query ? { query } : {}),
                        ...(action !== undefined ? { action } : {}),
                        ...(status ? { status } : {}),
                        ...(item.result !== undefined ? { result: item.result } : {}),
                        ...(item.error !== undefined ? { error: item.error } : {})
                    });
                }

                return events;
            }

            if (itemType === 'mcptoolcall') {
                const server = asString(item.server);
                const tool = asString(item.tool);
                const status = asString(item.status);
                const name = buildMcpToolName(server, tool);

                if (method === 'item/started') {
                    this.beginGenericToolCall(events, itemId, name, {
                        ...(server ? { server } : {}),
                        ...(tool ? { tool } : {}),
                        ...(status ? { status } : {}),
                        arguments: item.arguments
                    });
                }

                if (method === 'item/completed') {
                    const durationMs = asNumber(item.durationMs ?? item.duration_ms);
                    const error = extractErrorMessage(item.error);
                    this.completeGenericToolCall(events, itemId, name, {
                        ...(status ? { status } : {}),
                        ...(durationMs !== null ? { duration_ms: durationMs } : {}),
                        ...(item.result !== undefined ? { result: item.result } : {}),
                        ...(error ? { error } : {}),
                        ...(item.error && !error ? { error: item.error } : {})
                    });
                }

                return events;
            }

            if (itemType === 'collabagenttoolcall') {
                const tool = asString(item.tool);
                const name = toSnakeCase(tool ?? 'collab_tool_call');
                const status = asString(item.status);

                const payload = {
                    ...(tool ? { tool } : {}),
                    ...(status ? { status } : {}),
                    ...(asString(item.senderThreadId ?? item.sender_thread_id) ? { sender_thread_id: asString(item.senderThreadId ?? item.sender_thread_id) } : {}),
                    ...(Array.isArray(item.receiverThreadIds ?? item.receiver_thread_ids)
                        ? { receiver_thread_ids: item.receiverThreadIds ?? item.receiver_thread_ids }
                        : {}),
                    ...(asString(item.prompt) ? { prompt: asString(item.prompt) } : {}),
                    ...(asRecord(item.agentsStates ?? item.agents_states) ? { agents_states: asRecord(item.agentsStates ?? item.agents_states) } : {})
                };

                if (method === 'item/started') {
                    this.beginGenericToolCall(events, itemId, name, payload);
                }

                if (method === 'item/completed') {
                    this.completeGenericToolCall(events, itemId, name, payload);
                }

                return events;
            }

            if (itemType === 'imageview') {
                const path = asString(item.path);

                if (method === 'item/started') {
                    this.beginGenericToolCall(events, itemId, 'ImageView', {
                        ...(path ? { path } : {})
                    });
                }

                if (method === 'item/completed') {
                    this.completeGenericToolCall(events, itemId, 'ImageView', {
                        ...(path ? { path } : {})
                    });
                }

                return events;
            }

            if (itemType === 'enteredreviewmode') {
                const review = asString(item.review);

                if (method === 'item/started') {
                    this.beginGenericToolCall(events, itemId, 'CodexReviewEnter', {
                        ...(review ? { review } : {})
                    });
                }

                if (method === 'item/completed') {
                    this.completeGenericToolCall(events, itemId, 'CodexReviewEnter', {
                        ...(review ? { review } : {})
                    });
                }

                return events;
            }

            if (itemType === 'exitedreviewmode') {
                const review = asString(item.review);

                if (method === 'item/started') {
                    this.beginGenericToolCall(events, itemId, 'CodexReviewExit', {
                        ...(review ? { review } : {})
                    });
                }

                if (method === 'item/completed') {
                    this.completeGenericToolCall(events, itemId, 'CodexReviewExit', {
                        ...(review ? { review } : {})
                    });
                }

                return events;
            }

            if (itemType === 'contextcompaction') {
                if (method === 'item/started') {
                    this.beginGenericToolCall(events, itemId, 'ContextCompaction', {});
                }

                if (method === 'item/completed') {
                    this.completeGenericToolCall(events, itemId, 'ContextCompaction', {});
                    // Newer app servers signal a compaction only through this item, never thread/compacted:
                    // without this event the employee pilot waits forever and the hub misses the post report.
                    events.push({ type: 'context_compacted' });
                }

                return events;
            }
        }

        if (
            method === 'rawResponseItem/completed'
            || method === 'account/updated'
            || method === 'account/rateLimits/updated'
            || method === 'app/list/updated'
            || method === 'mcpServer/oauthLogin/completed'
            || method === 'deprecationNotice'
            || method === 'configWarning'
            || method === 'fuzzyFileSearch/sessionUpdated'
            || method === 'fuzzyFileSearch/sessionCompleted'
            || method === 'windows/worldWritableWarning'
            || method === 'windowsSandbox/setupCompleted'
            || method === 'account/login/completed'
            || method === 'authStatusChange'
            || method === 'loginChatGptComplete'
            || method === 'sessionConfigured'
            || method === 'thread/status/changed'
            || method === 'thread/archived'
            || method === 'thread/unarchived'
            || method === 'thread/name/updated'
            || method === 'thread/goal/updated'
            || method === 'thread/goal/cleared'
        ) {
            return events;
        }

        logger.debug('[AppServerEventConverter] Unhandled notification', { method, params });
        return events;
    }

    reset(): void {
        this.agentMessageBuffers.clear();
        this.reasoningSummaryBuffers.clear();
        this.reasoningContentBuffers.clear();
        this.planBuffers.clear();

        this.commandOutputBuffers.clear();
        this.commandInputBuffers.clear();
        this.fileChangeOutputBuffers.clear();

        this.commandMeta.clear();
        this.fileChangeMeta.clear();
        this.genericToolMeta.clear();
        this.genericToolProgress.clear();
        this.completedAgentMessageItems.clear();
        this.completedReasoningItems.clear();
        this.reasoningSectionBreakKeys.clear();
        this.lastAgentMessageDeltaByItemId.clear();
        this.lastReasoningDeltaByItemId.clear();
        this.lastCommandOutputDeltaByItemId.clear();
    }
}
