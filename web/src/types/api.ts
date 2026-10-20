import type {
    DecryptedMessage as ProtocolDecryptedMessage,
    Session,
    SessionSummary,
    SessionTask,
    SyncEvent as ProtocolSyncEvent,
    WorktreeMetadata
} from '@hapi/protocol/types'

export type {
    AgentState,
    AgentStateRunningAgent,
    AttachmentMetadata,
    CodexCredentialExportResponse,
    CodexCredentialImportRequest,
    CodexCredentialProfile,
    CodexCredentialSaveCurrentRequest,
    CodexCredentialStateResponse,
    CodexCredentialSummary,
    ModelMode,
    PermissionMode,
    Session,
    SessionSummary,
    SessionSummaryMetadata,
    SessionTask,
    TeamControlAction,
    TeamControlRequest,
    TeamControlResponse,
    TeamMember,
    TeamMessage,
    TeamState,
    TeamTask,
    TodoItem,
    WorktreeMetadata
} from '@hapi/protocol/types'

export type SessionMetadataSummary = {
    path: string
    host: string
    tags?: string[]
    version?: string
    name?: string
    model?: string
    thinkEffort?: string
    serviceTier?: string
    collaborationMode?: string
    availableModels?: string[]
    os?: string
    summary?: { text: string; updatedAt: number }
    machineId?: string
    tools?: string[]
    flavor?: string | null
    worktree?: WorktreeMetadata
}

export type MessageStatus = 'sending' | 'sent' | 'failed'

export type DecryptedMessage = ProtocolDecryptedMessage & {
    status?: MessageStatus
    originalText?: string
}

export type RunnerState = {
    status?: string
    pid?: number
    httpPort?: number
    startedAt?: number
    shutdownRequestedAt?: number
    shutdownSource?: string
    lastSpawnError?: {
        message: string
        pid?: number
        exitCode?: number | null
        signal?: string | null
        at: number
    } | null
}

export type Machine = {
    id: string
    active: boolean
    metadata: {
        host: string
        platform: string
        happyCliVersion: string
        displayName?: string
    } | null
    runnerState?: RunnerState | null
}

export type AuthResponse = {
    token: string
    user: {
        id: number
        username?: string
        firstName?: string
        lastName?: string
    }
}

export type SessionsResponse = { sessions: SessionSummary[] }
export type SessionResponse = { session: Session }
export type SessionPreviewUrlResponse = { ok: true; previewUrl: string | null }
export type PreviewUrlHistoryResponse = {
    urls: string[]
    entries?: Array<{ url: string; createdAt: number; lastUsedAt: number }>
}
export type MessagesResponse = {
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}

export type ConversationTurnStatus = 'open' | 'closed'

export type ConversationTurn = {
    id: string
    sessionId: string
    turnIndex: number
    status: ConversationTurnStatus
    userMessageId: string | null
    userSeq: number | null
    agentStartSeq: number | null
    agentEndSeq: number | null
    messageCount: number
    userPreview: string | null
    assistantPreview: string | null
    createdAt: number
    updatedAt: number
}

export type ConversationTurnsResponse = {
    turns: ConversationTurn[]
    page: {
        limit: number
        beforeTurnIndex: number | null
        nextBeforeTurnIndex: number | null
        hasMore: boolean
    }
}

export type ConversationTurnMessagesResponse = {
    turn: ConversationTurn
    messages: DecryptedMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
        startSeq: number | null
        endSeq: number | null
    }
}

export type MachinesResponse = { machines: Machine[] }
export type MachinePathsExistsResponse = { exists: Record<string, boolean> }

export type GroupTimelineMessageType = 'chat' | 'command' | 'task_state' | 'note_state' | 'system'

export type GroupTimelineMessage = {
    id: string
    groupId: string
    namespace: string
    seq: number
    type: GroupTimelineMessageType
    traceId?: string
    taskId?: string
    source: string
    actorSessionId?: string
    actorName?: string
    targetSessionIds?: string[]
    payload: unknown
    createdAt: number
    // Quote support
    quotedMessageId?: string
    quotedMessage?: {
        id: string
        text: string
        actorName?: string
        createdAt: number
    }
}

export type GroupConversationTurnStatus = 'open' | 'closed'

export type GroupConversationTurn = {
    id: string
    groupId: string
    namespace: string
    turnIndex: number
    status: GroupConversationTurnStatus
    initiatorMessageId: string | null
    initiatorSeq: number | null
    initiatorSource: string | null
    initiatorActorSessionId: string | null
    responderStartSeq: number | null
    responderEndSeq: number | null
    messageCount: number
    initiatorPreview: string | null
    responderPreview: string | null
    createdAt: number
    updatedAt: number
}

export type GroupConversationTurnsResponse = {
    turns: GroupConversationTurn[]
    page: {
        limit: number
        beforeTurnIndex: number | null
        nextBeforeTurnIndex: number | null
        hasMore: boolean
    }
}

export type GroupConversationTurnMessagesResponse = {
    turn: GroupConversationTurn
    messages: GroupTimelineMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
        startSeq: number | null
        endSeq: number | null
    }
}

export type GroupTaskStatus =
    | 'pending'
    | 'enqueued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'expired'
    | 'canceled'
    | 'manual_done'

export type GroupTask = {
    id: string
    groupId: string
    namespace: string
    traceId: string
    source: string
    targetSessionId: string
    command: string
    status: GroupTaskStatus
    dedupeKey: string | null
    expiresAt: number | null
    createdAt: number
    updatedAt: number
    startedAt: number | null
    completedAt: number | null
    error: string | null
}

export type Group = {
    id: string
    namespace: string
    name: string
    description: string | null
    noteSessionId: string | null
    notePrompt: string | null
    createdAt: number
    updatedAt: number
}

export type GroupMember = {
    id: number
    groupId: string
    namespace: string
    memberType: 'session' | 'human'
    sessionId: string | null
    userId: number | null
    role: string
    createdAt: number
}

export type GroupNote = {
    groupId: string
    namespace: string
    content: string
    version: number
    updatedBy: string | null
    updatedAt: number
}

export type GroupDetail = {
    group: Group
    members: GroupMember[]
    note: GroupNote | null
}

export type GroupsResponse = {
    groups: GroupDetail[]
}

export type GroupResponse = {
    group: GroupDetail
}

export type GroupMessagesResponse = {
    messages: GroupTimelineMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}

export type GroupTasksResponse = {
    tasks: GroupTask[]
}

export type CreateGroupResponse = {
    group: GroupDetail
}

export type AddGroupMemberResponse = {
    group: GroupDetail
}

export type RemoveGroupMemberResponse = {
    group: GroupDetail
}

export type UpdateGroupResponse = {
    group: GroupDetail
}

export type PostGroupMessageResponse = {
    message: GroupTimelineMessage
    createdTasks: GroupTask[]
}

export type GroupNoteResponse = {
    note: GroupNote | null
}

export type UpdateGroupNoteResponse = {
    note: GroupNote
}

export type RefreshGroupNoteResponse = {
    triggered: boolean
    reason?: string
}

export type GroupTaskActionResponse = {
    task: GroupTask
}

// ---- ReviewLoop types ----

export type ReviewLoopStatus = 'executing' | 'reviewing' | 'waiting_user' | 'paused' | 'accepted' | 'aborted' | 'canceled'
export type ReviewLoopUserPreference = 'auto' | 'verbose' | 'silent'
export type ReviewRoundStatus = 'instructed' | 'executing' | 'executed' | 'reviewed' | 'user_pending'

export type CriteriaItem = {
    criteria: string
    status: 'met' | 'not_met' | 'unclear'
    note?: string
}

export type ReviewVerdict = {
    action: 'continue' | 'pass' | 'abort' | 'notify_user'
    feedback: string
    userMessage?: string
    progress: number
    criteriaStatus: CriteriaItem[]
}

export type WorkerOutput = {
    rawResponse: string
    summary?: string
    diff: string
    filesChanged: string[]
    commands: Array<{
        command: string
        exitCode: number
        stdout: string
        stderr: string
    }>
    exitStatus: 'success' | 'error'
}

export type ReviewLoop = {
    id: string
    namespace: string
    workerSessionId: string
    reviewerSessionId: string
    requirement: string
    acceptanceCriteria: string
    status: ReviewLoopStatus
    userPreference: ReviewLoopUserPreference
    currentRound: number
    maxRounds: number
    createdAt: number
    updatedAt: number
}

export type ReviewRound = {
    id: string
    loopId: string
    namespace: string
    round: number
    instruction: string
    workerOutput: WorkerOutput | null
    verdict: ReviewVerdict | null
    status: ReviewRoundStatus
    startedAt: number
    completedAt: number | null
}

export type ReviewLoopsResponse = {
    loops: ReviewLoop[]
}

export type ReviewLoopDetailResponse = {
    loop: ReviewLoop
    rounds: ReviewRound[]
}

export type ReviewLoopRoundResponse = {
    round: ReviewRound
}

export type ReviewLoopVerdictResponse = {
    loop: ReviewLoop
    round: ReviewRound
    nextAction: string
}

export type GlobalMemory = {
    path: string
    content: string
    updatedAt: number
    bytes: number
    enabled: boolean
    pureContextMode: boolean
}

export type MemoryResponse = {
    memory: GlobalMemory
}

export type UpdateMemoryResponse = {
    memory: GlobalMemory
}

export type MemoryLevel = 'fact' | 'experience' | 'principle'

export type MemoryJevVerdict = {
    keep: number
    level: { choice: MemoryLevel; confidence: number }
    scope: { choice: 'global' | 'project'; confidence: number }
    project: string | null
}

/** One captured memory: a sentence + level + scope ('' = everywhere). */
export type MemoryItem = {
    id: string
    text: string
    level: MemoryLevel
    scope: string
    /** pending = waits for you (principles); candidate = on trial, promoted by mentions or let go after 30 quiet days. */
    status: 'active' | 'pending' | 'candidate' | 'archived'
    reason: string | null
    source: string
    sourceLabel: string | null
    sessionId: string | null
    said: boolean
    support: number
    jev: MemoryJevVerdict | null
    overridden: { level?: MemoryLevel; scope?: string } | null
    replaces: string | null
    version: number
    createdAt: number
    updatedAt: number
}

/** `fromId` backs (supports) `toId`. */
export type MemoryLink = { fromId: string; toId: string; createdAt: number }

export type MemoryEvent = {
    id: string
    memoryId: string | null
    action: string
    text: string
    reason: string | null
    source: string
    sourceLabel: string | null
    costUsd: number
    createdAt: number
}

export type MemoryCaptureSettings = { mode: 'off' | 'record'; projects: string[] }

export type MemoriesResponse = {
    memories: MemoryItem[]
    links: MemoryLink[]
    recent: MemoryEvent[]
    /** For memories on trial: mentions in the last 30 days and when it last came up. */
    trial: Record<string, { recent: number; lastAt: number }>
    stats: { addedToday: number; skippedToday: number; skippedReasons: Record<string, number>; judged: number; corrected: number; costTodayUsd: number }
    settings: MemoryCaptureSettings & { jevReady: boolean; knownProjects: Array<{ name: string; path: string | null; sessions: number }> }
}

export type MemoryHit = MemoryItem & { score: number }

export type MemoryMaintainResult = { moved: number; embedded: number; merged: number; promoted: number; expired: number; offered: number; costUsd: number }

export type ExperimentalSettings = {
    claudeLoginShell: boolean
    codexReportPromptEnabled: boolean
    previewEnabled: boolean
}

export type ExperimentalSettingsResponse = {
    settings: ExperimentalSettings
}

export type ReportDomainSettings = {
    value: string
    source: 'env' | 'file' | 'default'
    envOverride: boolean
}

export type ReportDomainResponse = {
    settings: ReportDomainSettings
}

export type ProjectOfflineSettingsResponse = {
    directories: string[]
}

export type SessionTasksResponse = {
    tasks: SessionTask[]
}

/** The model settings picked last (new-session form or a chat switch), shared by every device. */
export type NewSessionDefaults = {
    agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
    model?: string
    customModel?: string
    thinkEffort?: 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
    serviceTier?: 'auto' | 'fast' | 'flex'
    yoloMode?: boolean
    claudeAccountId?: string
    updatedAt: number
}

export type NewSessionDefaultsResponse = {
    defaults: NewSessionDefaults | null
}

export type UsageTotals = {
    inputTokens: number
    cachedInputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    outputTokens: number
    reasoningOutputTokens: number
    totalTokens: number
}

export type UsageCostEstimate = {
    currency: 'USD'
    unit: 'usd_per_million_tokens'
    usdPerMillionTokens: number
    allTimeUsd: number
    last30DaysUsd: number
    approximate: true
    rateSource: 'litelm' | 'env' | 'default'
    pricingModel?: string
    pricingFetchedAt?: number
}

export type UsageProviderOverview = {
    provider: 'claude' | 'codex'
    available: boolean
    roots: string[]
    filesScanned: number
    parseErrors: number
    eventCount: number
    last30DaysEventCount: number
    allTime: UsageTotals
    last30Days: UsageTotals
    estimatedCost?: UsageCostEstimate
}

export type UsageOverview = {
    generatedAt: number
    windowDays: number
    claude: UsageProviderOverview
    codex: UsageProviderOverview
}

export type UsageOverviewResponse = {
    success: boolean
    overview?: UsageOverview
    error?: string
}

export type SessionUsageProvider = 'claude' | 'codex' | 'unknown'

export type SessionUsageSourceCounts = {
    claudeAssistantMessages: number
    codexTokenEvents: number
}

export type SessionUsageOverview = {
    sessionId: string
    provider: SessionUsageProvider
    generatedAt: number
    messageCount: number
    usageEventCount: number
    parseErrors: number
    allTime: UsageTotals
    latest: UsageTotals | null
    lastUsageAt: number | null
    sourceCounts: SessionUsageSourceCounts
}

export type SessionUsageResponse = {
    success: boolean
    usage?: SessionUsageOverview
    error?: string
}

export type SpawnResponse =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string }

export type GitCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type QueueSummary = {
    pendingCount: number
    inQueue: boolean
    taskRunning: boolean
    nextPreview?: string
}

export type QueueEntry = {
    id: string
    index: number
    preview: string
    fullText?: string
    modeHash: string
    isolate: boolean
    deferredUserMessage?: boolean
    enqueuedAt: number
}

export type QueueState = QueueSummary & {
    entries: QueueEntry[]
}

export type QueueResponse = {
    success: boolean
    error?: string
    sessionId?: string
    queue?: QueueState
    removedId?: string
    movedId?: string
    clearedCount?: number
}

export type QueueStatusResponse = {
    success: boolean
    message?: string
    error?: string
    queue?: QueueSummary
}

// Backward-compat aliases (to be removed later)
export type CodexQueueSummary = QueueSummary
export type CodexQueueEntry = QueueEntry
export type CodexQueueState = QueueState
export type CodexQueueResponse = QueueResponse
export type CodexStatusResponse = QueueStatusResponse

export type FileSearchItem = {
    fileName: string
    filePath: string
    fullPath: string
    fileType: 'file' | 'folder'
}

export type FileSearchResponse = {
    success: boolean
    files?: FileSearchItem[]
    error?: string
}

export type DirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type ListDirectoryResponse = {
    success: boolean
    entries?: DirectoryEntry[]
    error?: string
}

export type FileReadResponse = {
    success: boolean
    content?: string
    size?: number
    truncated?: boolean
    error?: string
}

export type UploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type DeleteUploadResponse = {
    success: boolean
    error?: string
}

export type GitFileStatus = {
    fileName: string
    filePath: string
    fullPath: string
    repo?: string
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

export type GitRepoStatus = {
    name: string
    branch: string | null
}

export type GitStatusFiles = {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    repos: GitRepoStatus[]
    totalStaged: number
    totalUnstaged: number
}

export type SlashCommand = {
    name: string
    description?: string
    source: 'builtin' | 'user' | 'plugin' | 'project'
    content?: string  // Expanded content for Codex user prompts
    pluginName?: string
}

export type SlashCommandsResponse = {
    success: boolean
    commands?: SlashCommand[]
    error?: string
}

export type SkillSummary = {
    name: string
    description?: string
}

export type SkillsResponse = {
    success: boolean
    skills?: SkillSummary[]
    error?: string
}

export type McpServerSummary = {
    name: string
    status: string
    available: boolean
    enabled?: boolean
    connected?: boolean
    transport?: 'http' | 'stdio' | 'sse' | 'unknown'
    target?: string
    auth?: string
    source?: 'cli-config' | 'runtime-bridge' | 'combined'
}

export type McpServersResponse = {
    success: boolean
    flavor?: string
    servers?: McpServerSummary[]
    checkedAt?: number
    warning?: string
    error?: string
}

export type PushSubscriptionKeys = {
    p256dh: string
    auth: string
}

export type PushSubscriptionPayload = {
    endpoint: string
    keys: PushSubscriptionKeys
}

export type PushUnsubscribePayload = {
    endpoint: string
}

export type PushVapidPublicKeyResponse = {
    publicKey: string
}

export type VisibilityPayload = {
    subscriptionId: string
    visibility: 'visible' | 'hidden'
}

export type SyncEvent = ProtocolSyncEvent
