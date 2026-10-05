import { z } from 'zod'
import { MODEL_MODES, PERMISSION_MODES } from './modes'

export const PermissionModeSchema = z.enum(PERMISSION_MODES)
export const ModelModeSchema = z.enum(MODEL_MODES)

const MetadataSummarySchema = z.object({
    text: z.string(),
    updatedAt: z.number()
})

export const WorktreeMetadataSchema = z.object({
    basePath: z.string(),
    branch: z.string(),
    name: z.string(),
    worktreePath: z.string().optional(),
    createdAt: z.number().optional()
})

export type WorktreeMetadata = z.infer<typeof WorktreeMetadataSchema>

// Rate-limit snapshot for Claude sessions. Mirrors a subset of cc's
// SDKRateLimitInfoSchema; we keep only fields the UI surfaces.
export const ClaudeRateLimitTypeSchema = z.enum([
    'five_hour',
    'seven_day',
    'seven_day_opus',
    'seven_day_sonnet',
    'overage'
])
export type ClaudeRateLimitType = z.infer<typeof ClaudeRateLimitTypeSchema>

export const ClaudeRateLimitStatusSchema = z.enum(['allowed', 'allowed_warning', 'rejected'])
export type ClaudeRateLimitStatus = z.infer<typeof ClaudeRateLimitStatusSchema>

export const ClaudeRateLimitEntrySchema = z.object({
    status: ClaudeRateLimitStatusSchema,
    utilization: z.number().min(0).max(1).optional(),
    resetsAt: z.number().optional(),
    observedAt: z.number(),
    overageStatus: ClaudeRateLimitStatusSchema.optional(),
    isUsingOverage: z.boolean().optional()
})
export type ClaudeRateLimitEntry = z.infer<typeof ClaudeRateLimitEntrySchema>

// One row of the oauth usage API's `limits` projection. `kind` is the server's
// window id (session, weekly_all, weekly_scoped, ...); `label` carries the
// server-supplied model bucket name for scoped windows (e.g. 'Fable').
export const ClaudeUsageLimitSchema = z.object({
    kind: z.string().min(1).max(40),
    label: z.string().max(60).optional(),
    percent: z.number().min(0).max(100).optional(),
    resetsAt: z.number().optional(),
    severity: z.string().max(20).optional(),
    observedAt: z.number()
})
export type ClaudeUsageLimit = z.infer<typeof ClaudeUsageLimitSchema>

export const ClaudeRateLimitSnapshotSchema = z.object({
    five_hour: ClaudeRateLimitEntrySchema.optional(),
    seven_day: ClaudeRateLimitEntrySchema.optional(),
    seven_day_opus: ClaudeRateLimitEntrySchema.optional(),
    seven_day_sonnet: ClaudeRateLimitEntrySchema.optional(),
    overage: ClaudeRateLimitEntrySchema.optional(),
    usageLimits: z.array(ClaudeUsageLimitSchema).max(16).optional()
})
export type ClaudeRateLimitSnapshot = z.infer<typeof ClaudeRateLimitSnapshotSchema>


// Public account metadata only. Credentials and filesystem paths never cross RPC.
export const ClaudeAccountProfileSchema = z.object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    email: z.email(),
    trustGroup: z.string().min(1).max(80),
    enabled: z.boolean().default(true)
}).strict()
export const ClaudeAccountPoolSchema = z.object({
    initialAccount: z.string(),
    autoSwitch: z.boolean(),
    profiles: z.array(ClaudeAccountProfileSchema).max(10)
}).strict().superRefine((pool, ctx) => {
    const ids = pool.profiles.map(p => p.id)
    const emails = pool.profiles.map(p => p.email.toLowerCase())
    if (new Set(ids).size !== ids.length || new Set(emails).size !== emails.length)
        ctx.addIssue({ code: 'custom', message: '账号标识和邮箱必须唯一' })
    if (pool.profiles.length && !pool.profiles.some(p => p.id === pool.initialAccount && p.enabled))
        ctx.addIssue({ code: 'custom', message: '默认账号必须存在且已启用' })
})
export const ClaudeAccountSelectionSchema = z.object({
    accountId: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    automatic: z.boolean()
}).strict()
export const ClaudeAccountRuntimeSchema = z.object({
    id: z.string(), email: z.string(), automatic: z.boolean(),
    status: z.enum(['verified', 'switching', 'handoff', 'active', 'blocked']),
    updatedAt: z.number()
})
export type ClaudeAccountPool = z.infer<typeof ClaudeAccountPoolSchema>
export type ClaudeAccountSelection = z.infer<typeof ClaudeAccountSelectionSchema>
export type ClaudeAccountRuntime = z.infer<typeof ClaudeAccountRuntimeSchema>
export type ClaudeAccountPoolView = {
    pool: ClaudeAccountPool
    revision: string
    usage?: Record<string, ClaudeRateLimitSnapshot>
}

export const MetadataSchema = z.object({
    path: z.string(),
    host: z.string(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
    version: z.string().optional(),
    name: z.string().optional(),
    os: z.string().optional(),
    summary: MetadataSummarySchema.optional(),
    machineId: z.string().optional(),
    claudeSessionId: z.string().optional(),
    codexSessionId: z.string().optional(),
    geminiSessionId: z.string().optional(),
    opencodeSessionId: z.string().optional(),
    cursorSessionId: z.string().optional(),
    tools: z.array(z.string()).optional(),
    slashCommands: z.array(z.string()).optional(),
    model: z.string().optional(),
    thinkEffort: z.string().optional(),
    serviceTier: z.string().optional(),
    collaborationMode: z.string().optional(),
    availableModels: z.array(z.string()).optional(),
    homeDir: z.string().optional(),
    happyHomeDir: z.string().optional(),
    happyLibDir: z.string().optional(),
    happyToolsDir: z.string().optional(),
    startedFromRunner: z.boolean().optional(),
    hostPid: z.number().optional(),
    startedBy: z.enum(['runner', 'terminal']).optional(),
    lifecycleState: z.string().optional(),
    lifecycleStateSince: z.number().optional(),
    archivedBy: z.string().optional(),
    archiveReason: z.string().optional(),
    flavor: z.string().nullish(),
    worktree: WorktreeMetadataSchema.optional(),
    claudeAccount: ClaudeAccountRuntimeSchema.optional(),
    rateLimitSnapshot: ClaudeRateLimitSnapshotSchema.optional()
})

export type Metadata = z.infer<typeof MetadataSchema>

export const AgentStateRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish()
})

export type AgentStateRequest = z.infer<typeof AgentStateRequestSchema>

export const AgentStateCompletedRequestSchema = z.object({
    tool: z.string(),
    arguments: z.unknown(),
    createdAt: z.number().nullish(),
    completedAt: z.number().nullish(),
    status: z.enum(['canceled', 'denied', 'approved']),
    reason: z.string().optional(),
    mode: z.string().optional(),
    decision: z.enum(['approved', 'approved_for_session', 'denied', 'abort']).optional(),
    allowTools: z.array(z.string()).optional(),
    // Flat format: Record<string, string[]> (AskUserQuestion)
    // Nested format: Record<string, { answers: string[] }> (request_user_input)
    answers: z.union([
        z.record(z.string(), z.array(z.string())),
        z.record(z.string(), z.object({ answers: z.array(z.string()) }))
    ]).optional()
})

export type AgentStateCompletedRequest = z.infer<typeof AgentStateCompletedRequestSchema>

export const AgentStateRunningAgentSchema = z.object({
    name: z.string(),
    task: z.string().optional(),
    toolUseId: z.string().optional(),
    startedAt: z.number().nullish()
})

export type AgentStateRunningAgent = z.infer<typeof AgentStateRunningAgentSchema>

export const AgentStateSchema = z.object({
    controlledByUser: z.boolean().nullish(),
    requests: z.record(z.string(), AgentStateRequestSchema).nullish(),
    completedRequests: z.record(z.string(), AgentStateCompletedRequestSchema).nullish(),
    runningAgent: AgentStateRunningAgentSchema.nullish(),
    runningAgents: z.array(AgentStateRunningAgentSchema).nullish()
})

export type AgentState = z.infer<typeof AgentStateSchema>

export const TodoItemSchema = z.object({
    content: z.string(),
    status: z.enum(['pending', 'in_progress', 'completed']),
    priority: z.enum(['high', 'medium', 'low']),
    id: z.string()
})

export type TodoItem = z.infer<typeof TodoItemSchema>

export const TodosSchema = z.array(TodoItemSchema)

export const TeamMemberSchema = z.object({
    name: z.string(),
    agentType: z.string().optional(),
    status: z.enum(['active', 'idle', 'shutdown']).optional()
})

export type TeamMember = z.infer<typeof TeamMemberSchema>

export const TeamTaskSchema = z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    status: z.enum(['pending', 'in_progress', 'completed', 'blocked']).optional(),
    owner: z.string().optional()
})

export type TeamTask = z.infer<typeof TeamTaskSchema>

export const TeamMessageSchema = z.object({
    from: z.string(),
    to: z.string(),
    summary: z.string(),
    type: z.enum(['message', 'broadcast', 'shutdown_request', 'shutdown_response']),
    timestamp: z.number()
})

export type TeamMessage = z.infer<typeof TeamMessageSchema>

export const TeamStateSchema = z.object({
    teamName: z.string(),
    description: z.string().optional(),
    members: z.array(TeamMemberSchema).optional(),
    tasks: z.array(TeamTaskSchema).optional(),
    messages: z.array(TeamMessageSchema).optional(),
    updatedAt: z.number().optional()
})

export type TeamState = z.infer<typeof TeamStateSchema>

export const TeamControlActionSchema = z.enum([
    'message',
    'shutdown_member',
    'assign_task',
    'nudge_member',
    'cleanup_team'
])

export type TeamControlAction = z.infer<typeof TeamControlActionSchema>

export const TeamControlRequestSchema = z.object({
    action: TeamControlActionSchema,
    memberName: z.string().min(1).optional(),
    taskId: z.string().min(1).optional(),
    message: z.string().min(1).optional()
})

export type TeamControlRequest = z.infer<typeof TeamControlRequestSchema>

export const TeamControlResponseSchema = z.object({
    ok: z.boolean(),
    accepted: z.boolean().optional(),
    mode: z.literal('lead_prompt').optional(),
    enqueuedPrompt: z.string().optional(),
    error: z.string().optional(),
    code: z.enum([
        'not_claude_session',
        'session_not_active',
        'team_not_found',
        'member_not_found',
        'task_not_found',
        'invalid_action'
    ]).optional()
})

export type TeamControlResponse = z.infer<typeof TeamControlResponseSchema>

export const AttachmentMetadataSchema = z.object({
    id: z.string(),
    filename: z.string(),
    mimeType: z.string(),
    size: z.number(),
    path: z.string(),
    previewUrl: z.string().optional()
})

export type AttachmentMetadata = z.infer<typeof AttachmentMetadataSchema>

export const CodexCredentialSummarySchema = z.object({
    authMode: z.string().optional(),
    email: z.string().optional(),
    organizationTitle: z.string().optional(),
    planType: z.string().optional(),
    lastRefresh: z.string().optional(),
    hasOpenAiApiKey: z.boolean(),
    hasTokens: z.boolean()
})

export type CodexCredentialSummary = z.infer<typeof CodexCredentialSummarySchema>

export const CodexCredentialProfileSchema = z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    importSource: z.enum(['current-auth', 'imported-file']),
    isActive: z.boolean(),
    summary: CodexCredentialSummarySchema
})

export type CodexCredentialProfile = z.infer<typeof CodexCredentialProfileSchema>

export const CodexCredentialStateResponseSchema = z.object({
    current: z.object({
        exists: z.boolean(),
        activeProfileId: z.string().nullable(),
        summary: CodexCredentialSummarySchema.nullable()
    }),
    profiles: z.array(CodexCredentialProfileSchema)
})

export type CodexCredentialStateResponse = z.infer<typeof CodexCredentialStateResponseSchema>

export const CodexCredentialExportResponseSchema = z.object({
    content: z.string(),
    summary: CodexCredentialSummarySchema
})

export type CodexCredentialExportResponse = z.infer<typeof CodexCredentialExportResponseSchema>

export const CodexCredentialImportRequestSchema = z.object({
    content: z.string().min(1),
    name: z.string().trim().min(1).optional()
})

export type CodexCredentialImportRequest = z.infer<typeof CodexCredentialImportRequestSchema>

export const CodexCredentialSaveCurrentRequestSchema = z.object({
    name: z.string().trim().min(1).optional()
})

export type CodexCredentialSaveCurrentRequest = z.infer<typeof CodexCredentialSaveCurrentRequestSchema>

export const CodexCredentialActivateRequestSchema = z.object({
    profileId: z.string().min(1)
})

export type CodexCredentialActivateRequest = z.infer<typeof CodexCredentialActivateRequestSchema>

export const DecryptedMessageSchema = z.object({
    id: z.string(),
    seq: z.number().nullable(),
    localId: z.string().nullable(),
    content: z.unknown(),
    createdAt: z.number()
})

export type DecryptedMessage = z.infer<typeof DecryptedMessageSchema>

export const SessionSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    seq: z.number(),
    createdAt: z.number(),
    updatedAt: z.number(),
    previewUrl: z.string().optional(),
    active: z.boolean(),
    activeAt: z.number(),
    metadata: MetadataSchema.nullable(),
    metadataVersion: z.number(),
    agentState: AgentStateSchema.nullable(),
    agentStateVersion: z.number(),
    thinking: z.boolean(),
    thinkingAt: z.number(),
    todos: TodosSchema.optional(),
    teamState: TeamStateSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    modelMode: ModelModeSchema.optional()
})

export type Session = z.infer<typeof SessionSchema>

const SessionEventBaseSchema = z.object({
    namespace: z.string().optional()
})

const SessionChangedSchema = SessionEventBaseSchema.extend({
    sessionId: z.string()
})

const MachineChangedSchema = SessionEventBaseSchema.extend({
    machineId: z.string()
})

const GroupChangedSchema = SessionEventBaseSchema.extend({
    groupId: z.string()
})

export const GroupTimelineMessageTypeSchema = z.enum([
    'chat',
    'command',
    'task_state',
    'note_state',
    'system'
])

export const GroupTimelineMessageSchema = z.object({
    id: z.string(),
    groupId: z.string(),
    namespace: z.string(),
    seq: z.number().int().nonnegative(),
    type: GroupTimelineMessageTypeSchema,
    traceId: z.string().optional(),
    taskId: z.string().optional(),
    source: z.string(),
    actorSessionId: z.string().optional(),
    actorName: z.string().optional(),
    targetSessionIds: z.array(z.string()).optional(),
    quotedMessageId: z.string().optional(),
    quotedMessage: z.object({
        id: z.string(),
        text: z.string(),
        actorName: z.string().optional(),
        createdAt: z.number()
    }).optional(),
    payload: z.unknown(),
    createdAt: z.number()
})

// ---- ReviewLoop schemas ----

export const ReviewLoopStatusSchema = z.enum([
    'executing',
    'reviewing',
    'waiting_user',
    'accepted',
    'aborted',
    'canceled'
])

export type ReviewLoopStatus = z.infer<typeof ReviewLoopStatusSchema>

export const ReviewLoopUserPreferenceSchema = z.enum([
    'auto',
    'verbose',
    'silent'
])

export type ReviewLoopUserPreference = z.infer<typeof ReviewLoopUserPreferenceSchema>

export const CriteriaItemSchema = z.object({
    criteria: z.string(),
    status: z.enum(['met', 'not_met', 'unclear']),
    note: z.string().optional()
})

export type CriteriaItem = z.infer<typeof CriteriaItemSchema>

export const ReviewVerdictActionSchema = z.enum([
    'continue',
    'pass',
    'abort',
    'notify_user'
])

export type ReviewVerdictAction = z.infer<typeof ReviewVerdictActionSchema>

export const ReviewVerdictSchema = z.object({
    action: ReviewVerdictActionSchema,
    feedback: z.string(),
    userMessage: z.string().optional(),
    progress: z.number().min(0).max(100),
    criteriaStatus: z.array(CriteriaItemSchema)
})

export type ReviewVerdict = z.infer<typeof ReviewVerdictSchema>

export const CommandResultSchema = z.object({
    command: z.string(),
    exitCode: z.number(),
    stdout: z.string(),
    stderr: z.string()
})

export type CommandResult = z.infer<typeof CommandResultSchema>

export const WorkerOutputSchema = z.object({
    rawResponse: z.string(),
    summary: z.string().optional(),
    diff: z.string(),
    filesChanged: z.array(z.string()),
    commands: z.array(CommandResultSchema),
    exitStatus: z.enum(['success', 'error'])
})

export type WorkerOutput = z.infer<typeof WorkerOutputSchema>

export const ReviewRoundStatusSchema = z.enum([
    'instructed',
    'executing',
    'executed',
    'reviewed',
    'user_pending'
])

export type ReviewRoundStatus = z.infer<typeof ReviewRoundStatusSchema>

export const ReviewLoopSchema = z.object({
    id: z.string(),
    namespace: z.string(),
    workerSessionId: z.string(),
    reviewerSessionId: z.string(),
    requirement: z.string(),
    acceptanceCriteria: z.string(),
    status: ReviewLoopStatusSchema,
    userPreference: ReviewLoopUserPreferenceSchema,
    currentRound: z.number().int().nonnegative(),
    maxRounds: z.number().int().positive(),
    createdAt: z.number(),
    updatedAt: z.number()
})

export type ReviewLoop = z.infer<typeof ReviewLoopSchema>

export const ReviewRoundSchema = z.object({
    id: z.string(),
    loopId: z.string(),
    namespace: z.string(),
    round: z.number().int().positive(),
    instruction: z.string(),
    workerOutput: WorkerOutputSchema.nullable(),
    verdict: ReviewVerdictSchema.nullable(),
    status: ReviewRoundStatusSchema,
    startedAt: z.number(),
    completedAt: z.number().nullable()
})

export type ReviewRound = z.infer<typeof ReviewRoundSchema>

const ReviewLoopChangedSchema = SessionEventBaseSchema.extend({
    loopId: z.string()
})

export const SyncEventSchema = z.discriminatedUnion('type', [
    SessionChangedSchema.extend({
        type: z.literal('session-added'),
        data: z.unknown().optional()
    }),
    SessionChangedSchema.extend({
        type: z.literal('session-updated'),
        data: z.unknown().optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('session-removed'),
        sessionId: z.string()
    }),
    SessionChangedSchema.extend({
        type: z.literal('message-received'),
        message: DecryptedMessageSchema
    }),
    MachineChangedSchema.extend({
        type: z.literal('machine-updated'),
        data: z.unknown().optional()
    }),
    GroupChangedSchema.extend({
        type: z.literal('group-added'),
        data: z.unknown().optional()
    }),
    GroupChangedSchema.extend({
        type: z.literal('group-updated'),
        data: z.unknown().optional()
    }),
    GroupChangedSchema.extend({
        type: z.literal('group-removed')
    }),
    GroupChangedSchema.extend({
        type: z.literal('group-message-received'),
        message: GroupTimelineMessageSchema
    }),
    GroupChangedSchema.extend({
        type: z.literal('group-task-updated'),
        task: z.unknown()
    }),
    GroupChangedSchema.extend({
        type: z.literal('group-note-updated'),
        note: z.unknown()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('toast'),
        data: z.object({
            title: z.string(),
            body: z.string(),
            sessionId: z.string(),
            url: z.string()
        })
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('heartbeat'),
        data: z.object({
            timestamp: z.number()
        }).optional()
    }),
    SessionEventBaseSchema.extend({
        type: z.literal('connection-changed'),
        data: z.object({
            status: z.string(),
            subscriptionId: z.string().optional()
        }).optional()
    }),
    ReviewLoopChangedSchema.extend({
        type: z.literal('review-loop-added'),
        data: z.unknown().optional()
    }),
    ReviewLoopChangedSchema.extend({
        type: z.literal('review-loop-updated'),
        data: z.unknown().optional()
    }),
    ReviewLoopChangedSchema.extend({
        type: z.literal('review-loop-removed')
    }),
    ReviewLoopChangedSchema.extend({
        type: z.literal('review-loop-round-updated'),
        round: z.unknown()
    })
])

export type SyncEvent = z.infer<typeof SyncEventSchema>
