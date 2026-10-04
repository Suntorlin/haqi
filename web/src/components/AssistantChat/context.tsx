import type { ReactNode } from 'react'
import { createContext, useContext } from 'react'
import type { ApiClient } from '@/api/client'
import type { AgentState, PermissionMode, SessionMetadataSummary } from '@/types/api'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import type { ToolProgressSignal } from '@/chat/toolProgress'

export type HappyChatContextValue = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    agentState?: AgentState | null
    permissionMode?: PermissionMode
    disabled: boolean
    density: SessionListDensity
    onRefresh: () => void
    onRetryMessage?: (localId: string) => void
    toolProgress?: ReadonlyMap<string, ToolProgressSignal> | null
}

const HappyChatContext = createContext<HappyChatContextValue | null>(null)

export function HappyChatProvider(props: { value: HappyChatContextValue; children: ReactNode }) {
    return (
        <HappyChatContext.Provider value={props.value}>
            {props.children}
        </HappyChatContext.Provider>
    )
}

export function useHappyChatContext(): HappyChatContextValue {
    const ctx = useContext(HappyChatContext)
    if (!ctx) {
        throw new Error('HappyChatContext is missing')
    }
    return ctx
}

export function useOptionalHappyChatContext(): HappyChatContextValue | null {
    return useContext(HappyChatContext)
}
