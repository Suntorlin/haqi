import { ApiClient, ApiSessionClient } from '@/lib';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { logger } from '@/ui/logger';
import { AgentSessionBase } from '@/agent/sessionBase';
import type { AgentStateRunningAgent, SessionModelMode, TeamMember, TeamState, TeamTask } from '@/api/types';
import type { EnhancedMode } from './loop';
import type { PermissionMode } from './loop';
import type { LocalLaunchExitReason } from '@/agent/localLaunchPolicy';
import type { ClaudeHookEvent as SessionHookData } from './hooks';
import { readClaudeTeamSnapshotForSession } from './utils/claudeTeamSnapshot';
import { applyRateLimitEvent, type SdkRateLimitInfo } from './utils/rateLimitSnapshot';
import type { ClaudeUsageLimit } from '@hapi/protocol/schemas';

type LocalLaunchFailure = {
    message: string;
    exitReason: LocalLaunchExitReason;
};

export class Session extends AgentSessionBase<EnhancedMode> {
    readonly claudeEnvVars?: Record<string, string>;
    claudeArgs?: string[];
    readonly mcpServers: Record<string, any>;
    readonly allowedTools?: string[];
    readonly hookSettingsPath: string;
    readonly startedBy: 'runner' | 'terminal';
    readonly startingMode: 'local' | 'remote';
    localLaunchFailure: LocalLaunchFailure | null = null;
    private runningAgents = new Map<string, AgentStateRunningAgent>();
    private teamMembers = new Map<string, TeamMember>();
    private teamTasks = new Map<string, TeamTask>();
    private teamSnapshotActivityKeys = new Set<string>();
    private teamSnapshotPoller: NodeJS.Timeout | null = null;
    private permissionModeChangeListeners = new Set<(mode: PermissionMode) => void>();

    constructor(opts: {
        api: ApiClient;
        client: ApiSessionClient;
        path: string;
        logPath: string;
        sessionId: string | null;
        claudeEnvVars?: Record<string, string>;
        claudeArgs?: string[];
        mcpServers: Record<string, any>;
        messageQueue: MessageQueue2<EnhancedMode>;
        onModeChange: (mode: 'local' | 'remote') => void;
        allowedTools?: string[];
        mode?: 'local' | 'remote';
        startedBy: 'runner' | 'terminal';
        startingMode: 'local' | 'remote';
        hookSettingsPath: string;
        permissionMode?: PermissionMode;
        modelMode?: SessionModelMode;
    }) {
        super({
            api: opts.api,
            client: opts.client,
            path: opts.path,
            logPath: opts.logPath,
            sessionId: opts.sessionId,
            messageQueue: opts.messageQueue,
            onModeChange: opts.onModeChange,
            mode: opts.mode,
            sessionLabel: 'Session',
            sessionIdLabel: 'Claude Code',
            applySessionIdToMetadata: (metadata, sessionId) => ({
                ...metadata,
                claudeSessionId: sessionId
            }),
            permissionMode: opts.permissionMode,
            modelMode: opts.modelMode
        });

        this.claudeEnvVars = opts.claudeEnvVars;
        this.claudeArgs = opts.claudeArgs;
        this.mcpServers = opts.mcpServers;
        this.allowedTools = opts.allowedTools;
        this.hookSettingsPath = opts.hookSettingsPath;
        this.startedBy = opts.startedBy;
        this.startingMode = opts.startingMode;
        this.permissionMode = opts.permissionMode;
        this.modelMode = opts.modelMode;
    }

    stopKeepAlive = (): void => {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        this.stopClaudeTeamSnapshotPolling();
    };

    setPermissionMode = (mode: PermissionMode): void => {
        const previousMode = this.permissionMode;
        this.permissionMode = mode;
        if (previousMode === mode) {
            return;
        }
        for (const listener of this.permissionModeChangeListeners) {
            listener(mode);
        }
    };

    addPermissionModeChangeListener = (listener: (mode: PermissionMode) => void): (() => void) => {
        this.permissionModeChangeListeners.add(listener);
        return () => {
            this.permissionModeChangeListeners.delete(listener);
        };
    };

    setModelMode = (mode: SessionModelMode): void => {
        this.modelMode = mode;
    };

    updateRateLimitSnapshot = (info: SdkRateLimitInfo): void => {
        this.client.updateMetadata((metadata) => ({
            ...metadata,
            rateLimitSnapshot: applyRateLimitEvent(metadata.rateLimitSnapshot, info)
        }));
    };

    updateUsageLimits = (limits: ClaudeUsageLimit[]): void => {
        this.client.updateMetadata((metadata) => ({
            ...metadata,
            rateLimitSnapshot: { ...(metadata.rateLimitSnapshot ?? {}), usageLimits: limits }
        }));
    };

    recordLocalLaunchFailure = (message: string, exitReason: LocalLaunchExitReason): void => {
        this.localLaunchFailure = { message, exitReason };
    };

    /**
     * Clear the current session ID (used by /clear command)
     */
    clearSessionId = (): void => {
        this.sessionId = null;
        logger.debug('[Session] Session ID cleared');
    };

    /**
     * Consume one-time Claude flags from claudeArgs after Claude spawn
     * Currently handles: --resume (with or without session ID)
     */
    consumeOneTimeFlags = (): void => {
        if (!this.claudeArgs) return;

        const filteredArgs: string[] = [];
        for (let i = 0; i < this.claudeArgs.length; i++) {
            if (this.claudeArgs[i] === '--resume') {
                // Check if next arg looks like a UUID (contains dashes and alphanumeric)
                if (i + 1 < this.claudeArgs.length) {
                    const nextArg = this.claudeArgs[i + 1];
                    // Simple UUID pattern check - contains dashes and is not another flag
                    if (!nextArg.startsWith('-') && nextArg.includes('-')) {
                        // Skip both --resume and the UUID
                        i++; // Skip the UUID
                        logger.debug(`[Session] Consumed --resume flag with session ID: ${nextArg}`);
                    } else {
                        // Just --resume without UUID
                        logger.debug('[Session] Consumed --resume flag (no session ID)');
                    }
                } else {
                    // --resume at the end of args
                    logger.debug('[Session] Consumed --resume flag (no session ID)');
                }
            } else {
                filteredArgs.push(this.claudeArgs[i]);
            }
        }

        this.claudeArgs = filteredArgs.length > 0 ? filteredArgs : undefined;
        logger.debug(`[Session] Consumed one-time flags, remaining args:`, this.claudeArgs);
    };

    setRunningAgent = (id: string, agent: AgentStateRunningAgent | null): void => {
        if (!id) {
            return;
        }

        const nextRunningAgents = new Map(this.runningAgents);
        if (agent) {
            nextRunningAgents.set(id, agent);
        } else {
            nextRunningAgents.delete(id);
        }
        this.replaceRunningAgents(nextRunningAgents);
    };

    replaceRunningAgents = (runningAgents: ReadonlyMap<string, AgentStateRunningAgent>): void => {
        const nextRunningAgents = new Map(runningAgents);

        for (const id of this.runningAgents.keys()) {
            if (!nextRunningAgents.has(id)) {
                this.setAuxiliaryActivity(`claude-task:${id}`, false);
            }
        }
        for (const id of nextRunningAgents.keys()) {
            if (!this.runningAgents.has(id)) {
                this.setAuxiliaryActivity(`claude-task:${id}`, true);
            }
        }

        this.runningAgents = nextRunningAgents;
        this.syncRunningAgentState();
    };

    clearRunningAgents = (): void => {
        if (this.runningAgents.size === 0) {
            return;
        }
        this.replaceRunningAgents(new Map());
    };

    getRunningAgent = (): AgentStateRunningAgent | undefined => {
        const entries = [...this.runningAgents.values()];
        return entries.length === 0 ? undefined : entries[entries.length - 1];
    };

    applyClaudeHookEvent = (data: SessionHookData): void => {
        if (data.hook_event_name === 'SessionStart') {
            const sessionId = data.session_id;
            if (sessionId && this.sessionId !== sessionId) {
                this.onSessionFound(sessionId);
            }
            this.refreshClaudeTeamSnapshot();
            this.ensureClaudeTeamSnapshotPolling();
            return;
        }

        if (data.hook_event_name === 'Notification') {
            // Both `idle_prompt` and `permission_prompt` mean Claude is waiting on the user.
            // Other notification types (auth_success / elicitation_*) are observability-only.
            if (data.notification_type === 'idle_prompt' || data.notification_type === 'permission_prompt') {
                this.client.sendSessionEvent({ type: 'ready' });
            }
            return;
        }

        if (data.hook_event_name === 'SessionEnd') {
            this.clearRunningAgents();
            this.clearAuxiliaryActivity();
            this.client.sendSessionEvent({ type: 'ready' });
            return;
        }

        if (data.hook_event_name === 'Stop' || data.hook_event_name === 'StopFailure') {
            this.client.sendSessionEvent({ type: 'ready' });
            this.refreshClaudeTeamSnapshot();
            return;
        }

        if (data.hook_event_name === 'PreToolUse') {
            this.setAuxiliaryActivity(`claude-tool:${data.tool_use_id}`, true);
            return;
        }

        if (data.hook_event_name === 'PostToolUse' || data.hook_event_name === 'PostToolUseFailure' || data.hook_event_name === 'PermissionDenied') {
            this.setAuxiliaryActivity(`claude-tool:${data.tool_use_id}`, false);
            return;
        }

        if (data.hook_event_name === 'PreCompact') {
            this.setAuxiliaryActivity('claude-compact', true);
            return;
        }

        if (data.hook_event_name === 'PostCompact') {
            this.setAuxiliaryActivity('claude-compact', false);
            this.client.sendSessionEvent({ type: 'ready' });
            return;
        }

        if (data.hook_event_name === 'Elicitation') {
            this.client.sendSessionEvent({ type: 'message', message: data.message });
            this.client.sendSessionEvent({ type: 'ready' });
            return;
        }

        if (data.hook_event_name === 'ElicitationResult') {
            return;
        }

        if (data.hook_event_name === 'TaskCreated') {
            const hookAgentId = this.getHookAgentId(data);
            if (hookAgentId) {
                this.setRunningAgent(hookAgentId, this.buildRunningAgentFromHook(data));
                this.applyTeamStateFromHook(data, 'active');
                this.ensureClaudeTeamSnapshotPolling();
            }
            return;
        }

        if (data.hook_event_name === 'UserPromptSubmit'
            || data.hook_event_name === 'PermissionRequest'
            || data.hook_event_name === 'Setup'
            || data.hook_event_name === 'ConfigChange'
            || data.hook_event_name === 'WorktreeCreate'
            || data.hook_event_name === 'WorktreeRemove'
            || data.hook_event_name === 'InstructionsLoaded'
            || data.hook_event_name === 'CwdChanged'
            || data.hook_event_name === 'FileChanged') {
            return;
        }

        const hookAgentId = this.getHookAgentId(data);
        if (!hookAgentId) {
            return;
        }

        if (data.hook_event_name === 'SubagentStart') {
            this.setRunningAgent(hookAgentId, this.buildRunningAgentFromHook(data));
            this.applyTeamStateFromHook(data, 'active');
            this.ensureClaudeTeamSnapshotPolling();
            return;
        }

        if (data.hook_event_name === 'TeammateIdle') {
            this.setRunningAgent(hookAgentId, null);
            this.applyTeamStateFromHook(data, 'idle');
            this.refreshClaudeTeamSnapshot();
            return;
        }

        if (data.hook_event_name === 'SubagentStop' || data.hook_event_name === 'TaskCompleted') {
            this.setRunningAgent(hookAgentId, null);
            this.applyTeamStateFromHook(data, 'completed');
            this.refreshClaudeTeamSnapshot();
        }
    };

    ensureClaudeTeamSnapshotPolling = (): void => {
        if (this.teamSnapshotPoller || !this.sessionId) {
            return;
        }

        this.teamSnapshotPoller = setInterval(() => {
            this.refreshClaudeTeamSnapshot();
        }, 3000);
        this.teamSnapshotPoller.unref?.();
    };

    stopClaudeTeamSnapshotPolling = (): void => {
        if (!this.teamSnapshotPoller) {
            return;
        }
        clearInterval(this.teamSnapshotPoller);
        this.teamSnapshotPoller = null;
    };

    refreshClaudeTeamSnapshot = (): void => {
        if (!this.sessionId) {
            return;
        }
        const snapshot = readClaudeTeamSnapshotForSession(this.sessionId);
        if (!snapshot) {
            this.replaceTeamSnapshotActivityKeys(new Set());
            return;
        }

        this.teamMembers = new Map((snapshot.members ?? []).map((member) => [member.name, member]));
        this.teamTasks = new Map((snapshot.tasks ?? []).map((task) => [task.id, task]));
        const nextActivityKeys = new Set(
            (snapshot.tasks ?? [])
                .filter((task) => task.status === 'in_progress' || task.status === 'pending')
                .map((task) => `claude-team-task:${task.id}`)
        );
        this.replaceTeamSnapshotActivityKeys(nextActivityKeys);
        this.syncHookTeamState(snapshot.teamName, snapshot.description);
    };

    private replaceTeamSnapshotActivityKeys(nextKeys: ReadonlySet<string>): void {
        for (const key of this.teamSnapshotActivityKeys) {
            if (!nextKeys.has(key)) {
                this.setAuxiliaryActivity(key, false);
            }
        }
        for (const key of nextKeys) {
            if (!this.teamSnapshotActivityKeys.has(key)) {
                this.setAuxiliaryActivity(key, true);
            }
        }
        this.teamSnapshotActivityKeys = new Set(nextKeys);
    }

    private getHookAgentId(data: SessionHookData): string | null {
        const candidates = [
            data.agent_id,
            data.teammate_name,
            data.agent_transcript_path,
            data.transcript_path,
            data.task_id
        ];
        for (const candidate of candidates) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                return `claude-hook:${candidate.trim()}`;
            }
        }
        return null;
    }

    private buildRunningAgentFromHook(data: SessionHookData): AgentStateRunningAgent {
        const name = typeof data.agent_name === 'string' && data.agent_name.trim().length > 0
            ? data.agent_name.trim()
            : typeof data.teammate_name === 'string' && data.teammate_name.trim().length > 0
                ? data.teammate_name.trim()
            : typeof data.agent_type === 'string' && data.agent_type.trim().length > 0
                ? data.agent_type.trim()
                : typeof data.agent_id === 'string' && data.agent_id.trim().length > 0
                    ? data.agent_id.trim()
                    : 'Claude subagent';
        const task = typeof data.task_title === 'string' && data.task_title.trim().length > 0
            ? data.task_title.trim()
            : typeof data.task_subject === 'string' && data.task_subject.trim().length > 0
                ? data.task_subject.trim()
            : typeof data.task_id === 'string' && data.task_id.trim().length > 0
                ? data.task_id.trim()
                : typeof data.task_status === 'string' && data.task_status.trim().length > 0
                    ? data.task_status.trim()
                    : undefined;

        return {
            name,
            task,
            startedAt: Date.now()
        };
    }

    private applyTeamStateFromHook(data: SessionHookData, status: 'active' | 'idle' | 'completed'): void {
        const memberName = typeof data.teammate_name === 'string' && data.teammate_name.trim().length > 0
            ? data.teammate_name.trim()
            : typeof data.agent_name === 'string' && data.agent_name.trim().length > 0
            ? data.agent_name.trim()
            : typeof data.agent_type === 'string' && data.agent_type.trim().length > 0
                ? data.agent_type.trim()
                : typeof data.agent_id === 'string' && data.agent_id.trim().length > 0
                    ? data.agent_id.trim()
                    : null;
        if (memberName) {
            const previous = this.teamMembers.get(memberName);
            this.teamMembers.set(memberName, {
                ...previous,
                name: memberName,
                ...(typeof data.agent_type === 'string' && data.agent_type.trim().length > 0 ? { agentType: data.agent_type.trim() } : {}),
                status: status === 'active' ? 'active' : 'idle'
            });
        }

        const taskId = typeof data.task_id === 'string' && data.task_id.trim().length > 0
            ? data.task_id.trim()
            : null;
        const taskTitle = typeof data.task_title === 'string' && data.task_title.trim().length > 0
            ? data.task_title.trim()
            : typeof data.task_subject === 'string' && data.task_subject.trim().length > 0
                ? data.task_subject.trim()
            : null;
        if (taskId && taskTitle) {
            const previousTask = this.teamTasks.get(taskId);
            this.teamTasks.set(taskId, {
                ...previousTask,
                id: taskId,
                title: taskTitle,
                owner: memberName ?? previousTask?.owner,
                status: status === 'completed'
                    ? 'completed'
                    : status === 'active'
                        ? 'in_progress'
                        : previousTask?.status ?? 'pending'
            });
        }

        const teamName = typeof data.team_name === 'string' && data.team_name.trim().length > 0
            ? data.team_name.trim()
            : 'Claude Team';
        this.syncHookTeamState(teamName);
    }

    private syncHookTeamState(teamName: string = 'Claude Team', description?: string): void {
        if (this.teamMembers.size === 0 && this.teamTasks.size === 0) {
            this.client.updateTeamState(null);
            return;
        }

        const teamState: TeamState = {
            teamName,
            ...(description ? { description } : {}),
            members: [...this.teamMembers.values()],
            tasks: [...this.teamTasks.values()],
            updatedAt: Date.now()
        };
        this.client.updateTeamState(teamState);
    }

    private syncRunningAgentState(): void {
        const runningAgents = [...this.runningAgents.values()];
        const runningAgent = runningAgents.length > 0 ? runningAgents[runningAgents.length - 1] : undefined;
        this.client.updateAgentState((currentState) => {
            const nextState = { ...currentState };
            if (runningAgent) {
                nextState.runningAgent = runningAgent;
                nextState.runningAgents = runningAgents;
            } else {
                delete nextState.runningAgent;
                delete nextState.runningAgents;
            }
            return nextState;
        });
    }
}
