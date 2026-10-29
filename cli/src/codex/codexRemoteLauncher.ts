import React from 'react';
import { randomUUID } from 'node:crypto';

import { CodexMcpClient } from './codexMcpClient';
import { CodexAppServerClient } from './codexAppServerClient';
import {
    CodexPermissionHandler,
    isPlanApprovalToolName,
    isQuestionToolName
} from './utils/permissionHandler';
import { ReasoningProcessor } from './utils/reasoningProcessor';
import { DiffProcessor } from './utils/diffProcessor';
import { logger } from '@/ui/logger';
import { CodexDisplay } from '@/ui/ink/CodexDisplay';
import type { CodexSessionConfig } from './types';
import { buildHapiMcpBridge } from './utils/buildHapiMcpBridge';
import { emitReadyIfIdle } from './utils/emitReadyIfIdle';
import type { CodexSession } from './session';
import type { EnhancedMode } from './loop';
import { hasCodexCliOverrides } from './utils/codexCliOverrides';
import { buildCodexStartConfig } from './utils/codexStartConfig';
import { AppServerEventConverter } from './utils/appServerEventConverter';
import { registerAppServerPermissionHandlers } from './utils/appServerPermissionAdapter';
import { buildThreadStartParams, buildTurnStartParams } from './utils/appServerConfig';
import { TurnChangeTracker } from './utils/turnChangeTracker';
import { buildCodexSystemPrompt } from './utils/systemPrompt';
import { parseGoal, type GoalCommandResult } from '@/parsers/specialCommands';
import { employeeFromEnv } from '@/agent/utils/employeeEnv';
import { requestHubJson } from '@/api/hubHttp';
import {
    LIVE_ACTIVITY_EVENT_TYPES,
    LIVE_ACTIVITY_GRACE_MS,
    TERMINAL_TURN_EVENT_TYPES,
    isStaleTerminalTurnEvent
} from './utils/turnState';
import {
    RemoteLauncherBase,
    type RemoteLauncherDisplayContext,
    type RemoteLauncherExitReason
} from '@/modules/common/remote/RemoteLauncherBase';

type HappyServer = Awaited<ReturnType<typeof buildHapiMcpBridge>>['server'];

function shouldUseAppServer(): boolean {
    const useMcpServer = process.env.CODEX_USE_MCP_SERVER === '1';
    return !useMcpServer;
}

const AUTO_EXECUTE_PLAN_PROMPT = 'Plan approved. Exit plan mode and start implementing now.';

function extractPlanText(input: unknown): string | null {
    if (!input || typeof input !== 'object') {
        return null;
    }
    const record = input as Record<string, unknown>;
    const asRawString = (value: unknown): string | null => (
        typeof value === 'string' && value.length > 0 ? value : null
    );
    const text = asRawString(record.text) ?? asRawString(record.plan);
    if (!text) {
        return null;
    }
    const trimmed = text.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function formatGoalSummary(goal: unknown): string | null {
    if (!goal || typeof goal !== 'object') {
        return null;
    }

    const record = goal as Record<string, unknown>;
    const objective = typeof record.objective === 'string' ? record.objective.trim() : '';
    if (objective.length === 0) {
        return null;
    }

    const status = typeof record.status === 'string' ? record.status : undefined;
    const tokensUsed = typeof record.tokensUsed === 'number' ? record.tokensUsed : undefined;
    const tokenBudget = typeof record.tokenBudget === 'number' ? record.tokenBudget : undefined;
    const budget = tokenBudget !== undefined
        ? ` (${tokensUsed ?? 0}/${tokenBudget} tokens)`
        : '';

    return status ? `${objective} [${status}]${budget}` : `${objective}${budget}`;
}

class CodexRemoteLauncher extends RemoteLauncherBase {
    private readonly session: CodexSession;
    private readonly useAppServer: boolean;
    private readonly mcpClient: CodexMcpClient | null;
    private readonly appServerClient: CodexAppServerClient | null;
    private permissionHandler: CodexPermissionHandler | null = null;
    private reasoningProcessor: ReasoningProcessor | null = null;
    private diffProcessor: DiffProcessor | null = null;
    private happyServer: HappyServer | null = null;
    private abortController: AbortController = new AbortController();
    private currentThreadId: string | null = null;
    private currentTurnId: string | null = null;
    private turnChangeTracker: TurnChangeTracker = new TurnChangeTracker();
    /** Employee sessions compact themselves: context share from thread/tokenUsage/updated, trigger on turn end. */
    private readonly employeeEnv = employeeFromEnv();
    private employeeUsedTokens = 0;
    private employeeContextWindow = 0;
    private employeeCompacting = false;

    private noteEmployeeTokenUsage(params: unknown): void {
        if (!this.employeeEnv) return;
        const record = (params && typeof params === 'object') ? params as Record<string, unknown> : null;
        const usage = (record?.tokenUsage && typeof record.tokenUsage === 'object') ? record.tokenUsage as Record<string, unknown> : record;
        const last = (usage?.last && typeof usage.last === 'object') ? usage.last as Record<string, unknown> : null;
        if (typeof last?.totalTokens === 'number') this.employeeUsedTokens = last.totalTokens;
        const window = usage?.modelContextWindow ?? record?.modelContextWindow;
        if (typeof window === 'number' && window > 0) this.employeeContextWindow = window;
    }

    /** Over the threshold once the turn ended: ask the app server to compact (compact_prompt carries the keep list). */
    private maybeCompactEmployeeThread(): void {
        if (!this.employeeEnv || this.employeeCompacting) return;
        if (!this.appServerClient || !this.currentThreadId || this.employeeContextWindow <= 0) return;
        if (this.employeeUsedTokens / this.employeeContextWindow < this.employeeEnv.compactThreshold) return;
        logger.debug(`[codex] employee compact: ${this.employeeUsedTokens}/${this.employeeContextWindow}`);
        this.employeeCompacting = true;
        this.reportEmployeeCompaction('pre');
        this.appServerClient.compactStart(this.currentThreadId).catch((error) => {
            logger.debug('[codex] compactStart failed', error);
            this.employeeCompacting = false;
        });
    }

    private noteEmployeeCompacted(): void {
        if (!this.employeeEnv) return;
        this.employeeCompacting = false;
        this.employeeUsedTokens = 0;
        this.reportEmployeeCompaction('post');
    }

    private reportEmployeeCompaction(phase: 'pre' | 'post'): void {
        void requestHubJson('/api/employees/compaction', {
            method: 'POST',
            body: JSON.stringify({ sessionId: this.session.client.sessionId, phase, trigger: 'auto' })
        }).catch((error) => logger.debug('[codex] compaction report failed', error));
    }

    constructor(session: CodexSession) {
        super(process.env.DEBUG ? session.logPath : undefined);
        this.session = session;
        this.useAppServer = shouldUseAppServer();
        this.mcpClient = this.useAppServer ? null : new CodexMcpClient();
        this.appServerClient = this.useAppServer ? new CodexAppServerClient() : null;
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(CodexDisplay, context);
    }

    private async interruptCurrentTurn(options?: { resetQueue?: boolean }): Promise<void> {
        logger.debug('[Codex] Abort requested - stopping current task');
        try {
            if (this.useAppServer && this.appServerClient) {
                if (this.currentThreadId && this.currentTurnId) {
                    try {
                        await this.appServerClient.interruptTurn({
                            threadId: this.currentThreadId,
                            turnId: this.currentTurnId
                        });
                    } catch (error) {
                        logger.debug('[Codex] Error interrupting app-server turn:', error);
                    }
                }

                this.currentTurnId = null;
            }

            this.abortController.abort();
            if (options?.resetQueue !== false) {
                this.session.queue.reset();
            }
            this.permissionHandler?.reset();
            this.reasoningProcessor?.abort();
            this.diffProcessor?.reset();
            this.turnChangeTracker.reset();
            logger.debug('[Codex] Abort completed - session remains active');
        } catch (error) {
            logger.debug('[Codex] Error during abort:', error);
        } finally {
            this.abortController = new AbortController();
        }
    }

    private async handleAbort(): Promise<void> {
        await this.interruptCurrentTurn({ resetQueue: true });
    }

    private async handleStopCurrentTurn(): Promise<void> {
        await this.interruptCurrentTurn({ resetQueue: false });
    }

    private async handleExitFromUi(): Promise<void> {
        logger.debug('[codex-remote]: Exiting agent via Ctrl-C');
        this.exitReason = 'exit';
        this.shouldExit = true;
        await this.handleAbort();
    }

    private async handleSwitchFromUi(): Promise<void> {
        logger.debug('[codex-remote]: Switching to local mode via double space');
        this.exitReason = 'switch';
        this.shouldExit = true;
        await this.handleAbort();
    }

    private async handleSwitchRequest(): Promise<void> {
        this.exitReason = 'switch';
        this.shouldExit = true;
        await this.handleAbort();
    }

    public async launch(): Promise<RemoteLauncherExitReason> {
        if (this.session.codexArgs && this.session.codexArgs.length > 0) {
            if (hasCodexCliOverrides(this.session.codexCliOverrides)) {
                logger.debug(`[codex-remote] CLI args include sandbox/approval overrides; other args ` +
                    `are ignored in remote mode.`);
            } else {
                logger.debug(`[codex-remote] Warning: CLI args [${this.session.codexArgs.join(', ')}] are ignored in remote mode. ` +
                    `Remote mode uses message-based configuration (model/sandbox set via web interface).`);
            }
        }

        return this.start({
            onExit: () => this.handleExitFromUi(),
            onSwitchToLocal: () => this.handleSwitchFromUi()
        });
    }

    protected async runMainLoop(): Promise<void> {
        const session = this.session;
        const messageBuffer = this.messageBuffer;
        const useAppServer = this.useAppServer;
        const mcpClient = this.mcpClient;
        const appServerClient = this.appServerClient;
        const appServerEventConverter = useAppServer ? new AppServerEventConverter() : null;
        const baseInstructions = buildCodexSystemPrompt(session.path);
        let turnInFlight = false;
        let liveActivityActive = false;
        let liveActivityTimer: NodeJS.Timeout | null = null;
        const turnIdleWaiters: Array<() => void> = [];

        const syncThinkingFromRuntimeState = () => {
            const shouldBeThinking = turnInFlight || liveActivityActive;
            if (session.thinking !== shouldBeThinking) {
                session.onThinkingChange(shouldBeThinking);
            }
        };

        const clearLiveActivity = () => {
            liveActivityActive = false;
            if (liveActivityTimer) {
                clearTimeout(liveActivityTimer);
                liveActivityTimer = null;
            }
            syncThinkingFromRuntimeState();
        };

        const markLiveActivity = () => {
            liveActivityActive = true;
            syncThinkingFromRuntimeState();
            if (liveActivityTimer) {
                clearTimeout(liveActivityTimer);
            }
            liveActivityTimer = setTimeout(() => {
                liveActivityTimer = null;
                liveActivityActive = false;
                syncThinkingFromRuntimeState();
            }, LIVE_ACTIVITY_GRACE_MS);
            liveActivityTimer.unref?.();
        };

        const resolveTurnIdleWaiters = () => {
            while (turnIdleWaiters.length > 0) {
                const resolve = turnIdleWaiters.shift();
                resolve?.();
            }
        };

        const setTurnInFlight = (next: boolean) => {
            turnInFlight = next;
            syncThinkingFromRuntimeState();
            if (!next) {
                resolveTurnIdleWaiters();
            }
        };

        const waitForTurnIdle = async (signal: AbortSignal): Promise<void> => {
            if (!useAppServer || !turnInFlight) {
                return;
            }

            await new Promise<void>((resolve) => {
                const onAbort = () => {
                    cleanup();
                    resolve();
                };

                const onIdle = () => {
                    cleanup();
                    resolve();
                };

                const cleanup = () => {
                    signal.removeEventListener('abort', onAbort);
                    const index = turnIdleWaiters.indexOf(onIdle);
                    if (index >= 0) {
                        turnIdleWaiters.splice(index, 1);
                    }
                };

                turnIdleWaiters.push(onIdle);
                signal.addEventListener('abort', onAbort, { once: true });

                if (!turnInFlight) {
                    onIdle();
                }
            });
        };

        const normalizeCommand = (value: unknown): string | undefined => {
            if (typeof value === 'string') {
                const trimmed = value.trim();
                return trimmed.length > 0 ? trimmed : undefined;
            }
            if (Array.isArray(value)) {
                const joined = value.filter((part): part is string => typeof part === 'string').join(' ');
                return joined.length > 0 ? joined : undefined;
            }
            return undefined;
        };

        const asRecord = (value: unknown): Record<string, unknown> | null => {
            if (!value || typeof value !== 'object') {
                return null;
            }
            return value as Record<string, unknown>;
        };

        const asString = (value: unknown): string | null => {
            return typeof value === 'string' && value.length > 0 ? value : null;
        };

        type PlanEntry = {
            step: string;
            status: 'pending' | 'in_progress' | 'completed';
        };

        const normalizePlanStatus = (value: unknown): PlanEntry['status'] => {
            const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
            if (normalized === 'completed' || normalized === 'done') {
                return 'completed';
            }
            if (normalized === 'in_progress' || normalized === 'inprogress' || normalized === 'running') {
                return 'in_progress';
            }
            return 'pending';
        };

        const normalizePlanEntries = (planValue: unknown): PlanEntry[] => {
            if (!Array.isArray(planValue)) {
                return [];
            }

            const entries: PlanEntry[] = [];
            for (const rawEntry of planValue) {
                const record = asRecord(rawEntry);
                if (!record) continue;
                const rawStep = asString(record.step);
                if (!rawStep) continue;
                const step = rawStep.trim();
                if (step.length === 0) continue;
                entries.push({
                    step,
                    status: normalizePlanStatus(record.status)
                });
            }

            return entries;
        };

        const formatOutputPreview = (value: unknown): string => {
            if (typeof value === 'string') return value;
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            if (value === null || value === undefined) return '';
            try {
                return JSON.stringify(value);
            } catch {
                return String(value);
            }
        };

        const formatPlanText = (planValue: unknown, explanationValue: unknown): string | null => {
            const entries = normalizePlanEntries(planValue);
            const rows: string[] = [];
            const explanation = asString(explanationValue);

            if (explanation) {
                rows.push(explanation.trim());
            }

            for (const entry of entries) {
                rows.push(`- [${entry.status}] ${entry.step}`);
            }

            return rows.length > 0 ? rows.join('\n') : null;
        };

        let activeTurnMode: EnhancedMode | null = null;
        const pendingPlanApprovals = new Map<string, {
            turnId: string | null;
            mode: EnhancedMode | null;
            approved: boolean;
            toolCompleted: boolean;
            turnCompleted: boolean;
        }>();
        const livePlanTexts = new Map<string, string>();
        const surfacedPlanTexts = new Map<string, string>();
        const planInterruptedTurns = new Set<string>();

        const permissionHandler = new CodexPermissionHandler(session.client, {
            getPermissionMode: () => session.getPermissionMode() as EnhancedMode['permissionMode'] | undefined,
            onRequest: ({ id, toolName, input }) => {
                if (isPlanApprovalToolName(toolName)) {
                    return;
                }

                if (isQuestionToolName(toolName)) {
                    session.sendCodexMessage({
                        type: 'tool-call',
                        name: toolName,
                        callId: id,
                        input: input ?? {},
                        id: randomUUID()
                    });
                    return;
                }

                const inputRecord = input && typeof input === 'object' ? input as Record<string, unknown> : {};
                const message = typeof inputRecord.message === 'string' ? inputRecord.message : undefined;
                const rawCommand = inputRecord.command;
                const command = Array.isArray(rawCommand)
                    ? rawCommand.filter((part): part is string => typeof part === 'string').join(' ')
                    : typeof rawCommand === 'string'
                        ? rawCommand
                        : undefined;
                const cwdValue = inputRecord.cwd;
                const cwd = typeof cwdValue === 'string' && cwdValue.trim().length > 0 ? cwdValue : undefined;

                session.sendCodexMessage({
                    type: 'tool-call',
                    name: 'CodexPermission',
                    callId: id,
                    input: {
                        tool: toolName,
                        message,
                        command,
                        cwd
                    },
                    id: randomUUID()
                });
            },
            onComplete: ({ id, decision, reason, approved, toolName, answers }) => {
                if (isPlanApprovalToolName(toolName)) {
                    return;
                }

                session.sendCodexMessage({
                    type: 'tool-call-result',
                    callId: id,
                    output: isQuestionToolName(toolName)
                        ? {
                            decision,
                            reason,
                            answers
                        }
                        : {
                            decision,
                            reason
                        },
                    is_error: !approved,
                    id: randomUUID()
                });
            }
        });

        const maybeExecuteApprovedPlan = (callId: string) => {
            const state = pendingPlanApprovals.get(callId);
            if (!state || !state.approved || !state.toolCompleted || !state.turnCompleted) {
                return;
            }

            const fallbackPermissionMode = session.getPermissionMode() as EnhancedMode['permissionMode'] | undefined;
            const executeMode: EnhancedMode = {
                ...(state.mode ?? { permissionMode: fallbackPermissionMode ?? 'default' }),
                collaborationMode: undefined,
                routeContext: undefined
            };
            session.setCollaborationMode(undefined, { syncMetadata: true });
            session.queue.unshift(AUTO_EXECUTE_PLAN_PROMPT, executeMode, {
                deferUserMessageUntilDequeue: true
            });
            session.sendSessionEvent({
                type: 'message',
                message: 'Plan 已确认，自动退出计划模式并继续执行。'
            });
            pendingPlanApprovals.delete(callId);
            surfacedPlanTexts.delete(callId);
        };

        const publishPlanText = (callId: string, text: string | null) => {
            if (!text) {
                return;
            }

            const normalized = text.trim();
            if (normalized.length === 0) {
                return;
            }

            if (surfacedPlanTexts.get(callId) === normalized) {
                return;
            }

            surfacedPlanTexts.set(callId, normalized);
            session.sendCodexMessage({
                type: 'message',
                message: normalized,
                id: randomUUID()
            });
        };

        const interruptTurnForPlanApproval = (turnId: string | null) => {
            if (!useAppServer || !appServerClient || !this.currentThreadId || !turnId || planInterruptedTurns.has(turnId)) {
                return;
            }

            planInterruptedTurns.add(turnId);
            void appServerClient.interruptTurn({
                threadId: this.currentThreadId,
                turnId
            }).catch((error) => {
                planInterruptedTurns.delete(turnId);
                logger.debug('[Codex] Failed to interrupt turn after plan proposal', error);
            });
        };
        const reasoningProcessor = new ReasoningProcessor((message) => {
            session.sendCodexMessage(message);
        });
        const diffProcessor = new DiffProcessor((message) => {
            session.sendCodexMessage(message);
        });
        this.permissionHandler = permissionHandler;
        this.reasoningProcessor = reasoningProcessor;
        this.diffProcessor = diffProcessor;

        const handleCodexEvent = (msg: Record<string, unknown>) => {
            const msgType = asString(msg.type);
            if (!msgType) return;
            const eventTurnId = asString(msg.turn_id ?? msg.turnId);
            const isTerminalTurnEvent = TERMINAL_TURN_EVENT_TYPES.has(msgType);
            const staleTerminalEvent = isStaleTerminalTurnEvent({
                useAppServer,
                eventType: msgType,
                eventTurnId,
                currentTurnId: this.currentTurnId
            });

            if (staleTerminalEvent) {
                logger.debug(`[Codex] Ignoring stale terminal turn event ${msgType} (eventTurnId=${eventTurnId}, currentTurnId=${this.currentTurnId})`);
                return;
            }

            if (LIVE_ACTIVITY_EVENT_TYPES.has(msgType)) {
                markLiveActivity();
            }

            if (msgType === 'thread_started') {
                const threadId = asString(msg.thread_id ?? msg.threadId);
                if (threadId) {
                    this.currentThreadId = threadId;
                    session.onSessionFound(threadId);
                }
                return;
            }

            if (msgType === 'task_started') {
                if (eventTurnId) {
                    this.currentTurnId = eventTurnId;
                }
                this.turnChangeTracker.reset();
            }

            if (isTerminalTurnEvent) {
                this.currentTurnId = null;
            }

            if (!useAppServer) {
                logger.debug(`[Codex] MCP message: ${JSON.stringify(msg)}`);

                if (msgType === 'event_msg' || msgType === 'response_item' || msgType === 'session_meta') {
                    const payload = asRecord(msg.payload);
                    const payloadType = asString(payload?.type);
                    logger.debug(`[Codex] MCP wrapper event type: ${msgType}${payloadType ? ` (payload=${payloadType})` : ''}`);
                }
            }

            if (msgType === 'agent_message') {
                const message = asString(msg.message);
                if (message) {
                    messageBuffer.addMessage(message, 'assistant');
                }
            } else if (msgType === 'agent_reasoning') {
                const text = asString(msg.text);
                if (text) {
                    messageBuffer.addMessage(`[Thinking] ${text.substring(0, 100)}...`, 'system');
                }
            } else if (msgType === 'exec_command_begin') {
                const command = normalizeCommand(msg.command) ?? 'command';
                messageBuffer.addMessage(`Executing: ${command}`, 'tool');
            } else if (msgType === 'tool_call_begin') {
                const callId = asString(msg.call_id ?? msg.callId);
                const rawToolName = asString(msg.name);
                const turnIdForPlan = eventTurnId ?? this.currentTurnId;
                const planText = callId && rawToolName && isPlanApprovalToolName(rawToolName)
                    ? extractPlanText(msg.input) ?? livePlanTexts.get(callId) ?? null
                    : null;

                if (callId && planText) {
                    publishPlanText(callId, planText);
                }

                if (
                    callId
                    && rawToolName
                    && isPlanApprovalToolName(rawToolName)
                    && session.getCollaborationMode() === 'plan'
                    && planText
                    && !pendingPlanApprovals.has(callId)
                ) {
                    pendingPlanApprovals.set(callId, {
                        turnId: turnIdForPlan,
                        mode: activeTurnMode ? { ...activeTurnMode } : null,
                        approved: false,
                        toolCompleted: false,
                        turnCompleted: false
                    });

                    interruptTurnForPlanApproval(turnIdForPlan);

                    void permissionHandler.handleToolCall(callId, rawToolName, { text: planText })
                        .then((result) => {
                            const state = pendingPlanApprovals.get(callId);
                            if (!state) {
                                return;
                            }

                            if (result.decision === 'approved' || result.decision === 'approved_for_session') {
                                state.approved = true;
                                maybeExecuteApprovedPlan(callId);
                                return;
                            }

                            pendingPlanApprovals.delete(callId);
                            surfacedPlanTexts.delete(callId);
                            session.sendSessionEvent({
                                type: 'message',
                                message: 'Plan 未确认，保持计划模式。'
                            });
                        })
                        .catch((error) => {
                            pendingPlanApprovals.delete(callId);
                            surfacedPlanTexts.delete(callId);
                            logger.debug('[Codex] Plan approval request ended without confirmation', error);
                        });
                }

                const toolName = asString(msg.name) ?? 'Tool';
                const input = asRecord(msg.input);
                const query = asString(input?.query);
                const detail = query ? `: ${query}` : '';
                messageBuffer.addMessage(`Using ${toolName}${detail}`, 'tool');
            } else if (msgType === 'tool_call_progress') {
                const progress = asString(msg.message);
                if (progress) {
                    messageBuffer.addMessage(progress, 'status');
                }
            } else if (msgType === 'plan_delta') {
                const callId = asString(msg.item_id ?? msg.itemId);
                const delta = asString(msg.delta);
                if (callId && delta) {
                    const nextText = `${livePlanTexts.get(callId) ?? ''}${delta}`;
                    livePlanTexts.set(callId, nextText);
                }
            } else if (msgType === 'plan_proposal') {
                const callId = asString(msg.item_id ?? msg.itemId) ?? randomUUID();
                const turnIdForPlan = eventTurnId ?? this.currentTurnId;
                const text = extractPlanText(msg) ?? livePlanTexts.get(callId) ?? null;
                publishPlanText(callId, text);
                if (
                    session.getCollaborationMode() === 'plan'
                    && text
                    && !pendingPlanApprovals.has(callId)
                ) {
                    pendingPlanApprovals.set(callId, {
                        turnId: turnIdForPlan,
                        mode: activeTurnMode ? { ...activeTurnMode } : null,
                        approved: false,
                        toolCompleted: true,
                        turnCompleted: false
                    });

                    interruptTurnForPlanApproval(turnIdForPlan);

                    void permissionHandler.handleToolCall(callId, 'ExitPlanMode', { text })
                        .then((result) => {
                            const state = pendingPlanApprovals.get(callId);
                            if (!state) {
                                return;
                            }

                            if (result.decision === 'approved' || result.decision === 'approved_for_session') {
                                state.approved = true;
                                maybeExecuteApprovedPlan(callId);
                                return;
                            }

                            pendingPlanApprovals.delete(callId);
                            session.sendSessionEvent({
                                type: 'message',
                                message: 'Plan 未确认，保持计划模式。'
                            });
                        })
                        .catch((error) => {
                            pendingPlanApprovals.delete(callId);
                            logger.debug('[Codex] Plan approval request ended without confirmation', error);
                        });
                }
            } else if (msgType === 'tool_call_end') {
                const output = msg.output ?? 'Tool completed';
                const outputText = formatOutputPreview(output);
                const truncatedOutput = outputText.substring(0, 200);
                messageBuffer.addMessage(
                    `Result: ${truncatedOutput}${outputText.length > 200 ? '...' : ''}`,
                    'result'
                );
            } else if (msgType === 'exec_command_end') {
                const output = msg.output ?? msg.error ?? 'Command completed';
                const outputText = formatOutputPreview(output);
                const truncatedOutput = outputText.substring(0, 200);
                messageBuffer.addMessage(
                    `Result: ${truncatedOutput}${outputText.length > 200 ? '...' : ''}`,
                    'result'
                );
            } else if (msgType === 'turn_plan_updated') {
                messageBuffer.addMessage('Plan updated', 'status');
            } else if (msgType === 'model_rerouted') {
                const from = asString(msg.from_model ?? msg.fromModel) ?? 'unknown';
                const to = asString(msg.to_model ?? msg.toModel) ?? 'unknown';
                messageBuffer.addMessage(`Model rerouted: ${from} -> ${to}`, 'status');
            } else if (msgType === 'context_compacted') {
                messageBuffer.addMessage('Context compacted', 'status');
                this.noteEmployeeCompacted();
            } else if (msgType === 'task_started') {
                messageBuffer.addMessage('Starting task...', 'status');
            } else if (msgType === 'task_complete') {
                messageBuffer.addMessage('Task completed', 'status');
                this.maybeCompactEmployeeThread();
                sendReady();
            } else if (msgType === 'turn_aborted') {
                messageBuffer.addMessage('Turn aborted', 'status');
                sendReady();
            } else if (msgType === 'task_failed') {
                const error = asString(msg.error);
                messageBuffer.addMessage(error ? `Task failed: ${error}` : 'Task failed', 'status');
                sendReady();
            }

            if (msgType === 'tool_call_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                const toolName = asString(msg.name);
                if (callId && toolName && isPlanApprovalToolName(toolName)) {
                    const state = pendingPlanApprovals.get(callId);
                    if (state) {
                        state.toolCompleted = true;
                    }
                }
            }

            if (msgType === 'task_started') {
                setTurnInFlight(true);
            }
            if (isTerminalTurnEvent) {
                const terminalTurnId = eventTurnId ?? this.currentTurnId;
                setTurnInFlight(false);

                const summaryStatus = msgType === 'task_complete'
                    ? 'completed'
                    : msgType === 'turn_aborted'
                        ? 'aborted'
                        : 'failed';
                const summaryCallId = randomUUID();

                session.sendCodexMessage({
                    type: 'tool-call',
                    name: 'CodexTurnChanges',
                    callId: summaryCallId,
                    input: this.turnChangeTracker.buildToolInput(summaryStatus),
                    id: randomUUID()
                });
                session.sendCodexMessage({
                    type: 'tool-call-result',
                    callId: summaryCallId,
                    output: {
                        status: summaryStatus
                    },
                    id: randomUUID()
                });

                const interruptedForPlan = terminalTurnId ? planInterruptedTurns.has(terminalTurnId) : false;

                for (const [callId, state] of pendingPlanApprovals) {
                    const matchedTurn = !state.turnId || !terminalTurnId || state.turnId === terminalTurnId;
                    if (!matchedTurn) {
                        continue;
                    }

                    if (msgType === 'task_complete' || interruptedForPlan) {
                        state.turnCompleted = true;
                        maybeExecuteApprovedPlan(callId);
                    } else {
                        pendingPlanApprovals.delete(callId);
                        surfacedPlanTexts.delete(callId);
                    }
                }
                if (terminalTurnId) {
                    planInterruptedTurns.delete(terminalTurnId);
                }
                activeTurnMode = null;

                diffProcessor.reset();
                this.turnChangeTracker.reset();
                appServerEventConverter?.reset();
                livePlanTexts.clear();
            }
            if (msgType === 'agent_reasoning_section_break') {
                reasoningProcessor.handleSectionBreak();
            }
            if (msgType === 'agent_reasoning_delta') {
                const delta = asString(msg.delta);
                if (delta) {
                    reasoningProcessor.processDelta(delta);
                }
            }
            if (msgType === 'agent_reasoning') {
                const text = asString(msg.text);
                if (text) {
                    reasoningProcessor.complete(text);
                }
            }
            if (msgType === 'agent_message') {
                const message = asString(msg.message);
                if (message) {
                    session.sendCodexMessage({
                        type: 'message',
                        message,
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'exec_command_begin' || msgType === 'exec_approval_request') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const inputs: Record<string, unknown> = { ...msg };
                    delete inputs.type;
                    delete inputs.call_id;
                    delete inputs.callId;

                    session.sendCodexMessage({
                        type: 'tool-call',
                        name: 'CodexBash',
                        callId: callId,
                        input: inputs,
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'exec_command_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const output: Record<string, unknown> = { ...msg };
                    delete output.type;
                    delete output.call_id;
                    delete output.callId;

                    session.sendCodexMessage({
                        type: 'tool-call-result',
                        callId: callId,
                        output,
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'tool_call_begin') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const toolName = asString(msg.name) ?? 'Tool';
                    const rawInput = (msg.input && typeof msg.input === 'object') ? msg.input as Record<string, unknown> : {};
                    const hasInlinePlanText = Boolean(asString(rawInput.text) ?? asString(rawInput.plan));
                    const input = (() => {
                        if (toolName !== 'ExitPlanMode') {
                            return rawInput;
                        }

                        const derivedText = hasInlinePlanText
                            ? undefined
                            : livePlanTexts.get(callId);
                        const source = derivedText ? { ...rawInput, text: derivedText } : rawInput;

                        if (session.getCollaborationMode() !== 'plan') {
                            return source;
                        }

                        const sanitized = { ...source };
                        delete sanitized.text;
                        delete sanitized.plan;
                        return sanitized;
                    })();

                    session.sendCodexMessage({
                        type: 'tool-call',
                        name: toolName,
                        callId,
                        input,
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'tool_call_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    livePlanTexts.delete(callId);
                    if (!pendingPlanApprovals.has(callId)) {
                        surfacedPlanTexts.delete(callId);
                    }
                    session.sendCodexMessage({
                        type: 'tool-call-result',
                        callId,
                        output: msg.output ?? {},
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'turn_plan_updated') {
                const plan = normalizePlanEntries(msg.plan);
                const explanation = asString(msg.explanation);

                if (plan.length > 0 || explanation) {
                    session.sendCodexMessage({
                        type: 'plan-update',
                        plan,
                        ...(explanation ? { explanation } : {}),
                        id: randomUUID()
                    });
                } else {
                    const text = formatPlanText(msg.plan, msg.explanation);
                    if (text) {
                        session.sendCodexMessage({
                            type: 'message',
                            message: text,
                            id: randomUUID()
                        });
                    }
                }
            }
            if (msgType === 'model_rerouted') {
                const fromModel = asString(msg.from_model ?? msg.fromModel) ?? 'unknown';
                const toModel = asString(msg.to_model ?? msg.toModel) ?? 'unknown';
                const reason = asString(msg.reason);
                session.sendCodexMessage({
                    type: 'message',
                    message: reason
                        ? `[Model rerouted] ${fromModel} -> ${toModel} (${reason})`
                        : `[Model rerouted] ${fromModel} -> ${toModel}`,
                    id: randomUUID()
                });
            }
            if (msgType === 'context_compacted') {
                session.sendCodexMessage({
                    type: 'message',
                    message: '[Context compacted]',
                    id: randomUUID()
                });
            }
            if (msgType === 'token_count') {
                session.sendCodexMessage({
                    ...msg,
                    id: randomUUID()
                });
            }
            if (msgType === 'patch_apply_begin') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const changes = asRecord(msg.changes) ?? {};
                    const changeCount = Object.keys(changes).length;
                    const filesMsg = changeCount === 1 ? '1 file' : `${changeCount} files`;
                    messageBuffer.addMessage(`Modifying ${filesMsg}...`, 'tool');
                    this.turnChangeTracker.trackPatchBegin(callId, changes);

                    session.sendCodexMessage({
                        type: 'tool-call',
                        name: 'CodexPatch',
                        callId: callId,
                        input: {
                            auto_approved: msg.auto_approved ?? msg.autoApproved,
                            changes
                        },
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'patch_apply_end') {
                const callId = asString(msg.call_id ?? msg.callId);
                if (callId) {
                    const stdout = asString(msg.stdout);
                    const stderr = asString(msg.stderr);
                    const success = Boolean(msg.success);
                    this.turnChangeTracker.trackPatchEnd(callId, success);

                    if (success) {
                        const message = stdout || 'Files modified successfully';
                        messageBuffer.addMessage(message.substring(0, 200), 'result');
                    } else {
                        const errorMsg = stderr || 'Failed to modify files';
                        messageBuffer.addMessage(`Error: ${errorMsg.substring(0, 200)}`, 'result');
                    }

                    session.sendCodexMessage({
                        type: 'tool-call-result',
                        callId: callId,
                        output: {
                            stdout,
                            stderr,
                            success
                        },
                        id: randomUUID()
                    });
                }
            }
            if (msgType === 'turn_diff') {
                const diff = asString(msg.unified_diff);
                if (diff) {
                    this.turnChangeTracker.trackTurnDiff(diff);
                    diffProcessor.processDiff(diff);
                }
            }
        };

        if (useAppServer && appServerClient && appServerEventConverter) {
            registerAppServerPermissionHandlers({
                client: appServerClient,
                permissionHandler
            });

            appServerClient.setNotificationHandler((method, params) => {
                if (method === 'thread/tokenUsage/updated') this.noteEmployeeTokenUsage(params);
                const events = appServerEventConverter.handleNotification(method, params);
                for (const event of events) {
                    const eventRecord = asRecord(event) ?? { type: undefined };
                    handleCodexEvent(eventRecord);
                }
            });
        } else if (mcpClient) {
            mcpClient.setPermissionHandler(permissionHandler);
            mcpClient.setHandler((msg) => {
                const eventRecord = asRecord(msg) ?? { type: undefined };
                handleCodexEvent(eventRecord);
            });
        }

        const { server: happyServer, mcpServers } = await buildHapiMcpBridge(session.client);
        this.happyServer = happyServer;
        session.setStopCurrentTurnHandler(() => this.handleStopCurrentTurn());

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbort(),
            onSwitch: () => this.handleSwitchRequest()
        });

        function logActiveHandles(tag: string) {
            if (!process.env.DEBUG) return;
            const anyProc: any = process as any;
            const handles = typeof anyProc._getActiveHandles === 'function' ? anyProc._getActiveHandles() : [];
            const requests = typeof anyProc._getActiveRequests === 'function' ? anyProc._getActiveRequests() : [];
            logger.debug(`[codex][handles] ${tag}: handles=${handles.length} requests=${requests.length}`);
            try {
                const kinds = handles.map((h: any) => (h && h.constructor ? h.constructor.name : typeof h));
                logger.debug(`[codex][handles] kinds=${JSON.stringify(kinds)}`);
            } catch {}
        }

        const sendReady = () => {
            session.sendSessionEvent({ type: 'ready' });
        };

        const syncSessionId = () => {
            if (!mcpClient) return;
            const clientSessionId = mcpClient.getSessionId();
            if (clientSessionId && clientSessionId !== session.sessionId) {
                session.onSessionFound(clientSessionId);
            }
        };

        let appServerRequestUserInputEnabled: boolean | null = null;
        const shouldEnableRequestUserInput = (collaborationMode: EnhancedMode['collaborationMode'] | undefined): boolean => collaborationMode === 'plan';
        const ensureAppServerCapabilities = async (collaborationMode: EnhancedMode['collaborationMode'] | undefined): Promise<void> => {
            if (!useAppServer || !appServerClient) {
                return;
            }

            const enableRequestUserInput = shouldEnableRequestUserInput(collaborationMode);
            if (appServerRequestUserInputEnabled === enableRequestUserInput) {
                return;
            }

            if (appServerRequestUserInputEnabled !== null) {
                await appServerClient.disconnect();
                this.currentThreadId = null;
                this.currentTurnId = null;
            }

            await appServerClient.connect();
            await appServerClient.initialize({
                clientInfo: {
                    name: 'hapi-codex-client',
                    version: '1.0.0'
                },
                capabilities: {
                    experimentalApi: true,
                    ...(enableRequestUserInput
                        ? {}
                        : { optOutRequestMethods: ['item/tool/requestUserInput'] })
                }
            });
            appServerRequestUserInputEnabled = enableRequestUserInput;
        };

        if (useAppServer && appServerClient) {
            await ensureAppServerCapabilities(session.getCollaborationMode());
        } else if (mcpClient) {
            await mcpClient.connect();
        }

        let wasCreated = false;
        let currentModeHash: string | null = null;
        let pending: {
            message: string;
            mode: EnhancedMode;
            isolate: boolean;
            hash: string;
            deferUserMessageUntilDequeue: boolean;
        } | null = null;
        let first = true;
        let currentThreadModel: string | undefined;

        const resolveTurnCollaborationMode = (
            collaborationMode: EnhancedMode['collaborationMode']
        ): EnhancedMode['collaborationMode'] => {
            if (typeof collaborationMode !== 'string') {
                return 'code';
            }
            const normalized = collaborationMode.trim().toLowerCase();
            if (!normalized || normalized === 'default' || normalized === 'normal') {
                return 'code';
            }
            return normalized as EnhancedMode['collaborationMode'];
        };

        const buildTurnOverrides = (
            mode: EnhancedMode
        ): NonNullable<Parameters<typeof buildTurnStartParams>[0]['overrides']> => ({
            ...(mode.model ?? currentThreadModel
                ? { model: mode.model ?? currentThreadModel }
                : {}),
            collaborationMode: resolveTurnCollaborationMode(mode.collaborationMode)
        });

        const ensureAppServerThread = async (mode: EnhancedMode): Promise<string> => {
            if (wasCreated && this.currentThreadId) {
                return this.currentThreadId;
            }

            if (!appServerClient) {
                throw new Error('Codex app-server is not available');
            }

            const threadParams = buildThreadStartParams({
                mode,
                mcpServers,
                cliOverrides: session.codexCliOverrides,
                baseInstructions,
                cwd: session.path
            });

            const resumeCandidate = session.sessionId;
            let threadId: string | null = null;

            if (resumeCandidate) {
                try {
                    const resumeResponse = await appServerClient.resumeThread({
                        threadId: resumeCandidate,
                        ...threadParams
                    }, {
                        signal: this.abortController.signal
                    });
                    const resumeRecord = asRecord(resumeResponse);
                    const resumeThread = resumeRecord ? asRecord(resumeRecord.thread) : null;
                    threadId = asString(resumeThread?.id) ?? resumeCandidate;
                    currentThreadModel = asString(resumeRecord?.model) ?? currentThreadModel;
                    logger.debug(`[Codex] Resumed app-server thread ${threadId}`);
                } catch (error) {
                    logger.warn(`[Codex] Failed to resume app-server thread ${resumeCandidate}, starting new thread`, error);
                }
            }

            if (!threadId) {
                const threadResponse = await appServerClient.startThread(threadParams, {
                    signal: this.abortController.signal
                });
                const threadRecord = asRecord(threadResponse);
                const thread = threadRecord ? asRecord(threadRecord.thread) : null;
                threadId = asString(thread?.id);
                currentThreadModel = asString(threadRecord?.model) ?? currentThreadModel;
                if (!threadId) {
                    throw new Error('app-server thread/start did not return thread.id');
                }
            }

            this.currentThreadId = threadId;
            session.onSessionFound(threadId);
            wasCreated = true;
            first = false;
            return threadId;
        };

        const handleGoalCommand = async (
            command: GoalCommandResult,
            mode: EnhancedMode,
            deferUserMessageUntilDequeue: boolean
        ): Promise<boolean> => {
            if (!command.isGoal || !command.action) {
                return false;
            }

            messageBuffer.addMessage(command.originalMessage, 'user');
            if (deferUserMessageUntilDequeue) {
                session.sendUserMessage(command.originalMessage, mode.routeContext
                    ? { routeContext: mode.routeContext }
                    : undefined);
            }

            if (!useAppServer || !appServerClient) {
                const message = 'Codex /goal is only supported by the app-server backend.';
                messageBuffer.addMessage(message, 'status');
                session.sendSessionEvent({ type: 'message', message });
                sendReady();
                return true;
            }

            try {
                const threadId = await ensureAppServerThread(mode);
                if (command.action === 'get') {
                    const response = await appServerClient.getThreadGoal({
                        threadId
                    });
                    const summary = formatGoalSummary(response.goal);
                    const message = summary ? `Goal: ${summary}` : 'No goal set.';
                    messageBuffer.addMessage(message, 'status');
                    session.sendSessionEvent({ type: 'message', message });
                    sendReady();
                    return true;
                }

                if (command.action === 'clear') {
                    const response = await appServerClient.clearThreadGoal({
                        threadId
                    });
                    const message = response.cleared ? 'Goal cleared.' : 'No goal set.';
                    messageBuffer.addMessage(message, 'status');
                    session.sendSessionEvent({ type: 'message', message });
                    sendReady();
                    return true;
                }

                const objective = command.objective?.trim() ?? '';
                if (objective.length === 0) {
                    const message = 'Goal objective must not be empty.';
                    messageBuffer.addMessage(message, 'status');
                    session.sendSessionEvent({ type: 'message', message });
                    sendReady();
                    return true;
                }

                const response = await appServerClient.setThreadGoal({
                    threadId,
                    objective
                });
                const summary = formatGoalSummary(response.goal) ?? objective;
                const message = `Goal set: ${summary}`;
                messageBuffer.addMessage(message, 'status');
                session.sendSessionEvent({ type: 'message', message });
                sendReady();
                return true;
            } catch (error) {
                const message = error instanceof Error
                    ? `Failed to run /goal: ${error.message}`
                    : 'Failed to run /goal.';
                logger.warn('[Codex] Failed to run /goal command:', error);
                messageBuffer.addMessage(message, 'status');
                session.sendSessionEvent({ type: 'message', message });
                sendReady();
                return true;
            }
        };

        while (!this.shouldExit) {
            logActiveHandles('loop-top');

            if (useAppServer && turnInFlight && !this.shouldExit) {
                await waitForTurnIdle(this.abortController.signal);
                if (this.shouldExit) {
                    break;
                }
                if (this.abortController.signal.aborted && !turnInFlight) {
                    continue;
                }
            }

            let message: {
                message: string;
                mode: EnhancedMode;
                isolate: boolean;
                hash: string;
                deferUserMessageUntilDequeue: boolean;
            } | null = pending;
            pending = null;
            if (!message) {
                const waitSignal = this.abortController.signal;
                const batch = await session.queue.waitForMessagesAndGetAsString(waitSignal);
                if (!batch) {
                    if (waitSignal.aborted && !this.shouldExit) {
                        logger.debug('[codex]: Wait aborted while idle; ignoring and continuing');
                        continue;
                    }
                    logger.debug(`[codex]: batch=${!!batch}, shouldExit=${this.shouldExit}`);
                    break;
                }
                message = batch;
            }

            if (!message) {
                break;
            }

            if (!useAppServer && wasCreated && currentModeHash && message.hash !== currentModeHash) {
                logger.debug('[Codex] Mode changed – restarting Codex session');
                messageBuffer.addMessage('═'.repeat(40), 'status');
                messageBuffer.addMessage('Starting new Codex session (mode changed)...', 'status');
                mcpClient?.clearSession();
                wasCreated = false;
                currentModeHash = null;
                pending = message;
                permissionHandler.reset();
                reasoningProcessor.abort();
                diffProcessor.reset();
                clearLiveActivity();
                setTurnInFlight(false);
                continue;
            }

            if (useAppServer && appServerClient) {
                await ensureAppServerCapabilities(message.mode.collaborationMode);
            }

            const goalCommand = parseGoal(message.message);
            if (goalCommand.isGoal) {
                const handled = await handleGoalCommand(
                    goalCommand,
                    message.mode,
                    message.deferUserMessageUntilDequeue
                );
                if (handled) {
                    continue;
                }
            }

            messageBuffer.addMessage(message.message, 'user');
            if (message.deferUserMessageUntilDequeue) {
                session.sendUserMessage(message.message, message.mode.routeContext
                    ? { routeContext: message.mode.routeContext }
                    : undefined);
            }
            currentModeHash = message.hash;

            try {
                activeTurnMode = message.mode;
                if (!wasCreated) {
                    if (useAppServer && appServerClient) {
                        const threadId = await ensureAppServerThread(message.mode);

                        const turnParams = buildTurnStartParams({
                            threadId,
                            message: message.message,
                            mode: message.mode,
                            cliOverrides: session.codexCliOverrides,
                            cwd: session.path,
                            overrides: buildTurnOverrides(message.mode)
                        });
                        setTurnInFlight(true);
                        const turnResponse = await appServerClient.startTurn(turnParams, {
                            signal: this.abortController.signal
                        });
                        const turnRecord = asRecord(turnResponse);
                        const turn = turnRecord ? asRecord(turnRecord.turn) : null;
                        const turnId = asString(turn?.id);
                        if (turnId) {
                            this.currentTurnId = turnId;
                        }
                    } else if (mcpClient) {
                        const startConfig: CodexSessionConfig = buildCodexStartConfig({
                            message: message.message,
                            mode: message.mode,
                            first,
                            mcpServers,
                            cliOverrides: session.codexCliOverrides,
                            baseInstructions,
                            cwd: session.path
                        });

                        await mcpClient.startSession(startConfig, { signal: this.abortController.signal });
                        syncSessionId();
                    }

                    first = false;
                } else if (useAppServer && appServerClient) {
                    if (!this.currentThreadId) {
                        logger.debug('[Codex] Missing thread id; restarting app-server thread');
                        wasCreated = false;
                        pending = message;
                        continue;
                    }

                    const turnParams = buildTurnStartParams({
                        threadId: this.currentThreadId,
                        message: message.message,
                        mode: message.mode,
                        cliOverrides: session.codexCliOverrides,
                        cwd: session.path,
                        overrides: buildTurnOverrides(message.mode)
                    });
                    setTurnInFlight(true);
                    const turnResponse = await appServerClient.startTurn(turnParams, {
                        signal: this.abortController.signal
                    });
                    const turnRecord = asRecord(turnResponse);
                    const turn = turnRecord ? asRecord(turnRecord.turn) : null;
                    const turnId = asString(turn?.id);
                    if (turnId) {
                        this.currentTurnId = turnId;
                    }
                } else if (mcpClient) {
                    await mcpClient.continueSession(message.message, { signal: this.abortController.signal });
                    syncSessionId();
                }
            } catch (error) {
                logger.warn('Error in codex session:', error);
                const isAbortError = error instanceof Error && error.name === 'AbortError';
                clearLiveActivity();
                setTurnInFlight(false);
                activeTurnMode = null;
                pendingPlanApprovals.clear();
                surfacedPlanTexts.clear();
                planInterruptedTurns.clear();

                if (isAbortError) {
                    messageBuffer.addMessage('Aborted by user', 'status');
                    session.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
                    if (!useAppServer) {
                        wasCreated = false;
                        currentModeHash = null;
                        logger.debug('[Codex] Marked session as not created after abort for proper resume');
                    }
                } else {
                    messageBuffer.addMessage('Process exited unexpectedly', 'status');
                    session.sendSessionEvent({ type: 'message', message: 'Process exited unexpectedly' });
                    if (useAppServer) {
                        this.currentTurnId = null;
                        this.currentThreadId = null;
                        wasCreated = false;
                    }
                }
            } finally {
                // Keep pending permission requests alive across turn boundaries.
                // Plan approvals in particular must survive until the user responds.
                reasoningProcessor.abort();
                diffProcessor.reset();
                appServerEventConverter?.reset();
                if (!useAppServer || !turnInFlight) {
                    clearLiveActivity();
                    setTurnInFlight(false);
                }
                if (!useAppServer || !turnInFlight) {
                    emitReadyIfIdle({
                        pending,
                        queueSize: () => session.queue.size(),
                        shouldExit: this.shouldExit,
                        sendReady
                    });
                }
                logActiveHandles('after-turn');
            }
        }

        clearLiveActivity();
        setTurnInFlight(false);
    }

    protected async cleanup(): Promise<void> {
        logger.debug('[codex-remote]: cleanup start');
        try {
            if (this.appServerClient) {
                await this.appServerClient.disconnect();
            }
            if (this.mcpClient) {
                await this.mcpClient.disconnect();
            }
        } catch (error) {
            logger.debug('[codex-remote]: Error disconnecting client', error);
        }

        this.clearAbortHandlers(this.session.client.rpcHandlerManager);
        this.session.setStopCurrentTurnHandler(null);

        if (this.happyServer) {
            this.happyServer.stop();
            this.happyServer = null;
        }

        this.permissionHandler?.reset();
        this.reasoningProcessor?.abort();
        this.diffProcessor?.reset();
        this.permissionHandler = null;
        this.reasoningProcessor = null;
        this.diffProcessor = null;

        logger.debug('[codex-remote]: cleanup done');
    }
}

export async function codexRemoteLauncher(session: CodexSession): Promise<'switch' | 'exit'> {
    const launcher = new CodexRemoteLauncher(session);
    return launcher.launch();
}
