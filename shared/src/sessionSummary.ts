import type { ModelMode } from './modes'
import type { Session, WorktreeMetadata } from './schemas'

export type SessionSummaryMetadata = {
    name?: string
    path: string
    machineId?: string
    tags?: string[]
    model?: string
    thinkEffort?: string
    serviceTier?: string
    collaborationMode?: string
    summary?: { text: string }
    flavor?: string | null
    worktree?: WorktreeMetadata
}

export type SessionSummary = {
    id: string
    createdAt: number
    active: boolean
    thinking: boolean
    activeAt: number
    updatedAt: number
    metadata: SessionSummaryMetadata | null
    todoProgress: { completed: number; total: number } | null
    pendingRequestsCount: number
    modelMode?: ModelMode
}

export function toSessionSummary(session: Session): SessionSummary {
    const pendingRequestsCount = session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0

    const metadata: SessionSummaryMetadata | null = session.metadata ? {
        name: session.metadata.name,
        path: session.metadata.path,
        machineId: session.metadata.machineId ?? undefined,
        tags: session.metadata.tags,
        model: session.metadata.model,
        thinkEffort: session.metadata.thinkEffort,
        serviceTier: session.metadata.serviceTier,
        collaborationMode: session.metadata.collaborationMode,
        summary: session.metadata.summary ? { text: session.metadata.summary.text } : undefined,
        flavor: session.metadata.flavor ?? null,
        worktree: session.metadata.worktree
    } : null

    const todoProgress = session.todos?.length ? {
        completed: session.todos.filter(t => t.status === 'completed').length,
        total: session.todos.length
    } : null

    return {
        id: session.id,
        createdAt: session.createdAt,
        active: session.active,
        thinking: session.thinking,
        activeAt: session.activeAt,
        updatedAt: session.updatedAt,
        metadata,
        todoProgress,
        pendingRequestsCount,
        modelMode: session.modelMode
    }
}
