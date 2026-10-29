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
    /** The digital employee that escalated this task; its delivery goes back to the employee's main session. */
    employeeId: string | null
    completedAt: number | null
    /** Set when the user archived it: it leaves the main list, its sessions stop, its history stays. */
    archivedAt: number | null
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

/** The compliance light of one session: ok / warn / alert, why, and one strike count per violated memory. */
export type StoredSessionGuard = {
    sessionId: string
    namespace: string
    status: 'ok' | 'warn' | 'alert'
    reason: string | null
    /** The memory behind `reason`, when a rule was violated. */
    memoryId: string | null
    /** Per memory, the conversation turn indexes whose reply broke it, within the guard's window. */
    strikes: Record<string, number[]>
    cleanStreak: number
    /** The newest message seq a check covered; turns at or below it are not checked again. */
    checkedEndSeq: number
    checkedTurns: number
    costUsd: number
    updatedAt: number
}

/** The notes copy of one handoff report: where it was written, what was written, and the retry state. */
export type StoredHandoffExport = {
    reportId: string
    namespace: string
    sessionId: string | null
    project: string | null
    /** Folder under the notes root, relative, with `/` separators. */
    folder: string | null
    /** File under the notes root, relative, with the `.md` ending. */
    filePath: string | null
    /** Hash of the last rendered copy; equal means nothing new to write. */
    renderedHash: string | null
    /** Hash of the file as last written; a different file on disk means the user edited it. */
    writtenHash: string | null
    /** own: the file is rewritten; append: the user edited it, so updates go to its end. */
    mode: 'own' | 'append'
    status: 'pending' | 'ok' | 'failed' | 'empty'
    attempts: number
    nextAt: number | null
    lastError: string | null
    /** The report version (updatedAt) the session was last asked to bring up to date. */
    nudgedVersion: number | null
    exportedAt: number | null
    updatedAt: number
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
    /** The employee whose work this loop reviews; null for ordinary loops. */
    employeeId: string | null
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
    /** Owning employee; null = shared memory, visible to everyone. */
    employeeId: string | null
    /** Pinned memories are never merged, retired or rewritten by maintenance. */
    pinned: boolean
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

/** A digital employee: a persistent identity over one-off sessions. */
export type StoredEmployee = {
    id: string
    namespace: string
    name: string
    emoji: string | null
    status: 'active' | 'paused' | 'retired'
    /** Employee home, relative to the vault root. */
    homePath: string
    /** Default machine; also the only machine that reads and writes the employee's shared files. */
    machineId: string
    /** Default working directory (a project folder on the machine). */
    directory: string
    agent: string
    model: string | null
    permissionMode: string | null
    accountGroup: string | null
    timezone: string
    mainSessionId: string | null
    mainSessionStartedAt: number | null
    mainSessionCompactions: number
    /** Hour of day (employee timezone) when the main session is reset. */
    dailyResetHour: number
    /** Context share at which HAQI compacts the main session itself. */
    compactThreshold: number
    webhookSlug: string | null
    createdAt: number
    updatedAt: number
}

/** An open loose end; one row per distinct problem, repeats only bump seenCount. */
export type StoredEmployeeIssue = {
    id: string
    namespace: string
    employeeId: string
    text: string
    status: 'open' | 'closed'
    firstSeen: number
    lastSeen: number
    seenCount: number
    /** When the user was last reminded about this overdue issue. */
    escalatedAt: number | null
    closedAt: number | null
    closeNote: string | null
}

/** The MEMORY.md text as last generated; the baseline a file edit is diffed against. */
export type StoredEmployeeMemoryView = {
    employeeId: string
    namespace: string
    content: string
    generatedAt: number
}

/** One week of an employee's work: the metrics snapshot, and the user's score once given. */
export type StoredEmployeeReview = {
    id: string
    namespace: string
    employeeId: string
    periodStart: number
    periodEnd: number
    /** The weekly report file, relative to the employee home. */
    reportPath: string | null
    /** The metrics snapshot, as JSON. */
    metrics: string
    /** 1 to 5; null until the user reviews. */
    score: number | null
    comment: string | null
    /** The distilled lesson of a low score; the next wake's state package repeats it. */
    lesson: string | null
    /** The proposed skill file of a high score, relative to the employee home. */
    skillPath: string | null
    createdAt: number
    reviewedAt: number | null
}
