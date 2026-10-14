/**
 * Memory page data model (prototype). Two axes:
 *  - layer: where a memory applies (user = every session, project = one repo, task = one session)
 *  - maturity: how settled it is (fact -> experience/inference -> principle/preference)
 */

export type MemoryLayer = 'user' | 'project' | 'task'
export type Maturity = 'fact' | 'experience' | 'principle'
export type MemoryStatus = 'active' | 'pending' | 'superseded' | 'rejected' | 'stale' | 'conflict'
export type MemorySource = 'propose' | 'claude_auto' | 'user_message' | 'curator' | 'user_edit' | 'import'
export type LinkKind = 'supports' | 'supersedes' | 'conflicts'

export type MemoryVersion = {
    version: number
    text: string
    at: string
    by: string
    note?: string
}

export type MemoryItem = {
    id: string
    layer: MemoryLayer
    project?: string
    section: string
    maturity: Maturity
    /** Experience that is the agent's guess, not yet seen to hold. */
    inference?: boolean
    text: string
    status: MemoryStatus
    /** The user said it in so many words. */
    said?: boolean
    locked?: boolean
    support: number
    injected: boolean
    createdAt: string
    reinforcedAt: string
    versions: MemoryVersion[]
    sources: string[]
}

export type MemoryLink = { from: string; to: string; kind: LinkKind }

export type Probs = Record<string, number>

export type JevAnswer =
    | { kind: 'noul'; label: string; p: number }
    | { kind: 'choice'; label: string; probs: Probs; confidence: number }

export type RuleStep = { ok: boolean; text: string }

export type CandidateOutcome = 'written' | 'reinforced' | 'pending' | 'rejected' | 'merged'

export type Candidate = {
    id: string
    at: string
    source: MemorySource
    agent?: 'Claude' | 'Codex' | 'Gemini'
    session: string
    project?: string
    text: string
    redacted?: boolean
    said?: boolean
    jev: {
        latencyMs: number
        costUsd: number
        answers: Record<'lasting' | 'scope' | 'section' | 'maturity' | 'secret' | 'match', JevAnswer>
    }
    rules: RuleStep[]
    outcome: CandidateOutcome
    result: { layer?: MemoryLayer; section?: string; maturity?: Maturity; memoryId?: string; note: string }
    overridden?: boolean
}
