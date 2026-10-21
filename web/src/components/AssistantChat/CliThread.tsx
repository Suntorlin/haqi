import { memo, useEffect, useRef } from 'react'
import type { ChatBlock } from '@/chat/types'
import type { ApiClient } from '@/api/client'
import type { AgentState, PermissionMode, SessionMetadataSummary } from '@/types/api'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { useSessionViewportScroll } from '@/components/AssistantChat/useSessionViewportScroll'
import { useNestedScrollPassthrough } from '@/components/AssistantChat/useNestedScrollPassthrough'
import { CliBlockRenderer } from '@/components/AssistantChat/cli/CliBlockRenderer'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { JumpToLatestButton } from '@/components/AssistantChat/JumpToLatestButton'
import { useTranslation } from '@/lib/use-translation'

type CliThreadProps = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    agentState?: AgentState | null
    permissionMode?: PermissionMode
    disabled: boolean
    density: SessionListDensity
    blocks: ChatBlock[]
    isLoadingMessages: boolean
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMoreMessages: boolean
    onLoadMore: () => void
    onRefresh: () => void
    onFlushPending: () => void
    onRetryMessage?: (localId: string) => void
    onAtBottomChange?: (atBottom: boolean) => void
    pendingCount: number
    newestMessageSeq: number | null
    messagesVersion: number
}

export const CliThread = memo(function CliThread(props: CliThreadProps) {
    const scrollRef = useRef<HTMLDivElement>(null)
    useNestedScrollPassthrough(scrollRef)
    const {
        isNearBottom,
        showJumpToLatest,
        scrollToBottom
    } = useSessionViewportScroll({
        sessionId: props.sessionId,
        viewMode: 'cli',
        viewportRef: scrollRef,
        isLoading: props.isLoadingMessages,
        hasMore: props.hasMoreMessages,
        isLoadingMore: props.isLoadingMoreMessages,
        pendingCount: props.pendingCount,
        contentVersion: props.messagesVersion,
        latestKey: props.newestMessageSeq !== null ? String(props.newestMessageSeq) : null,
        onLoadMore: props.onLoadMore,
        onFlushPending: props.onFlushPending
    })

    useEffect(() => {
        props.onAtBottomChange?.(isNearBottom)
    }, [isNearBottom, props.onAtBottomChange])

    return (
        <HappyChatProvider value={{
            api: props.api,
            sessionId: props.sessionId,
            metadata: props.metadata,
            agentState: props.agentState,
            permissionMode: props.permissionMode,
            disabled: props.disabled,
            density: props.density,
            onRefresh: props.onRefresh,
            onRetryMessage: props.onRetryMessage,
        }}>
            <div className="relative flex min-h-0 flex-1 flex-col">
                <div
                    ref={scrollRef}
                    className="cli-thread flex-1 overflow-y-auto px-4 py-3"
                >
                    <div className="mx-auto max-w-content space-y-0.5">
                        {(props.hasMoreMessages || props.isLoadingMoreMessages) && (
                            <div className="flex justify-center py-2">
                                {props.isLoadingMoreMessages ? (
                                    <div className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full bg-[var(--social-primary)] px-2.5 text-xs text-[var(--social-primary-fg)]">
                                        <Spinner size="sm" label={null} className="text-current" />
                                        Loading…
                                    </div>
                                ) : (
                                    <Button variant="secondary" size="sm" onClick={props.onLoadMore} className={HIT_AREA_CLASS}>
                                        Load older
                                    </Button>
                                )}
                            </div>
                        )}

                        {props.isLoadingMessages && props.blocks.length === 0 && (
                            <div className="flex justify-center py-8">
                                <Spinner size="md" />
                            </div>
                        )}

                        {props.messagesWarning && (
                            <div className="text-xs text-[var(--app-badge-warning-text)] italic py-1">
                                — {props.messagesWarning}
                            </div>
                        )}

                        {props.blocks.map((block) => (
                            <CliBlockRenderer key={block.id} block={block} />
                        ))}
                    </div>
                </div>
                <JumpToLatestButton
                    raised
                    count={props.pendingCount}
                    show={showJumpToLatest}
                    onClick={scrollToBottom}
                />
            </div>
        </HappyChatProvider>
    )
})
