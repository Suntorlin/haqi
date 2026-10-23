import { logger } from '@/ui/logger';
import { geminiLoop } from './loop';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { hashObject } from '@/utils/deterministicJson';
import { registerKillSessionHandler } from '@/claude/registerKillSessionHandler';
import type { AgentState } from '@/api/types';
import type { GeminiSession } from './session';
import type { GeminiMode, PermissionMode } from './types';
import { bootstrapSession } from '@/agent/sessionFactory';
import { createModeChangeHandler, createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle';
import { startHookServer } from '@/claude/utils/startHookServer';
import { cleanupHookSettingsFile, generateHookSettingsFile } from '@/modules/common/hooks/generateHookSettings';
import { resolveGeminiRuntimeConfig } from './utils/config';
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol';
import { PermissionModeSchema } from '@hapi/protocol/schemas';
import { formatMessageWithAttachments } from '@/utils/attachmentFormatter';

export async function runGemini(opts: {
    startedBy?: 'runner' | 'terminal';
    startingMode?: 'local' | 'remote';
    permissionMode?: PermissionMode;
    model?: string;
} = {}): Promise<void> {
    const workingDirectory = process.env.HAPI_WORKING_DIRECTORY ?? process.cwd();
    const startedBy = opts.startedBy ?? 'terminal';

    logger.debug(`[gemini] Starting with options: startedBy=${startedBy}, startingMode=${opts.startingMode}`);

    if (startedBy === 'runner' && opts.startingMode === 'local') {
        logger.debug('[gemini] Runner spawn requested with local mode; forcing remote mode');
        opts.startingMode = 'remote';
    }

    const initialState: AgentState = {
        controlledByUser: false
    };

    const { api, session } = await bootstrapSession({
        flavor: 'gemini',
        startedBy,
        workingDirectory,
        agentState: initialState
    });

    const startingMode: 'local' | 'remote' = opts.startingMode
        ?? (startedBy === 'runner' ? 'remote' : 'local');

    setControlledByUser(session, startingMode);

    const messageQueue = new MessageQueue2<GeminiMode>((mode) => hashObject({
        permissionMode: mode.permissionMode,
        model: mode.model
    }));

    const sessionWrapperRef: { current: GeminiSession | null } = { current: null };
    let currentPermissionMode: PermissionMode = opts.permissionMode ?? 'default';
    const resolvedModel = resolveGeminiRuntimeConfig({ model: opts.model }).model;

    const hookServer = await startHookServer({
        onClaudeHook: (sessionId, data) => {
            logger.debug(`[gemini] Session hook received: ${sessionId}`);
            const currentSession = sessionWrapperRef.current;
            if (!currentSession) {
                return;
            }
            if (currentSession.sessionId !== sessionId) {
                currentSession.onSessionFound(sessionId);
            }
            if (typeof data.transcript_path === 'string') {
                currentSession.onTranscriptPathFound(data.transcript_path);
            }
        }
    });

    const hookSettingsPath = generateHookSettingsFile(hookServer.port, hookServer.token, {
        filenamePrefix: 'gemini-session-hook',
        logLabel: 'gemini-hook-settings',
        hooksEnabled: true
    });

    const lifecycle = createRunnerLifecycle({
        session,
        logTag: 'gemini',
        stopKeepAlive: () => sessionWrapperRef.current?.stopKeepAlive(),
        onAfterClose: () => {
            hookServer.stop();
            cleanupHookSettingsFile(hookSettingsPath, 'gemini-hook-settings');
        }
    });

    lifecycle.registerProcessHandlers();
    registerKillSessionHandler(session.rpcHandlerManager, lifecycle.cleanupAndExit);

    const syncSessionMode = () => {
        const sessionInstance = sessionWrapperRef.current;
        if (!sessionInstance) {
            return;
        }
        sessionInstance.setPermissionMode(currentPermissionMode);
        logger.debug(`[gemini] Synced session permission mode for keepalive: ${currentPermissionMode}`);
    };

    const buildQueuePreview = (text: string | undefined): string | undefined => {
        if (typeof text !== 'string') {
            return undefined;
        }
        const normalized = text.trim().replace(/\s+/g, ' ');
        if (!normalized) {
            return undefined;
        }
        return normalized.length <= 180 ? normalized : `${normalized.slice(0, 180)}...`;
    };

    const getGeminiQueueSnapshot = () => {
        const pendingCount = messageQueue.size();
        const nextQueued = messageQueue.peek()?.message;
        return {
            pendingCount,
            inQueue: pendingCount > 0,
            taskRunning: Boolean(sessionWrapperRef.current?.thinking),
            nextPreview: buildQueuePreview(nextQueued)
        };
    };

    const getGeminiQueueStateSnapshot = () => {
        const queueSnapshot = getGeminiQueueSnapshot();
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
        return {
            id,
            toIndex: Math.max(0, Math.floor(toIndexValue))
        };
    };

    const resolveQueueUpdatePayload = (payload: unknown): { id: string; text: string } => {
        const id = resolveQueueItemId(payload);
        const textValue = (payload as { text?: unknown }).text;
        if (typeof textValue !== 'string' || !textValue.trim()) {
            throw new Error('Queue message text is empty');
        }
        return { id, text: textValue };
    };

    const resolveQueueEnqueuePayload = (payload: unknown): { text: string; attachments?: Array<{
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

        return { text, attachments };
    };

    session.onUserMessage((message) => {
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);
        const mode: GeminiMode = {
            permissionMode: currentPermissionMode,
            model: resolvedModel
        };
        messageQueue.push(formattedText, mode);
    });

    const resolvePermissionMode = (value: unknown): PermissionMode => {
        const parsed = PermissionModeSchema.safeParse(value);
        if (!parsed.success || !isPermissionModeAllowedForFlavor(parsed.data, 'gemini')) {
            throw new Error('Invalid permission mode');
        }
        return parsed.data as PermissionMode;
    };

    session.rpcHandlerManager.registerHandler('set-session-config', async (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid session config payload');
        }
        const config = payload as { permissionMode?: unknown };

        if (config.permissionMode !== undefined) {
            currentPermissionMode = resolvePermissionMode(config.permissionMode);
        }

        syncSessionMode();
        return { applied: { permissionMode: currentPermissionMode } };
    });

    // Keep handler names aligned with existing /codex-queue HTTP API for minimal hub/web changes.
    session.rpcHandlerManager.registerHandler('get-codex-queue', async () => {
        try {
            return { success: true, queue: getGeminiQueueStateSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getGeminiQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('enqueue-codex-message', async (payload: unknown) => {
        try {
            const parsed = resolveQueueEnqueuePayload(payload);
            const formattedText = formatMessageWithAttachments(parsed.text, parsed.attachments);
            const mode: GeminiMode = {
                permissionMode: currentPermissionMode,
                model: resolvedModel
            };
            messageQueue.push(formattedText, mode, {
                deferUserMessageUntilDequeue: true,
                isolate: true
            });
            return { success: true, queue: getGeminiQueueStateSnapshot() };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getGeminiQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('remove-codex-queue-item', async (payload: unknown) => {
        try {
            const id = resolveQueueItemId(payload);
            const removed = messageQueue.removeById(id);
            if (!removed) {
                return { success: false, error: 'Queue item not found', queue: getGeminiQueueStateSnapshot() };
            }
            return {
                success: true,
                removedId: removed.id,
                queue: getGeminiQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getGeminiQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('move-codex-queue-item', async (payload: unknown) => {
        try {
            const { id, toIndex } = resolveQueueMovePayload(payload);
            const moved = messageQueue.moveById(id, toIndex);
            if (!moved) {
                return { success: false, error: 'Queue item not found', queue: getGeminiQueueStateSnapshot() };
            }
            return {
                success: true,
                movedId: id,
                queue: getGeminiQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getGeminiQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('update-codex-queue-item', async (payload: unknown) => {
        try {
            const { id, text } = resolveQueueUpdatePayload(payload);
            const result = messageQueue.updateById(id, text);
            if (result !== 'updated') {
                const error = result === 'not_found' ? 'Queue item not found' : 'Queue item is already in the chat and cannot be edited';
                return { success: false, error, queue: getGeminiQueueStateSnapshot() };
            }
            return {
                success: true,
                updatedId: id,
                queue: getGeminiQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getGeminiQueueStateSnapshot() };
        }
    });

    session.rpcHandlerManager.registerHandler('clear-codex-queue', async () => {
        try {
            const clearedCount = messageQueue.clear();
            return {
                success: true,
                clearedCount,
                queue: getGeminiQueueStateSnapshot()
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { success: false, error: message, queue: getGeminiQueueStateSnapshot() };
        }
    });

    try {
        await geminiLoop({
            path: workingDirectory,
            startingMode,
            startedBy,
            messageQueue,
            session,
            api,
            permissionMode: currentPermissionMode,
            model: resolvedModel,
            hookSettingsPath,
            onModeChange: createModeChangeHandler(session),
            onSessionReady: (instance) => {
                sessionWrapperRef.current = instance;
                syncSessionMode();
            }
        });
    } catch (error) {
        lifecycle.markCrash(error);
        logger.debug('[gemini] Loop error:', error);
    } finally {
        const localFailure = sessionWrapperRef.current?.localLaunchFailure;
        if (localFailure?.exitReason === 'exit') {
            lifecycle.setExitCode(1);
            lifecycle.setArchiveReason(`Local launch failed: ${localFailure.message.slice(0, 200)}`);
        }
        await lifecycle.cleanupAndExit();
    }
}
