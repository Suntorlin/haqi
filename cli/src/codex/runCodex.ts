import { logger } from '@/ui/logger';
import { loop, type EnhancedMode, type PermissionMode } from './loop';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import type { AgentState } from '@/api/types';
import type { CodexSession } from './session';
import { parseCodexCliOverrides } from './utils/codexCliOverrides';
import { bootstrapSession } from '@/agent/sessionFactory';
import { createModeChangeHandler, createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle';
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol';
import { PermissionModeSchema } from '@hapi/protocol/schemas';
import { formatMessageWithAttachments } from '@/utils/attachmentFormatter';
import type { ReasoningEffort, ServiceTier } from './appServerTypes';
import { buildCodexStatusMessage, isCodexStatusCommand, type CodexQueueSnapshot } from './utils/codexStatusCommand';
import { MessageRouteContextSchema } from '@/api/types';
import { parseGoal } from '@/parsers/specialCommands';

export { emitReadyIfIdle } from './utils/emitReadyIfIdle';

type CodexQueueEntrySnapshot = {
    id: string;
    index: number;
    preview: string;
    fullText: string;
    modeHash: string;
    isolate: boolean;
    deferredUserMessage: boolean;
    enqueuedAt: number;
};

type CodexQueueStateSnapshot = CodexQueueSnapshot & {
    entries: CodexQueueEntrySnapshot[];
};

export async function runCodex(opts: {
    startedBy?: 'runner' | 'terminal';
    codexArgs?: string[];
    permissionMode?: PermissionMode;
    resumeSessionId?: string;
    model?: string;
    effort?: ReasoningEffort;
    serviceTier?: ServiceTier;
}): Promise<void> {
    const workingDirectory = process.env.HAPI_WORKING_DIRECTORY ?? process.cwd();
    const startedBy = opts.startedBy ?? 'terminal';

    logger.debug(`[codex] Starting with options: startedBy=${startedBy}`);

    let state: AgentState = {
        controlledByUser: false
    };
    const { api, session, sessionInfo } = await bootstrapSession({
        flavor: 'codex',
        startedBy,
        workingDirectory,
        agentState: state
    });

    const startingMode: 'local' | 'remote' = startedBy === 'runner' ? 'remote' : 'local';

    setControlledByUser(session, startingMode);

    const messageQueue = new MessageQueue2<EnhancedMode>((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model,
        effort: mode.effort,
        serviceTier: mode.serviceTier,
        collaborationMode: mode.collaborationMode,
        routeContext: mode.routeContext
    }));

    const codexCliOverrides = parseCodexCliOverrides(opts.codexArgs);
    const sessionWrapperRef: { current: CodexSession | null } = { current: null };

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
        return trimmed;
    };

    const normalizeServiceTier = (value: unknown): ServiceTier | undefined => {
        if (typeof value !== 'string') {
            return undefined;
        }
        const normalized = value.trim().toLowerCase();
        if (normalized === 'fast' || normalized === 'flex') {
            return normalized;
        }
        return undefined;
    };

    let currentPermissionMode: PermissionMode = opts.permissionMode ?? 'default';
    const currentModel = normalizeConfiguredModel(opts.model ?? sessionInfo.metadata?.model);
    let currentEffort: ReasoningEffort | undefined = opts.effort;
    let currentServiceTier: ServiceTier | undefined = normalizeServiceTier(opts.serviceTier ?? sessionInfo.metadata?.serviceTier);
    const metadataCollaborationMode = typeof sessionInfo.metadata?.collaborationMode === 'string'
        ? sessionInfo.metadata.collaborationMode.trim().toLowerCase()
        : '';
    let currentCollaborationMode: EnhancedMode['collaborationMode'] = metadataCollaborationMode
        ? (metadataCollaborationMode === 'plan' ? 'plan' : undefined)
        : undefined;

    const getCurrentCollaborationMode = (): EnhancedMode['collaborationMode'] => {
        // When the session wrapper exists, always use its value (even if undefined).
        // Only fall back to the startup-time currentCollaborationMode when the
        // session hasn't been created yet.  Using ?? here would re-introduce a
        // stale 'plan' value after the auto-execute flow clears the collaboration
        // mode via session.setCollaborationMode(undefined).
        if (sessionWrapperRef.current) {
            return sessionWrapperRef.current.getCollaborationMode();
        }
        return currentCollaborationMode;
    };

    const syncRuntimeMetadata = (): void => {
        const collaborationMode = getCurrentCollaborationMode();
        session.updateMetadata((currentMetadata) => {
            const {
                thinkEffort: _previousThinkEffort,
                serviceTier: _previousServiceTier,
                collaborationMode: _previousCollaborationMode,
                ...metadataWithoutRuntime
            } = currentMetadata;
            const nextMetadata: typeof currentMetadata = {
                ...metadataWithoutRuntime,
                model: currentModel
            };
            if (currentEffort) {
                nextMetadata.thinkEffort = currentEffort;
            }
            if (currentServiceTier) {
                nextMetadata.serviceTier = currentServiceTier;
            }
            if (collaborationMode) {
                nextMetadata.collaborationMode = collaborationMode;
            }
            return nextMetadata;
        });
    };

    syncRuntimeMetadata();

    const lifecycle = createRunnerLifecycle({
        session,
        logTag: 'codex',
        stopKeepAlive: () => sessionWrapperRef.current?.stopKeepAlive()
    });

    lifecycle.registerProcessHandlers();
    registerKillSessionHandler(session.rpcHandlerManager, lifecycle.cleanupAndExit);

    const syncSessionMode = () => {
        const sessionInstance = sessionWrapperRef.current;
        if (!sessionInstance) {
            return;
        }
        sessionInstance.setPermissionMode(currentPermissionMode);
        logger.debug(`[Codex] Synced session permission mode for keepalive: ${currentPermissionMode}`);
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

    const getCodexQueueSnapshot = (): CodexQueueSnapshot => {
        const pendingCount = messageQueue.size();
        const nextQueued = messageQueue.peek()?.message;
        return {
            pendingCount,
            inQueue: pendingCount > 0,
            taskRunning: Boolean(sessionWrapperRef.current?.thinking),
            nextPreview: buildQueuePreview(nextQueued)
        };
    };

    const getCodexQueueStateSnapshot = (): CodexQueueStateSnapshot => {
        const queueSnapshot = getCodexQueueSnapshot();
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
            ...queueSnapshot,
            entries
        };
    };

    const getCodexStatusMessage = async (): Promise<string> => {
        const sessionInstance = sessionWrapperRef.current;
        return await buildCodexStatusMessage({
            cwd: workingDirectory,
            mode: sessionInstance?.mode ?? startingMode,
            sessionId: sessionInstance?.sessionId ?? null,
            permissionMode: currentPermissionMode,
            collaborationMode: getCurrentCollaborationMode(),
            queueSnapshot: getCodexQueueSnapshot()
        });
    };

    session.onUserMessage((message) => {
        messageQueue.resumeDequeue();
        if (isCodexStatusCommand(message.content.text)) {
            logger.debug('[Codex] Detected /status command');
            void (async () => {
                try {
                    const statusMessage = await getCodexStatusMessage();
                    session.sendCodexMessage({
                        type: 'message',
                        message: statusMessage
                    });
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    session.sendCodexMessage({
                        type: 'message',
                        message: `Failed to get Codex status: ${message}`
                    });
                } finally {
                    if (!sessionWrapperRef.current?.thinking) {
                        session.sendSessionEvent({ type: 'ready' });
                    }
                }
            })();
            return;
        }

        const messagePermissionMode = currentPermissionMode;
        logger.debug(`[Codex] User message received with permission mode: ${currentPermissionMode}`);

        const enhancedMode: EnhancedMode = {
            permissionMode: messagePermissionMode ?? 'default',
            model: currentModel,
            effort: currentEffort,
            serviceTier: currentServiceTier,
            collaborationMode: getCurrentCollaborationMode(),
            routeContext: message.meta?.routeContext
        };
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);
        messageQueue.push(formattedText, enhancedMode, {
            isolate: Boolean(message.meta?.routeContext) || parseGoal(formattedText).isGoal
        });
    });

    const formatFailureReason = (message: string): string => {
        const maxLength = 200;
        if (message.length <= maxLength) {
            return message;
        }
        return `${message.slice(0, maxLength)}...`;
    };

    const resolvePermissionMode = (value: unknown): PermissionMode => {
        const parsed = PermissionModeSchema.safeParse(value);
        if (!parsed.success || !isPermissionModeAllowedForFlavor(parsed.data, 'codex')) {
            throw new Error('Invalid permission mode');
        }
        return parsed.data as PermissionMode;
    };

    const resolveCollaborationMode = (value: unknown): EnhancedMode['collaborationMode'] => {
        if (value === null) {
            return undefined;
        }
        if (typeof value !== 'string') {
            throw new Error('Invalid collaboration mode');
        }
        const trimmed = value.trim();
        if (!trimmed) {
            throw new Error('Invalid collaboration mode');
        }
        return trimmed as EnhancedMode['collaborationMode'];
    };

    const resolveThinkEffort = (value: unknown): ReasoningEffort | undefined => {
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
        if (normalized === 'low' || normalized === 'medium' || normalized === 'high' || normalized === 'xhigh') {
            return normalized;
        }
        throw new Error('Invalid think effort');
    };

    const resolveServiceTier = (value: unknown): ServiceTier | undefined => {
        if (value === null) {
            return undefined;
        }
        if (typeof value !== 'string') {
            throw new Error('Invalid service tier');
        }
        const normalized = value.trim().toLowerCase();
        if (!normalized) {
            return undefined;
        }
        if (normalized === 'fast' || normalized === 'flex') {
            return normalized;
        }
        throw new Error('Invalid service tier');
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

    const resolveEnqueuePayload = (payload: unknown): { text: string; routeContext?: EnhancedMode['routeContext']; attachments?: Array<{
        id: string;
        filename: string;
        mimeType: string;
        size: number;
        path: string;
        previewUrl?: string;
    }> } => {
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
                id: string;
                filename: string;
                mimeType: string;
                size: number;
                path: string;
                previewUrl?: string;
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
        if (!text && (!attachments || attachments.length === 0)) {
            throw new Error('Message requires text or attachments');
        }
        return {
            text,
            routeContext: routeContextResult.data,
            attachments
        };
    };

    session.rpcHandlerManager.registerHandler('set-session-config', async (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid session config payload');
        }
        const config = payload as {
            permissionMode?: unknown;
            collaborationMode?: unknown;
            thinkEffort?: unknown;
            serviceTier?: unknown;
        };

        if (config.permissionMode !== undefined) {
            currentPermissionMode = resolvePermissionMode(config.permissionMode);
        }

        if (config.collaborationMode !== undefined) {
            currentCollaborationMode = resolveCollaborationMode(config.collaborationMode);
            sessionWrapperRef.current?.setCollaborationMode(currentCollaborationMode);
            syncRuntimeMetadata();
        }

        if (config.thinkEffort !== undefined) {
            currentEffort = resolveThinkEffort(config.thinkEffort);
            sessionWrapperRef.current?.setEffort(currentEffort);
            syncRuntimeMetadata();
        }
        if (config.serviceTier !== undefined) {
            currentServiceTier = resolveServiceTier(config.serviceTier);
            syncRuntimeMetadata();
        }

        syncSessionMode();
        return {
            applied: {
                permissionMode: currentPermissionMode,
                collaborationMode: getCurrentCollaborationMode(),
                thinkEffort: currentEffort,
                serviceTier: currentServiceTier
            }
        };
    });

    session.rpcHandlerManager.registerHandler('get-codex-status', async () => {
        try {
            const message = await getCodexStatusMessage();
            return { success: true, message, queue: getCodexQueueSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getCodexQueueSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('get-codex-queue', async () => {
        try {
            return { success: true, queue: getCodexQueueStateSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getCodexQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('enqueue-codex-message', async (payload: unknown) => {
        try {
            const parsed = resolveEnqueuePayload(payload);
            const formattedText = formatMessageWithAttachments(parsed.text, parsed.attachments);
            messageQueue.resumeDequeue();
            const enhancedMode: EnhancedMode = {
                permissionMode: currentPermissionMode ?? 'default',
                model: currentModel,
                effort: currentEffort,
                serviceTier: currentServiceTier,
                collaborationMode: getCurrentCollaborationMode(),
                routeContext: parsed.routeContext
            };
            messageQueue.push(formattedText, enhancedMode, {
                deferUserMessageUntilDequeue: true,
                isolate: true
            });
            return { success: true, queue: getCodexQueueStateSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getCodexQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('remove-codex-queue-item', async (payload: unknown) => {
        try {
            const id = resolveQueueItemId(payload);
            const removed = messageQueue.removeById(id);
            if (!removed) {
                return { success: false, error: 'Queue item not found', queue: getCodexQueueStateSnapshot() };
            }
            return {
                success: true,
                removedId: removed.id,
                queue: getCodexQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getCodexQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('move-codex-queue-item', async (payload: unknown) => {
        try {
            const { id, toIndex } = resolveQueueMovePayload(payload);
            const moved = messageQueue.moveById(id, toIndex);
            if (!moved) {
                return { success: false, error: 'Queue item not found', queue: getCodexQueueStateSnapshot() };
            }
            return {
                success: true,
                movedId: id,
                queue: getCodexQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getCodexQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('update-codex-queue-item', async (payload: unknown) => {
        try {
            const { id, text } = resolveQueueUpdatePayload(payload);
            const result = messageQueue.updateById(id, text);
            if (result !== 'updated') {
                const error = result === 'not_found' ? 'Queue item not found' : 'Queue item is already in the chat and cannot be edited';
                return { success: false, error, queue: getCodexQueueStateSnapshot() };
            }
            return {
                success: true,
                updatedId: id,
                queue: getCodexQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getCodexQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('clear-codex-queue', async () => {
        try {
            const clearedCount = messageQueue.clear();
            return {
                success: true,
                clearedCount,
                queue: getCodexQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getCodexQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('stop-and-preserve-codex-queue', async () => {
        try {
            const sessionInstance = sessionWrapperRef.current;
            if (!sessionInstance) {
                return {
                    success: false,
                    error: 'Codex session is not ready',
                    queue: getCodexQueueStateSnapshot()
                };
            }

            messageQueue.pauseDequeue();
            await sessionInstance.stopCurrentTurn();

            return {
                success: true,
                queue: getCodexQueueStateSnapshot()
            };
        } catch (error) {
            messageQueue.resumeDequeue();
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getCodexQueueStateSnapshot() };
        }
    });

    try {
        await loop({
            path: workingDirectory,
            startingMode,
            messageQueue,
            api,
            session,
            codexArgs: opts.codexArgs,
            codexCliOverrides,
            startedBy,
            permissionMode: currentPermissionMode,
            effort: currentEffort,
            resumeSessionId: opts.resumeSessionId,
            onModeChange: createModeChangeHandler(session),
            onSessionReady: (instance) => {
                sessionWrapperRef.current = instance;
                syncSessionMode();
                instance.setCollaborationMode(currentCollaborationMode);
            }
        });
    } catch (error) {
        lifecycle.markCrash(error);
        logger.debug('[codex] Loop error:', error);
    } finally {
        const localFailure = sessionWrapperRef.current?.localLaunchFailure;
        if (localFailure?.exitReason === 'exit') {
            lifecycle.setExitCode(1);
            lifecycle.setArchiveReason(`Local launch failed: ${formatFailureReason(localFailure.message)}`);
        }
        await lifecycle.cleanupAndExit();
    }
}
