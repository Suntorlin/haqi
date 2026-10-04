export type ApprovalPolicy = 'untrusted' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type ServiceTier = 'fast' | 'flex';

export interface InitializeParams {
    clientInfo: {
        name: string;
        title?: string;
        version: string;
    };
    capabilities?: {
        experimentalApi?: boolean;
        optOutNotificationMethods?: string[] | null;
        optOutRequestMethods?: string[] | null;
    } | null;
}

export interface InitializeResponse {
    userAgent?: string;
    [key: string]: unknown;
}

export interface ThreadStartParams {
    model?: string;
    modelProvider?: string;
    serviceTier?: ServiceTier | null;
    cwd?: string;
    approvalPolicy?: ApprovalPolicy;
    sandbox?: SandboxMode;
    config?: Record<string, unknown>;
    baseInstructions?: string;
    developerInstructions?: string;
    personality?: string;
    ephemeral?: boolean;
    experimentalRawEvents?: boolean;
}

export interface ThreadStartResponse {
    thread: {
        id: string;
    };
    [key: string]: unknown;
}

export type ResponseItem = Record<string, unknown>;

export interface ThreadResumeParams {
    threadId: string;
    history?: ResponseItem[];
    path?: string;
    model?: string;
    modelProvider?: string;
    serviceTier?: ServiceTier | null;
    cwd?: string;
    approvalPolicy?: ApprovalPolicy;
    sandbox?: SandboxMode;
    config?: Record<string, unknown>;
    baseInstructions?: string;
    developerInstructions?: string;
    personality?: string;
}

export interface ThreadResumeResponse {
    thread: {
        id: string;
    };
    [key: string]: unknown;
}

export type UserInput =
    | {
        type: 'text';
        text: string;
        textElements?: Array<{
            byteRange: { start: number; end: number };
            placeholder?: string;
        }>;
    }
    | {
        type: 'image';
        url: string;
    }
    | {
        type: 'localImage';
        path: string;
    }
    | {
        type: 'skill';
        name: string;
        path: string;
    };

export type SandboxPolicy =
    | { type: 'dangerFullAccess' }
    | { type: 'readOnly' }
    | { type: 'externalSandbox'; networkAccess?: 'restricted' | 'enabled' }
    | {
        type: 'workspaceWrite';
        writableRoots?: string[];
        networkAccess?: boolean;
        excludeTmpdirEnvVar?: boolean;
        excludeSlashTmp?: boolean;
    };

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'auto';
export type ReasoningSummary = 'auto' | 'none' | 'brief' | 'detailed';

export type CollaborationMode = {
    mode: 'plan' | 'code' | 'pair_programming' | 'execute' | 'custom' | (string & {});
    settings?: Record<string, unknown>;
};

export interface TurnStartParams {
    threadId: string;
    input: UserInput[];
    cwd?: string;
    approvalPolicy?: ApprovalPolicy;
    sandboxPolicy?: SandboxPolicy;
    model?: string;
    serviceTier?: ServiceTier | null;
    effort?: ReasoningEffort;
    summary?: ReasoningSummary;
    personality?: string;
    outputSchema?: unknown;
    collaborationMode?: CollaborationMode;
}

export interface TurnStartResponse {
    turn: {
        id: string;
        status?: string;
    };
    [key: string]: unknown;
}

export interface TurnInterruptParams {
    threadId: string;
    turnId: string;
}

export interface TurnInterruptResponse {
    ok: boolean;
    [key: string]: unknown;
}

export type ThreadGoalStatus = 'active' | 'paused' | 'budgetLimited';

export interface ThreadGoal {
    objective: string;
    status?: ThreadGoalStatus;
    tokenBudget?: number | null;
    tokensUsed?: number;
    timeUsedSeconds?: number;
    createdAt?: number;
    updatedAt?: number;
    [key: string]: unknown;
}

export interface ThreadGoalSetParams {
    threadId: string;
    objective: string;
    status?: ThreadGoalStatus;
    tokenBudget?: number | null;
}

export interface ThreadGoalSetResponse {
    goal: ThreadGoal;
    [key: string]: unknown;
}

export interface ThreadGoalGetParams {
    threadId: string;
}

export interface ThreadGoalGetResponse {
    goal?: ThreadGoal | null;
    [key: string]: unknown;
}

export interface ThreadGoalClearParams {
    threadId: string;
}

export interface ThreadGoalClearResponse {
    cleared: boolean;
    [key: string]: unknown;
}

export interface AccountReadResponse {
    account?: {
        type?: string;
        email?: string;
        planType?: string;
        [key: string]: unknown;
    };
    requiresOpenaiAuth?: boolean;
    [key: string]: unknown;
}

export interface AuthStatusResponse {
    authMethod?: string;
    requiresOpenaiAuth?: boolean;
    [key: string]: unknown;
}

export interface RateLimitWindow {
    usedPercent?: number;
    windowDurationMins?: number;
    resetsAt?: number;
    [key: string]: unknown;
}

export interface RateLimitCredits {
    hasCredits?: boolean;
    unlimited?: boolean;
    balance?: string;
    [key: string]: unknown;
}

export interface RateLimitEntry {
    limitId?: string;
    limitName?: string | null;
    primary?: RateLimitWindow;
    secondary?: RateLimitWindow;
    credits?: RateLimitCredits | null;
    planType?: string;
    [key: string]: unknown;
}

export interface RateLimitsReadResponse {
    rateLimits?: RateLimitEntry;
    rateLimitsByLimitId?: Record<string, RateLimitEntry>;
    [key: string]: unknown;
}

export interface ConfigReadResponse {
    config?: Record<string, unknown>;
    origins?: Record<string, unknown>;
    [key: string]: unknown;
}
