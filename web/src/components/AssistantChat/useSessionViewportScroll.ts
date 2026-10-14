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
const MAX_TOP_RETRIGGERS = 6

type PendingRestoreState = {
    scrollTop: number
    scrollHeight: number
    at: number
    renderedOldestKey: string | null | undefined
}

const PENDING_RESTORE_MAX_AGE_MS = 3000

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
    /** Id of the oldest message the thread has rendered; a change means older history reached the DOM (live appends do not change it). */
    renderedOldestKey?: string | null
    onLoadMore: () => Promise<unknown> | void
    onFlushPending: () => Promise<void> | void
}) {
    const [isNearBottom, setIsNearBottom] = useState(true)
    const isNearBottomRef = useRef(true)
    const previousScrollTopRef = useRef(0)
    const lastLoadTriggerAtRef = useRef(0)
    const loadMoreArmedRef = useRef(true)
    const topRetriggersRef = useRef(0)
    const pendingRestoreRef = useRef<PendingRestoreState | null>(null)
    const renderedOldestRef = useRef(params.renderedOldestKey)
    renderedOldestRef.current = params.renderedOldestKey
    const isLoadingMoreRef = useRef(params.isLoadingMore)
    isLoadingMoreRef.current = params.isLoadingMore
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

    // Older messages render a beat after the store updates (assistant-ui syncs in a passive effect), so
    // the restore must wait until the content has actually grown; applying it early was a 0px delta.
    const applyPendingRestore = useCallback((): boolean => {
        const viewport = resolveViewport()
        const pending = pendingRestoreRef.current
        if (!viewport || !pending) {
            return false
        }
        if (Date.now() - pending.at > PENDING_RESTORE_MAX_AGE_MS) {
            pendingRestoreRef.current = null
            return false
        }
        // Ready once the thread rendered more messages (exact). Threads that cannot report that fall back to
        // "request finished and the height changed", because the spinner swap alone also changes the height.
        const ready = pending.renderedOldestKey !== undefined && renderedOldestRef.current !== undefined
            ? renderedOldestRef.current !== pending.renderedOldestKey
            : !isLoadingMoreRef.current && viewport.scrollHeight !== pending.scrollHeight
        if (!ready) {
            return false
        }
        const nextTop = restoreScrollTopByDelta({
            previousScrollTop: pending.scrollTop,
            previousScrollHeight: pending.scrollHeight,
            nextScrollHeight: viewport.scrollHeight
        })
        // Any scrollTop write stops a touch fling on iOS, so skip it when nothing actually moved
        // (pages made only of collapsed steps add no height).
        if (Math.abs(nextTop - viewport.scrollTop) >= 1) {
            viewport.scrollTop = nextTop
        }
        previousScrollTopRef.current = viewport.scrollTop
        pendingRestoreRef.current = null
        return true
    }, [resolveViewport])

    /** Remember where we are so the view stays on the same message once older history is prepended. */
    const markRestorePoint = useCallback(() => {
        const viewport = resolveViewport()
        if (!viewport) {
            return
        }
        pendingRestoreRef.current = {
            scrollTop: viewport.scrollTop,
            scrollHeight: viewport.scrollHeight,
            at: Date.now(),
            renderedOldestKey: renderedOldestRef.current
        }
    }, [resolveViewport])

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
                topRetriggersRef.current = 0
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
                    scrollHeight: viewport.scrollHeight,
                    at: Date.now(),
                    renderedOldestKey: renderedOldestRef.current
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

    // Arriving at the top arms nothing again until the user scrolls away, so a load that added no visible
    // height used to leave them stuck at the top with history still available. Ask again, a few times.
    useEffect(() => {
        if (params.isLoadingMore || params.isLoading || !params.hasMore || !initialPositionAppliedRef.current) {
            return
        }
        const viewport = resolveViewport()
        if (!viewport || viewport.scrollTop > LOAD_OLDER_THRESHOLD_PX || isNearBottomRef.current) {
            return
        }
        if (topRetriggersRef.current >= MAX_TOP_RETRIGGERS) {
            return
        }
        const timer = setTimeout(() => {
            const current = resolveViewport()
            if (!current || current.scrollTop > LOAD_OLDER_THRESHOLD_PX || pendingRestoreRef.current) {
                return
            }
            topRetriggersRef.current += 1
            lastLoadTriggerAtRef.current = Date.now()
            pendingRestoreRef.current = {
                scrollTop: current.scrollTop,
                scrollHeight: current.scrollHeight,
                at: Date.now(),
                renderedOldestKey: renderedOldestRef.current
            }
            void params.onLoadMore()
        }, LOAD_OLDER_COOLDOWN_MS)
        return () => clearTimeout(timer)
    }, [params.isLoadingMore, params.isLoading, params.hasMore, params.contentVersion, params.onLoadMore, resolveViewport])

    useEffect(() => {
        const viewport = resolveViewport()
        const content = viewport?.firstElementChild
        if (!viewport || !content) {
            return
        }
        let expiry: ReturnType<typeof setTimeout> | null = null
        const observer = new ResizeObserver(() => {
            if (!pendingRestoreRef.current) {
                return
            }
            if (applyPendingRestore()) {
                if (expiry) clearTimeout(expiry)
                expiry = null
            } else if (!expiry) {
                // A load that returned nothing new never grows the content; drop the stale restore.
                expiry = setTimeout(() => {
                    expiry = null
                    pendingRestoreRef.current = null
                }, 2000)
            }
        })
        observer.observe(content)
        return () => {
            if (expiry) clearTimeout(expiry)
            observer.disconnect()
        }
    }, [applyPendingRestore, resolveViewport, params.sessionId, params.viewMode])

    useLayoutEffect(() => {
        const viewport = resolveViewport()
        if (!viewport) {
            return
        }

        if (pendingRestoreRef.current) {
            // Applied now if the content already grew, otherwise by the observer below; never pin to the
            // bottom while a restore is waiting.
            applyPendingRestore()
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
        applyPendingRestore,
        jumpToBottom,
        params.contentVersion,
        params.renderedOldestKey,
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
        markRestorePoint,
        persistSnapshot
    }
}
