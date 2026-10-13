import { useCallback, useEffect, useRef } from 'react'
import { ThreadPrimitive, useAssistantState } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type { AgentState, PermissionMode, SessionMetadataSummary } from '@/types/api'
import { HappyChatProvider } from '@/components/AssistantChat/context'
import { HappyAssistantMessage } from '@/components/AssistantChat/messages/AssistantMessage'
import { HappyUserMessage } from '@/components/AssistantChat/messages/UserMessage'
import { HappySystemMessage } from '@/components/AssistantChat/messages/SystemMessage'
import { SocialAssistantMessage, SocialUserMessage } from '@/components/AssistantChat/messages/SocialMessages'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { useSessionViewportScroll } from '@/components/AssistantChat/useSessionViewportScroll'
import { Spinner } from '@/components/Spinner'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import type { ToolProgressSignal } from '@/chat/toolProgress'
import type { RunStats } from '@/components/mobile/chatTimeline'
import { useTranslation } from '@/lib/use-translation'

const STICK_TO_BOTTOM_THRESHOLD_PX = 32

/**
 * Social layout replaces assistant-ui's auto-scroll: stay pinned to the bottom while content grows,
 * except during a short hold requested by a message that is expanding or collapsing itself.
 */
function useStickToBottom(
    enabled: boolean,
    viewportRef: React.RefObject<HTMLDivElement | null>,
    contentRef: React.RefObject<HTMLDivElement | null>
): (durationMs?: number) => void {
    const holdUntilRef = useRef(0)
    useEffect(() => {
        const viewport = viewportRef.current
        const content = contentRef.current
        if (!enabled || !viewport || !content) return
        let nearBottom = true
        const onScroll = () => {
            nearBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= STICK_TO_BOTTOM_THRESHOLD_PX
        }
        onScroll()
        viewport.addEventListener('scroll', onScroll, { passive: true })
        const observer = new ResizeObserver(() => {
            if (!nearBottom || performance.now() < holdUntilRef.current) return
            viewport.scrollTop = viewport.scrollHeight
        })
        observer.observe(content)
        return () => {
            viewport.removeEventListener('scroll', onScroll)
            observer.disconnect()
        }
    }, [enabled, viewportRef, contentRef])
    return useCallback((durationMs = 700) => {
        holdUntilRef.current = performance.now() + durationMs
    }, [])
}

// Social layout collapses each agent turn, so a long turn can fill the latest page entirely.
// Pull a few older pages so the user's own last message is on screen too.
const MAX_SOCIAL_AUTO_LOAD_PAGES = 4

function NewMessagesIndicator(props: { count: number; show: boolean; onClick: () => void; social?: boolean }) {
    const { t } = useTranslation()
    if (!props.show) {
        return null
    }

    return (
        <Button
            size={props.social ? 'sm' : 'default'}
            onClick={props.onClick}
            className={cn(
                'absolute left-1/2 -translate-x-1/2 shadow-lg animate-bounce-in z-10',
                props.social ? cn('bottom-3', HIT_AREA_CLASS) : 'bottom-20'
            )}
        >
            {props.count > 0 ? t('misc.newMessage', { n: props.count }) : t('misc.jumpToLatest')} &#8595;
        </Button>
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
                        <div className={`${row.height} ${row.width} rounded-xl bg-[var(--social-hover)]`} />
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

    const controlClass = 'mx-auto inline-flex h-7 items-center justify-center gap-1.5 rounded-full px-2.5 text-xs'

    if (props.loading) {
        return (
            <div className="mb-2 py-1">
                <div
                    role="status"
                    aria-live="polite"
                    className={`${controlClass} bg-[var(--social-primary)] text-[var(--social-primary-fg)]`}
                >
                    <Spinner size="sm" label={null} className="text-current" />
                    {t('misc.loadingHistory')}
                </div>
            </div>
        )
    }

    return (
        <div className="mb-2 py-1">
            <Button variant="secondary" size="sm" onClick={props.onLoadMore} className={cn('mx-auto flex', HIT_AREA_CLASS)}>
                {t('misc.loadOlder')}
            </Button>
        </div>
    )
}

function ThreadMessagesList(props: { social: boolean }) {
    return (
        <ThreadPrimitive.Messages
            components={props.social ? SOCIAL_THREAD_MESSAGE_COMPONENTS : THREAD_MESSAGE_COMPONENTS}
        />
    )
}

const THREAD_MESSAGE_COMPONENTS = {
    UserMessage: HappyUserMessage,
    AssistantMessage: HappyAssistantMessage,
    SystemMessage: HappySystemMessage
} as const

const SOCIAL_THREAD_MESSAGE_COMPONENTS = {
    UserMessage: SocialUserMessage,
    AssistantMessage: SocialAssistantMessage,
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
    layout?: 'classic' | 'social'
    timeSeparators?: ReadonlyMap<string, number> | null
    runStats?: ReadonlyMap<string, RunStats> | null
}) {
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const contentRef = useRef<HTMLDivElement | null>(null)
    const isSocial = props.layout === 'social'
    const holdAutoScroll = useStickToBottom(isSocial, viewportRef, contentRef)
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

    const hasUserMessage = useAssistantState(({ thread }) => thread.messages.some((message) => message.role === 'user'))
    const autoLoadPagesRef = useRef(0)
    useEffect(() => {
        autoLoadPagesRef.current = 0
    }, [props.sessionId])
    useEffect(() => {
        if (!isSocial || hasUserMessage || !props.hasMoreMessages) return
        if (props.isLoadingMessages || props.isLoadingMoreMessages) return
        if (autoLoadPagesRef.current >= MAX_SOCIAL_AUTO_LOAD_PAGES) return
        autoLoadPagesRef.current += 1
        void props.onLoadMore()
    }, [isSocial, hasUserMessage, props.hasMoreMessages, props.isLoadingMessages, props.isLoadingMoreMessages, props.onLoadMore])

    const showSkeleton = props.isLoadingMessages && props.messagesVersion === 0 && props.pendingCount === 0
    // Social layout always uses one-line tool rows so bubbles stay readable on phones.
    const effectiveDensity: SessionListDensity = isSocial ? 'compact' : props.density
    const isCompact = effectiveDensity === 'compact'

    return (
        <HappyChatProvider value={{
            api: props.api,
            sessionId: props.sessionId,
            metadata: props.metadata,
            agentState: props.agentState,
            permissionMode: props.permissionMode,
            disabled: props.disabled,
            density: effectiveDensity,
            onRefresh: props.onRefresh,
            onRetryMessage: props.onRetryMessage,
            toolProgress: props.toolProgress,
            layout: props.layout ?? 'classic',
            timeSeparators: props.timeSeparators ?? null,
            runStats: props.runStats ?? null,
            holdAutoScroll
        }}>
            <ThreadPrimitive.Root className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col">
                <ThreadPrimitive.Viewport
                    ref={viewportRef}
                    autoScroll={isSocial ? false : undefined}
                    className={cn(
                        'app-scrollbar min-h-0 min-w-0 w-full flex-1 overflow-y-auto overflow-x-hidden',
                        isSocial ? 'social-chat' : ''
                    )}
                >
                    <div ref={contentRef} className={`mx-auto w-full max-w-content min-w-0 ${isSocial ? 'px-4 pb-5 pt-4' : isCompact ? 'p-2' : 'p-3'}`}>
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
                                    <div className="mb-3 rounded-xl bg-[var(--app-badge-warning-bg)] p-2 text-xs">
                                        {props.messagesWarning}
                                    </div>
                                ) : null}
                            </>
                        )}
                        <div className={`flex flex-col ${isSocial ? 'gap-5' : isCompact ? 'gap-2' : 'gap-3'}`}>
                            <ThreadMessagesList social={isSocial} />
                        </div>
                    </div>
                </ThreadPrimitive.Viewport>
                <NewMessagesIndicator
                    count={props.pendingCount}
                    show={showJumpToLatest}
                    onClick={scrollToBottom}
                    social={isSocial}
                />
            </ThreadPrimitive.Root>
        </HappyChatProvider>
    )
}
