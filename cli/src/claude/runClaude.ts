import { logger } from '@/ui/logger';
import { loop } from '@/claude/loop';
import { AgentState, MessageRouteContextSchema, SessionModelMode } from '@/api/types';
import { EnhancedMode, PermissionMode } from './loop';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { extractSDKMetadataAsync } from '@/claude/sdk/metadataExtractor';
import { parseSpecialCommand } from '@/parsers/specialCommands';
import { getEnvironmentInfo } from '@/ui/doctor';
import { startHappyServer } from '@/claude/utils/startHappyServer';
import { startHookServer } from '@/claude/utils/startHookServer';
import { generateHookSettingsFile, cleanupHookSettingsFile } from '@/modules/common/hooks/generateHookSettings';
import { registerKillSessionHandler } from './registerKillSessionHandler';
import type { Session } from './session';
import { bootstrapSession } from '@/agent/sessionFactory';
import { createModeChangeHandler, createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle';
import { isModelModeAllowedForFlavor, isPermissionModeAllowedForFlavor } from '@hapi/protocol';
import { ModelModeSchema, PermissionModeSchema } from '@hapi/protocol/schemas';
import { formatMessageWithAttachments } from '@/utils/attachmentFormatter';
import { findClaudeThinkEffortFromArgs, type ClaudeThinkEffort, resolveClaudeModelSelection } from './modelMode';
import { normalizeClaudeModelValue } from '@hapi/protocol';
import { isPureContextModeEnabled } from '@/agent/utils/haqiAgentInstructions';
import { CompactPilot, employeeFromEnv } from '@/claude/utils/compactPilot';
import { requestHubJson } from '@/api/hubHttp';

export interface StartOptions {
    model?: string
    thinkEffort?: ClaudeThinkEffort
    permissionMode?: PermissionMode
    startingMode?: 'local' | 'remote'
    shouldStartRunner?: boolean
    claudeEnvVars?: Record<string, string>
    claudeArgs?: string[]
    startedBy?: 'runner' | 'terminal'
}

type ClaudeQueueSnapshot = {
    pendingCount: number
    inQueue: boolean
    taskRunning: boolean
    nextPreview?: string
}

type ClaudeQueueEntrySnapshot = {
    id: string
    index: number
    preview: string
    fullText: string
    modeHash: string
    isolate: boolean
    deferredUserMessage: boolean
    enqueuedAt: number
}

type ClaudeQueueStateSnapshot = ClaudeQueueSnapshot & {
    entries: ClaudeQueueEntrySnapshot[]
}

export async function runClaude(options: StartOptions = {}): Promise<void> {
    const workingDirectory = process.env.HAPI_WORKING_DIRECTORY ?? process.cwd();
    const startedBy = options.startedBy ?? 'terminal';

    // Log environment info at startup
    logger.debugLargeJson('[START] HAPI process started', getEnvironmentInfo());
    logger.debug(`[START] Options: startedBy=${startedBy}, startingMode=${options.startingMode}`);

    // Validate runner spawn requirements
    if (startedBy === 'runner' && options.startingMode === 'local') {
        logger.debug('Runner spawn requested with local mode - forcing remote mode');
        options.startingMode = 'remote';
        // TODO: Eventually we should error here instead of silently switching
        // throw new Error('Runner-spawned sessions cannot use local/interactive mode');
    }

    const initialState: AgentState = {};
    const { api, session, sessionInfo } = await bootstrapSession({
        flavor: 'claude',
        startedBy,
        workingDirectory,
        agentState: initialState
    });
    logger.debug(`Session created: ${sessionInfo.id}`);

    const initialModelSelection = resolveClaudeModelSelection({
        model: options.model,
        claudeArgs: options.claudeArgs
    });

    // Forward messages to the queue
    let currentPermissionMode: PermissionMode = options.permissionMode ?? 'default';
    /**
     * Sticky: set by the first message that carries inbound content, never cleared (the content stays in
     * context). Recovered from the hub session metadata, so a restarted process stays tainted.
     */
    let inboundTainted = sessionInfo.metadata?.inboundTainted === true;
    let currentModelMode: SessionModelMode = initialModelSelection.mode;
    let currentModel: string | undefined = initialModelSelection.model;
    let currentThinkEffort: ClaudeThinkEffort | undefined = options.thinkEffort ?? findClaudeThinkEffortFromArgs(options.claudeArgs);
    let currentFallbackModel: string | undefined = undefined; // Track current fallback model
    let currentCustomSystemPrompt: string | undefined = undefined; // Track current custom system prompt
    let currentAppendSystemPrompt: string | undefined = undefined; // Track current append system prompt
    let currentAllowedTools: string[] | undefined = undefined; // Track current allowed tools
    let currentDisallowedTools: string[] | undefined = undefined; // Track current disallowed tools

    const normalizeConfiguredModel = (value: unknown): string | undefined => {
        if (typeof value !== 'string') {
            return undefined;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return undefined;
        }
        const lowered = trimmed.toLowerCase();
        if (lowered === 'default' || lowered === 'auto') {
            return undefined;
        }
        return normalizeClaudeModelValue(trimmed) ?? trimmed;
    };

    const resolveConfiguredModel = (value: unknown): string | undefined => {
        if (value === null || value === undefined) {
            return undefined;
        }
        if (typeof value !== 'string') {
            throw new Error('Invalid model');
        }
        return normalizeConfiguredModel(value);
    };

    const syncRuntimeMetadata = (
        model: string | undefined,
        thinkEffort: ClaudeThinkEffort | undefined = currentThinkEffort
    ): void => {
        session.updateMetadata((currentMetadata) => {
            const { thinkEffort: _previousThinkEffort, ...metadataWithoutThinkEffort } = currentMetadata;
            return thinkEffort
                ? {
                    ...metadataWithoutThinkEffort,
                    model,
                    thinkEffort
                }
                : {
                    ...metadataWithoutThinkEffort,
                    model
                };
        });
    };

    syncRuntimeMetadata(currentModel, currentThinkEffort);

    // Extract SDK metadata in background and update session when ready
    extractSDKMetadataAsync(async (sdkMetadata) => {
        logger.debug('[start] SDK metadata extracted, updating session:', sdkMetadata);
        try {
            const normalizedSdkModel = normalizeConfiguredModel(sdkMetadata.model);

            // SDK metadata query is capability discovery only; it must not override runtime model selection.
            session.updateMetadata((currentMetadata) => ({
                ...currentMetadata,
                tools: sdkMetadata.tools,
                slashCommands: sdkMetadata.slashCommands,
                model: currentModel ?? normalizedSdkModel,
                availableModels: sdkMetadata.availableModels
            }));
            logger.debug('[start] Session metadata updated with SDK capabilities');
        } catch (error) {
            logger.debug('[start] Failed to update session metadata:', error);
        }
    });

    // Start HAPI MCP server
    const happyServer = await startHappyServer(session);
    logger.debug(`[START] HAPI MCP server started at ${happyServer.url}`);

    // Variable to track current session instance (updated via onSessionReady callback)
    const currentSessionRef: { current: Session | null } = { current: null };

    const formatFailureReason = (message: string): string => {
        const maxLength = 200;
        if (message.length <= maxLength) {
            return message;
        }
        return `${message.slice(0, maxLength)}...`;
    };

    // Start Hook server for receiving Claude session notifications
    const hookServer = await startHookServer({
        onClaudeHook: (sessionId, data) => {
            logger.debug(`[START] Session hook received: ${sessionId}`, data);

            return currentSessionRef.current?.applyClaudeHookEvent(data);
        }
    });
    logger.debug(`[START] Hook server started on port ${hookServer.port}`);

    const hookSettingsPath = generateHookSettingsFile(hookServer.port, hookServer.token, {
        filenamePrefix: 'session-hook',
        logLabel: 'generateHookSettings'
    });
    logger.debug(`[START] Generated hook settings file: ${hookSettingsPath}`);

    // Print log file path
    const logPath = logger.logFilePath;
    logger.infoDeveloper(`Session: ${sessionInfo.id}`);
    logger.infoDeveloper(`Logs: ${logPath}`);

    const lifecycle = createRunnerLifecycle({
        session,
        logTag: 'claude',
        stopKeepAlive: () => currentSessionRef.current?.stopKeepAlive(),
        onAfterClose: () => {
            currentSessionRef.current?.stopClaudeTeamSnapshotPolling();
            happyServer.stop();
            hookServer.stop();
            cleanupHookSettingsFile(hookSettingsPath, 'generateHookSettings');
        }
    });

    lifecycle.registerProcessHandlers();
    registerKillSessionHandler(session.rpcHandlerManager, lifecycle.cleanupAndExit);

    // Set initial agent state
    const startingMode = options.startingMode ?? (startedBy === 'runner' ? 'remote' : 'local');
    setControlledByUser(session, startingMode);

    // Import MessageQueue2 and create message queue
    const messageQueue = new MessageQueue2<EnhancedMode>(mode => hashObject({
        isPlan: mode.permissionMode === 'plan',
        // A taint flips the mode hash once, so the next launch runs with --permission-mode default.
        inboundTainted: mode.inboundTainted === true,
        model: mode.model,
        thinkEffort: mode.thinkEffort,
        fallbackModel: mode.fallbackModel,
        customSystemPrompt: mode.customSystemPrompt,
        appendSystemPrompt: mode.appendSystemPrompt,
        allowedTools: mode.allowedTools,
        disallowedTools: mode.disallowedTools,
        routeContext: mode.routeContext
    }));

    function syncSessionModes() {
        const sessionInstance = currentSessionRef.current;
        if (!sessionInstance) {
            return;
        }
        sessionInstance.setPermissionMode(currentPermissionMode);
        sessionInstance.setModelMode(currentModelMode);
        logger.debug(`[loop] Synced session modes for keepalive: permissionMode=${currentPermissionMode}, modelMode=${currentModelMode}`);
    };

    const buildQueuePreview = (text: string | undefined): string | undefined => {
        if (typeof text !== 'string') {
            return undefined;
        }
        const normalized = text
            .trim()
            .replace(/\s+/g, ' ');
        if (!normalized) {
            return undefined;
        }
        return normalized.length <= 180 ? normalized : `${normalized.slice(0, 180)}...`;
    };

    const getClaudeQueueSnapshot = (): ClaudeQueueSnapshot => {
        const pendingCount = messageQueue.size();
        const nextQueued = messageQueue.peek()?.message;
        return {
            pendingCount,
            inQueue: pendingCount > 0,
            taskRunning: Boolean(currentSessionRef.current?.thinking),
            nextPreview: buildQueuePreview(nextQueued)
        };
    };

    const getClaudeQueueStateSnapshot = (): ClaudeQueueStateSnapshot => {
        const summary = getClaudeQueueSnapshot();
        const entries = messageQueue
            .listEntries()
            .map((item, index) => ({
                id: item.id,
                index,
                preview: buildQueuePreview(item.message) ?? '',
                fullText: item.message,
                modeHash: item.modeHash,
                isolate: item.isolate,
                deferredUserMessage: item.deferUserMessageUntilDequeue,
                enqueuedAt: item.enqueuedAt
            }));
        return {
            ...summary,
            entries
        };
    };

    const formatBoolean = (value: boolean): string => value ? 'yes' : 'no';

    const getClaudeStatusMessage = (): string => {
        const sessionInstance = currentSessionRef.current;
        const queueSnapshot = getClaudeQueueSnapshot();
        const lines = [
            'Claude status',
            `- Mode: ${sessionInstance?.mode ?? startingMode}`,
            `- Session: ${sessionInstance?.sessionId ?? 'not established'}`,
            `- Permission mode: ${currentPermissionMode}`,
            `- Model mode: ${currentModelMode}`,
            `- Queue pending: ${queueSnapshot.pendingCount}`,
            `- In queue: ${formatBoolean(queueSnapshot.inQueue)}`,
            `- Task running: ${formatBoolean(queueSnapshot.taskRunning)}`
        ];

        if (queueSnapshot.nextPreview) {
            lines.push(`- Next queued message: ${queueSnapshot.nextPreview}`);
        }

        return lines.join('\n');
    };

    const isClaudeStatusCommand = (text: string): boolean => {
        const trimmed = text.trim();
        return trimmed === '/status' || trimmed === '/claude-status';
    };

    const resolveQueueItemId = (payload: unknown): string => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid queue payload');
        }
        const candidate = (payload as { id?: unknown }).id;
        if (typeof candidate !== 'string') {
            throw new Error('Invalid queue item id');
        }
        const id = candidate.trim();
        if (!id) {
            throw new Error('Invalid queue item id');
        }
        return id;
    };

    const resolveQueueMovePayload = (payload: unknown): { id: string; toIndex: number } => {
        const id = resolveQueueItemId(payload);
        const toIndexValue = (payload as { toIndex?: unknown }).toIndex;
        if (typeof toIndexValue !== 'number' || !Number.isFinite(toIndexValue)) {
            throw new Error('Invalid queue target index');
        }
        const toIndex = Math.max(0, Math.floor(toIndexValue));
        return { id, toIndex };
    };

    const resolveQueueUpdatePayload = (payload: unknown): { id: string; text: string } => {
        const id = resolveQueueItemId(payload);
        const textValue = (payload as { text?: unknown }).text;
        if (typeof textValue !== 'string' || !textValue.trim()) {
            throw new Error('Queue message text is empty');
        }
        return { id, text: textValue };
    };

    const resolveEnqueuePayload = (payload: unknown): {
        text: string
        routeContext?: EnhancedMode['routeContext']
        appendSystemPrompt?: string
        attachments?: Array<{
            id: string
            filename: string
            mimeType: string
            size: number
            path: string
            previewUrl?: string
        }>
    } => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid enqueue payload');
        }
        const textValue = (payload as { text?: unknown }).text;
        if (typeof textValue !== 'string') {
            throw new Error('Invalid enqueue text');
        }
        const text = textValue.trim();
        const attachmentsValue = (payload as { attachments?: unknown }).attachments;
        if (attachmentsValue !== undefined && !Array.isArray(attachmentsValue)) {
            throw new Error('Invalid enqueue attachments');
        }
        const routeContextValue = (payload as { meta?: { routeContext?: unknown } }).meta?.routeContext;
        const routeContextResult = routeContextValue === undefined
            ? { success: true as const, data: undefined }
            : MessageRouteContextSchema.safeParse(routeContextValue);
        if (!routeContextResult.success) {
            throw new Error('Invalid enqueue route context');
        }
        const attachments = Array.isArray(attachmentsValue)
            ? attachmentsValue.filter((attachment): attachment is {
                id: string
                filename: string
                mimeType: string
                size: number
                path: string
                previewUrl?: string
            } => {
                if (!attachment || typeof attachment !== 'object') return false;
                const entry = attachment as Record<string, unknown>;
                return typeof entry.id === 'string'
                    && typeof entry.filename === 'string'
                    && typeof entry.mimeType === 'string'
                    && typeof entry.size === 'number'
                    && Number.isFinite(entry.size)
                    && typeof entry.path === 'string'
                    && (entry.previewUrl === undefined || typeof entry.previewUrl === 'string');
            })
            : undefined;
        const appendSystemPromptValue = (payload as { meta?: { appendSystemPrompt?: unknown } }).meta?.appendSystemPrompt;
        const appendSystemPrompt = typeof appendSystemPromptValue === 'string' ? appendSystemPromptValue : undefined;
        if (!text && (!attachments || attachments.length === 0)) {
            throw new Error('Message requires text or attachments');
        }
        return {
            text,
            routeContext: routeContextResult.data,
            appendSystemPrompt,
            attachments
        };
    };
    session.onUserMessage((message) => {
        if (isClaudeStatusCommand(message.content.text)) {
            logger.debug('[start] Detected /status command for Claude');
            try {
                const statusMessage = getClaudeStatusMessage();
                session.sendCodexMessage({
                    type: 'message',
                    message: statusMessage
                });
            } catch (error) {
                const reason = error instanceof Error ? error.message : String(error);
                session.sendCodexMessage({
                    type: 'message',
                    message: `Failed to get Claude status: ${reason}`
                });
            } finally {
                if (!currentSessionRef.current?.thinking) {
                    session.sendSessionEvent({ type: 'ready' });
                }
            }
            return;
        }

        const sessionPermissionMode = currentSessionRef.current?.getPermissionMode();
        if (sessionPermissionMode && isPermissionModeAllowedForFlavor(sessionPermissionMode, 'claude')) {
            currentPermissionMode = sessionPermissionMode as PermissionMode;
        }
        // Inbound (untrusted) content taints the session for good: the content stays in context, so every later
        // turn runs without bypass and the permission layer asks a human (design: 入站不可信、外发必须确认).
        if (message.meta?.inbound && !inboundTainted) {
            inboundTainted = true;
            logger.debug('[loop] Inbound content received: the session is tainted, permissions fall back to default');
            // Persisted in the hub, so the taint survives a process restart.
            session.updateMetadata((currentMetadata) => ({ ...currentMetadata, inboundTainted: true }));
        }
        const messagePermissionMode = inboundTainted && currentPermissionMode !== 'plan' ? 'default' : currentPermissionMode;
        const messageModel = currentModel;
        const pureContextMode = isPureContextModeEnabled();
        logger.debug(`[loop] User message received with permission mode: ${currentPermissionMode}, modelMode: ${currentModelMode}, model: ${currentModel ?? 'default'}`);

        // Resolve custom system prompt - use message.meta.customSystemPrompt if provided, otherwise use current
        let messageCustomSystemPrompt = currentCustomSystemPrompt;
        if (pureContextMode) {
            messageCustomSystemPrompt = undefined;
            currentCustomSystemPrompt = undefined;
        } else if (message.meta?.hasOwnProperty('customSystemPrompt')) {
            messageCustomSystemPrompt = message.meta.customSystemPrompt || undefined; // null becomes undefined
            currentCustomSystemPrompt = messageCustomSystemPrompt;
            logger.debug(`[loop] Custom system prompt updated from user message: ${messageCustomSystemPrompt ? 'set' : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no custom system prompt override, using current: ${currentCustomSystemPrompt ? 'set' : 'none'}`);
        }

        // Resolve fallback model - use message.meta.fallbackModel if provided, otherwise use current fallback model
        let messageFallbackModel = currentFallbackModel;
        if (message.meta?.hasOwnProperty('fallbackModel')) {
            messageFallbackModel = message.meta.fallbackModel || undefined; // null becomes undefined
            currentFallbackModel = messageFallbackModel;
            logger.debug(`[loop] Fallback model updated from user message: ${messageFallbackModel || 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no fallback model override, using current: ${currentFallbackModel || 'none'}`);
        }

        // Resolve append system prompt - use message.meta.appendSystemPrompt if provided, otherwise use current
        let messageAppendSystemPrompt = currentAppendSystemPrompt;
        if (pureContextMode) {
            messageAppendSystemPrompt = undefined;
            currentAppendSystemPrompt = undefined;
        } else if (message.meta?.hasOwnProperty('appendSystemPrompt')) {
            messageAppendSystemPrompt = message.meta.appendSystemPrompt || undefined; // null becomes undefined
            currentAppendSystemPrompt = messageAppendSystemPrompt;
            logger.debug(`[loop] Append system prompt updated from user message: ${messageAppendSystemPrompt ? 'set' : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no append system prompt override, using current: ${currentAppendSystemPrompt ? 'set' : 'none'}`);
        }

        // Resolve allowed tools - use message.meta.allowedTools if provided, otherwise use current
        let messageAllowedTools = currentAllowedTools;
        if (message.meta?.hasOwnProperty('allowedTools')) {
            messageAllowedTools = message.meta.allowedTools || undefined; // null becomes undefined
            currentAllowedTools = messageAllowedTools;
            logger.debug(`[loop] Allowed tools updated from user message: ${messageAllowedTools ? messageAllowedTools.join(', ') : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no allowed tools override, using current: ${currentAllowedTools ? currentAllowedTools.join(', ') : 'none'}`);
        }

        // Resolve disallowed tools - use message.meta.disallowedTools if provided, otherwise use current
        let messageDisallowedTools = currentDisallowedTools;
        if (message.meta?.hasOwnProperty('disallowedTools')) {
            messageDisallowedTools = message.meta.disallowedTools || undefined; // null becomes undefined
            currentDisallowedTools = messageDisallowedTools;
            logger.debug(`[loop] Disallowed tools updated from user message: ${messageDisallowedTools ? messageDisallowedTools.join(', ') : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no disallowed tools override, using current: ${currentDisallowedTools ? currentDisallowedTools.join(', ') : 'none'}`);
        }

        // Check for special commands before processing
        const specialCommand = parseSpecialCommand(message.content.text);

        // Format message text with attachments for Claude
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);

        if (specialCommand.type === 'compact') {
            logger.debug('[start] Detected /compact command');
            const enhancedMode: EnhancedMode = {
                permissionMode: messagePermissionMode ?? 'default',
                model: messageModel,
                thinkEffort: currentThinkEffort,
                fallbackModel: messageFallbackModel,
                customSystemPrompt: messageCustomSystemPrompt,
                appendSystemPrompt: messageAppendSystemPrompt,
                allowedTools: messageAllowedTools,
                disallowedTools: messageDisallowedTools,
                routeContext: message.meta?.routeContext,
                inboundTainted
            };
            // Use raw text only, ignore attachments for special commands
            const commandText = specialCommand.originalMessage || message.content.text;
            messageQueue.pushIsolateAndClear(commandText, enhancedMode);
            logger.debugLargeJson('[start] /compact command pushed to queue:', message);
            return;
        }

        if (specialCommand.type === 'clear') {
            logger.debug('[start] Detected /clear command');
            const enhancedMode: EnhancedMode = {
                permissionMode: messagePermissionMode ?? 'default',
                model: messageModel,
                thinkEffort: currentThinkEffort,
                fallbackModel: messageFallbackModel,
                customSystemPrompt: messageCustomSystemPrompt,
                appendSystemPrompt: messageAppendSystemPrompt,
                allowedTools: messageAllowedTools,
                disallowedTools: messageDisallowedTools,
                routeContext: message.meta?.routeContext,
                inboundTainted
            };
            // Use raw text only, ignore attachments for special commands
            const commandText = specialCommand.originalMessage || message.content.text;
            messageQueue.pushIsolateAndClear(commandText, enhancedMode);
            logger.debugLargeJson('[start] /clear command pushed to queue:', message);
            return;
        }

        // Push with resolved permission mode, model, system prompts, and tools
        const enhancedMode: EnhancedMode = {
            permissionMode: messagePermissionMode ?? 'default',
            model: messageModel,
            thinkEffort: currentThinkEffort,
            fallbackModel: messageFallbackModel,
            customSystemPrompt: messageCustomSystemPrompt,
            appendSystemPrompt: messageAppendSystemPrompt,
            allowedTools: messageAllowedTools,
            disallowedTools: messageDisallowedTools,
            routeContext: message.meta?.routeContext,
            inboundTainted
        };
        messageQueue.push(formattedText, enhancedMode, {
            isolate: Boolean(message.meta?.routeContext)
        });
        logger.debugLargeJson('User message pushed to queue:', message)
    });

    const resolvePermissionMode = (value: unknown): PermissionMode => {
        const parsed = PermissionModeSchema.safeParse(value);
        if (!parsed.success || !isPermissionModeAllowedForFlavor(parsed.data, 'claude')) {
            throw new Error('Invalid permission mode');
        }
        return parsed.data as PermissionMode;
    };

    const resolveModelMode = (value: unknown): SessionModelMode => {
        const parsed = ModelModeSchema.safeParse(value);
        if (!parsed.success || !isModelModeAllowedForFlavor(parsed.data, 'claude')) {
            throw new Error('Invalid model mode');
        }
        return parsed.data;
    };

    const resolveThinkEffort = (value: unknown): ClaudeThinkEffort | undefined => {
        if (value === null) {
            return undefined;
        }
        if (typeof value !== 'string') {
            throw new Error('Invalid think effort');
        }

        const normalized = value.trim().toLowerCase();
        if (!normalized || normalized === 'auto') {
            return undefined;
        }
        if (
            normalized === 'low'
            || normalized === 'medium'
            || normalized === 'high'
            || normalized === 'xhigh'
            || normalized === 'max'
        ) {
            return normalized;
        }
        throw new Error('Invalid think effort');
    };

    session.rpcHandlerManager.registerHandler('set-session-config', async (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid session config payload');
        }
        const config = payload as { permissionMode?: unknown; modelMode?: unknown; model?: unknown; thinkEffort?: unknown };

        if (config.permissionMode !== undefined) {
            currentPermissionMode = resolvePermissionMode(config.permissionMode);
        }

        if (config.modelMode !== undefined) {
            const resolvedModelMode = resolveModelMode(config.modelMode);
            currentModelMode = resolvedModelMode;
            currentModel = resolvedModelMode === 'default' ? undefined : resolvedModelMode;
            syncRuntimeMetadata(currentModel);
        }

        if (config.model !== undefined) {
            const resolvedSelection = resolveClaudeModelSelection({
                model: resolveConfiguredModel(config.model)
            });
            currentModel = resolvedSelection.model;
            currentModelMode = resolvedSelection.mode;
            syncRuntimeMetadata(currentModel);
        }

        if (config.thinkEffort !== undefined) {
            currentThinkEffort = resolveThinkEffort(config.thinkEffort);
            syncRuntimeMetadata(currentModel, currentThinkEffort);
        }

        syncSessionModes();
        return {
            applied: {
                permissionMode: currentPermissionMode,
                modelMode: currentModelMode,
                model: currentModel,
                thinkEffort: currentThinkEffort
            }
        };
    });

    session.rpcHandlerManager.registerHandler('get-claude-queue', async () => {
        try {
            return { success: true, queue: getClaudeQueueStateSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('enqueue-claude-message', async (payload: unknown) => {
        try {
            const parsed = resolveEnqueuePayload(payload);
            const formattedText = formatMessageWithAttachments(parsed.text, parsed.attachments);
            const pureContextMode = isPureContextModeEnabled();
            const enhancedMode: EnhancedMode = {
                permissionMode: currentPermissionMode ?? 'default',
                model: currentModel,
                thinkEffort: currentThinkEffort,
                fallbackModel: currentFallbackModel,
                customSystemPrompt: pureContextMode ? undefined : currentCustomSystemPrompt,
                appendSystemPrompt: parsed.appendSystemPrompt ?? (pureContextMode ? undefined : currentAppendSystemPrompt),
                allowedTools: currentAllowedTools,
                disallowedTools: currentDisallowedTools,
                routeContext: parsed.routeContext
            };
            messageQueue.push(formattedText, enhancedMode, {
                deferUserMessageUntilDequeue: true,
                isolate: true
            });
            return { success: true, queue: getClaudeQueueStateSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('remove-claude-queue-item', async (payload: unknown) => {
        try {
            const id = resolveQueueItemId(payload);
            const removed = messageQueue.removeById(id);
            if (!removed) {
                return { success: false, error: 'Queue item not found', queue: getClaudeQueueStateSnapshot() };
            }
            return {
                success: true,
                removedId: removed.id,
                queue: getClaudeQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('move-claude-queue-item', async (payload: unknown) => {
        try {
            const { id, toIndex } = resolveQueueMovePayload(payload);
            const moved = messageQueue.moveById(id, toIndex);
            if (!moved) {
                return { success: false, error: 'Queue item not found', queue: getClaudeQueueStateSnapshot() };
            }
            return {
                success: true,
                movedId: id,
                queue: getClaudeQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('update-claude-queue-item', async (payload: unknown) => {
        try {
            const { id, text } = resolveQueueUpdatePayload(payload);
            const result = messageQueue.updateById(id, text);
            if (result !== 'updated') {
                const error = result === 'not_found' ? 'Queue item not found' : 'Queue item is already in the chat and cannot be edited';
                return { success: false, error, queue: getClaudeQueueStateSnapshot() };
            }
            return {
                success: true,
                updatedId: id,
                queue: getClaudeQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('clear-claude-queue', async () => {
        try {
            const clearedCount = messageQueue.clear();
            return {
                success: true,
                clearedCount,
                queue: getClaudeQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('get-codex-status', async () => {
        try {
            const message = getClaudeStatusMessage();
            return { success: true, message, queue: getClaudeQueueSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('get-codex-queue', async () => {
        try {
            return { success: true, queue: getClaudeQueueStateSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('enqueue-codex-message', async (payload: unknown) => {
        try {
            const parsed = resolveEnqueuePayload(payload);
            const formattedText = formatMessageWithAttachments(parsed.text, parsed.attachments);
            const pureContextMode = isPureContextModeEnabled();
            const enhancedMode: EnhancedMode = {
                permissionMode: currentPermissionMode ?? 'default',
                model: currentModelMode === 'default' ? undefined : currentModelMode,
                fallbackModel: currentFallbackModel,
                customSystemPrompt: pureContextMode ? undefined : currentCustomSystemPrompt,
                appendSystemPrompt: parsed.appendSystemPrompt ?? (pureContextMode ? undefined : currentAppendSystemPrompt),
                allowedTools: currentAllowedTools,
                disallowedTools: currentDisallowedTools,
                routeContext: parsed.routeContext
            };
            messageQueue.push(formattedText, enhancedMode, {
                deferUserMessageUntilDequeue: true,
                isolate: true
            });
            return { success: true, queue: getClaudeQueueStateSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('remove-codex-queue-item', async (payload: unknown) => {
        try {
            const id = resolveQueueItemId(payload);
            const removed = messageQueue.removeById(id);
            if (!removed) {
                return { success: false, error: 'Queue item not found', queue: getClaudeQueueStateSnapshot() };
            }
            return {
                success: true,
                removedId: removed.id,
                queue: getClaudeQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('move-codex-queue-item', async (payload: unknown) => {
        try {
            const { id, toIndex } = resolveQueueMovePayload(payload);
            const moved = messageQueue.moveById(id, toIndex);
            if (!moved) {
                return { success: false, error: 'Queue item not found', queue: getClaudeQueueStateSnapshot() };
            }
            return {
                success: true,
                movedId: id,
                queue: getClaudeQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('update-codex-queue-item', async (payload: unknown) => {
        try {
            const { id, text } = resolveQueueUpdatePayload(payload);
            const result = messageQueue.updateById(id, text);
            if (result !== 'updated') {
                const error = result === 'not_found' ? 'Queue item not found' : 'Queue item is already in the chat and cannot be edited';
                return { success: false, error, queue: getClaudeQueueStateSnapshot() };
            }
            return {
                success: true,
                updatedId: id,
                queue: getClaudeQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('clear-codex-queue', async () => {
        try {
            const clearedCount = messageQueue.clear();
            return {
                success: true,
                clearedCount,
                queue: getClaudeQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getClaudeQueueStateSnapshot() };
        }
    });

    // The employee compaction pilot: watches usage, flushes the run log and compacts at the threshold (design §8.2).
    const employeeEnv = employeeFromEnv();
    const compactPilot = employeeEnv
        ? new CompactPilot(employeeEnv, {
            pushMessage: (text) => {
                const enhancedMode: EnhancedMode = {
                    permissionMode: currentPermissionMode ?? 'default',
                    model: currentModel,
                    thinkEffort: currentThinkEffort,
                    fallbackModel: currentFallbackModel,
                    customSystemPrompt: currentCustomSystemPrompt,
                    appendSystemPrompt: currentAppendSystemPrompt,
                    allowedTools: currentAllowedTools,
                    disallowedTools: currentDisallowedTools
                };
                // deferUserMessageUntilDequeue keeps the injected message visible in the hub chat for auditing.
                messageQueue.push(text, enhancedMode, { isolate: true, deferUserMessageUntilDequeue: true });
            },
            fetchStatePackage: async () => {
                const payload = await requestHubJson(`/api/employees/whoami?sessionId=${encodeURIComponent(sessionInfo.id)}`);
                return typeof payload.statePackage === 'string' ? payload.statePackage : null;
            },
            reportCompaction: async (input) => {
                await requestHubJson('/api/employees/compaction', {
                    method: 'POST',
                    body: JSON.stringify({ sessionId: sessionInfo.id, ...input })
                });
            }
        })
        : null;
    compactPilot?.start();

    const attachCompactPilot = (sessionInstance: Session): void => {
        if (!compactPilot) return;
        sessionInstance.setSessionStartContext((source) => compactPilot.sessionStartContext(source));
        sessionInstance.setCompactionListener((event) => {
            if (event.phase === 'pre') compactPilot.notePreCompact(event.trigger);
            else compactPilot.notePostCompact(event.trigger, event.summary);
        });
        sessionInstance.setSdkMessageListener((raw) => {
            const message = raw as { type?: string; parent_tool_use_id?: string; message?: { usage?: unknown }; modelUsage?: Record<string, { contextWindow?: unknown }> };
            if (message?.type === 'assistant' && !message.parent_tool_use_id) {
                compactPilot.noteAssistantUsage(message.message?.usage);
            }
            if (message?.type === 'result') {
                const windows = Object.values(message.modelUsage ?? {})
                    .map((entry) => entry?.contextWindow)
                    .filter((value): value is number => typeof value === 'number' && value > 0);
                if (windows.length > 0) compactPilot.noteContextWindow(Math.max(...windows));
                compactPilot.noteTurnEnd();
            }
        });
    };

    const allowedTools = Array.from(new Set(
        happyServer.toolNames.flatMap((toolName) => [
            `mcp__haqi__${toolName}`,
            `mcp__hapi__${toolName}`
        ])
    ));

    let loopError: unknown = null;
    let loopFailed = false;
    try {
        await loop({
            path: workingDirectory,
            model: currentModel,
            permissionMode: options.permissionMode,
            startingMode,
            messageQueue,
            api,
            allowedTools,
            onModeChange: createModeChangeHandler(session),
            onSessionReady: (sessionInstance) => {
                currentSessionRef.current = sessionInstance;
                syncSessionModes();
                attachCompactPilot(sessionInstance);
            },
            mcpServers: {
                'haqi': {
                    type: 'http' as const,
                    url: happyServer.url,
                },
                'hapi': {
                    type: 'http' as const,
                    url: happyServer.url,
                }
            },
            session,
            claudeEnvVars: options.claudeEnvVars,
            claudeArgs: options.claudeArgs,
            startedBy,
            hookSettingsPath
        });
    } catch (error) {
        loopError = error;
        loopFailed = true;
        lifecycle.markCrash(error);
    }

    const localFailure = currentSessionRef.current?.localLaunchFailure;
    if (localFailure?.exitReason === 'exit') {
        lifecycle.setExitCode(1);
        lifecycle.setArchiveReason(`Local launch failed: ${formatFailureReason(localFailure.message)}`);
    }

    if (loopFailed) {
        await lifecycle.cleanup();
        throw loopError;
    }

    await lifecycle.cleanupAndExit();
}
