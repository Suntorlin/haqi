import { useEffect, useRef } from 'react'
import { ThreadPrimitive } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { AgentState, PermissionMode, SessionMetadataSummary } from '@/types/api'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { HappyAssistantMessage } from '@/components/AssistantChat/messages/AssistantMessage'
import { HappyUserMessage } from '@/components/AssistantChat/messages/UserMessage'
import { HappySystemMessage } from '@/components/AssistantChat/messages/SystemMessage'
import { useSessionViewportScroll } from '@/components/AssistantChat/useSessionViewportScroll'
import { Spinner } from '@/components/Spinner'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import type { ToolProgressSignal } from '@/chat/toolProgress'
import { useTranslation } from '@/lib/use-translation'

function NewMessagesIndicator(props: { count: number; show: boolean; onClick: () => void }) {
    const { t } = useTranslation()
    if (!props.show) {
        return null
    }

    return (
        <button
            onClick={props.onClick}
            className="absolute bottom-20 left-1/2 -translate-x-1/2 bg-[var(--app-button)] text-[var(--app-button-text)] px-3 py-1.5 rounded-full text-sm font-medium shadow-lg animate-bounce-in z-10"
        >
            {props.count > 0 ? t('misc.newMessage', { n: props.count }) : t('misc.jumpToLatest')} &#8595;
        </button>
    )
}

function MessageSkeleton() {
    const { t } = useTranslation()
    const rows = [
        { align: 'end', width: 'w-2/3', height: 'h-10' },
        { align: 'start', width: 'w-3/4', height: 'h-12' },
        { align: 'end', width: 'w-1/2', height: 'h-9' },
        { align: 'start', width: 'w-5/6', height: 'h-14' }
    ]

    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">{t('misc.loadingMessages')}</span>
            <div className="space-y-3 animate-pulse">
                {rows.map((row, index) => (
                    <div key={`skeleton-${index}`} className={row.align === 'end' ? 'flex justify-end' : 'flex justify-start'}>
                        <div className={`${row.height} ${row.width} rounded-xl bg-[var(--app-subtle-bg)]`} />
                    </div>
                ))}
            </div>
        </div>
    )
}

function HistoryLoadMoreControl(props: { loading: boolean; hasMore: boolean; onLoadMore: () => void }) {
    const { t } = useTranslation()

    if (!props.loading && !props.hasMore) {
        return null
    }

    const controlClass = 'mx-auto inline-flex h-7 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs shadow-sm'

    if (props.loading) {
        return (
            <div className="mb-2 py-1">
                <div
                    role="status"
                    aria-live="polite"
                    className={`${controlClass} border border-transparent bg-[var(--app-button)] text-[var(--app-button-text)]`}
                >
                    <Spinner size="sm" label={null} className="text-current" />
                    {t('misc.loadingHistory')}
                </div>
            </div>
        )
    }

    return (
        <div className="mb-2 py-1">
            <button
                type="button"
                onClick={props.onLoadMore}
                className={`${controlClass} border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)]`}
            >
                {t('misc.loadOlder')}
            </button>
        </div>
    )
}

function ThreadMessagesList() {
    return <ThreadPrimitive.Messages components={THREAD_MESSAGE_COMPONENTS} />
}

const THREAD_MESSAGE_COMPONENTS = {
    UserMessage: HappyUserMessage,
    AssistantMessage: HappyAssistantMessage,
    SystemMessage: HappySystemMessage
} as const

export function HappyThread(props: {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    agentState?: AgentState | null
    permissionMode?: PermissionMode
    disabled: boolean
    onRefresh: () => void
    onRetryMessage?: (localId: string) => void
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    isLoadingMessages: boolean
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMoreMessages: boolean
    onLoadMore: () => Promise<unknown>
    pendingCount: number
    newestMessageSeq: number | null
    messagesVersion: number
    forceScrollToken: number
    density: SessionListDensity
    toolProgress?: ReadonlyMap<string, ToolProgressSignal> | null
}) {
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const {
        isNearBottom,
        showJumpToLatest,
        scrollToBottom
    } = useSessionViewportScroll({
        sessionId: props.sessionId,
        viewMode: 'normal',
        viewportRef,
        isLoading: props.isLoadingMessages,
        hasMore: props.hasMoreMessages,
        isLoadingMore: props.isLoadingMoreMessages,
        pendingCount: props.pendingCount,
        contentVersion: props.messagesVersion,
        latestKey: props.newestMessageSeq !== null ? String(props.newestMessageSeq) : null,
        forceScrollToken: props.forceScrollToken,
        onLoadMore: props.onLoadMore,
        onFlushPending: props.onFlushPending
    })

    useEffect(() => {
        props.onAtBottomChange(isNearBottom)
    }, [isNearBottom, props.onAtBottomChange])

    const showSkeleton = props.isLoadingMessages && props.messagesVersion === 0 && props.pendingCount === 0
    const isCompact = props.density === 'compact'

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
            toolProgress: props.toolProgress
        }}>
            <ThreadPrimitive.Root className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col">
                <ThreadPrimitive.Viewport
                    ref={viewportRef}
                    className="app-scrollbar min-h-0 min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden"
                >
                    <div className={`mx-auto w-full max-w-content min-w-0 ${isCompact ? 'p-2' : 'p-3'}`}>
                        {showSkeleton ? (
                            <MessageSkeleton />
                        ) : (
                            <>
                                <HistoryLoadMoreControl
                                    loading={props.isLoadingMoreMessages}
                                    hasMore={props.hasMoreMessages}
                                    onLoadMore={props.onLoadMore}
                                />

                                {props.messagesWarning ? (
                                    <div className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs">
                                        {props.messagesWarning}
                                    </div>
                                ) : null}
                            </>
                        )}
                        <div className={`flex flex-col ${isCompact ? 'gap-2' : 'gap-3'}`}>
                            <ThreadMessagesList />
                        </div>
                    </div>
                </ThreadPrimitive.Viewport>
                <NewMessagesIndicator
                    count={props.pendingCount}
                    show={showJumpToLatest}
                    onClick={scrollToBottom}
                />
            </ThreadPrimitive.Root>
        </HappyChatProvider>
    )
}
