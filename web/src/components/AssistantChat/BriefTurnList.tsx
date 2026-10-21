import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AssistantRuntimeProvider } from '@assistant-ui/react'

import type { ApiClient } from '@/api/client'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { asRecord, extractLatestLiveActivity } from '@/components/AssistantChat/liveActivity'
import { BriefFullMarkdownContent } from '@/components/AssistantChat/BriefFullMarkdownContent'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import {
    isBriefTurnLive,
    shouldFetchLatestTurnChangesSummary,
    shouldShowLatestBriefTurnAsFullContent
} from '@/components/AssistantChat/briefTurnPresentation'
import { restoreScrollTopByDelta, shouldTriggerLoadOlder } from '@/components/AssistantChat/historyScroll'
import { useNestedScrollPassthrough } from '@/components/AssistantChat/useNestedScrollPassthrough'
import { Spinner } from '@/components/Spinner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'
import { HIT_AREA_CLASS, TEXT_HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSessionReopenPositionPreference } from '@/hooks/useSessionReopenPositionPreference'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { readSessionScrollSnapshot, writeSessionScrollSnapshot } from '@/lib/sessionScrollState'
import type { ConversationTurn, DecryptedMessage, Session } from '@/types/api'
import { EmptyState } from '@/components/ui/EmptyState'

type TurnDetailState = {
    isLoading: boolean
    isLoadingMore: boolean
    error: string | null
    messages: DecryptedMessage[]
    nextBeforeSeq: number | null
    hasMore: boolean
}

type TurnDetailStateMap = Record<string, TurnDetailState>

const DEFAULT_TURN_MESSAGE_LIMIT = 120
const LIVE_PREVIEW_ROTATION_MS = 2600
const LIVE_PREVIEW_FADE_MS = 180
const TURN_DETAILS_REFRESH_INTERVAL_MS = 1200
const MOBILE_BRIEF_BREAKPOINT_QUERY = '(max-width: 767px)'
const MOBILE_BRIEF_TURN_QUERY_KEY = 'briefTurnId'
const TURN_CHANGES_DETAIL_QUERY_KEY = 'turnChangesToolId'
const LIVE_ACTIVITY_FETCH_LIMIT = 40
const TURN_CHANGES_SUMMARY_FETCH_LIMIT = 200

type TurnChangesSummary = {
    toolId: string
    additions: number
    deletions: number
}

function isCodexPlanModeEnabled(session: Session): boolean {
    const flavor = session.metadata?.flavor?.trim().toLowerCase()
    if (flavor !== 'codex') {
        return false
    }
    return session.metadata?.collaborationMode?.trim().toLowerCase() === 'plan'
}

function normalizePreview(value: string | null | undefined, emptyLabel: string): string {
    const text = value?.trim() ?? ''
    return text.length > 0 ? text : emptyLabel
}

function normalizeLivePreviewLine(line: string): string {
    const cleaned = line
        .trim()
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/\bcall_[A-Za-z0-9_-]{4,}\b/g, '')
        .replace(/^[\s:>–—-]+/, '')
        .replace(/\s+/g, ' ')
        .trim()

    return cleaned
}

function extractLivePreviewLines(preview: string, waitingLine: string): string[] {
    const text = preview.trim()
    if (text.length === 0) {
        return [waitingLine]
    }

    const normalizedLines = text
        .split(/\r?\n/g)
        .map((line) => normalizeLivePreviewLine(line))
        .filter((line) => line.length > 0)

    if (normalizedLines.length === 0) {
        return [waitingLine]
    }

    return normalizedLines.slice(-3)
}

function buildDefaultTurnState(): TurnDetailState {
    return {
        isLoading: false,
        isLoadingMore: false,
        error: null,
        messages: [],
        nextBeforeSeq: null,
        hasMore: false
    }
}

function readMobileBriefTurnId(search: string): string | null {
    const rawValue = new URLSearchParams(search).get(MOBILE_BRIEF_TURN_QUERY_KEY)
    const value = rawValue?.trim() ?? ''
    return value.length > 0 ? value : null
}

function writeMobileBriefTurnId(turnId: string | null, mode: 'push' | 'replace'): void {
    if (typeof window === 'undefined') {
        return
    }

    const url = new URL(window.location.href)
    if (turnId) {
        url.searchParams.set(MOBILE_BRIEF_TURN_QUERY_KEY, turnId)
    } else {
        url.searchParams.delete(MOBILE_BRIEF_TURN_QUERY_KEY)
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    if (mode === 'replace') {
        window.history.replaceState(window.history.state, '', nextUrl)
        return
    }

    window.history.pushState(window.history.state, '', nextUrl)
}

function readTurnChangesDetailToolId(search: string): string | null {
    const rawValue = new URLSearchParams(search).get(TURN_CHANGES_DETAIL_QUERY_KEY)
    const value = rawValue?.trim() ?? ''
    return value.length > 0 ? value : null
}

function writeTurnChangesDetailToolId(toolId: string | null, mode: 'push' | 'replace'): void {
    if (typeof window === 'undefined') {
        return
    }

    const url = new URL(window.location.href)
    if (toolId) {
        url.searchParams.set(TURN_CHANGES_DETAIL_QUERY_KEY, toolId)
    } else {
        url.searchParams.delete(TURN_CHANGES_DETAIL_QUERY_KEY)
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    if (mode === 'replace') {
        window.history.replaceState(window.history.state, '', nextUrl)
        return
    }

    window.history.pushState(window.history.state, '', nextUrl)
}

function toNonNegativeNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.round(value))
    }

    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value)
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.round(parsed))
        }
    }

    return 0
}

function extractTurnChangesSummary(messages: DecryptedMessage[]): TurnChangesSummary | null {
    let matchedToolId: string | null = null
    let totalAdditions = 0
    let totalDeletions = 0

    for (const message of messages) {
        const normalized = normalizeDecryptedMessage(message)
        if (!normalized || normalized.role !== 'agent') {
            continue
        }

        for (const content of normalized.content) {
            if (content.type !== 'tool-call') {
                continue
            }
            const normalizedToolName = content.name.trim().toLowerCase().replace(/[_-]/g, '')
            if (!normalizedToolName.endsWith('codexturnchanges')) {
                continue
            }

            matchedToolId = content.id
            const input = asRecord(content.input)
            const files = Array.isArray(input?.files) ? input.files : []
            let additions = 0
            let deletions = 0

            for (const file of files) {
                const fileRecord = asRecord(file)
                if (!fileRecord) {
                    continue
                }
                additions += toNonNegativeNumber(fileRecord.additions)
                deletions += toNonNegativeNumber(fileRecord.deletions)
            }

            if (additions === 0 && deletions === 0) {
                const diffStats = asRecord(input?.diff_stats)
                additions = toNonNegativeNumber(diffStats?.additions)
                deletions = toNonNegativeNumber(diffStats?.deletions)
            }

            totalAdditions += additions
            totalDeletions += deletions
        }
    }

    if (!matchedToolId) {
        return null
    }

    return {
        toolId: matchedToolId,
        additions: totalAdditions,
        deletions: totalDeletions
    }
}

async function fetchTurnChangesSummaryByPaging(
    api: ApiClient,
    sessionId: string,
    turnId: string
): Promise<TurnChangesSummary | null> {
    let beforeSeq: number | null = null
    let pageCount = 0

    while (pageCount < 8) {
        const response = await api.getConversationTurnMessages(sessionId, turnId, {
            limit: TURN_CHANGES_SUMMARY_FETCH_LIMIT,
            beforeSeq
        })
        const summary = extractTurnChangesSummary(response.messages)
        if (summary) {
            return summary
        }

        if (!response.page.hasMore || response.page.nextBeforeSeq === null) {
            return null
        }

        beforeSeq = response.page.nextBeforeSeq
        pageCount += 1
    }

    return null
}

function dedupeAndSortMessages(messages: DecryptedMessage[]): DecryptedMessage[] {
    const dedupedById = new Map<string, DecryptedMessage>()
    for (const message of messages) {
        dedupedById.set(message.id, message)
    }

    return Array.from(dedupedById.values()).sort((left, right) => {
        const leftSeq = typeof left.seq === 'number' ? left.seq : Number.MAX_SAFE_INTEGER
        const rightSeq = typeof right.seq === 'number' ? right.seq : Number.MAX_SAFE_INTEGER
        return leftSeq - rightSeq
    })
}

function AnimatedCounter(props: {
    value: number
}) {
    const [displayValue, setDisplayValue] = useState(props.value)
    const [previousValue, setPreviousValue] = useState(props.value)
    const [stage, setStage] = useState<'idle' | 'prep' | 'run'>('idle')

    useEffect(() => {
        if (props.value === displayValue) {
            return
        }

        setPreviousValue(displayValue)
        setDisplayValue(props.value)
        setStage('prep')
        const rafId = window.requestAnimationFrame(() => {
            setStage('run')
        })
        const timeoutId = window.setTimeout(() => {
            setStage('idle')
        }, 220)

        return () => {
            window.cancelAnimationFrame(rafId)
            window.clearTimeout(timeoutId)
        }
    }, [displayValue, props.value])

    const previousClass = stage === 'prep' ? 'translate-y-0 opacity-100' : '-translate-y-full opacity-0'
    const currentClass = stage === 'prep' ? 'translate-y-full opacity-0' : 'translate-y-0 opacity-100'
    const widthText = String(previousValue).length > String(displayValue).length
        ? String(previousValue)
        : String(displayValue)

    return (
        <span className="relative inline-flex h-[1.1em] min-w-[2ch] items-center justify-center overflow-hidden align-middle tabular-nums">
            <span className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ease-out ${previousClass}`}>
                {previousValue}
            </span>
            <span className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ease-out ${currentClass}`}>
                {displayValue}
            </span>
            <span className="invisible">{widthText}</span>
        </span>
    )
}

function LivePreviewCarousel(props: {
    preview: string
    liveActivity: string
}) {
    const { t } = useTranslation()
    const waitingLine = t('brief.turn.waitingForUpdates')
    const lines = useMemo(() => extractLivePreviewLines(props.preview, waitingLine), [props.preview, waitingLine])
    const [activeLineIndex, setActiveLineIndex] = useState(0)
    const [isVisible, setIsVisible] = useState(true)
    const fadeTimeoutRef = useRef<number | null>(null)

    useEffect(() => {
        setActiveLineIndex(0)
        setIsVisible(true)
    }, [props.preview])

    useEffect(() => {
        if (lines.length <= 1) {
            return
        }

        const intervalId = window.setInterval(() => {
            setIsVisible(false)
            if (fadeTimeoutRef.current !== null) {
                window.clearTimeout(fadeTimeoutRef.current)
            }
            fadeTimeoutRef.current = window.setTimeout(() => {
                setActiveLineIndex((previous) => (previous + 1) % lines.length)
                setIsVisible(true)
            }, LIVE_PREVIEW_FADE_MS)
        }, LIVE_PREVIEW_ROTATION_MS)

        return () => {
            window.clearInterval(intervalId)
            if (fadeTimeoutRef.current !== null) {
                window.clearTimeout(fadeTimeoutRef.current)
                fadeTimeoutRef.current = null
            }
        }
    }, [lines])

    const activeLine = lines[activeLineIndex] ?? waitingLine

    return (
        <div className="min-h-[3.6rem] py-0.5">
            <div className={`whitespace-pre-wrap break-words text-body leading-6 text-[var(--social-fg-muted)] transition-all duration-200 ease-out ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}>
                {activeLine}
            </div>
            <div className="truncate text-caption leading-5 text-[var(--social-fg-muted)]">
                {props.liveActivity}
            </div>
        </div>
    )
}

function TurnDetailThread(props: {
    api: ApiClient
    session: Session
    messages: DecryptedMessage[]
    hasMoreMessages: boolean
    isLoadingMessages: boolean
    isLoadingMoreMessages: boolean
    onLoadMore: () => Promise<void>
    density: SessionListDensity
}) {
    const [forceScrollToken, setForceScrollToken] = useState(0)
    const initialBottomAppliedRef = useRef(false)

    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
        const normalized: NormalizedMessage[] = []
        for (const message of props.messages) {
            const next = normalizeDecryptedMessage(message)
            if (next) normalized.push(next)
        }
        return normalized
    }, [props.messages])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, props.session.agentState, props.session.metadata?.flavor ?? null),
        [normalizedMessages, props.session.agentState, props.session.metadata?.flavor]
    )

    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, new Map<string, ChatBlock>()),
        [reduced.blocks]
    )

    const runtimeSession = useMemo(() => ({
        ...props.session,
        thinking: false
    }), [props.session])

    const runtime = useHappyRuntime({
        session: runtimeSession,
        blocks: reconciled.blocks,
        isSending: true,
        onSendMessage: () => false,
        onAbort: async () => {},
        allowSendWhenInactive: true
    })

    useEffect(() => {
        if (props.messages.length === 0) {
            initialBottomAppliedRef.current = false
            return
        }
        if (initialBottomAppliedRef.current) {
            return
        }

        initialBottomAppliedRef.current = true
        setForceScrollToken((prev) => prev + 1)
    }, [props.messages.length])

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <div className="flex h-full min-h-0 flex-col">
                <HappyThread
                    api={props.api}
                    sessionId={props.session.id}
                    metadata={props.session.metadata}
                    permissionMode={props.session.permissionMode}
                    disabled
                    onRefresh={() => {}}
                    onFlushPending={() => {}}
                    onAtBottomChange={() => {}}
                    isLoadingMessages={props.isLoadingMessages}
                    messagesWarning={null}
                    hasMoreMessages={props.hasMoreMessages}
                    isLoadingMoreMessages={props.isLoadingMoreMessages}
                    onLoadMore={props.onLoadMore}
                    pendingCount={0}
                    newestMessageSeq={props.messages[props.messages.length - 1]?.seq ?? null}
                    messagesVersion={normalizedMessages.length}
                    forceScrollToken={forceScrollToken}
                    density={props.density}
                />
            </div>
        </AssistantRuntimeProvider>
    )
}

export function BriefTurnList(props: {
    api: ApiClient
    session: Session
    turns: ConversationTurn[]
    warning: string | null
    isLoading: boolean
    isLoadingMore: boolean
    hasMore: boolean
    thinking: boolean
    density: SessionListDensity
    onLoadMoreTurns: () => Promise<void>
}) {
    const { t } = useTranslation()
    const scrollerRef = useRef<HTMLDivElement | null>(null)
    useNestedScrollPassthrough(scrollerRef)
    const isAtBottomRef = useRef(true)
    const initialScrollAppliedRef = useRef(false)
    const pendingRestoreRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)
    const previousScrollTopRef = useRef(0)
    const lastLoadTriggerAtRef = useRef(0)
    const loadMoreArmedRef = useRef(true)
    const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
    const [turnDetailStateById, setTurnDetailStateById] = useState<TurnDetailStateMap>({})
    const [liveActivityByTurnId, setLiveActivityByTurnId] = useState<Record<string, string>>({})
    const [turnChangesSummaryByTurnId, setTurnChangesSummaryByTurnId] = useState<Record<string, TurnChangesSummary | null>>({})
    const turnChangesSummaryInFlightRef = useRef(new Set<string>())
    const turnChangesSummaryFetchedUpdatedAtRef = useRef<Record<string, number>>({})
    const [isMobileViewport, setIsMobileViewport] = useState(() => (
        typeof window !== 'undefined' && window.matchMedia(MOBILE_BRIEF_BREAKPOINT_QUERY).matches
    ))

    const activeTurn = useMemo(
        () => props.turns.find((turn) => turn.id === activeTurnId) ?? null,
        [activeTurnId, props.turns]
    )

    const activeDetail = useMemo(
        () => (activeTurnId ? (turnDetailStateById[activeTurnId] ?? buildDefaultTurnState()) : null),
        [activeTurnId, turnDetailStateById]
    )
    const codexPlanModeEnabled = useMemo(
        () => isCodexPlanModeEnabled(props.session),
        [props.session]
    )
    const { sessionReopenPosition } = useSessionReopenPositionPreference()
    const generatingBadgeText = codexPlanModeEnabled ? t('brief.turn.generatingPlan') : t('groups.brief.generating')
    const turnTitle = activeTurn ? t('groups.brief.turnTitle', { n: activeTurn.turnIndex }) : t('groups.brief.turnDetails')
    const turnSubtitle = activeTurn
        ? t(activeTurn.messageCount === 1 ? 'groups.brief.messageOne' : 'groups.brief.messages', { n: activeTurn.messageCount })
        : null

    const fetchTurnMessages = useCallback(async (
        turnId: string,
        beforeSeq: number | null,
        prepend: boolean,
        options?: { mergeRecent?: boolean; silent?: boolean }
    ) => {
        const mergeRecent = options?.mergeRecent === true
        const silent = options?.silent === true

        if (!silent) {
            setTurnDetailStateById((prev) => ({
                ...prev,
                [turnId]: {
                    ...(prev[turnId] ?? buildDefaultTurnState()),
                    isLoading: !prepend,
                    isLoadingMore: prepend,
                    error: null
                }
            }))
        }

        try {
            const response = await props.api.getConversationTurnMessages(props.session.id, turnId, {
                limit: DEFAULT_TURN_MESSAGE_LIMIT,
                beforeSeq
            })

            setTurnDetailStateById((prev) => {
                const previous = prev[turnId] ?? buildDefaultTurnState()
                const mergedMessages = prepend
                    ? [...response.messages, ...previous.messages]
                    : mergeRecent
                        ? [...previous.messages, ...response.messages]
                        : response.messages
                const deduped = dedupeAndSortMessages(mergedMessages)

                const keepPagingState = mergeRecent && previous.messages.length > 0

                return {
                    ...prev,
                    [turnId]: {
                        isLoading: false,
                        isLoadingMore: false,
                        error: null,
                        messages: deduped,
                        nextBeforeSeq: keepPagingState ? previous.nextBeforeSeq : response.page.nextBeforeSeq,
                        hasMore: keepPagingState ? previous.hasMore : response.page.hasMore
                    }
                }
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : t('groups.brief.loadFailed')
            setTurnDetailStateById((prev) => ({
                ...prev,
                [turnId]: {
                    ...(prev[turnId] ?? buildDefaultTurnState()),
                    isLoading: false,
                    isLoadingMore: false,
                    error: message
                }
            }))
        }
    }, [props.api, props.session.id, t])

    const openTurnDetails = useCallback((turnId: string) => {
        setActiveTurnId(turnId)

        if (typeof window !== 'undefined' && readTurnChangesDetailToolId(window.location.search)) {
            writeTurnChangesDetailToolId(null, 'replace')
        }

        if (isMobileViewport && typeof window !== 'undefined') {
            const currentTurnId = readMobileBriefTurnId(window.location.search)
            if (currentTurnId !== turnId) {
                writeMobileBriefTurnId(turnId, 'push')
            }
        }
    }, [isMobileViewport])

    const openTurnChangesDetails = useCallback((turnId: string, toolId: string) => {
        setActiveTurnId(turnId)
        if (typeof window === 'undefined') {
            return
        }

        if (isMobileViewport) {
            const currentTurnId = readMobileBriefTurnId(window.location.search)
            const currentToolId = readTurnChangesDetailToolId(window.location.search)
            if (currentTurnId === turnId && currentToolId === toolId) {
                return
            }

            const url = new URL(window.location.href)
            url.searchParams.set(MOBILE_BRIEF_TURN_QUERY_KEY, turnId)
            url.searchParams.set(TURN_CHANGES_DETAIL_QUERY_KEY, toolId)
            const nextUrl = `${url.pathname}${url.search}${url.hash}`
            window.history.pushState(window.history.state, '', nextUrl)
            return
        }

        const currentToolId = readTurnChangesDetailToolId(window.location.search)
        if (currentToolId !== toolId) {
            writeTurnChangesDetailToolId(toolId, 'replace')
        }
    }, [isMobileViewport])

    const closeTurnDetails = useCallback(() => {
        if (isMobileViewport && typeof window !== 'undefined') {
            const currentTurnId = readMobileBriefTurnId(window.location.search)
            if (currentTurnId) {
                window.history.back()
                return
            }
        }

        if (typeof window !== 'undefined' && readTurnChangesDetailToolId(window.location.search)) {
            writeTurnChangesDetailToolId(null, 'replace')
        }

        setActiveTurnId(null)
    }, [isMobileViewport])

    const activeTurnIdForStreaming = useMemo(() => {
        if (props.turns.length === 0) {
            return null
        }
        const openTurn = [...props.turns].reverse().find((turn) => turn.status === 'open')
        return openTurn?.id ?? props.turns[props.turns.length - 1]?.id ?? null
    }, [props.turns])

    const loadMoreActiveTurnDetails = useCallback(async () => {
        if (!activeTurn || !activeDetail) {
            return
        }
        if (!activeDetail.hasMore || activeDetail.nextBeforeSeq === null || activeDetail.isLoadingMore) {
            return
        }
        await fetchTurnMessages(activeTurn.id, activeDetail.nextBeforeSeq, true)
    }, [activeDetail, activeTurn, fetchTurnMessages])

    const fetchLiveActivity = useCallback(async (turnId: string) => {
        const response = await props.api.getConversationTurnMessages(props.session.id, turnId, {
            limit: LIVE_ACTIVITY_FETCH_LIMIT,
            beforeSeq: null
        })
        const latestActivity = extractLatestLiveActivity(response.messages)
        setLiveActivityByTurnId((previous) => {
            if (previous[turnId] === latestActivity) {
                return previous
            }
            return {
                ...previous,
                [turnId]: latestActivity
            }
        })
    }, [props.api, props.session.id])

    useEffect(() => {
        if (!activeTurnId || !activeTurn) {
            return
        }

        const isLiveTurn = activeTurn.status === 'open' || (props.thinking && activeTurnIdForStreaming === activeTurn.id)
        if (!isLiveTurn) {
            return
        }

        let stopped = false
        let inFlight = false

        const refreshLatest = async () => {
            if (stopped || inFlight) {
                return
            }
            inFlight = true
            try {
                await fetchTurnMessages(activeTurn.id, null, false, { mergeRecent: true, silent: true })
            } finally {
                inFlight = false
            }
        }

        void refreshLatest()
        const intervalId = window.setInterval(() => {
            void refreshLatest()
        }, TURN_DETAILS_REFRESH_INTERVAL_MS)

        return () => {
            stopped = true
            window.clearInterval(intervalId)
        }
    }, [
        activeTurn,
        activeTurnId,
        activeTurnIdForStreaming,
        fetchTurnMessages,
        props.thinking
    ])

    useEffect(() => {
        if (!activeTurnId) {
            return
        }

        const existing = turnDetailStateById[activeTurnId]
        if (!existing || (existing.messages.length === 0 && !existing.isLoading && !existing.isLoadingMore)) {
            void fetchTurnMessages(activeTurnId, null, false)
        }
    }, [activeTurnId, fetchTurnMessages, turnDetailStateById])

    useEffect(() => {
        if (activeTurnId !== null || typeof window === 'undefined') {
            return
        }
        if (readTurnChangesDetailToolId(window.location.search)) {
            writeTurnChangesDetailToolId(null, 'replace')
        }
    }, [activeTurnId])

    useEffect(() => {
        const latestTurn = props.turns[props.turns.length - 1]
        const latestTurnId = latestTurn?.id ?? null
        const latestTurnUpdatedAt = latestTurn?.updatedAt ?? null

        if (!shouldFetchLatestTurnChangesSummary({
            latestTurnId,
            latestTurnUpdatedAt,
            fetchedUpdatedAtByTurnId: turnChangesSummaryFetchedUpdatedAtRef.current,
            inFlightTurnIds: turnChangesSummaryInFlightRef.current
        })) {
            return
        }

        const turnId = latestTurnId as string

        let cancelled = false
        turnChangesSummaryInFlightRef.current.add(turnId)

        void fetchTurnChangesSummaryByPaging(props.api, props.session.id, turnId).then((summary) => {
            if (cancelled) {
                return
            }
            setTurnChangesSummaryByTurnId((previous) => ({
                ...previous,
                [turnId]: summary
            }))
        }).catch(() => {
            if (cancelled) {
                return
            }
            setTurnChangesSummaryByTurnId((previous) => ({
                ...previous,
                [turnId]: null
            }))
        }).finally(() => {
            if (latestTurnUpdatedAt !== null) {
                turnChangesSummaryFetchedUpdatedAtRef.current[turnId] = latestTurnUpdatedAt
            }
            turnChangesSummaryInFlightRef.current.delete(turnId)
        })

        return () => {
            cancelled = true
        }
    }, [props.api, props.session.id, props.turns])

    useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        const mediaQuery = window.matchMedia(MOBILE_BRIEF_BREAKPOINT_QUERY)
        const handleChange = () => {
            setIsMobileViewport(mediaQuery.matches)
        }

        handleChange()
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange)
            return () => {
                mediaQuery.removeEventListener('change', handleChange)
            }
        }

        mediaQuery.addListener(handleChange)
        return () => {
            mediaQuery.removeListener(handleChange)
        }
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        if (!isMobileViewport) {
            if (readMobileBriefTurnId(window.location.search)) {
                writeMobileBriefTurnId(null, 'replace')
            }
            return
        }

        const syncFromHistory = () => {
            setActiveTurnId(readMobileBriefTurnId(window.location.search))
        }

        syncFromHistory()
        window.addEventListener('popstate', syncFromHistory)
        return () => {
            window.removeEventListener('popstate', syncFromHistory)
        }
    }, [isMobileViewport])

    useEffect(() => {
        initialScrollAppliedRef.current = false
        pendingRestoreRef.current = null
        previousScrollTopRef.current = 0
        lastLoadTriggerAtRef.current = 0
        loadMoreArmedRef.current = true
        setLiveActivityByTurnId({})
    }, [props.session.id])

    useEffect(() => {
        if (!props.thinking || !activeTurnIdForStreaming) {
            return
        }

        let stopped = false
        let inFlight = false

        const refreshActivity = async () => {
            if (stopped || inFlight) {
                return
            }
            inFlight = true
            try {
                await fetchLiveActivity(activeTurnIdForStreaming)
            } catch {
            } finally {
                inFlight = false
            }
        }

        void refreshActivity()
        const intervalId = window.setInterval(() => {
            void refreshActivity()
        }, TURN_DETAILS_REFRESH_INTERVAL_MS)

        return () => {
            stopped = true
            window.clearInterval(intervalId)
        }
    }, [activeTurnIdForStreaming, fetchLiveActivity, props.thinking])

    const latestTurnUpdateToken = useMemo(() => {
        if (props.turns.length === 0) {
            return 'empty'
        }
        const latestTurn = props.turns[props.turns.length - 1]
        return [
            props.turns.length,
            latestTurn.id,
            latestTurn.messageCount,
            latestTurn.status,
            latestTurn.updatedAt
        ].join(':')
    }, [props.turns])

    const latestTurnId = props.turns[props.turns.length - 1]?.id ?? null
    const latestTurnKey = latestTurnId ? `${latestTurnId}:${props.turns[props.turns.length - 1]?.updatedAt ?? ''}` : null

    const renderTurnRow = useCallback((turn: ConversationTurn) => {
        const userPreview = turn.userPreview?.trim() ?? ''
        const assistantPreviewRaw = turn.assistantPreview?.trim() ?? ''
        const assistantPreview = normalizePreview(turn.assistantPreview, t('groups.brief.emptyPreview'))
        const isLiveTurn = isBriefTurnLive({
            status: turn.status,
            thinking: props.thinking,
            isActiveStreamingTurn: activeTurnIdForStreaming === turn.id
        })
        const liveActivity = liveActivityByTurnId[turn.id] ?? t('brief.turn.waitingForActivity')
        const shouldShowFullLastBlock = shouldShowLatestBriefTurnAsFullContent({
            isLatestTurn: latestTurnId === turn.id,
            isLiveTurn
        })
        const turnChangesSummary = turnChangesSummaryByTurnId[turn.id]
        const messageMeta = (
            <span className="inline-flex items-center gap-1">
                <AnimatedCounter value={turn.messageCount} />
                <span>{t(turn.messageCount === 1 ? 'brief.turn.messageUnit' : 'brief.turn.messagesUnit')}</span>
            </span>
        )

        return (
            <div className="space-y-2">
                {userPreview.length > 0 ? (
                    <div className="flex justify-end">
                        <div className="max-w-[92%] rounded-2xl rounded-br-md border border-[var(--social-border)] bg-[var(--social-hover)]/60 px-3 py-2 text-body text-[var(--social-fg)]">
                            <BriefFullMarkdownContent content={userPreview} className="text-body" />
                        </div>
                    </div>
                ) : null}

                <div className="flex justify-start">
                    {isLiveTurn ? (
                        <div className="relative w-full max-w-[92%] rounded-2xl rounded-bl-md border border-[var(--app-badge-info-border)] bg-[var(--social-surface)] px-3 py-2">
                            <button
                                type="button"
                                className="block w-full text-left"
                                onClick={() => openTurnDetails(turn.id)}
                                aria-label={t('brief.turn.openReplyDetails')}
                            >
                                <div className="flex min-h-[7.25rem] flex-col gap-1.5 py-1">
                                    <div className="flex items-center gap-2">
                                        <Badge variant="info" dot live>
                                            {generatingBadgeText}
                                        </Badge>
                                        <span className="ml-auto text-caption text-[var(--social-fg-muted)]">{messageMeta}</span>
                                    </div>
                                    <LivePreviewCarousel
                                        preview={assistantPreviewRaw}
                                        liveActivity={liveActivity}
                                    />
                                    <div className="text-caption text-[var(--social-fg-muted)]">
                                        <span className="underline decoration-dotted">{t('groups.brief.openDetails')}</span>
                                    </div>
                                </div>
                            </button>
                        </div>
                    ) : shouldShowFullLastBlock ? (
                        <div className="w-full max-w-[92%] px-1 py-1">
                            <BriefFullMarkdownContent content={assistantPreview} />
                            <div className="mt-2 flex items-center gap-2 text-caption text-[var(--social-fg-muted)]">
                                <span>{messageMeta}</span>
                                <span>·</span>
                                <button
                                    type="button"
                                    className={cn('underline decoration-dotted hover:text-[var(--social-fg)]', TEXT_HIT_AREA_CLASS)}
                                    onClick={() => openTurnDetails(turn.id)}
                                >
                                    {t('groups.brief.openDetails')}
                                </button>
                                {turnChangesSummary ? (
                                    <>
                                        <span>·</span>
                                        <button
                                            type="button"
                                            className={cn('underline decoration-dotted hover:text-[var(--social-fg)]', TEXT_HIT_AREA_CLASS)}
                                            onClick={() => openTurnChangesDetails(turn.id, turnChangesSummary.toolId)}
                                        >
                                            {t('brief.turn.changes', { additions: turnChangesSummary.additions, deletions: turnChangesSummary.deletions })}
                                        </button>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    ) : (
                        <div className="w-full max-w-[92%] px-1 py-1">
                            <BriefFullMarkdownContent content={assistantPreview} />
                            <div className="mt-2 flex items-center gap-2 text-caption text-[var(--social-fg-muted)]">
                                <span>{messageMeta}</span>
                                <span>·</span>
                                <button
                                    type="button"
                                    className={cn('underline decoration-dotted hover:text-[var(--social-fg)]', TEXT_HIT_AREA_CLASS)}
                                    onClick={() => openTurnDetails(turn.id)}
                                >
                                    {t('groups.brief.openDetails')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )
    }, [
        activeTurnIdForStreaming,
        latestTurnId,
        liveActivityByTurnId,
        openTurnDetails,
        openTurnChangesDetails,
        props.thinking,
        turnChangesSummaryByTurnId,
        generatingBadgeText,
        t
    ])

    useEffect(() => {
        return () => {
            writeSessionScrollSnapshot(props.session.id, 'brief', {
                top: scrollerRef.current?.scrollTop ?? 0,
                topIndex: 0,
                lastKey: latestTurnKey,
                savedAt: Date.now()
            })
        }
    }, [latestTurnKey, props.session.id])

    const loadOlderTurnsPreservingViewport = useCallback(() => {
        if (props.isLoadingMore || !props.hasMore) {
            return
        }

        const scroller = scrollerRef.current
        if (scroller) {
            pendingRestoreRef.current = {
                scrollTop: scroller.scrollTop,
                scrollHeight: scroller.scrollHeight
            }
        }

        void props.onLoadMoreTurns()
    }, [props.hasMore, props.isLoadingMore, props.onLoadMoreTurns])

    useEffect(() => {
        const scroller = scrollerRef.current
        if (!scroller) {
            return
        }

        previousScrollTopRef.current = scroller.scrollTop

        const handleScroll = () => {
            const currentScrollTop = scroller.scrollTop
            const distanceFromBottom = scroller.scrollHeight - currentScrollTop - scroller.clientHeight
            isAtBottomRef.current = distanceFromBottom <= 32

            writeSessionScrollSnapshot(props.session.id, 'brief', {
                top: currentScrollTop,
                topIndex: 0,
                lastKey: latestTurnKey,
                savedAt: Date.now()
            })

            if (currentScrollTop >= 96) {
                loadMoreArmedRef.current = true
            }

            if (shouldTriggerLoadOlder({
                previousScrollTop: previousScrollTopRef.current,
                currentScrollTop,
                thresholdPx: 48,
                isArmed: loadMoreArmedRef.current,
                isLoadingMessages: props.isLoading,
                isLoadingMoreMessages: props.isLoadingMore,
                hasMoreMessages: props.hasMore,
                lastTriggeredAtMs: lastLoadTriggerAtRef.current,
                nowMs: Date.now(),
                cooldownMs: 300
            })) {
                loadMoreArmedRef.current = false
                lastLoadTriggerAtRef.current = Date.now()
                loadOlderTurnsPreservingViewport()
            }

            previousScrollTopRef.current = currentScrollTop
        }

        scroller.addEventListener('scroll', handleScroll, { passive: true })
        return () => {
            scroller.removeEventListener('scroll', handleScroll)
        }
    }, [
        latestTurnKey,
        loadOlderTurnsPreservingViewport,
        props.hasMore,
        props.isLoading,
        props.isLoadingMore,
        props.session.id,
        props.turns.length
    ])

    useLayoutEffect(() => {
        const scroller = scrollerRef.current
        if (!scroller) {
            return
        }

        if (!initialScrollAppliedRef.current) {
            if (props.isLoading && props.turns.length === 0) {
                return
            }
            const snapshot = readSessionScrollSnapshot(props.session.id, 'brief')
            const shouldRestore = snapshot && (
                sessionReopenPosition === 'restore'
                || (
                    sessionReopenPosition === 'bottom-if-unread'
                    && snapshot.lastKey !== null
                    && latestTurnKey !== null
                    && snapshot.lastKey === latestTurnKey
                )
            )

            if (shouldRestore && snapshot) {
                scroller.scrollTop = Math.min(snapshot.top, Math.max(0, scroller.scrollHeight - scroller.clientHeight))
                const distanceFromBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight
                isAtBottomRef.current = distanceFromBottom <= 32
            } else {
                scroller.scrollTop = scroller.scrollHeight
                isAtBottomRef.current = true
            }
            previousScrollTopRef.current = scroller.scrollTop
            initialScrollAppliedRef.current = true
            return
        }

        const pendingRestore = pendingRestoreRef.current
        if (pendingRestore) {
            scroller.scrollTop = restoreScrollTopByDelta({
                previousScrollTop: pendingRestore.scrollTop,
                previousScrollHeight: pendingRestore.scrollHeight,
                nextScrollHeight: scroller.scrollHeight
            })
            previousScrollTopRef.current = scroller.scrollTop
            pendingRestoreRef.current = null
            return
        }

        if (isAtBottomRef.current) {
            scroller.scrollTop = scroller.scrollHeight
            previousScrollTopRef.current = scroller.scrollTop
        }
    }, [latestTurnKey, props.isLoading, props.session.id, props.turns, sessionReopenPosition])

    return (
        <>
            <div className="relative flex min-h-0 flex-1 flex-col">
                <div className="mx-auto flex h-full w-full max-w-content min-h-0 flex-col gap-3 px-3 py-3">
                    {props.warning ? (
                        <div className="rounded-xl border border-[var(--app-badge-warning-border)] bg-[var(--app-badge-warning-bg)] px-3 py-2 text-caption text-[var(--app-badge-warning-text)]">
                            {props.warning}
                        </div>
                    ) : null}

                    <div className="min-h-0 flex flex-1 flex-col pr-1">
                        <div
                            ref={scrollerRef}
                            className="app-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
                        >
                            {props.isLoading && props.turns.length === 0 ? (
                                <div className="text-caption text-[var(--social-fg-muted)]">{t('groups.brief.loading')}</div>
                            ) : null}

                            {props.turns.length === 0 && !props.isLoading ? (
                                <EmptyState title={t('groups.brief.empty')} />
                            ) : null}

                            {props.turns.length > 0 ? (
                                <>
                                    {props.hasMore || props.isLoadingMore ? (
                                        <div className="pb-2">
                                            <Button
                                                variant="outline"
                                                className="w-full"
                                                onClick={loadOlderTurnsPreservingViewport}
                                                disabled={props.isLoadingMore}
                                            >
                                                {props.isLoadingMore ? t('brief.turn.loadingOlder') : t('brief.turn.loadOlder')}
                                            </Button>
                                        </div>
                                    ) : (
                                        <div className="h-1" />
                                    )}

                                    {props.turns.map((turn) => (
                                        <div key={turn.id} className="pb-3">
                                            {renderTurnRow(turn)}
                                        </div>
                                    ))}
                                </>
                            ) : null}
                        </div>
                    </div>
                </div>

            </div>

            {isMobileViewport ? (
                activeTurnId ? (
                    <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--social-surface)]">
                        <SubPageHeader title={turnTitle} subtitle={turnSubtitle} onBack={closeTurnDetails} />

                        <div className="min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)]">
                            {activeTurn && activeDetail?.error ? (
                                <div className="h-full overflow-y-auto p-4 text-body text-[var(--social-danger)]">
                                    {activeDetail.error}
                                    <div className="mt-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className={HIT_AREA_CLASS}
                                            onClick={() => {
                                                void fetchTurnMessages(activeTurn.id, null, false)
                                            }}
                                        >
                                            {t('groups.brief.retry')}
                                        </Button>
                                    </div>
                                </div>
                            ) : null}

                            {activeTurn && activeDetail && !activeDetail.error ? (
                                <div className="flex h-full min-h-0 flex-col">
                                    <TurnDetailThread
                                        key={activeTurn.id}
                                        api={props.api}
                                        session={props.session}
                                        messages={activeDetail.messages}
                                        hasMoreMessages={activeDetail.hasMore}
                                        isLoadingMessages={activeDetail.isLoading}
                                        isLoadingMoreMessages={activeDetail.isLoadingMore}
                                        onLoadMore={loadMoreActiveTurnDetails}
                                        density={props.density}
                                    />
                                </div>
                            ) : activeTurn && activeDetail?.error ? null : (
                                <div className="flex h-full items-center justify-center text-body text-[var(--social-fg-muted)]">
                                    {activeTurn && activeDetail?.isLoading ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Spinner size="sm" label={null} className="text-current" />
                                            {t('groups.brief.loadingTurn')}
                                        </span>
                                    ) : (
                                        t('groups.brief.noDetail')
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ) : null
            ) : (
                <Dialog open={Boolean(activeTurnId)} onOpenChange={(open) => {
                    if (!open) {
                        setActiveTurnId(null)
                    }
                }}>
                    <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col overflow-hidden p-0">
                        <div className="border-b border-[var(--social-border)] px-4 py-3">
                            <DialogHeader>
                                <DialogTitle>{turnTitle}</DialogTitle>
                            </DialogHeader>
                            {turnSubtitle ? (
                                <div className="mt-1 text-caption text-[var(--social-fg-muted)]">{turnSubtitle}</div>
                            ) : null}
                        </div>

                        <div className="min-h-0 flex-1 overflow-hidden">
                            {activeTurn && activeDetail?.error ? (
                                <div className="h-full overflow-y-auto p-4 text-body text-[var(--social-danger)]">
                                    {activeDetail.error}
                                    <div className="mt-2">
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className={HIT_AREA_CLASS}
                                            onClick={() => {
                                                void fetchTurnMessages(activeTurn.id, null, false)
                                            }}
                                        >
                                            {t('groups.brief.retry')}
                                        </Button>
                                    </div>
                                </div>
                            ) : null}

                            {activeTurn && activeDetail && !activeDetail.error ? (
                                <div className="flex h-full min-h-0 flex-col">
                                    <TurnDetailThread
                                        key={activeTurn.id}
                                        api={props.api}
                                        session={props.session}
                                        messages={activeDetail.messages}
                                        hasMoreMessages={activeDetail.hasMore}
                                        isLoadingMessages={activeDetail.isLoading}
                                        isLoadingMoreMessages={activeDetail.isLoadingMore}
                                        onLoadMore={loadMoreActiveTurnDetails}
                                        density={props.density}
                                    />
                                </div>
                            ) : activeTurn && activeDetail?.error ? null : (
                                <div className="flex h-[65vh] items-center justify-center text-body text-[var(--social-fg-muted)]">
                                    {activeTurn && activeDetail?.isLoading ? (
                                        <span className="inline-flex items-center gap-2">
                                            <Spinner size="sm" label={null} className="text-current" />
                                            {t('groups.brief.loadingTurn')}
                                        </span>
                                    ) : (
                                        t('groups.brief.noDetail')
                                    )}
                                </div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    )
}
