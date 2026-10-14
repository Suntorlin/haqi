import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import {
    readSessionReopenPositionPreference,
    type SessionReopenPositionPreference
} from '@/hooks/useSessionReopenPositionPreference'
import {
    readSessionScrollSnapshot,
    writeSessionScrollSnapshot,
    type SessionScrollViewMode
} from '@/lib/sessionScrollState'
import { restoreScrollTopByDelta, shouldTriggerLoadOlder } from '@/components/AssistantChat/historyScroll'

const NEAR_BOTTOM_THRESHOLD_PX = 32
const UPWARD_ESCAPE_PX = 2
const LOAD_OLDER_THRESHOLD_PX = 48
const LOAD_OLDER_REARM_PX = 96
const LOAD_OLDER_COOLDOWN_MS = 300

type PendingRestoreState = {
    scrollTop: number
    scrollHeight: number
}

export function useSessionViewportScroll(params: {
    sessionId: string
    viewMode: Extract<SessionScrollViewMode, 'normal' | 'cli'>
    viewportRef: RefObject<HTMLDivElement | null>
    isLoading: boolean
    hasMore: boolean
    isLoadingMore: boolean
    pendingCount: number
    contentVersion: number
    latestKey: string | null
    forceScrollToken?: number
    onLoadMore: () => Promise<unknown> | void
    onFlushPending: () => Promise<void> | void
}) {
    const [isNearBottom, setIsNearBottom] = useState(true)
    const isNearBottomRef = useRef(true)
    const previousScrollTopRef = useRef(0)
    const lastLoadTriggerAtRef = useRef(0)
    const loadMoreArmedRef = useRef(true)
    const pendingRestoreRef = useRef<PendingRestoreState | null>(null)
    const initialPositionAppliedRef = useRef(false)
    const lastForceScrollTokenRef = useRef(params.forceScrollToken ?? 0)
    const latestKeyRef = useRef<string | null>(params.latestKey)
    const preferenceRef = useRef<SessionReopenPositionPreference>('bottom')
    const resolveViewport = useCallback(() => {
        const container = params.viewportRef.current
        if (!container) {
            return null
        }
        const nestedVirtuosoScroller = container.querySelector<HTMLDivElement>('[data-virtuoso-scroller="true"]')
        return nestedVirtuosoScroller ?? container
    }, [params.viewportRef])

    const persistSnapshot = useCallback(() => {
        const viewport = resolveViewport()
        if (!viewport) {
            return
        }
        writeSessionScrollSnapshot(params.sessionId, params.viewMode, {
            top: viewport.scrollTop,
            lastKey: latestKeyRef.current,
            savedAt: Date.now()
        })
    }, [params.sessionId, params.viewMode, resolveViewport])

    const jumpToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
        const viewport = resolveViewport()
        if (!viewport) {
            return
        }
        viewport.scrollTo({ top: viewport.scrollHeight, behavior })
        previousScrollTopRef.current = viewport.scrollTop
        if (!isNearBottomRef.current) {
            isNearBottomRef.current = true
            setIsNearBottom(true)
        }
        void params.onFlushPending()
        persistSnapshot()
    }, [params.onFlushPending, persistSnapshot, resolveViewport])

    useEffect(() => {
        latestKeyRef.current = params.latestKey
    }, [params.latestKey])

    useEffect(() => {
        preferenceRef.current = readSessionReopenPositionPreference()
    })

    useEffect(() => {
        isNearBottomRef.current = true
        setIsNearBottom(true)
        previousScrollTopRef.current = 0
        loadMoreArmedRef.current = true
        pendingRestoreRef.current = null
        initialPositionAppliedRef.current = false
        lastForceScrollTokenRef.current = params.forceScrollToken ?? 0
    }, [params.sessionId, params.viewMode])

    useEffect(() => {
        const viewport = resolveViewport()
        if (!viewport) {
            return
        }

        const handleScroll = () => {
            const currentScrollTop = viewport.scrollTop
            const previousScrollTop = previousScrollTopRef.current
            const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
            // Any upward movement leaves the bottom at once, so streaming content cannot yank the user back down.
            const movedUp = currentScrollTop < previousScrollTop && distanceFromBottom > UPWARD_ESCAPE_PX
            const nextIsNearBottom = !movedUp && distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX

            if (nextIsNearBottom !== isNearBottomRef.current) {
                isNearBottomRef.current = nextIsNearBottom
                setIsNearBottom(nextIsNearBottom)
                if (nextIsNearBottom) {
                    void params.onFlushPending()
                }
            }

            if (currentScrollTop >= LOAD_OLDER_REARM_PX) {
                loadMoreArmedRef.current = true
            }

            if (shouldTriggerLoadOlder({
                previousScrollTop,
                currentScrollTop,
                thresholdPx: LOAD_OLDER_THRESHOLD_PX,
                isArmed: loadMoreArmedRef.current,
                isLoadingMessages: params.isLoading,
                isLoadingMoreMessages: params.isLoadingMore,
                hasMoreMessages: params.hasMore,
                lastTriggeredAtMs: lastLoadTriggerAtRef.current,
                nowMs: Date.now(),
                cooldownMs: LOAD_OLDER_COOLDOWN_MS
            })) {
                loadMoreArmedRef.current = false
                lastLoadTriggerAtRef.current = Date.now()
                pendingRestoreRef.current = {
                    scrollTop: viewport.scrollTop,
                    scrollHeight: viewport.scrollHeight
                }
                void params.onLoadMore()
            }

            previousScrollTopRef.current = currentScrollTop
        }

        viewport.addEventListener('scroll', handleScroll, { passive: true })
        return () => {
            viewport.removeEventListener('scroll', handleScroll)
            persistSnapshot()
        }
    }, [
        params.contentVersion,
        params.hasMore,
        params.isLoading,
        params.isLoadingMore,
        params.onFlushPending,
        params.onLoadMore,
        persistSnapshot,
        resolveViewport
    ])

    useLayoutEffect(() => {
        const viewport = resolveViewport()
        if (!viewport) {
            return
        }

        const pendingRestore = pendingRestoreRef.current
        if (pendingRestore) {
            viewport.scrollTop = restoreScrollTopByDelta({
                previousScrollTop: pendingRestore.scrollTop,
                previousScrollHeight: pendingRestore.scrollHeight,
                nextScrollHeight: viewport.scrollHeight
            })
            previousScrollTopRef.current = viewport.scrollTop
            pendingRestoreRef.current = null
            return
        }

        if (!initialPositionAppliedRef.current) {
            if (params.isLoading && params.contentVersion === 0) {
                return
            }
            const snapshot = readSessionScrollSnapshot(params.sessionId, params.viewMode)
            const preference = preferenceRef.current
            const canRestore = snapshot && (
                preference === 'restore'
                || (
                    preference === 'bottom-if-unread'
                    && snapshot.lastKey !== null
                    && params.latestKey !== null
                    && snapshot.lastKey === params.latestKey
                )
            )

            if (canRestore && snapshot) {
                viewport.scrollTop = Math.min(snapshot.top, Math.max(0, viewport.scrollHeight - viewport.clientHeight))
                previousScrollTopRef.current = viewport.scrollTop
                const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
                const nextIsNearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX
                isNearBottomRef.current = nextIsNearBottom
                setIsNearBottom(nextIsNearBottom)
            } else {
                jumpToBottom('auto')
            }
            initialPositionAppliedRef.current = true
            return
        }

        if ((params.forceScrollToken ?? 0) !== lastForceScrollTokenRef.current) {
            lastForceScrollTokenRef.current = params.forceScrollToken ?? 0
            jumpToBottom('smooth')
            return
        }

        if (isNearBottomRef.current) {
            jumpToBottom('auto')
        }
    }, [
        jumpToBottom,
        params.contentVersion,
        params.forceScrollToken,
        params.isLoading,
        params.latestKey,
        params.sessionId,
        params.viewMode,
        resolveViewport
    ])

    return {
        isNearBottom,
        showJumpToLatest: params.pendingCount > 0 || !isNearBottom,
        scrollToBottom: () => jumpToBottom('smooth'),
        persistSnapshot
    }
}
