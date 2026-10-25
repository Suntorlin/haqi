import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQueryClient } from '@tanstack/react-query'
import {
    Navigate,
    Outlet,
    createRootRoute,
    createRoute,
    createRouter,
    lazyRouteComponent,
    useLocation,
    useMatchRoute,
    useNavigate,
    useParams,
    useSearch,
} from '@tanstack/react-router'
import { App } from '@/App'
import { MemoryPage } from '@/routes/memory'
import { SessionChat } from '@/components/SessionChat'
import { SessionFeed, SessionList, formatRelativeTime, type NewSessionPreset } from '@/components/SessionList'
import { PinnedStoriesStrip } from '@/components/mobile/PinnedStoriesStrip'
import { MobilePageHeader, MobileTabBar } from '@/components/mobile/MobileTabBar'
import { ChevronRightIcon, FolderIcon, MoreHorizontalIcon, PlusCircleIcon, RecentIcon, SearchIcon, TagIcon } from '@/components/mobile/icons'
import { tagChipClass } from '@/components/ui/tagChip'
import { MobileSearchField } from '@/components/mobile/MobileSearchField'
import { GroupAvatar, Orb, PairAvatar } from '@/components/mobile/SessionAvatar'
import { DesktopPaneHeader } from '@/components/mobile/DesktopPaneHeader'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'
import { FitText } from '@/components/ui/FitText'
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
    loadPreferredYoloMode,
    pickRememberedConfig,
    rememberedAccountSelection
} from '@/components/NewSession/preferences'
import { accountsKey } from '@/components/ClaudeAccounts/Settings'
import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'
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
import { useTaskActions, useTasks } from '@/hooks/queries/useTasks'
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
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { FeedRow } from '@/components/ui/FeedRow'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'
import type { GroupDetail, SessionSummary, TaskStatus, TaskView } from '@/types/api'
import { Badge, DotBadge } from '@/components/ui/badge'
import { NewTaskForm } from '@/components/tasks/NewTaskForm'
import { TaskActionMenu } from '@/components/tasks/TaskActionMenu'
import { safeCopyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { ProgressOrb, type ReportTone } from '@/components/report'
import { filterSessionsBySearch } from '@/lib/session-search'
import { getUserTags, isSessionPinned, isSessionSnoozed } from '@/lib/session-pins'
import { useMinuteClock } from '@/hooks/useMinuteClock'
import { useSessionPin, useSessionSnooze } from '@/hooks/mutations/useSessionPin'
import { useArchiveSession } from '@/hooks/mutations/useArchiveSession'
import FilesPage from '@/routes/sessions/files'
import FilePage from '@/routes/sessions/file'
import { SessionDockLayout } from '@/components/SessionDockLayout'
import PreviewPage from '@/routes/sessions/preview'
import SettingsPage from '@/routes/settings'
import DebugDiffPage from '@/routes/debug/diff'
import GroupDetailPage from '@/routes/groups/detail'
import { GroupInfoPanelContext } from '@/routes/groups/group-info'
import ReviewLoopsIndexPage from '@/routes/review-loops/index'
import ReviewLoopDetailPage from '@/routes/review-loops/detail'
import ScheduledListPage from '@/routes/scheduled/index'
import ScheduledDetailPage from '@/routes/scheduled/detail'
import { useGroups } from '@/hooks/queries/useGroups'
import { useReviewLoops } from '@/hooks/queries/useReviewLoops'
import type { ReviewLoop } from '@/types/api'
import { ReviewLoopStatusBadge, CreateLoopModal, type CreateLoopData } from '@/components/ReviewLoop'

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
            className={`${tagChipClass(selected)} cursor-grab select-none active:cursor-grabbing ${isDragging ? 'z-10 opacity-70' : ''}`}
        >
            <FitText kind="label" lines={1} text={`#${tag}`} />
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
                className={`${props.listVisible ? 'flex' : 'hidden'} relative h-full shrink-0 flex-col border-r border-[var(--social-border)] bg-[var(--social-surface)]`}
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
            <main className="flex min-w-0 flex-1 flex-col bg-[var(--social-surface)]">
                <div className="min-h-0 flex-1">
                    {props.children}
                </div>
            </main>
        </div>
    )
}

/** Desktop detail pane with nothing selected. */
function DesktopEmptyState(props: { title: string; subtitle?: string; action?: { label: string; onClick: () => void } }) {
    return (
        <EmptyState
            variant="page"
            className="h-full py-0"
            illustration={<Orb seed="haqi" size={76} />}
            title={props.title}
            subtitle={props.subtitle}
            action={props.action}
        />
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
    const [sessionSearchOpen, setSessionSearchOpen] = useState(false)
    const [selectedSessionTag, setSelectedSessionTag] = useState<string | null>(null)
    const selectTagView = setSelectedSessionTag
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

    const sessionTags = useMemo(
        () => Array.from(new Set(sessions.flatMap((session) => getUserTags(session)))).sort((a, b) => a.localeCompare(b)),
        [sessions]
    )
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

    // Snoozed sessions fold into their own section until the wake time; search still finds them.
    // Pinned sessions live in the row at the top; the list below only repeats them in search results.
    const now = useMinuteClock()
    const pinnedSessions = useMemo(
        () => sessions.filter((session) => isSessionPinned(session) && !isSessionSnoozed(session, now)),
        [sessions, now]
    )
    const { visibleSessions, snoozedSessions } = useMemo(() => {
        const searched = filterSessionsBySearch(sessions, sessionSearchQuery)
        const tagged = selectedSessionTag
            ? searched.filter((session) => session.metadata?.tags?.includes(selectedSessionTag))
            : searched
        if (sessionSearchQuery) return { visibleSessions: tagged, snoozedSessions: [] }
        return {
            visibleSessions: tagged.filter((session) => !isSessionPinned(session) && !isSessionSnoozed(session, now)),
            snoozedSessions: tagged.filter((session) => isSessionSnoozed(session, now))
        }
    }, [sessions, sessionSearchQuery, selectedSessionTag, now])
    const pinSession = useSessionPin(api)
    const unpinSession = useCallback((session: SessionSummary) => {
        void pinSession(session, false).catch((pinError) => {
            addToast({
                title: t('session.pin.failed'),
                body: pinError instanceof Error ? pinError.message : '',
                sessionId: session.id,
                url: ''
            })
        })
    }, [addToast, pinSession, t])
    const snoozeSession = useSessionSnooze(api)
    const archiveSession = useArchiveSession(api)
    const archivePinnedSession = useCallback((session: SessionSummary) => archiveSession(session.id), [archiveSession])

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
            // Same starting point as the form: the settings picked last on any device.
            const sharedDefaults = await queryClient.fetchQuery({
                queryKey: queryKeys.newSessionDefaults,
                queryFn: () => api.getNewSessionDefaults(),
                staleTime: 0,
                retry: false
            }).then((response) => response.defaults).catch(() => null)
            const lastConfig = pickRememberedConfig(loadLastSessionConfig(), sharedDefaults)
            const quickCreateAgent = lastConfig?.agent ?? loadPreferredAgent()
            const quickModel = lastConfig?.model ?? loadPreferredModel(quickCreateAgent) ?? undefined
            const quickCustomModel = (lastConfig?.customModel ?? loadPreferredCustomModel(quickCreateAgent)).trim()
            const quickThinkEffort = lastConfig?.thinkEffort ?? loadPreferredThinkEffort(quickCreateAgent) ?? 'auto'
            const quickServiceTier = lastConfig?.serviceTier ?? loadPreferredServiceTier(quickCreateAgent) ?? 'auto'
            const quickYolo = lastConfig?.yoloMode ?? loadPreferredYoloMode()
            const quickPreviewUrl = lastConfig?.previewUrl ?? ''

            // Claude: the account picked last, like the form. A machine login that last failed to
            // authenticate would fail again, so let the form show it and offer the other accounts.
            let quickAccount: ClaudeAccountSelection | undefined
            if (quickCreateAgent === 'claude') {
                const machineId = preset.machineId
                const accounts = await queryClient.fetchQuery({
                    queryKey: accountsKey(machineId),
                    queryFn: () => api.getClaudeAccounts(machineId),
                    retry: false
                }).catch(() => null)
                quickAccount = rememberedAccountSelection(accounts?.pool, lastConfig?.claudeAccountId)
                if (!quickAccount && accounts?.machineLogin?.failedAt) {
                    openNewSession(preset)
                    return
                }
            }

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
                previewUrl: sessionSettings.previewUrl,
                ...(quickAccount ? { claudeAccount: quickAccount } : {})
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

    // Searching is occasional, so the field lives behind a header icon instead of taking a row all the time.
    const searchVisible = sessionSearchOpen || sessionSearchQuery.length > 0
    const toggleSessionSearch = () => {
        if (searchVisible) {
            setSessionSearchQuery('')
            setSessionSearchOpen(false)
        } else {
            setSessionSearchOpen(true)
        }
    }

    const listHeader = (
        <div className="pb-2">
            {searchVisible ? (
                <div className="px-5 pb-3 pt-1">
                    <MobileSearchField
                        value={sessionSearchQuery}
                        onChange={setSessionSearchQuery}
                        placeholder={t('sessions.search.placeholder')}
                        autoFocus
                        onBlur={() => {
                            // An emptied field folds away again; one holding a query stays.
                            if (!sessionSearchQuery) setSessionSearchOpen(false)
                        }}
                    />
                </div>
            ) : null}
            {sessionSearchQuery ? null : (
                <PinnedStoriesStrip
                    sessions={pinnedSessions}
                    onSelect={selectSession}
                    onNewSession={() => openNewSession()}
                    onUnpin={unpinSession}
                    onSnooze={snoozeSession}
                    onArchive={archivePinnedSession}
                />
            )}
            {sessionTags.length ? (
                <div className="flex flex-wrap gap-2 px-5 pb-1 pt-0.5">
                    <button
                        type="button"
                        onClick={() => selectTagView(null)}
                        className={`${tagChipClass(selectedSessionTag === null)} justify-center px-2.5`}
                        aria-label={t('sessions.tags.all')}
                        aria-pressed={selectedSessionTag === null}
                        title={t('sessions.tags.all')}
                    >
                        <TagIcon className="h-4 w-4" />
                    </button>
                    {isMobileLayout ? orderedSessionTags.map((tag) => (
                        <button
                            key={tag}
                            type="button"
                            onClick={() => selectTagView(tag)}
                            className={tagChipClass(selectedSessionTag === tag)}
                        >
                            <FitText kind="label" lines={1} text={`#${tag}`} />
                        </button>
                    )) : (
                        // Desktop keeps drag-to-reorder for tag filters.
                        <DndContext sensors={tagSensors} onDragEnd={handleTagDragEnd}>
                            <SortableContext items={orderedSessionTags} strategy={rectSortingStrategy}>
                                {orderedSessionTags.map((tag) => (
                                    <SortableSessionTag
                                        key={tag}
                                        tag={tag}
                                        selected={selectedSessionTag === tag}
                                        onSelect={() => selectTagView(tag)}
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
            snoozedSessions={snoozedSessions}
            availableTags={orderedSessionTags}
            selectedSessionId={selectedSessionId}
            onSelect={selectSession}
            api={api}
            listHeader={listHeader}
            empty={isLoading ? (
                <div className="px-6 py-16 text-center text-footnote text-[var(--social-fg-muted)]">{t('mobile.feed.loading')}</div>
            ) : (
                <EmptyState variant="page" title={t('mobile.feed.empty')} />
            )}
        />
    ) : (
        <SessionList
            sessions={visibleSessions}
            snoozedSessions={snoozedSessions}
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
            <IconButton className="text-[var(--social-fg)]" label={t('sessions.search.open')} onClick={toggleSessionSearch}>
                <SearchIcon className="h-[22px] w-[22px]" />
            </IconButton>
            <IconButton
                className="text-[var(--social-fg)]"
                label={mobileListMode === 'recent' ? t('mobile.list.switchToProjects') : t('mobile.list.switchToRecent')}
                onClick={toggleListMode}
            >
                {mobileListMode === 'recent'
                    ? <FolderIcon className="h-[22px] w-[22px]" />
                    : <RecentIcon className="h-[22px] w-[22px]" />}
            </IconButton>
            <IconButton className="text-[var(--social-fg)]" label={t('sessions.new')} onClick={() => openNewSession()}>
                <PlusCircleIcon className="h-[24px] w-[24px]" />
            </IconButton>
        </>
    )
    const listError = error ? (
        <div className="px-5 py-2 text-footnote text-[var(--social-danger)]">{error}</div>
    ) : null

    if (isMobileLayout) {
        return (
            <SessionsLayoutContext.Provider value={layoutContext}>
                {isSessionsIndex ? (
                    <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
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
                    <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
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
                const message = error instanceof Error ? error.message : t('session.resumeFailed')
                addToast({
                    title: t('session.resumeFailed'),
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
                    <div className="max-w-sm text-footnote text-[var(--social-fg-muted)]">
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
                <LoadingState label={t('loading.session')} className="text-footnote" />
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

    const isMobileLayout = useIsMobileLayout()
    const content = isChat ? <SessionPage /> : <Outlet />

    // Desktop: terminal / preview dock beside the chat instead of replacing it.
    return isMobileLayout ? content : <SessionDockLayout sessionId={sessionId}>{content}</SessionDockLayout>
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

    return (
        <div className="flex h-full min-h-0 flex-col">
            <SubPageHeader
                title={t('newSession.title')}
                onBack={isTelegramApp() ? undefined : goBack}
            />

            <div className="flex-1 min-h-0 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
                {machinesError ? (
                    <div className="p-3 text-footnote text-[var(--social-danger)]">
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

/** The second line of a task group's row: where the guide step is, else the task's tag and goal. */
function taskRowSubtitle(item: GroupDetail, task: TaskView | undefined, t: ReturnType<typeof useTranslation>['t']): string {
    if (item.group.status === 'guiding' && task) {
        if (task.guide.state === 'ready') return t('tasks.guideReady')
        if (task.guide.state === 'failed') return t('tasks.guideFailed')
        return t('tasks.guideWorking')
    }
    return [item.group.tag ? `#${item.group.tag}` : null, item.group.goal].filter(Boolean).join(' · ')
}

/**
 * Who a task's header says is working. The lead only plans: after the split it is stopped, so a running task names
 * the subtask sessions that work now, else its phase.
 */
function taskWorker(task: TaskView, anyoneThinking: boolean, t: ReturnType<typeof useTranslation>['t']): string {
    const run = task.run
    if (!run) return anyoneThinking ? t('taskRun.leadWorking') : t('tasks.status.guiding')
    if (run.phase === 'planning' && anyoneThinking) return t('taskRun.leadWorking')
    if (run.phase === 'delivering') return t('taskRun.phase.delivering')
    const working = run.subtasks.filter((s) => s.state === 'running')
    if (working.length === 1) return t('taskRun.subtaskWorking', { title: working[0]!.title })
    if (working.length > 1) return t('taskRun.subtasksWorking', { n: working.length })
    return t(`taskRun.phase.${run.phase}`)
}

/** A running task's ring: acceptance criteria met (after review) or subtasks done (before). */
function taskProgress(task: TaskView): number {
    const run = task.run!
    if (run.review) return task.acceptance.length ? run.review.results.filter((r) => r.status === 'met').length / task.acceptance.length : 0
    const subtasks = run.subtasks.filter((s) => !s.fix && s.id !== 'merge')
    return subtasks.length ? subtasks.filter((s) => s.state === 'done').length / subtasks.length : 0
}

function taskTone(task: TaskView): ReportTone {
    const run = task.run!
    if (run.phase === 'accepted') return 'done'
    if (run.decisions.some((d) => !d.answer) || run.phase === 'reporting') return 'wait'
    if (run.subtasks.some((s) => s.state === 'stuck' || s.state === 'stopped')) return 'stuck'
    return 'live'
}

const TASK_STATUS_BADGE: Record<TaskStatus, 'warning' | 'info' | 'default'> = { guiding: 'warning', active: 'info', done: 'default', abandoned: 'default' }

function GroupRow(props: {
    item: GroupDetail
    /** Set for a task group. */
    task?: TaskView
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
    const status = item.group.kind === 'task' ? item.group.status ?? null : null
    // "Active" is the normal state of a task: no badge.
    const badge = status && status !== 'active' ? status : null

    return (
        <FeedRow
            {...longPressHandlers}
            style={{ WebkitTouchCallout: 'none' }}
            aria-current={props.selected ? 'page' : undefined}
            avatar={props.task?.run && (props.task.status === 'active' || props.task.status === 'done') ? (
                <ProgressOrb seed={item.group.id} size={44} progress={taskProgress(props.task)} tone={taskTone(props.task)} />
            ) : (
                <GroupAvatar seed={item.group.id} members={members} size={44} />
            )}
            title={item.group.name}
            aside={(
                <>
                    {badge ? <Badge variant={TASK_STATUS_BADGE[badge]} className="shrink-0 self-center">{t(`tasks.status.${badge}`)}</Badge> : null}
                    <span>{formatRelativeTime(item.group.updatedAt, t)}</span>
                </>
            )}
            status={(
                <>
                    {hasLiveMember ? (
                        <span className="shrink-0 font-semibold text-[var(--social-fg)]">{t('mobile.feed.thinking')} ·</span>
                    ) : null}
                    {status && item.group.status === 'guiding' && props.task?.guide.state === 'ready' ? (
                        <DotBadge className="shrink-0" />
                    ) : null}
                </>
            )}
            subtitle={status && (item.group.status === 'guiding' || item.group.goal || item.group.tag)
                ? taskRowSubtitle(item, props.task, t)
                : `${t('mobile.groups.members', { n: item.members.length })}${item.group.description?.trim() ? ` · ${item.group.description}` : ''}`}
        />
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
    const [actionMenuOpen, setActionMenuOpen] = useState(false)
    const [actionAnchorPoint, setActionAnchorPoint] = useState({ x: 0, y: 0 })
    const [actionGroupId, setActionGroupId] = useState<string | null>(null)
    const [renameModalOpen, setRenameModalOpen] = useState(false)
    const [deleteModalOpen, setDeleteModalOpen] = useState(false)
    const [groupInfoOpen, setGroupInfoOpen] = useState(false)
    const [showArchived, setShowArchived] = useState(false)
    const groupInfoPanel = useMemo(() => ({ open: groupInfoOpen, setOpen: setGroupInfoOpen }), [groupInfoOpen])
    const { updateGroup, deleteGroup, isPending: isActionPending } = useGroupActions(api, actionGroupId)
    const { addToast } = useToast()
    const isMobileLayout = useIsMobileLayout()
    const { sessions: allSessions } = useSessions(api)
    const sessionsById = useMemo(() => new Map(allSessions.map((session) => [session.id, session])), [allSessions])
    const { tasks } = useTasks(api)
    const tasksById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
    const { createTask } = useTaskActions(api)

    const groupMatch = matchRoute({ to: '/groups/$groupId', fuzzy: true })
    const selectedGroupId = groupMatch ? groupMatch.groupId : null
    const isGroupsIndex = pathname === '/groups' || pathname === '/groups/'
    const showDesktopSidebar = isGroupsIndex || !desktopSidebarHidden
    const selectedGroup = selectedGroupId
        ? groups.find((item) => item.group.id === selectedGroupId) ?? null
        : null
    const matchingGroups = useMemo(
        () => filterGroupsBySearch(groups, groupSearchQuery),
        [groups, groupSearchQuery]
    )
    // Archived ones sit in a folded section at the end of the list.
    const visibleGroups = useMemo(() => matchingGroups.filter((item) => !item.group.archivedAt), [matchingGroups])
    const archivedGroups = useMemo(() => matchingGroups.filter((item) => item.group.archivedAt), [matchingGroups])
    const actionTarget = actionGroupId
        ? groups.find((item) => item.group.id === actionGroupId) ?? null
        : null

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

    const handleOpenGroupActions = (groupId: string, point: { x: number; y: number }) => {
        setActionGroupId(groupId)
        setActionAnchorPoint(point)
        setActionMenuOpen(true)
    }

    const handleOpenRename = () => {
        if (actionTarget) setRenameModalOpen(true)
    }

    // RenameSessionDialog closes on success and shows its own error when this throws.
    const handleRenameGroup = async (nextName: string) => {
        if (!actionTarget) return
        await updateGroup({ name: nextName })
    }

    const handleCopyGroupTitle = async () => {
        if (!actionTarget) return
        try {
            await safeCopyToClipboard(actionTarget.group.name)
            addToast({ title: t('groups.action.copied'), body: actionTarget.group.name, sessionId: '', url: '' })
        } catch {
            addToast({ title: t('groups.action.copyFailed'), body: '', sessionId: '', url: '' })
        }
    }

    const handleArchiveGroup = async (archived: boolean) => {
        if (!actionTarget) return
        try {
            await updateGroup({ archived })
        } catch (error) {
            addToast({ title: t('groups.action.archiveFailed'), body: error instanceof Error ? error.message : '', sessionId: '', url: '' })
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
            <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
                {/* Wide enough for the prompt box's toolbar: files, model, thinking, permission, drafting, mic. */}
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{t('tasks.new')}</DialogTitle>
                    </DialogHeader>
                    <div className="mt-4">
                        <NewTaskForm
                            api={api}
                            onCreate={async (input) => {
                                const task = await createTask(input)
                                setShowCreateModal(false)
                                navigate({ to: '/groups/$groupId', params: { groupId: task.id } })
                            }}
                        />
                    </div>
                </DialogContent>
            </Dialog>

            <TaskActionMenu
                isOpen={actionMenuOpen && Boolean(actionTarget)}
                onClose={() => setActionMenuOpen(false)}
                archived={Boolean(actionTarget?.group.archivedAt)}
                onRename={handleOpenRename}
                onCopyTitle={() => void handleCopyGroupTitle()}
                onArchive={(archived) => void handleArchiveGroup(archived)}
                onDelete={() => {
                    setRenameModalOpen(false)
                    setDeleteModalOpen(true)
                }}
                anchorPoint={actionAnchorPoint}
            />

            <RenameSessionDialog
                isOpen={renameModalOpen && Boolean(actionTarget)}
                onClose={() => setRenameModalOpen(false)}
                currentName={actionTarget?.group.name ?? ''}
                onRename={handleRenameGroup}
                isPending={isActionPending}
                title={t('groups.dialog.renameTitle')}
                placeholder={t('groups.dialog.name')}
            />

            <ConfirmDialog
                isOpen={deleteModalOpen && Boolean(actionTarget)}
                onClose={() => setDeleteModalOpen(false)}
                title={t('groups.dialog.deleteTitle')}
                description={t('groups.dialog.deleteDescription', { name: actionTarget?.group.name ?? '' })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
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
                <IconButton className="text-[var(--social-fg)]" label={t('mobile.groups.new')} onClick={() => setShowCreateModal(true)}>
                    <PlusCircleIcon className="h-[24px] w-[24px]" />
                </IconButton>
            )}
        />
    )
    const listBody = (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-5 pb-3 pt-1">
                <MobileSearchField
                    value={groupSearchQuery}
                    onChange={setGroupSearchQuery}
                    placeholder={t('groups.search.placeholder')}
                />
            </div>
            {isLoading ? (
                <div className="px-6 py-16 text-center text-footnote text-[var(--social-fg-muted)]">{t('mobile.feed.loading')}</div>
            ) : visibleGroups.length === 0 && archivedGroups.length === 0 ? (
                <EmptyState variant="page" title={t('mobile.groups.empty')} />
            ) : (
                <>
                    {visibleGroups.map((item) => (
                        <GroupRow
                            key={item.group.id}
                            item={item}
                            task={tasksById.get(item.group.id)}
                            members={membersOf(item)}
                            selected={selectedGroupId === item.group.id}
                            onSelect={openGroup}
                            onOpenActions={handleOpenGroupActions}
                        />
                    ))}
                    {archivedGroups.length > 0 ? (
                        <>
                            <button
                                type="button"
                                aria-expanded={showArchived || Boolean(groupSearchQuery.trim())}
                                onClick={() => setShowArchived((open) => !open)}
                                className="flex min-h-11 w-full items-center gap-1.5 px-5 pt-3 text-left text-footnote font-semibold text-[var(--social-fg-muted)]"
                            >
                                <ChevronRightIcon className={cn('h-3.5 w-3.5 transition-transform', showArchived || groupSearchQuery.trim() ? 'rotate-90' : '')} />
                                {t('groups.archived', { n: archivedGroups.length })}
                            </button>
                            {showArchived || groupSearchQuery.trim() ? archivedGroups.map((item) => (
                                <GroupRow
                                    key={item.group.id}
                                    item={item}
                                    task={tasksById.get(item.group.id)}
                                    members={membersOf(item)}
                                    selected={selectedGroupId === item.group.id}
                                    onSelect={openGroup}
                                    onOpenActions={handleOpenGroupActions}
                                />
                            )) : null}
                        </>
                    ) : null}
                </>
            )}
        </div>
    )
    // A task's header says who is working and when it last changed, like the lead report; a chat its members.
    const selectedTask = selectedGroup?.group.kind === 'task' ? tasksById.get(selectedGroup.group.id) : undefined
    const groupSubtitle = selectedGroup
        ? selectedTask && (selectedTask.status === 'guiding' || selectedTask.run)
            ? t('taskRun.header', {
                who: taskWorker(selectedTask, membersOf(selectedGroup).some((session) => session.thinking), t),
                time: formatRelativeTime(selectedTask.updatedAt, t) ?? ''
            })
            : t('groups.info.summary', {
                n: selectedGroup.members.length,
                m: membersOf(selectedGroup).filter((session) => session.active).length
            })
        : null
    const groupInfoLabel = t('groups.info.title')

    if (isMobileLayout) {
        if (isGroupsIndex) {
            return (
                <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
                    {listHeader}
                    {listBody}
                    <MobileTabBar active="groups" />
                    {groupModals}
                </div>
            )
        }

        return (
            <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
                <SubPageHeader
                    onBack={() => navigate({ to: '/groups' })}
                    avatar={selectedGroup ? <GroupAvatar seed={selectedGroup.group.id} members={membersOf(selectedGroup)} size={38} /> : null}
                    title={selectedGroup?.group.name ?? ''}
                    subtitle={groupSubtitle}
                    onTitleClick={() => setGroupInfoOpen(true)}
                    actions={(
                        <IconButton label={groupInfoLabel} onClick={() => setGroupInfoOpen(true)} className="text-[var(--social-fg)]">
                            <MoreHorizontalIcon className="h-6 w-6" />
                        </IconButton>
                    )}
                />
                <div className="min-h-0 flex-1">
                    <GroupInfoPanelContext.Provider value={groupInfoPanel}>
                        <Outlet />
                    </GroupInfoPanelContext.Provider>
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
                            title={selectedGroup?.group.name ?? ''}
                            subtitle={groupSubtitle}
                            listVisible={showDesktopSidebar}
                            onToggleList={toggleDesktopSidebar}
                            onTitleClick={() => setGroupInfoOpen(true)}
                            titleLabel={groupInfoLabel}
                            actions={(
                                <IconButton size="sm" label={groupInfoLabel} onClick={() => setGroupInfoOpen(true)}>
                                    <MoreHorizontalIcon className="h-[21px] w-[21px]" />
                                </IconButton>
                            )}
                        />
                        <div className="min-h-0 flex-1">
                            <GroupInfoPanelContext.Provider value={groupInfoPanel}>
                                <Outlet />
                            </GroupInfoPanelContext.Provider>
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

/**
 * Scheduled tasks. Phone: the list page, or one task's page. Desktop: the list column beside the selected task, like
 * the sessions page; with none selected the pane invites a pick or a new task.
 */
function ScheduledLayout() {
    const { t } = useTranslation()
    const matchRoute = useMatchRoute()
    const isMobileLayout = useIsMobileLayout()
    const [createOpen, setCreateOpen] = useState(false)
    const detailMatch = matchRoute({ to: '/scheduled/$scheduleId', fuzzy: true })
    const selectedId = detailMatch ? detailMatch.scheduleId : null

    if (isMobileLayout) {
        return selectedId ? <Outlet /> : <ScheduledListPage />
    }

    return (
        <DesktopSplitView
            listVisible
            list={<ScheduledListPage variant="panel" selectedId={selectedId} createOpen={createOpen} onCreateOpenChange={setCreateOpen} />}
        >
            {selectedId ? <Outlet /> : (
                <DesktopEmptyState
                    title={t('scheduled.desktop.pick')}
                    subtitle={t('scheduled.desktop.pickHint')}
                    action={{ label: t('scheduled.new'), onClick: () => setCreateOpen(true) }}
                />
            )}
        </DesktopSplitView>
    )
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
                <IconButton className="text-[var(--social-fg)]" label={t('mobile.loops.new')} onClick={() => setCreateModalOpen(true)}>
                    <PlusCircleIcon className="h-[24px] w-[24px]" />
                </IconButton>
            )}
        />
    )
    const listBody = (
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-5 pb-3 pt-1">
                <MobileSearchField
                    value={loopSearchQuery}
                    onChange={setLoopSearchQuery}
                    placeholder={t('mobile.loops.search')}
                />
            </div>
            {isLoading ? (
                <div className="px-6 py-16 text-center text-footnote text-[var(--social-fg-muted)]">{t('mobile.feed.loading')}</div>
            ) : visibleLoops.length === 0 ? (
                <EmptyState variant="page" title={t('mobile.loops.empty')} />
            ) : (
                visibleLoops.map((item) => (
                    <FeedRow
                        key={item.id}
                        onClick={() => navigate({ to: '/review-loops/$loopId', params: { loopId: item.id } })}
                        aria-current={selectedLoopId === item.id ? 'page' : undefined}
                        avatar={loopAvatar(item, 44)}
                        title={item.requirement}
                        aside={formatRelativeTime(item.updatedAt, t)}
                        status={<ReviewLoopStatusBadge status={item.status} />}
                        subtitle={t('mobile.loops.round', { n: item.currentRound, max: item.maxRounds })}
                    />
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
                <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
                    {listHeader}
                    {listBody}
                    <MobileTabBar active="settings" />
                    {createLoopModal}
                </div>
            )
        }

        return (
            <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
                <SubPageHeader
                    onBack={() => navigate({ to: '/review-loops' })}
                    avatar={selectedLoop ? loopAvatar(selectedLoop, 38) : null}
                    title={selectedLoop?.requirement ?? ''}
                    subtitle={loopSubtitle ?? undefined}
                />
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
                            title={selectedLoop?.requirement ?? ''}
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

// xterm (~420KB) is only needed on the terminal page.
const TerminalPage = lazyRouteComponent(() => import('@/routes/sessions/terminal'))

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

const memoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/memory',
    component: MemoryPage,
})

const scheduledRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/scheduled',
    component: ScheduledLayout,
})

const scheduledIndexRoute = createRoute({
    getParentRoute: () => scheduledRoute,
    path: '/',
    component: () => null,
})

const scheduledDetailRoute = createRoute({
    getParentRoute: () => scheduledRoute,
    path: '$scheduleId',
    component: ScheduledDetailPage,
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
    memoryRoute,
    scheduledRoute.addChildren([
        scheduledIndexRoute,
        scheduledDetailRoute,
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
