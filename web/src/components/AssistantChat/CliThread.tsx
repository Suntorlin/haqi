import { memo, useEffect, useRef } from 'react'
import type { ChatBlock } from '@/chat/types'
import type { ApiClient } from '@/api/client'
import type { AgentState, PermissionMode, SessionMetadataSummary } from '@/types/api'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { useSessionViewportScroll } from '@/components/AssistantChat/useSessionViewportScroll'
import { CliBlockRenderer } from '@/components/AssistantChat/cli/CliBlockRenderer'
import { Spinner } from '@/components/Spinner'
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

function NewMessagesIndicator(props: { count: number; show: boolean; onClick: () => void }) {
    const { t } = useTranslation()
    if (!props.show) {
        return null
    }
    return (
        <button
            onClick={props.onClick}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-[var(--app-button)] text-[var(--app-button-text)] px-3 py-1.5 rounded-full text-[15px] font-semibold shadow-lg animate-bounce-in z-10"
        >
            {props.count > 0 ? t('misc.newMessage', { n: props.count }) : t('misc.jumpToLatest')} &#8595;
        </button>
    )
}

export const CliThread = memo(function CliThread(props: CliThreadProps) {
    const scrollRef = useRef<HTMLDivElement>(null)
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
                    className="cli-thread flex-1 overflow-y-auto app-scrollbar px-4 py-3"
                >
                    <div className="mx-auto max-w-content space-y-0.5">
                        {(props.hasMoreMessages || props.isLoadingMoreMessages) && (
                            <div className="flex justify-center py-2">
                                {props.isLoadingMoreMessages ? (
                                    <div className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs border border-transparent bg-[var(--app-button)] text-[var(--app-button-text)] shadow-sm">
                                        <Spinner size="sm" label={null} className="text-current" />
                                        Loading…
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={props.onLoadMore}
                                        className="inline-flex h-7 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] text-[var(--app-fg)] shadow-sm transition-colors hover:bg-[var(--app-subtle-bg)]"
                                    >
                                        Load older
                                    </button>
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
                <NewMessagesIndicator
                    count={props.pendingCount}
                    show={showJumpToLatest}
                    onClick={scrollToBottom}
                />
            </div>
        </HappyChatProvider>
    )
})
