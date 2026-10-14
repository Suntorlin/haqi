import { useCallback, useEffect, useMemo, useRef } from 'react'
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
import { JumpToLatestButton } from '@/components/AssistantChat/JumpToLatestButton'
import { useSessionViewportScroll } from '@/components/AssistantChat/useSessionViewportScroll'
import { useNestedScrollPassthrough } from '@/components/AssistantChat/useNestedScrollPassthrough'
import { Spinner } from '@/components/Spinner'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import type { ToolProgressSignal } from '@/chat/toolProgress'
import type { RunStats } from '@/components/mobile/chatTimeline'
import { useTranslation } from '@/lib/use-translation'

const STICK_TO_BOTTOM_THRESHOLD_PX = 32
const USER_INPUT_QUIET_MS = 250

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
        let lastTop = viewport.scrollTop
        let lastInputAt = 0
        const onScroll = () => {
            const top = viewport.scrollTop
            const distance = viewport.scrollHeight - top - viewport.clientHeight
            // Moving up lets go of the bottom immediately, even inside the threshold; otherwise a
            // streaming reply would snap the view back while the user is still scrolling away.
            nearBottom = !(top < lastTop && distance > 2) && distance <= STICK_TO_BOTTOM_THRESHOLD_PX
            lastTop = top
        }
        // Never move the view while a finger or wheel is driving it.
        const onInput = () => { lastInputAt = performance.now() }
        onScroll()
        viewport.addEventListener('scroll', onScroll, { passive: true })
        viewport.addEventListener('touchstart', onInput, { passive: true })
        viewport.addEventListener('touchmove', onInput, { passive: true })
        viewport.addEventListener('wheel', onInput, { passive: true })
        const observer = new ResizeObserver(() => {
            const now = performance.now()
            if (!nearBottom || now < holdUntilRef.current || now - lastInputAt < USER_INPUT_QUIET_MS) return
            viewport.scrollTop = viewport.scrollHeight
        })
        observer.observe(content)
        return () => {
            viewport.removeEventListener('scroll', onScroll)
            viewport.removeEventListener('touchstart', onInput)
            viewport.removeEventListener('touchmove', onInput)
            viewport.removeEventListener('wheel', onInput)
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
// Loading older history in the social layout keeps paging until something visible appears (a user
// message); pages made only of collapsed tool steps add no height, so one click looked like a no-op.
const MAX_LOAD_OLDER_PAGES = 8
const LOAD_OLDER_SETTLE_MS = 80

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
    useNestedScrollPassthrough(viewportRef)
    const userMessageCount = useAssistantState(({ thread }) => thread.messages.reduce((count, message) => count + (message.role === 'user' ? 1 : 0), 0))
    const oldestRenderedKey = useAssistantState(({ thread }) => thread.messages[0]?.id ?? null)
    const olderStateRef = useRef({ userMessageCount, hasMore: props.hasMoreMessages })
    olderStateRef.current = { userMessageCount, hasMore: props.hasMoreMessages }
    const onLoadMoreProp = props.onLoadMore
    const markRestorePointRef = useRef<() => void>(() => {})
    const loadOlder = useCallback(async () => {
        if (!isSocial) {
            await onLoadMoreProp()
            return
        }
        const startCount = olderStateRef.current.userMessageCount
        for (let page = 0; page < MAX_LOAD_OLDER_PAGES; page += 1) {
            markRestorePointRef.current()
            await onLoadMoreProp()
            // Let the store update reach the thread before judging whether anything new is visible.
            await new Promise((resolve) => setTimeout(resolve, LOAD_OLDER_SETTLE_MS))
            if (olderStateRef.current.userMessageCount > startCount || !olderStateRef.current.hasMore) {
                break
            }
        }
    }, [isSocial, onLoadMoreProp])
    const {
        isNearBottom,
        showJumpToLatest,
        scrollToBottom,
        markRestorePoint
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
        renderedOldestKey: oldestRenderedKey,
        onLoadMore: loadOlder,
        onFlushPending: props.onFlushPending
    })

    markRestorePointRef.current = markRestorePoint

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

    const chatContext = useMemo(() => ({
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
        layout: props.layout ?? 'classic' as const,
        timeSeparators: props.timeSeparators ?? null,
        runStats: props.runStats ?? null,
        holdAutoScroll
    }), [
        props.api, props.sessionId, props.metadata, props.agentState, props.permissionMode, props.disabled,
        effectiveDensity, props.onRefresh, props.onRetryMessage, props.toolProgress, props.layout,
        props.timeSeparators, props.runStats, holdAutoScroll
    ])

    return (
        <HappyChatProvider value={chatContext}>
            <ThreadPrimitive.Root className="relative flex min-h-0 min-w-0 w-full flex-1 flex-col">
                <ThreadPrimitive.Viewport
                    ref={viewportRef}
                    autoScroll={isSocial ? false : undefined}
                    // assistant-ui arms a sticky scroll-to-bottom on run start / initialize / thread switch even
                    // with autoScroll off, which re-pins the view on every resize (it fought users scrolling
                    // up while an agent ran). The social layout positions itself through the two hooks above.
                    scrollToBottomOnRunStart={isSocial ? false : undefined}
                    scrollToBottomOnInitialize={isSocial ? false : undefined}
                    scrollToBottomOnThreadSwitch={isSocial ? false : undefined}
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
                                    onLoadMore={() => { void loadOlder() }}
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
                <JumpToLatestButton
                    count={props.pendingCount}
                    show={showJumpToLatest}
                    onClick={scrollToBottom}
                    raised={!isSocial}
                />
            </ThreadPrimitive.Root>
        </HappyChatProvider>
    )
}
