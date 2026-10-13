import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import {
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    useLocation,
    useMatchRoute,
    useNavigate,
    useParams,
    useSearch,
} from '@tanstack/react-router'
import { App } from '@/App'
import { SessionChat } from '@/components/SessionChat'
import { SessionFeed, SessionList, formatRelativeTime, type NewSessionPreset } from '@/components/SessionList'
import { ActiveStoriesStrip } from '@/components/mobile/ActiveStoriesStrip'
import { MobileHeaderIconButton, MobilePageHeader, MobileTabBar } from '@/components/mobile/MobileTabBar'
import { ChevronLeftIcon, ClearIcon, FolderStackIcon, PlusCircleIcon, RecentIcon, SearchIcon } from '@/components/mobile/icons'
import { GroupAvatar, Orb, PairAvatar } from '@/components/mobile/SessionAvatar'
import { DesktopPaneHeader } from '@/components/mobile/DesktopPaneHeader'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { applySessionTagOrder, loadSessionTagOrder, moveSessionTag, persistSessionTagOrder } from '@/components/sessionTagOrder'
import { NewSession } from '@/components/NewSession'
import {
    loadLastSessionConfig,
    loadPreferredAgent,
    loadPreferredCustomModel,
    loadPreferredModel,
    loadPreferredServiceTier,
    loadPreferredThinkEffort,
    loadPreferredYoloMode
} from '@/components/NewSession/preferences'
import { resolveSpawnModel, resolveSpawnServiceTier, resolveSpawnSessionSettings, resolveSpawnThinkEffort } from '@/components/NewSession/spawnPayload'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useMessages } from '@/hooks/queries/useMessages'
import { useConversationTurns } from '@/hooks/queries/useConversationTurns'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSession } from '@/hooks/queries/useSession'
import { useSessions } from '@/hooks/queries/useSessions'
import { useSlashCommands } from '@/hooks/queries/useSlashCommands'
import { useSkills } from '@/hooks/queries/useSkills'
import { useSendMessage } from '@/hooks/mutations/useSendMessage'
import { useGroupActions } from '@/hooks/mutations/useGroupActions'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { queryKeys } from '@/lib/query-keys'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { fetchLatestMessages, seedMessageWindowFromSession } from '@/lib/message-window-store'
import { useSessionListDensity, type SessionListDensity } from '@/hooks/useSessionListDensity'
import { useSessionSidebarWidth } from '@/hooks/useSessionSidebarWidth'
import { useSessionSidebarVisibility } from '@/hooks/useSessionSidebarVisibility'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useChatViewMode } from '@/hooks/useChatViewMode'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Button } from '@/components/ui/button'
import type { GroupDetail, SessionSummary } from '@/types/api'
import { filterSessionsBySearch } from '@/lib/session-search'
import FilesPage from '@/routes/sessions/files'
import FilePage from '@/routes/sessions/file'
import PreviewPage from '@/routes/sessions/preview'
import TerminalPage from '@/routes/sessions/terminal'
import SettingsPage from '@/routes/settings'
import DebugDiffPage from '@/routes/debug/diff'
import GroupDetailPage from '@/routes/groups/detail'
import ReviewLoopsIndexPage from '@/routes/review-loops/index'
import ReviewLoopDetailPage from '@/routes/review-loops/detail'
import { useGroups } from '@/hooks/queries/useGroups'
import { useReviewLoops } from '@/hooks/queries/useReviewLoops'
import type { ReviewLoop } from '@/types/api'
import { ReviewLoopStatusBadge, CreateLoopModal, type CreateLoopData } from '@/components/ReviewLoop'

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

type NewSessionSearch = {
    directory?: string
    machineId?: string
    tag?: string
}

type SessionsLayoutContextValue = {
    toggleSidebarFromHeader: () => void
    showDesktopSidebar: boolean
    density: SessionListDensity
}

const SessionsLayoutContext = createContext<SessionsLayoutContextValue | null>(null)

function useSessionsLayoutContext() {
    return useContext(SessionsLayoutContext)
}

function toNewSessionSearch(preset?: NewSessionPreset): NewSessionSearch {
    const directory = preset?.directory
    const machineId = preset?.machineId
    const tag = preset?.tag
    const next: NewSessionSearch = {}
    if (directory) {
        next.directory = directory
    }
    if (machineId) {
        next.machineId = machineId
    }
    if (tag) {
        next.tag = tag
    }
    return next
}

function getTagChipClass(selected: boolean): string {
    return `h-8 shrink-0 rounded-full border px-3.5 text-[13px] transition-colors ${selected
        ? 'border-[var(--social-primary)] bg-[var(--social-primary)] text-[var(--social-primary-fg)]'
        : 'border-[var(--social-border)] text-[var(--social-fg)] hover:bg-[var(--social-hover)]'}`
}

function SortableSessionTag(props: { tag: string; selected: boolean; onSelect: () => void }) {
    const { tag, selected, onSelect } = props
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tag })

    return (
        <button
            ref={setNodeRef}
            type="button"
            {...attributes}
            {...listeners}
            onClick={onSelect}
            style={{ transform: CSS.Transform.toString(transform), transition }}
            className={`${getTagChipClass(selected)} cursor-grab select-none active:cursor-grabbing ${isDragging ? 'z-10 opacity-70' : ''}`}
        >
            #{tag}
        </button>
    )
}

/** Desktop list | content split: resizable list column next to the main pane (WeChat for desktop). */
function DesktopSplitView(props: { list: ReactNode; listVisible: boolean; children: ReactNode }) {
    const { t } = useTranslation()
    const { sidebarWidth, isResizing, startSidebarResize } = useSessionSidebarWidth()

    return (
        <div className="flex h-full min-h-0">
            <aside
                className={`${props.listVisible ? 'flex' : 'hidden'} relative h-full shrink-0 flex-col border-r border-[var(--social-border)] bg-[var(--app-bg)]`}
                style={{ width: sidebarWidth }}
            >
                {props.list}
                <div
                    className="group absolute inset-y-0 -right-[5px] z-20 w-[9px] cursor-col-resize"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t('sessions.sidebar.resize')}
                    title={t('sessions.sidebar.resize')}
                    onPointerDown={startSidebarResize}
                >
                    <div
                        className={`absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors ${isResizing ? 'bg-[var(--social-fg-subtle)]' : 'bg-transparent group-hover:bg-[var(--social-border)]'}`}
                    />
                </div>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col bg-[var(--app-bg)]">
                <div className="min-h-0 flex-1">
                    {props.children}
                </div>
            </main>
        </div>
    )
}

function DesktopEmptyState(props: { title: string; subtitle?: string; action?: { label: string; onClick: () => void } }) {
    return (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
            <Orb seed="haqi" size={76} />
            <div className="mt-5 text-[17px] font-semibold tracking-[-0.01em] text-[var(--social-fg)]">{props.title}</div>
            {props.subtitle ? (
                <div className="mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-[var(--social-fg-muted)]">{props.subtitle}</div>
            ) : null}
            {props.action ? (
                <button
                    type="button"
                    onClick={props.action.onClick}
                    className="mt-5 rounded-full bg-[var(--social-primary)] px-5 py-2 text-[14px] font-medium text-[var(--social-primary-fg)] transition-opacity hover:opacity-90"
                >
                    {props.action.label}
                </button>
            ) : null}
        </div>
    )
}

type MobileSessionListMode = 'recent' | 'projects'

const MOBILE_SESSION_LIST_MODE_KEY = 'hapi:mobileSessionListMode:v1'

function loadMobileSessionListMode(): MobileSessionListMode {
    try {
        return window.localStorage.getItem(MOBILE_SESSION_LIST_MODE_KEY) === 'projects' ? 'projects' : 'recent'
    } catch {
        return 'recent'
    }
}

function persistMobileSessionListMode(mode: MobileSessionListMode): void {
    try {
        window.localStorage.setItem(MOBILE_SESSION_LIST_MODE_KEY, mode)
    } catch {
    }
}

function MobileSearchField(props: { value: string; onChange: (value: string) => void; placeholder: string }) {
    return (
        <label className="flex h-10 items-center gap-2.5 rounded-xl bg-[var(--social-muted)] px-3.5 text-[var(--social-fg-subtle)]">
            <SearchIcon className="h-[17px] w-[17px] shrink-0" />
            <input
                value={props.value}
                onChange={(event) => props.onChange(event.target.value)}
                placeholder={props.placeholder}
                className="min-w-0 flex-1 bg-transparent text-[16px] text-[var(--social-fg)] outline-none placeholder:text-[var(--social-fg-subtle)]"
                type="search"
                enterKeyHint="search"
            />
            {props.value ? (
                <button type="button" onClick={() => props.onChange('')} className="shrink-0 opacity-70" aria-label="Clear">
                    <ClearIcon className="h-4 w-4" />
                </button>
            ) : null}
        </label>
    )
}

function SessionsPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { sessions, isLoading, error, refetch } = useSessions(api)
    const { spawnSession, isPending: isQuickCreatingSession } = useSpawnSession(api)
    const { density } = useSessionListDensity()
    const { desktopSidebarHidden, setDesktopSidebarHidden, toggleDesktopSidebar } = useSessionSidebarVisibility()
    const isMobileLayout = useIsMobileLayout()
    const [mobileListMode, setMobileListMode] = useState<MobileSessionListMode>(loadMobileSessionListMode)
    const [sessionSearchQuery, setSessionSearchQuery] = useState('')
    const [selectedSessionTag, setSelectedSessionTag] = useState<string | null>(null)
    const [sessionTagOrder, setSessionTagOrder] = useState<string[]>(loadSessionTagOrder)
    const tagSensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
        useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    )
    const sessionMatch = matchRoute({ to: '/sessions/$sessionId', fuzzy: true })
    const selectedSessionId = sessionMatch && sessionMatch.sessionId !== 'new' ? sessionMatch.sessionId : null

    const selectedSessionPreset = useMemo<NewSessionPreset | undefined>(() => {
        if (!selectedSessionId) {
            return undefined
        }
        const selected = sessions.find((session) => session.id === selectedSessionId)
        if (!selected) {
            return undefined
        }

        const directory = selected.metadata?.path?.trim()
        const machineId = selected.metadata?.machineId?.trim()
        if (!directory && !machineId) {
            return undefined
        }
        return {
            directory: directory || undefined,
            machineId: machineId || undefined
        }
    }, [selectedSessionId, sessions])

    const sessionTags = useMemo(() => Array.from(new Set(
        sessions.flatMap((session) => session.metadata?.tags ?? [])
    )).sort((a, b) => a.localeCompare(b)), [sessions])
    const orderedSessionTags = useMemo(
        () => applySessionTagOrder(sessionTags, sessionTagOrder),
        [sessionTags, sessionTagOrder]
    )

    useEffect(() => {
        persistSessionTagOrder(sessionTagOrder)
    }, [sessionTagOrder])

    const handleTagDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return
        setSessionTagOrder((previous) => moveSessionTag(
            applySessionTagOrder(sessionTags, previous),
            String(active.id),
            String(over.id)
        ))
    }

    useEffect(() => {
        if (selectedSessionTag && !sessionTags.includes(selectedSessionTag)) {
            setSelectedSessionTag(null)
        }
    }, [selectedSessionTag, sessionTags])

    const visibleSessions = useMemo(() => {
        const searched = filterSessionsBySearch(sessions, sessionSearchQuery)
        if (!selectedSessionTag) return searched
        return searched.filter((session) => session.metadata?.tags?.includes(selectedSessionTag))
    }, [sessions, sessionSearchQuery, selectedSessionTag])

    const handleRefresh = useCallback(() => {
        void refetch()
    }, [refetch])

    const openNewSession = useCallback((preset?: NewSessionPreset) => {
        const resolvedPreset = {
            ...(preset ?? selectedSessionPreset),
            ...(selectedSessionTag ? { tag: selectedSessionTag } : {})
        }
        navigate({
            to: '/sessions/new',
            search: toNewSessionSearch(resolvedPreset)
        })
    }, [navigate, selectedSessionPreset, selectedSessionTag])

    const quickCreateInProject = useCallback(async (preset?: NewSessionPreset) => {
        if (isQuickCreatingSession) {
            return
        }
        if (!preset?.directory || !preset.machineId) {
            openNewSession(preset)
            return
        }

        try {
            const lastConfig = loadLastSessionConfig()
            const quickCreateAgent = lastConfig?.agent ?? loadPreferredAgent()
            const quickModel = lastConfig?.model ?? loadPreferredModel(quickCreateAgent) ?? undefined
            const quickCustomModel = (lastConfig?.customModel ?? loadPreferredCustomModel(quickCreateAgent)).trim()
            const quickThinkEffort = lastConfig?.thinkEffort ?? loadPreferredThinkEffort(quickCreateAgent) ?? 'auto'
            const quickServiceTier = lastConfig?.serviceTier ?? loadPreferredServiceTier(quickCreateAgent) ?? 'auto'
            const quickYolo = lastConfig?.yoloMode ?? loadPreferredYoloMode()
            const quickPreviewUrl = lastConfig?.previewUrl ?? ''

            const resolvedModel = resolveSpawnModel(quickCreateAgent, quickModel, quickCustomModel)
            const resolvedThinkEffort = resolveSpawnThinkEffort(quickCreateAgent, quickThinkEffort)
            const resolvedServiceTier = resolveSpawnServiceTier(quickCreateAgent, quickServiceTier)
            // Project-level quick create should stay in the clicked project directory.
            // Force simple mode so worktree preferences don't move cwd unexpectedly.
            const sessionSettings = resolveSpawnSessionSettings('simple', '', quickPreviewUrl)
            const result = await spawnSession({
                machineId: preset.machineId,
                directory: preset.directory,
                agent: quickCreateAgent,
                model: resolvedModel,
                thinkEffort: resolvedThinkEffort,
                serviceTier: resolvedServiceTier,
                yolo: quickYolo,
                sessionType: sessionSettings.sessionType,
                worktreeName: sessionSettings.worktreeName,
                previewUrl: sessionSettings.previewUrl
            })

            if (result.type !== 'success') {
                addToast({
                    title: t('sessions.quickCreate.failed'),
                    body: result.message,
                    sessionId: '',
                    url: ''
                })
                return
            }

            if (selectedSessionTag) {
                try {
                    await api.updateSessionTags(result.sessionId, [selectedSessionTag])
                } catch (error) {
                    console.error('Failed to apply session tag after quick create', error)
                    addToast({
                        title: t('newSession.tagAttachFailed'),
                        body: selectedSessionTag,
                        sessionId: result.sessionId,
                        url: ''
                    })
                }
            }

            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: result.sessionId }
            })
        } catch (error) {
            addToast({
                title: t('sessions.quickCreate.failed'),
                body: error instanceof Error ? error.message : t('send.blocked.noConnection'),
                sessionId: '',
                url: ''
            })
        }
    }, [
        addToast,
        api,
        isQuickCreatingSession,
        navigate,
        openNewSession,
        queryClient,
        selectedSessionTag,
        spawnSession,
        t
    ])

    const isSessionsIndex = pathname === '/sessions' || pathname === '/sessions/'
    const showDesktopSidebar = isSessionsIndex || !desktopSidebarHidden

    useEffect(() => {
        if (isSessionsIndex && desktopSidebarHidden) {
            setDesktopSidebarHidden(false)
        }
    }, [isSessionsIndex, desktopSidebarHidden, setDesktopSidebarHidden])

    const selectSession = useCallback((sessionId: string) => {
        navigate({
            to: '/sessions/$sessionId',
            params: { sessionId },
        })
    }, [navigate])

    const onlineCount = sessions.filter((session) => session.active).length
    const pendingSessionsCount = sessions.filter((session) => session.active && session.pendingRequestsCount > 0).length
    const toggleListMode = () => {
        const next: MobileSessionListMode = mobileListMode === 'recent' ? 'projects' : 'recent'
        setMobileListMode(next)
        persistMobileSessionListMode(next)
    }
    const layoutContext: SessionsLayoutContextValue = {
        toggleSidebarFromHeader: toggleDesktopSidebar,
        showDesktopSidebar,
        density
    }

    const listHeader = (
        <div className="pb-2">
            <div className="px-5 pb-3 pt-1">
                <MobileSearchField
                    value={sessionSearchQuery}
                    onChange={setSessionSearchQuery}
                    placeholder={t('sessions.search.placeholder')}
                />
            </div>
            {sessionSearchQuery ? null : (
                <ActiveStoriesStrip
                    sessions={sessions}
                    onSelect={selectSession}
                    onNewSession={() => openNewSession()}
                />
            )}
            {sessionTags.length ? (
                <div className="session-tag-scroll flex gap-2 overflow-x-auto px-5 pb-1 pt-1">
                    <button
                        type="button"
                        onClick={() => setSelectedSessionTag(null)}
                        className={getTagChipClass(selectedSessionTag === null)}
                    >
                        {t('sessions.tags.all')}
                    </button>
                    {isMobileLayout ? orderedSessionTags.map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => setSelectedSessionTag(tag)}
                            className={getTagChipClass(selectedSessionTag === tag)}
                        >
                            #{tag}
                        </button>
                    )) : (
                        // Desktop keeps drag-to-reorder for tag filters.
                        <DndContext sensors={tagSensors} onDragEnd={handleTagDragEnd}>
                            <SortableContext items={orderedSessionTags} strategy={horizontalListSortingStrategy}>
                                {orderedSessionTags.map((tag) => (
                                    <SortableSessionTag
                                        key={tag}
                                        tag={tag}
                                        selected={selectedSessionTag === tag}
                                        onSelect={() => setSelectedSessionTag(tag)}
                                    />
                                ))}
                            </SortableContext>
                        </DndContext>
                    )}
                </div>
            ) : null}
        </div>
    )

    const listBody = mobileListMode === 'recent' ? (
        <SessionFeed
            sessions={visibleSessions}
            availableTags={orderedSessionTags}
            selectedSessionId={selectedSessionId}
            onSelect={selectSession}
            api={api}
            listHeader={listHeader}
            emptyLabel={isLoading ? t('mobile.feed.loading') : t('mobile.feed.empty')}
        />
    ) : (
        <SessionList
            sessions={visibleSessions}
            availableTags={orderedSessionTags}
            selectedSessionId={selectedSessionId}
            onSelect={selectSession}
            onNewSession={openNewSession}
            onQuickCreateInProject={quickCreateInProject}
            onRefresh={handleRefresh}
            isLoading={isLoading}
            renderHeader={false}
            api={api}
            density={density}
            listHeader={listHeader}
            itemVariant="feed"
        />
    )

    const listActions = (
        <>
            <MobileHeaderIconButton
                label={mobileListMode === 'recent' ? t('mobile.list.switchToProjects') : t('mobile.list.switchToRecent')}
                onClick={toggleListMode}
            >
                {mobileListMode === 'recent'
                    ? <FolderStackIcon className="h-[22px] w-[22px]" />
                    : <RecentIcon className="h-[22px] w-[22px]" />}
            </MobileHeaderIconButton>
            <MobileHeaderIconButton label={t('sessions.new')} onClick={() => openNewSession()}>
                <PlusCircleIcon className="h-[24px] w-[24px]" />
            </MobileHeaderIconButton>
        </>
    )
    const listError = error ? (
        <div className="px-5 py-2 text-sm text-red-600">{error}</div>
    ) : null

    if (isMobileLayout) {
        return (
            <SessionsLayoutContext.Provider value={layoutContext}>
                {isSessionsIndex ? (
                    <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
                        <MobilePageHeader
                            title="HAQI"
                            subtitle={t('mobile.feed.onlineCount', { n: onlineCount, total: sessions.length })}
                            actions={listActions}
                        />
                        {listError}
                        <div className="min-h-0 flex-1">
                            {listBody}
                        </div>
                        <MobileTabBar active="sessions" sessionsBadge={pendingSessionsCount} />
                    </div>
                ) : (
                    <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
                        <Outlet />
                    </div>
                )}
            </SessionsLayoutContext.Provider>
        )
    }

    return (
        <SessionsLayoutContext.Provider value={layoutContext}>
            <DesktopSplitView
                listVisible={showDesktopSidebar}
                list={(
                    <>
                        <MobilePageHeader
                            title={t('mobile.tab.sessions')}
                            subtitle={t('mobile.feed.onlineCount', { n: onlineCount, total: sessions.length })}
                            actions={listActions}
                        />
                        {listError}
                        <div className="min-h-0 flex-1">
                            {listBody}
                        </div>
                    </>
                )}
            >
                {isSessionsIndex ? (
                    <DesktopEmptyState
                        title={t('desktop.empty.title')}
                        subtitle={t('desktop.empty.subtitle')}
                        action={{ label: t('desktop.empty.new'), onClick: () => openNewSession() }}
                    />
                ) : (
                    <Outlet />
                )}
            </DesktopSplitView>
        </SessionsLayoutContext.Provider>
    )
}

function SessionsIndexPage() {
    return null
}

function SessionPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const goBack = useAppGoBack()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const sessionsLayout = useSessionsLayoutContext()
    const density = sessionsLayout?.density ?? 'comfortable'
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const {
        session,
        isFetching: sessionFetching,
        error: sessionError,
        notFound: sessionNotFound,
        refetch: refetchSession,
    } = useSession(api, sessionId)
    const { viewMode, setViewMode } = useChatViewMode()
    const {
        messages,
        warning: messagesWarning,
        isLoading: messagesLoading,
        isLoadingMore: messagesLoadingMore,
        hasMore: messagesHasMore,
        newestSeq,
        loadMore: loadMoreMessages,
        refetch: refetchMessages,
        pendingCount,
        messagesVersion,
        flushPending,
        setAtBottom,
    } = useMessages(api, sessionId, { enabled: viewMode === 'normal' || viewMode === 'cli' })
    const {
        turns,
        warning: turnsWarning,
        isLoading: turnsLoading,
        isLoadingMore: turnsLoadingMore,
        hasMore: turnsHasMore,
        loadMore: loadMoreTurns,
        refetch: refetchTurns
    } = useConversationTurns(api, sessionId, { enabled: viewMode === 'brief' })
    const {
        sendMessage,
        retryMessage,
        isSending,
    } = useSendMessage(api, sessionId, {
        resolveSessionId: async (currentSessionId) => {
            if (!api || !session || session.active) {
                return currentSessionId
            }
            try {
                return await api.resumeSession(currentSessionId)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Resume failed'
                addToast({
                    title: 'Resume failed',
                    body: message,
                    sessionId: currentSessionId,
                    url: ''
                })
                throw error
            }
        },
        onSessionResolved: (resolvedSessionId) => {
            void (async () => {
                if (api) {
                    if (session && resolvedSessionId !== session.id) {
                        seedMessageWindowFromSession(session.id, resolvedSessionId)
                        queryClient.setQueryData(queryKeys.session(resolvedSessionId), {
                            session: { ...session, id: resolvedSessionId, active: true }
                        })
                    }
                    try {
                        await Promise.all([
                            queryClient.prefetchQuery({
                                queryKey: queryKeys.session(resolvedSessionId),
                                queryFn: () => api.getSession(resolvedSessionId),
                            }),
                            fetchLatestMessages(api, resolvedSessionId),
                        ])
                    } catch {
                    }
                }
                navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: resolvedSessionId },
                    replace: true
                })
            })()
        },
        onBlocked: (reason) => {
            if (reason === 'no-api') {
                addToast({
                    title: t('send.blocked.title'),
                    body: t('send.blocked.noConnection'),
                    sessionId: sessionId ?? '',
                    url: ''
                })
            }
            // 'no-session' and 'pending' don't need toast - either invalid state or expected behavior
        }
    })

    // Get agent type from session metadata for slash commands
    const agentType = session?.metadata?.flavor ?? 'claude'
    const {
        getSuggestions: getSlashSuggestions,
    } = useSlashCommands(api, sessionId, agentType)
    const {
        getSuggestions: getSkillSuggestions,
    } = useSkills(api, sessionId)

    const getAutocompleteSuggestions = useCallback(async (query: string) => {
        if (query.startsWith('$')) {
            return await getSkillSuggestions(query)
        }
        return await getSlashSuggestions(query)
    }, [getSkillSuggestions, getSlashSuggestions])

    const refreshSelectedSession = useCallback(() => {
        void refetchSession()
        void refetchMessages()
        void refetchTurns()
    }, [refetchMessages, refetchSession, refetchTurns])

    if (!session) {
        if (sessionError && !sessionFetching) {
            return (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                    <div className="max-w-sm text-sm text-[var(--app-hint)]">
                        {sessionNotFound ? t('session.load.notFound') : t('session.load.failed')}
                    </div>
                    <div className="flex items-center gap-2">
                        {sessionNotFound ? null : (
                            <Button size="sm" onClick={() => void refetchSession()}>
                                {t('session.load.retry')}
                            </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => navigate({ to: '/sessions' })}>
                            {t('session.load.back')}
                        </Button>
                    </div>
                </div>
            )
        }
        return (
            <div className="flex-1 flex items-center justify-center p-4">
                <LoadingState label={t('loading.session')} className="text-sm" />
            </div>
        )
    }

    return (
        <SessionChat
            api={api}
            session={session}
            messages={messages}
            messagesWarning={messagesWarning}
            hasMoreMessages={messagesHasMore}
            isLoadingMessages={messagesLoading}
            isLoadingMoreMessages={messagesLoadingMore}
            turns={turns}
            turnsWarning={turnsWarning}
            hasMoreTurns={turnsHasMore}
            isLoadingTurns={turnsLoading}
            isLoadingMoreTurns={turnsLoadingMore}
            isSending={isSending}
            pendingCount={pendingCount}
            newestMessageSeq={newestSeq}
            messagesVersion={messagesVersion}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onBack={goBack}
            onRefresh={refreshSelectedSession}
            onLoadMore={loadMoreMessages}
            onLoadMoreTurns={loadMoreTurns}
            onSend={sendMessage}
            onFlushPending={flushPending}
            onAtBottomChange={setAtBottom}
            onRetryMessage={retryMessage}
            autocompleteSuggestions={getAutocompleteSuggestions}
            onToggleSidebar={sessionsLayout?.toggleSidebarFromHeader}
            sidebarVisible={sessionsLayout?.showDesktopSidebar ?? false}
            density={density}
        />
    )
}

function SessionDetailRoute() {
    const pathname = useLocation({ select: location => location.pathname })
    const { sessionId } = useParams({ from: '/sessions/$sessionId' })
    const basePath = `/sessions/${sessionId}`
    const isChat = pathname === basePath || pathname === `${basePath}/`

    return isChat ? <SessionPage /> : <Outlet />
}

function NewSessionPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const search = useSearch({ from: '/sessions/new' })
    const goBack = useAppGoBack()
    const queryClient = useQueryClient()
    const { addToast } = useToast()
    const { t } = useTranslation()
    const { machines, isLoading: machinesLoading, error: machinesError } = useMachines(api, true)

    const handleCancel = useCallback(() => {
        navigate({ to: '/sessions' })
    }, [navigate])

    const handleSuccess = useCallback(async (sessionId: string) => {
        if (search.tag) {
            try {
                await api.updateSessionTags(sessionId, [search.tag])
            } catch (error) {
                console.error('Failed to apply session tag after create', error)
                addToast({
                    title: t('newSession.tagAttachFailed'),
                    body: search.tag,
                    sessionId,
                    url: ''
                })
            }
        }
        void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        // Replace current page with /sessions to clear spawn flow from history
        navigate({ to: '/sessions', replace: true })
        // Then navigate to new session
        requestAnimationFrame(() => {
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId },
            })
        })
    }, [addToast, api, navigate, queryClient, search.tag, t])
    const formId = 'new-session-page-form'
    const submitDisabled = Boolean(machinesLoading || machinesError)

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-[var(--app-border)] bg-[var(--app-bg)] p-3 pt-[calc(0.75rem+env(safe-area-inset-top))]">
                {!isTelegramApp() && (
                    <button
                        type="button"
                        onClick={goBack}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                    >
                        <BackIcon />
                    </button>
                )}
                <div className="flex-1 font-semibold">Create Session</div>
                <Button
                    type="submit"
                    form={formId}
                    size="sm"
                    disabled={submitDisabled}
                    className="hidden sm:inline-flex"
                >
                    Create
                </Button>
                <Button
                    type="submit"
                    form={formId}
                    size="sm"
                    disabled={submitDisabled}
                    className="h-8 w-8 p-0 text-base sm:hidden"
                    aria-label="Create"
                    title="Create"
                >
                    <span aria-hidden>✅</span>
                </Button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                {machinesError ? (
                    <div className="p-3 text-sm text-red-600">
                        {machinesError}
                    </div>
                ) : null}

                <NewSession
                    api={api}
                    machines={machines}
                    isLoading={machinesLoading}
                    initialDirectory={search.directory}
                    initialMachineId={search.machineId}
                    formId={formId}
                    onCancel={handleCancel}
                    onSuccess={handleSuccess}
                />
            </div>
        </div>
    )
}

/** Shared look of list rows (sessions, groups, loops): full-bleed on phones, inset pills on desktop. */
const SOCIAL_ROW_CLASS = 'social-pressable flex w-full items-center gap-3.5 px-5 py-2.5 text-left select-none lg:mx-2 lg:w-[calc(100%-1rem)] lg:rounded-2xl lg:px-3'

function GroupRow(props: {
    item: GroupDetail
    members: SessionSummary[]
    selected?: boolean
    onSelect: (groupId: string) => void
    onOpenActions: (groupId: string, point: { x: number; y: number }) => void
}) {
    const { item, members, onSelect, onOpenActions } = props
    const { t } = useTranslation()
    const { haptic } = usePlatform()
    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            onOpenActions(item.group.id, point)
        },
        onClick: () => onSelect(item.group.id),
        threshold: 500
    })
    const hasLiveMember = members.some((member) => member.thinking)

    return (
        <button
            type="button"
            {...longPressHandlers}
            className={SOCIAL_ROW_CLASS}
            style={{ WebkitTouchCallout: 'none' }}
            aria-current={props.selected ? 'page' : undefined}
        >
            <GroupAvatar seed={item.group.id} members={members} size={52} />
            <div className="flex min-w-0 flex-1 flex-col justify-center">
                <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[15px] font-medium leading-snug tracking-[-0.01em]">{item.group.name}</span>
                    <span className="shrink-0 text-[12px] text-[var(--social-fg-subtle)]">{formatRelativeTime(item.group.updatedAt, t)}</span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13.5px] leading-snug text-[var(--social-fg-muted)]">
                    {hasLiveMember ? (
                        <span className="shrink-0 font-medium text-[var(--social-fg)]">{t('mobile.feed.thinking')} ·</span>
                    ) : null}
                    <span className="min-w-0 truncate">
                        {t('mobile.groups.members', { n: item.members.length })}
                        {item.group.description?.trim() ? ` · ${item.group.description}` : ''}
                    </span>
                </div>
            </div>
        </button>
    )
}

function filterGroupsBySearch(groups: GroupDetail[], query: string): GroupDetail[] {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
        return groups
    }
    return groups.filter((item) => {
        const name = item.group.name.toLowerCase()
        const description = (item.group.description ?? '').toLowerCase()
        const groupId = item.group.id.toLowerCase()
        return name.includes(normalizedQuery)
            || description.includes(normalizedQuery)
            || groupId.includes(normalizedQuery)
    })
}

function GroupsLayout() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const { groups, isLoading } = useGroups(api)
    const { desktopSidebarHidden, setDesktopSidebarHidden, toggleDesktopSidebar } = useSessionSidebarVisibility()
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [groupSearchQuery, setGroupSearchQuery] = useState('')
    const [newGroupName, setNewGroupName] = useState('')
    const [newGroupDesc, setNewGroupDesc] = useState('')
    const [createError, setCreateError] = useState<string | null>(null)
    const [isCreateSubmitting, setIsCreateSubmitting] = useState(false)
    const [actionMenuOpen, setActionMenuOpen] = useState(false)
    const [actionAnchorPoint, setActionAnchorPoint] = useState({ x: 0, y: 0 })
    const [actionGroupId, setActionGroupId] = useState<string | null>(null)
    const [renameModalOpen, setRenameModalOpen] = useState(false)
    const [renameDraft, setRenameDraft] = useState('')
    const [renameError, setRenameError] = useState<string | null>(null)
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const { createGroup, isPending: isCreatingGroup } = useGroupActions(api, null)
    const { updateGroup, deleteGroup, isPending: isActionPending } = useGroupActions(api, actionGroupId)
    const isMobileLayout = useIsMobileLayout()
    const { sessions: allSessions } = useSessions(api)
    const sessionsById = useMemo(() => new Map(allSessions.map((session) => [session.id, session])), [allSessions])

    const groupMatch = matchRoute({ to: '/groups/$groupId', fuzzy: true })
    const selectedGroupId = groupMatch ? groupMatch.groupId : null
    const isGroupsIndex = pathname === '/groups' || pathname === '/groups/'
    const showDesktopSidebar = isGroupsIndex || !desktopSidebarHidden
    const selectedGroup = selectedGroupId
        ? groups.find((item) => item.group.id === selectedGroupId) ?? null
        : null
    const visibleGroups = useMemo(
        () => filterGroupsBySearch(groups, groupSearchQuery),
        [groups, groupSearchQuery]
    )
    const actionTarget = actionGroupId
        ? groups.find((item) => item.group.id === actionGroupId) ?? null
        : null
    const isCreateRequestInFlight = isCreatingGroup || isCreateSubmitting

    // Calculate total member count across all groups
    const totalMemberCount = visibleGroups.reduce((acc, item) => acc + item.members.length, 0)

    useEffect(() => {
        if (!actionGroupId) {
            return
        }
        if (!groups.some((item) => item.group.id === actionGroupId)) {
            setActionMenuOpen(false)
            setRenameModalOpen(false)
            setDeleteModalOpen(false)
            setActionGroupId(null)
        }
    }, [actionGroupId, groups])

    useEffect(() => {
        if (isGroupsIndex && desktopSidebarHidden) {
            setDesktopSidebarHidden(false)
        }
    }, [isGroupsIndex, desktopSidebarHidden, setDesktopSidebarHidden])

    useEffect(() => {
        // Desktop opens the first group next to the list; on phones the list itself is the page.
        if (isMobileLayout || !isGroupsIndex || isLoading || groups.length === 0) {
            return
        }
        const firstGroupId = groups[0]?.group.id
        if (!firstGroupId) {
            return
        }
        navigate({
            to: '/groups/$groupId',
            params: { groupId: firstGroupId },
            replace: true
        })
    }, [groups, isGroupsIndex, isLoading, isMobileLayout, navigate])

    const handleCreate = async () => {
        if (isCreateRequestInFlight) {
            return
        }
        const trimmedName = newGroupName.trim()
        if (!trimmedName) {
            setCreateError('Name is required')
            return
        }
        setCreateError(null)
        setIsCreateSubmitting(true)
        try {
            const groupId = await createGroup({
                name: trimmedName,
                description: newGroupDesc.trim() || undefined
            })
            setShowCreateModal(false)
            setNewGroupName('')
            setNewGroupDesc('')
            navigate({ to: '/groups/$groupId', params: { groupId } })
        } catch (error) {
            setCreateError(error instanceof Error ? error.message : 'Failed to create group')
        } finally {
            setIsCreateSubmitting(false)
        }
    }

    const handleOpenGroupActions = (groupId: string, point: { x: number; y: number }) => {
        setActionGroupId(groupId)
        setActionAnchorPoint(point)
        setActionMenuOpen(true)
    }

    const handleOpenRename = () => {
        if (!actionTarget) {
            return
        }
        setRenameError(null)
        setRenameDraft(actionTarget.group.name)
        setRenameModalOpen(true)
    }

    const handleRenameGroup = async () => {
        if (!actionTarget) {
            return
        }
        const nextName = renameDraft.trim()
        if (!nextName) {
            setRenameError('Name is required')
            return
        }
        if (nextName === actionTarget.group.name) {
            setRenameModalOpen(false)
            return
        }
        setRenameError(null)
        try {
            await updateGroup({ name: nextName })
            setRenameModalOpen(false)
        } catch (error) {
            setRenameError(error instanceof Error ? error.message : 'Failed to rename group')
        }
    }

    const handleDeleteGroup = async () => {
        if (!actionTarget) {
            return
        }
        const removedGroupId = actionTarget.group.id
        await deleteGroup()
        setDeleteModalOpen(false)
        setActionMenuOpen(false)
        if (selectedGroupId === removedGroupId) {
            navigate({ to: '/groups' })
        }
    }

    const groupModals = (
        <>
            {/* Create group modal */}
            {showCreateModal ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-sm rounded-xl border border-[var(--app-divider)] bg-[var(--app-bg)] p-4 shadow-xl">
                        <div className="mb-3 font-semibold text-[var(--app-fg)]">New Group</div>
                        <input
                            autoFocus
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { void handleCreate() } }}
                            placeholder="Group name"
                            className="mb-2 w-full rounded-md border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--app-link)]"
                        />
                        <input
                            value={newGroupDesc}
                            onChange={(e) => setNewGroupDesc(e.target.value)}
                            placeholder="Description (optional)"
                            className="mb-3 w-full rounded-md border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--app-link)]"
                        />
                        {createError ? (
                            <div className="mb-2 text-xs text-red-600">{createError}</div>
                        ) : null}
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => { setShowCreateModal(false); setCreateError(null) }}
                                className="rounded-md border border-[var(--app-divider)] px-3 py-1.5 text-sm text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => { void handleCreate() }}
                                disabled={isCreateRequestInFlight}
                                className="rounded-md bg-[var(--app-link)] px-3 py-1.5 text-sm text-white disabled:opacity-60"
                            >
                                {isCreateRequestInFlight ? 'Creating...' : 'Create'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            <SessionActionMenu
                isOpen={actionMenuOpen && Boolean(actionTarget)}
                onClose={() => setActionMenuOpen(false)}
                sessionActive={false}
                onRename={handleOpenRename}
                onArchive={() => {}}
                onDelete={() => {
                    setRenameModalOpen(false)
                    setRenameError(null)
                    setDeleteModalOpen(true)
                }}
                anchorPoint={actionAnchorPoint}
            />

            {renameModalOpen && actionTarget ? (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-sm rounded-xl border border-[var(--app-divider)] bg-[var(--app-bg)] p-4 shadow-xl">
                        <div className="mb-3 font-semibold text-[var(--app-fg)]">Rename Group</div>
                        <input
                            autoFocus
                            value={renameDraft}
                            onChange={(e) => setRenameDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { void handleRenameGroup() } }}
                            placeholder="Group name"
                            className="mb-2 w-full rounded-md border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--app-link)]"
                        />
                        {renameError ? (
                            <div className="mb-2 text-xs text-red-600">{renameError}</div>
                        ) : null}
                        <div className="flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => {
                                    setRenameModalOpen(false)
                                    setRenameError(null)
                                }}
                                className="rounded-md border border-[var(--app-divider)] px-3 py-1.5 text-sm text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={() => { void handleRenameGroup() }}
                                disabled={isActionPending}
                                className="rounded-md bg-[var(--app-link)] px-3 py-1.5 text-sm text-white disabled:opacity-60"
                            >
                                {isActionPending ? 'Saving...' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}

            <ConfirmDialog
                isOpen={deleteModalOpen && Boolean(actionTarget)}
                onClose={() => setDeleteModalOpen(false)}
                title="Delete Group"
                description={
                    actionTarget
                        ? `Are you sure you want to delete "${actionTarget.group.name}"? This action cannot be undone.`
                        : 'Are you sure you want to delete this group?'
                }
                confirmLabel="Delete"
                confirmingLabel="Deleting..."
                onConfirm={handleDeleteGroup}
                isPending={isActionPending}
                destructive
            />
        </>
    )

    const membersOf = (item: GroupDetail) => item.members
        .map((member) => (member.sessionId ? sessionsById.get(member.sessionId) : undefined))
        .filter((session): session is NonNullable<typeof session> => Boolean(session))
    const openGroup = (groupId: string) => {
        setActionMenuOpen(false)
        navigate({ to: '/groups/$groupId', params: { groupId } })
    }
    const listHeader = (
        <MobilePageHeader
            title={t('mobile.tab.groups')}
            subtitle={t('mobile.groups.summary', { n: visibleGroups.length, m: totalMemberCount })}
            actions={(
                <MobileHeaderIconButton label={t('mobile.groups.new')} onClick={() => setShowCreateModal(true)}>
                    <PlusCircleIcon className="h-[24px] w-[24px]" />
                </MobileHeaderIconButton>
            )}
        />
    )
    const listBody = (
        <div className="session-list-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="px-5 pb-3 pt-1">
                <MobileSearchField
                    value={groupSearchQuery}
                    onChange={setGroupSearchQuery}
                    placeholder={t('groups.search.placeholder')}
                />
            </div>
            {isLoading ? (
                <div className="px-6 py-16 text-center text-sm text-[var(--app-hint)]">{t('mobile.feed.loading')}</div>
            ) : visibleGroups.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-[var(--app-hint)]">{t('mobile.groups.empty')}</div>
            ) : (
                visibleGroups.map((item) => (
                    <GroupRow
                        key={item.group.id}
                        item={item}
                        members={membersOf(item)}
                        selected={selectedGroupId === item.group.id}
                        onSelect={openGroup}
                        onOpenActions={handleOpenGroupActions}
                    />
                ))
            )}
        </div>
    )
    const groupSubtitle = selectedGroup
        ? `${t('mobile.groups.members', { n: selectedGroup.members.length })}${selectedGroup.group.description?.trim() ? ` · ${selectedGroup.group.description}` : ''}`
        : null

    if (isMobileLayout) {
        if (isGroupsIndex) {
            return (
                <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
                    {listHeader}
                    {listBody}
                    <MobileTabBar active="groups" />
                    {groupModals}
                </div>
            )
        }

        return (
            <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
                <div className="social-bar relative z-20 shrink-0 border-b border-[var(--social-border)] pt-[env(safe-area-inset-top)]">
                    <div className="flex h-[52px] items-center gap-2 pl-1 pr-4">
                        <button
                            type="button"
                            onClick={() => navigate({ to: '/groups' })}
                            className="flex h-11 w-9 shrink-0 items-center justify-center text-[var(--app-fg)] [-webkit-tap-highlight-color:transparent]"
                            aria-label="Back"
                        >
                            <ChevronLeftIcon className="h-[26px] w-[26px]" />
                        </button>
                        {selectedGroup ? (
                            <GroupAvatar seed={selectedGroup.group.id} members={membersOf(selectedGroup)} size={38} />
                        ) : null}
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[16px] font-semibold leading-tight">
                                {selectedGroup?.group.name ?? 'Group'}
                            </div>
                            <div className="mt-0.5 truncate text-[12px] leading-tight text-[var(--app-hint)]">
                                {groupSubtitle}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="min-h-0 flex-1">
                    <Outlet />
                </div>
                {groupModals}
            </div>
        )
    }

    return (
        <>
            <DesktopSplitView
                listVisible={showDesktopSidebar}
                list={(
                    <>
                        {listHeader}
                        {listBody}
                    </>
                )}
            >
                {isGroupsIndex ? (
                    <DesktopEmptyState title={isLoading || groups.length > 0 ? t('desktop.groups.pick') : t('mobile.groups.empty')} />
                ) : (
                    <div className="flex h-full min-h-0 flex-col">
                        <DesktopPaneHeader
                            avatar={selectedGroup ? (
                                <GroupAvatar seed={selectedGroup.group.id} members={membersOf(selectedGroup)} size={36} />
                            ) : null}
                            title={selectedGroup?.group.name ?? 'Group'}
                            subtitle={groupSubtitle}
                            listVisible={showDesktopSidebar}
                            onToggleList={toggleDesktopSidebar}
                        />
                        <div className="min-h-0 flex-1">
                            <Outlet />
                        </div>
                    </div>
                )}
            </DesktopSplitView>
            {groupModals}
        </>
    )
}

function GroupsIndexPage() {
    return null
}

// ─── ReviewLoops ────────────────────────────────────────────────────────────────

function formatLoopAge(ts: number): string {
    const diff = Date.now() - ts
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
}

function filterLoopsBySearch(loops: ReviewLoop[], query: string): ReviewLoop[] {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) {
        return loops
    }
    return loops.filter((item) => {
        const req = item.requirement.toLowerCase()
        const criteria = item.acceptanceCriteria.toLowerCase()
        const loopId = item.id.toLowerCase()
        const status = item.status.toLowerCase()
        return req.includes(normalizedQuery)
            || criteria.includes(normalizedQuery)
            || loopId.includes(normalizedQuery)
            || status.includes(normalizedQuery)
    })
}

function ReviewLoopsLayout() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const pathname = useLocation({ select: location => location.pathname })
    const matchRoute = useMatchRoute()
    const { t } = useTranslation()
    const { loops, isLoading } = useReviewLoops(api)
    const { sessions } = useSessions(api)
    const { desktopSidebarHidden, setDesktopSidebarHidden, toggleDesktopSidebar } = useSessionSidebarVisibility()
    const [loopSearchQuery, setLoopSearchQuery] = useState('')
    const [createModalOpen, setCreateModalOpen] = useState(false)
    const isMobileLayout = useIsMobileLayout()

    const handleCreateLoop = useCallback(async (data: CreateLoopData) => {
        if (!api) return
        try {
            const result = await api.createReviewLoop({
                workerSessionId: data.workerSessionId,
                reviewerSessionId: data.reviewerSessionId,
                requirement: data.requirement,
                acceptanceCriteria: data.acceptanceCriteria,
                maxRounds: data.maxRounds,
                userPreference: data.userPreference,
            })
            setCreateModalOpen(false)
            const loopId = result.loop?.id
            if (loopId) {
                // Initiate the first round
                try {
                    await api.initiateReviewLoop(loopId)
                } catch {
                    // Loop created but initiation failed — user can retry from detail page
                }
                navigate({ to: '/review-loops/$loopId', params: { loopId } })
            }
        } catch (e) {
            console.error('Failed to create loop:', e)
        }
    }, [api, navigate])

    const loopMatch = matchRoute({ to: '/review-loops/$loopId', fuzzy: true })
    const selectedLoopId = loopMatch ? loopMatch.loopId : null
    const isLoopsIndex = pathname === '/review-loops' || pathname === '/review-loops/'
    const showDesktopSidebar = isLoopsIndex || !desktopSidebarHidden

    const visibleLoops = useMemo(
        () => filterLoopsBySearch(loops, loopSearchQuery),
        [loops, loopSearchQuery]
    )

    const activeCount = visibleLoops.filter((l) => l.status === 'executing' || l.status === 'reviewing' || l.status === 'waiting_user').length

    useEffect(() => {
        if (isLoopsIndex && desktopSidebarHidden) {
            setDesktopSidebarHidden(false)
        }
    }, [isLoopsIndex, desktopSidebarHidden, setDesktopSidebarHidden])

    const selectedLoop = selectedLoopId
        ? loops.find((item) => item.id === selectedLoopId) ?? null
        : null

    const sessionById = new Map(sessions.map((session) => [session.id, session]))
    const loopAvatar = (loop: ReviewLoop, size: number) => (
        <PairAvatar
            first={sessionById.get(loop.workerSessionId) ?? null}
            second={sessionById.get(loop.reviewerSessionId) ?? null}
            size={size}
            seed={loop.id}
        />
    )
    const listHeader = (
        <MobilePageHeader
            title={t('mobile.tab.loops')}
            subtitle={t('mobile.loops.summary', { n: visibleLoops.length, active: activeCount })}
            actions={(
                <MobileHeaderIconButton label={t('mobile.loops.new')} onClick={() => setCreateModalOpen(true)}>
                    <PlusCircleIcon className="h-[24px] w-[24px]" />
                </MobileHeaderIconButton>
            )}
        />
    )
    const listBody = (
        <div className="session-list-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="px-5 pb-3 pt-1">
                <MobileSearchField
                    value={loopSearchQuery}
                    onChange={setLoopSearchQuery}
                    placeholder={t('mobile.loops.search')}
                />
            </div>
            {isLoading ? (
                <div className="px-6 py-16 text-center text-sm text-[var(--app-hint)]">{t('mobile.feed.loading')}</div>
            ) : visibleLoops.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-[var(--app-hint)]">{t('mobile.loops.empty')}</div>
            ) : (
                visibleLoops.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        onClick={() => navigate({ to: '/review-loops/$loopId', params: { loopId: item.id } })}
                        className={SOCIAL_ROW_CLASS}
                        aria-current={selectedLoopId === item.id ? 'page' : undefined}
                    >
                        {loopAvatar(item, 52)}
                        <div className="flex min-w-0 flex-1 flex-col justify-center">
                            <div className="flex items-baseline gap-2">
                                <span className="min-w-0 flex-1 truncate text-[15px] font-medium leading-snug tracking-[-0.01em]">
                                    {item.requirement}
                                </span>
                                <span className="shrink-0 text-[12px] text-[var(--social-fg-subtle)]">
                                    {formatRelativeTime(item.updatedAt, t)}
                                </span>
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[12px] text-[var(--social-fg-muted)]">
                                <ReviewLoopStatusBadge status={item.status} />
                                <span>{t('mobile.loops.round', { n: item.currentRound, max: item.maxRounds })}</span>
                            </div>
                        </div>
                    </button>
                ))
            )}
        </div>
    )
    const createLoopModal = (
        <CreateLoopModal
            open={createModalOpen}
            onClose={() => setCreateModalOpen(false)}
            onSubmit={handleCreateLoop}
            sessions={sessions}
        />
    )
    const loopSubtitle = selectedLoop
        ? t('mobile.loops.round', { n: selectedLoop.currentRound, max: selectedLoop.maxRounds })
        : null

    if (isMobileLayout) {
        if (isLoopsIndex) {
            return (
                <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
                    {listHeader}
                    {listBody}
                    <MobileTabBar active="loops" />
                    {createLoopModal}
                </div>
            )
        }

        return (
            <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
                <div className="social-bar relative z-20 shrink-0 border-b border-[var(--social-border)] pt-[env(safe-area-inset-top)]">
                    <div className="flex h-[52px] items-center gap-2 pl-1 pr-4">
                        <button
                            type="button"
                            onClick={() => navigate({ to: '/review-loops' })}
                            className="flex h-11 w-9 shrink-0 items-center justify-center text-[var(--app-fg)] [-webkit-tap-highlight-color:transparent]"
                            aria-label="Back"
                        >
                            <ChevronLeftIcon className="h-[26px] w-[26px]" />
                        </button>
                        {selectedLoop ? loopAvatar(selectedLoop, 38) : null}
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[16px] font-semibold leading-tight">
                                {selectedLoop?.requirement ?? 'review-loop'}
                            </div>
                            {loopSubtitle ? (
                                <div className="mt-0.5 truncate text-[12px] leading-tight text-[var(--app-hint)]">
                                    {loopSubtitle}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
                <div className="min-h-0 flex-1">
                    <Outlet />
                </div>
            </div>
        )
    }

    return (
        <>
            <DesktopSplitView
                listVisible={showDesktopSidebar}
                list={(
                    <>
                        {listHeader}
                        {listBody}
                    </>
                )}
            >
                {isLoopsIndex ? (
                    <DesktopEmptyState
                        title={t('desktop.loops.pick')}
                        action={{ label: t('mobile.loops.new'), onClick: () => setCreateModalOpen(true) }}
                    />
                ) : (
                    <div className="flex h-full min-h-0 flex-col">
                        <DesktopPaneHeader
                            avatar={selectedLoop ? loopAvatar(selectedLoop, 36) : null}
                            title={selectedLoop?.requirement ?? 'review-loop'}
                            subtitle={loopSubtitle}
                            listVisible={showDesktopSidebar}
                            onToggleList={toggleDesktopSidebar}
                        />
                        <div className="min-h-0 flex-1">
                            <Outlet />
                        </div>
                    </div>
                )}
            </DesktopSplitView>
            {createLoopModal}
        </>
    )
}

const rootRoute = createRootRoute({
    component: App,
})

const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <Navigate to="/sessions" replace />,
})

const sessionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions',
    component: SessionsPage,
})

const sessionsIndexRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '/',
    component: SessionsIndexPage,
})

const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: '$sessionId',
    component: SessionDetailRoute,
})

const sessionFilesRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'files',
    validateSearch: (search: Record<string, unknown>): { tab?: 'changes' | 'directories' } => {
        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        return tab ? { tab } : {}
    },
    component: FilesPage,
})

const sessionTerminalRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'terminal',
    component: TerminalPage,
})

const sessionPreviewRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'preview',
    component: PreviewPage,
})

type SessionFileSearch = {
    path: string
    staged?: boolean
    tab?: 'changes' | 'directories'
}

const sessionFileRoute = createRoute({
    getParentRoute: () => sessionDetailRoute,
    path: 'file',
    validateSearch: (search: Record<string, unknown>): SessionFileSearch => {
        const path = typeof search.path === 'string' ? search.path : ''
        const staged = search.staged === true || search.staged === 'true'
            ? true
            : search.staged === false || search.staged === 'false'
                ? false
                : undefined

        const tabValue = typeof search.tab === 'string' ? search.tab : undefined
        const tab = tabValue === 'directories'
            ? 'directories'
            : tabValue === 'changes'
                ? 'changes'
                : undefined

        const result: SessionFileSearch = { path }
        if (staged !== undefined) {
            result.staged = staged
        }
        if (tab !== undefined) {
            result.tab = tab
        }
        return result
    },
    component: FilePage,
})

const newSessionRoute = createRoute({
    getParentRoute: () => sessionsRoute,
    path: 'new',
    validateSearch: (search: Record<string, unknown>): NewSessionSearch => {
        const directoryRaw = typeof search.directory === 'string' ? search.directory : undefined
        const machineIdRaw = typeof search.machineId === 'string' ? search.machineId : undefined
        const tagRaw = typeof search.tag === 'string' ? search.tag : undefined

        const result: NewSessionSearch = {}
        if (directoryRaw && directoryRaw.trim().length > 0) {
            result.directory = directoryRaw
        }
        if (machineIdRaw && machineIdRaw.trim().length > 0) {
            result.machineId = machineIdRaw
        }
        if (tagRaw && tagRaw.trim().length > 0) {
            result.tag = tagRaw.trim().toLowerCase()
        }
        return result
    },
    component: NewSessionPage,
})

const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: SettingsPage,
})

const debugDiffRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/debug/diff',
    component: DebugDiffPage,
})

const groupsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/groups',
    component: GroupsLayout,
})

const groupsIndexRoute = createRoute({
    getParentRoute: () => groupsRoute,
    path: '/',
    component: GroupsIndexPage,
})

const groupDetailRoute = createRoute({
    getParentRoute: () => groupsRoute,
    path: '$groupId',
    component: GroupDetailPage,
})

const reviewLoopsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/review-loops',
    component: ReviewLoopsLayout,
})

const reviewLoopsIndexRoute = createRoute({
    getParentRoute: () => reviewLoopsRoute,
    path: '/',
    component: ReviewLoopsIndexPage,
})

const reviewLoopDetailRoute = createRoute({
    getParentRoute: () => reviewLoopsRoute,
    path: '$loopId',
    component: ReviewLoopDetailPage,
})

export const routeTree = rootRoute.addChildren([
    indexRoute,
    debugDiffRoute,
    sessionsRoute.addChildren([
        sessionsIndexRoute,
        newSessionRoute,
        sessionDetailRoute.addChildren([
            sessionPreviewRoute,
            sessionTerminalRoute,
            sessionFilesRoute,
            sessionFileRoute,
        ]),
    ]),
    groupsRoute.addChildren([
        groupsIndexRoute,
        groupDetailRoute,
    ]),
    reviewLoopsRoute.addChildren([
        reviewLoopsIndexRoute,
        reviewLoopDetailRoute,
    ]),
    settingsRoute,
])

type RouterHistory = Parameters<typeof createRouter>[0]['history']

export function createAppRouter(history?: RouterHistory) {
    return createRouter({
        routeTree,
        history,
        scrollRestoration: true,
    })
}

export type AppRouter = ReturnType<typeof createAppRouter>

declare module '@tanstack/react-router' {
    interface Register {
        router: AppRouter
    }
}
