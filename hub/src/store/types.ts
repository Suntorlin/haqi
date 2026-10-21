export type StoredSession = {
    id: string
    tag: string | null
    namespace: string
    machineId: string | null
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    agentState: unknown | null
    agentStateVersion: number
    previewUrl: string | null
    todos: unknown | null
    todosUpdatedAt: number | null
    teamState: unknown | null
    teamStateUpdatedAt: number | null
    active: boolean
    activeAt: number | null
    seq: number
}

export type PreviewUrlHistoryEntry = {
    url: string
    createdAt: number
    lastUsedAt: number
}

export type StoredMachine = {
    id: string
    namespace: string
    createdAt: number
    updatedAt: number
    metadata: unknown | null
    metadataVersion: number
    runnerState: unknown | null
    runnerStateVersion: number
    active: boolean
    activeAt: number | null
    seq: number
}

export type StoredMessage = {
    id: string
    sessionId: string
    content: unknown
    createdAt: number
    seq: number
    localId: string | null
}

export type StoredConversationTurn = {
    id: string
    sessionId: string
    turnIndex: number
    status: 'open' | 'closed'
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

export type StoredGroupKind = 'chat' | 'task'

export type StoredTaskStatus = 'guiding' | 'active' | 'done' | 'abandoned'

/** One acceptance criterion, as the user confirmed it. */
export type StoredAcceptanceCriterion = {
    id: string
    text: string
    /** principle: from a memory; repo: from a repository convention file; inferred: the planner's guess. */
    source: 'principle' | 'repo' | 'inferred' | 'user'
    sourceRef: string | null
    verify: string
}

/** A group is a chat group or a task. The task fields are null on a chat group. */
export type StoredGroup = {
    id: string
    namespace: string
    name: string
    description: string | null
    noteSessionId: string | null
    kind: StoredGroupKind
    tag: string | null
    status: StoredTaskStatus | null
    goal: string | null
    nonGoals: string[]
    acceptance: StoredAcceptanceCriterion[]
    repoPath: string | null
    machineId: string | null
    leadSessionId: string | null
    completedAt: number | null
    createdAt: number
    updatedAt: number
}

export type StoredTaskEvent = {
    id: string
    namespace: string
    groupId: string
    type: string
    payload: unknown
    createdAt: number
}

export type StoredMessageClass = {
    messageId: string
    namespace: string
    sessionId: string
    class: string
    confidence: number
    jevCostUsd: number
    createdAt: number
}

export type StoredGroupMember = {
    id: number
    groupId: string
    namespace: string
    memberType: 'session' | 'human'
    sessionId: string | null
    userId: number | null
    role: string
    createdAt: number
}

export type StoredGroupMessageType = 'chat' | 'command' | 'task_state' | 'note_state' | 'system'

export type StoredGroupMessage = {
    id: string
    groupId: string
    namespace: string
    seq: number
    type: StoredGroupMessageType
    traceId: string | null
    taskId: string | null
    source: string
    actorSessionId: string | null
    actorName: string | null
    targetSessionIds: string[] | null
    quotedMessageId: string | null
    payload: unknown
    createdAt: number
}

export type StoredGroupConversationTurn = {
    id: string
    groupId: string
    namespace: string
    turnIndex: number
    status: 'open' | 'closed'
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

export type StoredGroupTaskStatus =
    | 'pending'
    | 'enqueued'
    | 'running'
    | 'completed'
    | 'failed'
    | 'expired'
    | 'canceled'
    | 'manual_done'

export type StoredGroupTask = {
    id: string
    groupId: string
    namespace: string
    traceId: string
    source: string
    targetSessionId: string
    command: string
    status: StoredGroupTaskStatus
    dedupeKey: string | null
    expiresAt: number | null
    createdAt: number
    updatedAt: number
    startedAt: number | null
    completedAt: number | null
    error: string | null
}

export type StoredGroupNote = {
    groupId: string
    namespace: string
    content: string
    version: number
    updatedBy: string | null
    updatedAt: number
}

export type StoredReport = {
    id: string
    namespace: string
    sessionId: string | null
    taskId: string | null
    title: string
    status: string
    markdown: string
    metadata: unknown | null
    createdAt: number
    updatedAt: number
}

export type StoredReportAsset = {
    id: string
    reportId: string
    namespace: string
    fileName: string
    storageKey: string
    mimeType: string
    size: number
    caption: string | null
    createdAt: number
}

export type StoredReportShare = {
    id: string
    reportId: string
    namespace: string
    token: string
    createdBy: string | null
    createdAt: number
    expiresAt: number | null
    revokedAt: number | null
}

export type StoredUser = {
    id: number
    platform: string
    platformUserId: string
    namespace: string
    createdAt: number
}

export type StoredPushSubscription = {
    id: number
    namespace: string
    endpoint: string
    p256dh: string
    auth: string
    createdAt: number
}

// ---- ReviewLoop types ----

export type StoredReviewLoopStatus =
    | 'executing'
    | 'reviewing'
    | 'waiting_user'
    | 'paused'
    | 'accepted'
    | 'aborted'
    | 'canceled'

export type StoredReviewLoopUserPreference = 'auto' | 'verbose' | 'silent'

export type StoredReviewLoop = {
    id: string
    namespace: string
    workerSessionId: string
    reviewerSessionId: string
    requirement: string
    acceptanceCriteria: string
    status: StoredReviewLoopStatus
    userPreference: StoredReviewLoopUserPreference
    currentRound: number
    maxRounds: number
    createdAt: number
    updatedAt: number
}

export type StoredReviewRoundStatus =
    | 'instructed'
    | 'executing'
    | 'executed'
    | 'reviewed'
    | 'user_pending'

export type StoredReviewRound = {
    id: string
    loopId: string
    namespace: string
    round: number
    instruction: string
    workerOutput: unknown | null
    verdict: unknown | null
    status: StoredReviewRoundStatus
    startedAt: number
    completedAt: number | null
}

export type VersionedUpdateResult<T> =
    | { result: 'success'; version: number; value: T }
    | { result: 'version-mismatch'; version: number; value: T }
    | { result: 'error' }

export type StoredMemory = {
    id: string
    namespace: string
    text: string
    level: 'fact' | 'experience' | 'principle'
    /** '' = applies everywhere; otherwise a repository name. */
    scope: string
    /** pending = waits for the user (principles only); candidate = on trial, promoted by mentions or let go with time. */
    status: 'active' | 'pending' | 'candidate' | 'archived'
    reason: string | null
    source: string
    sourceLabel: string | null
    sessionId: string | null
    said: boolean
    support: number
    jev: unknown | null
    overridden: { level?: string; scope?: string } | null
    replaces: string | null
    /** Lowercase tags, like session tags: the tags of the session or task the memory came from. */
    tags: string[]
    version: number
    createdAt: number
    updatedAt: number
}

export type StoredMemoryLink = {
    namespace: string
    /** `fromId` backs (supports) `toId`. */
    fromId: string
    toId: string
    createdAt: number
}

export type StoredMemoryEvent = {
    id: string
    namespace: string
    memoryId: string | null
    action: string
    text: string
    reason: string | null
    source: string
    sourceLabel: string | null
    sourceRef: string | null
    hash: string | null
    sessionId: string | null
    jev: unknown | null
    costUsd: number
    latencyMs: number
    createdAt: number
    /** What a merge changed, kept so it can be undone. */
    detail: unknown | null
}
