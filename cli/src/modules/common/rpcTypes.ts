import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'

export interface SpawnSessionOptions {
    claudeAccount?: ClaudeAccountSelection
    machineId?: string
    directory: string
    sessionId?: string
    resumeSessionId?: string
    /** Existing Claude account whose transcript is being resumed; runner copies the transcript before launch. */
    sourceClaudeAccountId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
    model?: string
    thinkEffort?: 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
    serviceTier?: 'fast' | 'flex'
    yolo?: boolean
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string }
