import {
    forwardRef,
    useRef,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
    type KeyboardEvent as ReactKeyboardEvent,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
    type TouchEvent as ReactTouchEvent
} from 'react'
import { useUnreadSessions } from '@/lib/unread-sessions'
import { DndContext, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Virtuoso } from 'react-virtuoso'
import type { SessionSummary, TaskView } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { cn } from '@/lib/utils'
import { FEED_ROW_CLASS } from '@/components/ui/ListRow'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { ProjectActionMenu } from '@/components/ProjectActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { SessionTagsDialog } from '@/components/SessionTagsDialog'
import { SessionTaskSheet } from '@/components/SessionTaskSheet'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { IconButton } from '@/components/ui/IconButton'
import { BulbIcon, DisclosureIcon, GripIcon, PlusIcon } from '@/components/mobile/icons'
import { useArchiveConfirmation } from '@/hooks/useArchiveConfirmation'
import { useProjectOfflineDirectories } from '@/hooks/useProjectOfflineDirectories'
import { useProjectQuickCreate } from '@/hooks/useProjectQuickCreate'
import { useSessionQuickArchive } from '@/hooks/useSessionQuickArchive'
import { SessionQuickArchiveButton } from '@/components/SessionQuickArchiveButton'
import {
    applySessionGroupOrder,
    loadSessionGroupOrder,
    moveSessionGroup,
    persistSessionGroupOrder,
    reconcileSessionGroupOrder
} from '@/components/sessionGroupOrder'
import {
    applySessionItemOrder,
    loadSessionItemOrder,
    moveSessionItem,
    persistSessionItemOrder
} from '@/components/sessionItemOrder'
import { getSessionTitle } from '@/lib/session-title'
import { useTranslation } from '@/lib/use-translation'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import { SessionAvatar, getProjectName, getSessionProjectPath } from '@/components/mobile/SessionAvatar'
import { getSnoozeUntil, getUserTags, isSessionPinned, isSessionSnoozed, withUserTags } from '@/lib/session-pins'
import { formatSnoozeStatus } from '@/lib/session-snooze'
import { SessionSnoozeDialog } from '@/components/SessionSnoozeDialog'
import { useSessionPin, useSessionSnooze, useSessionTaskLink } from '@/hooks/mutations/useSessionPin'
import { useTasks } from '@/hooks/queries/useTasks'
import { isTaskOpen, taskIdsOfSession } from '@/lib/tasks'

type SessionGroup = {
    directory: string
    displayName: string
    sessions: SessionSummary[]
    hasActiveSession: boolean
}

type SessionListRow =
    | {
        type: 'group'
        group: SessionGroup
        isProjectOffline: boolean
        isCollapsed: boolean
    }
    | {
        type: 'projects-offline-section'
        count: number
        isCollapsed: boolean
    }
    | {
        type: 'offline-section'
        group: SessionGroup
        offlineCount: number
        isCollapsed: boolean
    }
    | {
        type: 'snoozed-section'
        count: number
        isCollapsed: boolean
    }
    | {
        type: 'session'
        session: SessionSummary
        forceOffline: boolean
        snoozed?: boolean
    }

export type NewSessionPreset = {
    directory?: string
    machineId?: string
    tag?: string
}

function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

function groupSessionsByDirectory(sessions: SessionSummary[]): SessionGroup[] {
    const groups = new Map<string, SessionSummary[]>()

    sessions.forEach(session => {
        const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
        if (!groups.has(path)) {
            groups.set(path, [])
        }
        groups.get(path)!.push(session)
    })

    return Array.from(groups.entries())
        .map(([directory, groupSessions]) => {
            const sortedSessions = [...groupSessions].sort((a, b) => {
                if (a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
                return a.id.localeCompare(b.id)
            })
            const hasActiveSession = groupSessions.some(s => s.active)
            const displayName = getGroupDisplayName(directory)

            return { directory, displayName, sessions: sortedSessions, hasActiveSession }
        })
        .sort((a, b) => a.directory.localeCompare(b.directory))
}

function getGroupMachineId(group: SessionGroup): string | undefined {
    return group.sessions.find((session) => session.metadata?.machineId)?.metadata?.machineId
}

function pruneCollapseOverrides(
    overrides: Map<string, boolean>,
    knownGroups: Set<string>
): Map<string, boolean> {
    if (overrides.size === 0) return overrides
    const next = new Map(overrides)
    let changed = false
    for (const directory of next.keys()) {
        if (!knownGroups.has(directory)) {
            next.delete(directory)
            changed = true
        }
    }
    return changed ? next : overrides
}

function flattenSessionRows(
    groups: SessionGroup[],
    isGroupCollapsed: (group: SessionGroup) => boolean,
    isOfflineCollapsed: (directory: string) => boolean,
    isProjectForcedOffline: (group: SessionGroup) => boolean,
    areOfflineProjectsCollapsed: boolean
): SessionListRow[] {
    const rows: SessionListRow[] = []
    const activeGroups = groups.filter((group) => !isProjectForcedOffline(group))
    const offlineGroups = groups.filter((group) => isProjectForcedOffline(group))

    const appendGroupRows = (groupList: SessionGroup[], forcedOffline: boolean) => {
        for (const group of groupList) {
            const collapsed = isGroupCollapsed(group)
            rows.push({ type: 'group', group, isProjectOffline: forcedOffline, isCollapsed: collapsed })
            if (collapsed) continue

            const onlineSessions = forcedOffline ? [] : group.sessions.filter((session) => session.active)
            const offlineSessions = forcedOffline ? group.sessions : group.sessions.filter((session) => !session.active)

            for (const session of onlineSessions) {
                rows.push({
                    type: 'session',
                    session,
                    forceOffline: false
                })
            }

            if (offlineSessions.length === 0) {
                continue
            }

            // If this group has no online sessions, show offline sessions directly
            // instead of requiring an extra "OFFLINE" expand step.
            if (onlineSessions.length === 0) {
                for (const session of offlineSessions) {
                    rows.push({
                        type: 'session',
                        session,
                        forceOffline: forcedOffline
                    })
                }
                continue
            }

            const offlineCollapsed = isOfflineCollapsed(group.directory)
            rows.push({
                type: 'offline-section',
                group,
                offlineCount: offlineSessions.length,
                isCollapsed: offlineCollapsed
            })

            if (offlineCollapsed) {
                continue
            }

            for (const session of offlineSessions) {
                rows.push({
                    type: 'session',
                    session,
                    forceOffline: forcedOffline
                })
            }
        }
    }

    appendGroupRows(activeGroups, false)

    if (offlineGroups.length > 0) {
        rows.push({
            type: 'projects-offline-section',
            count: offlineGroups.length,
            isCollapsed: areOfflineProjectsCollapsed
        })

        if (!areOfflineProjectsCollapsed) {
            appendGroupRows(offlineGroups, true)
        }
    }

    return rows
}

type ListHeaderContext = { header?: ReactNode }

const SessionListScroller = forwardRef<HTMLDivElement, React.ComponentProps<'div'> & { context?: ListHeaderContext }>(
    function SessionListScroller(props, ref) {
        const { context: _context, ...rest } = props
        return (
            <div
                {...rest}
                ref={ref}
                className={props.className}
            />
        )
    }
)

function ListHeader(props: { context?: ListHeaderContext }) {
    return <>{props.context?.header ?? null}</>
}

function getTodoProgress(session: SessionSummary): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

function getAgentLabel(session: SessionSummary): string {
    const flavor = session.metadata?.flavor?.trim()
    if (flavor) return flavor
    return 'unknown'
}

/**
 * "刚刚" / "3 分钟前" / ... up to 6 days, then a short date in the app language ("10月14日", "Oct 14").
 * The app language comes from `<html lang>` (set by I18nProvider) unless `locale` is given.
 */
export function formatRelativeTime(
    value: number,
    t: (key: string, params?: Record<string, string | number>) => string,
    locale?: string
): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.daysAgo', { n: days })
    const date = new Date(ms)
    const lang = locale ?? (typeof document !== 'undefined' ? document.documentElement.lang : '')
    const sameYear = date.getFullYear() === new Date().getFullYear()
    return date.toLocaleDateString(lang || undefined, sameYear
        ? { month: 'short', day: 'numeric' }
        : { year: 'numeric', month: 'short', day: 'numeric' })
}

function shortModelName(model: string): string {
    return model.replace(/^.*claude-/, '')
}

/** Approval requests only matter while the agent is online; stale ones on dead sessions are noise. */
function getLivePendingCount(session: SessionSummary): number {
    return session.active ? session.pendingRequestsCount : 0
}

function FeedPreview(props: { session: SessionSummary; active: boolean; thinking: boolean }) {
    const { t } = useTranslation()
    const { session: s } = props
    const projectName = getProjectName(getSessionProjectPath(s))
    const model = s.metadata?.model?.trim() || s.modelMode || ''
    const progress = getTodoProgress(s)
    const meta = [
        projectName,
        model && model !== 'default' ? shortModelName(model) : null,
        ...getUserTags(s).map((tag) => `#${tag}`)
    ].filter(Boolean).join(' · ')

    return (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-footnote leading-snug text-[var(--social-fg-muted)]">
            {props.active && s.pendingRequestsCount > 0 ? (
                <span className="shrink-0 font-semibold text-[var(--social-badge)]">
                    {t('mobile.feed.pending', { n: s.pendingRequestsCount })} ·
                </span>
            ) : props.thinking ? (
                <span className="inline-flex shrink-0 items-center font-semibold text-[var(--social-fg)]">
                    {t('mobile.feed.thinking')}
                    <span className="typing-dots ml-0.5 inline-flex items-center" aria-hidden="true">
                        <span /><span /><span />
                    </span>
                </span>
            ) : null}
            <span className="min-w-0 truncate">{meta}</span>
            {progress ? (
                <span className="ml-auto shrink-0 pl-1 text-caption tabular-nums text-[var(--social-fg-subtle)]">
                    {progress.completed}/{progress.total}
                </span>
            ) : null}
        </div>
    )
}

function SessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    showPath?: boolean
    api: ApiClient | null
    availableTags?: string[]
    selected?: boolean
    density: SessionListDensity
    forceOffline?: boolean
    variant?: 'default' | 'feed'
    sortable?: boolean
}) {
    const { t, locale } = useTranslation()
    const { session: s, onSelect, showPath = true, api, availableTags = [], selected = false, density, forceOffline = false, variant = 'default', sortable = true } = props
    const isFeed = variant === 'feed'
    const unreadSessions = useUnreadSessions()
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [tagsOpen, setTagsOpen] = useState(false)
    const [tasksOpen, setTasksOpen] = useState(false)
    const [snoozeOpen, setSnoozeOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [isQuickArchiveVisible, setIsQuickArchiveVisible] = useState(false)
    const itemRef = useRef<HTMLDivElement | null>(null)
    const {
        attributes: dragAttributes,
        listeners: dragListeners,
        setNodeRef: setSortableNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id: s.id, disabled: !sortable })

    const {
        archiveSession,
        renameSession,
        setTags,
        deleteSession,
        spawnSameConfigSession,
        duplicateSession,
        isPending
    } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )
    const { skipArchiveConfirmation } = useArchiveConfirmation()
    const { sessionQuickArchiveEnabled } = useSessionQuickArchive()
    const pinSession = useSessionPin(api)
    const snoozeSession = useSessionSnooze(api)
    const linkTask = useSessionTaskLink(api)
    const { tasks } = useTasks(api)

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const sessionName = getSessionTitle(s)
    const pinned = isSessionPinned(s)
    const snoozeUntil = isSessionSnoozed(s) ? getSnoozeUntil(s) : null
    const snoozeStatus = snoozeUntil === null ? null : formatSnoozeStatus(snoozeUntil, Date.now(), locale, t)
    const updateSnooze = (until: number | null) => snoozeSession(s, until)
    const userTags = getUserTags(s)
    // Editing tags must not drop the pin or the snooze (both are stored as system tags).
    const saveUserTags = (tags: string[]) => setTags(withUserTags(s, tags))
    const taskIds = taskIdsOfSession(tasks, s.id)
    // Open tasks of the session's own tags first; a done task still shows while the session is in it.
    const menuTasks = tasks
        .filter((task) => isTaskOpen(task) || taskIds.includes(task.id))
        .sort((a, b) => Number(userTags.includes(b.tag)) - Number(userTags.includes(a.tag)))
    const effectiveActive = forceOffline ? false : s.active
    const effectiveThinking = forceOffline ? false : s.thinking
    const statusDotClass = effectiveActive
        ? (effectiveThinking ? 'bg-[var(--app-badge-info-text)]' : 'bg-[var(--app-badge-success-text)]')
        : 'bg-[var(--social-fg-muted)]'
    const isCompact = density === 'compact'

    const toggleTask = (task: TaskView, linked: boolean) => {
        void linkTask(s, task, linked).catch((error) => {
            console.error('Failed to update session task', error)
        })
    }

    const handleArchive = () => {
        if (!skipArchiveConfirmation) {
            setArchiveOpen(true)
            return
        }

        void archiveSession().catch((error) => {
            console.error('Failed to archive session', error)
        })
    }

    const handleSpawnSameConfig = () => {
        void spawnSameConfigSession()
            .then((newSessionId) => onSelect(newSessionId))
            .catch((error) => {
                console.error('Failed to create same-config session', error)
            })
    }

    const handleDuplicate = () => {
        void duplicateSession()
            .then((newSessionId) => onSelect(newSessionId))
            .catch((error) => {
                console.error('Failed to duplicate session', error)
            })
    }

    return (
        <>
            <div
                ref={(node) => {
                    itemRef.current = node
                    setSortableNodeRef(node)
                }}
                style={{ transform: CSS.Transform.toString(transform), transition }}
                className={`group/session-item relative ${isDragging ? 'z-10 bg-[var(--social-surface)] opacity-70' : ''}`}
                onMouseEnter={() => setIsQuickArchiveVisible(true)}
                onMouseLeave={() => setIsQuickArchiveVisible(false)}
                onFocusCapture={() => setIsQuickArchiveVisible(true)}
                onBlurCapture={(event) => {
                    const nextTarget = event.relatedTarget
                    if (nextTarget instanceof Node && itemRef.current?.contains(nextTarget)) {
                        return
                    }
                    setIsQuickArchiveVisible(false)
                }}
            >
                {isFeed ? (
                    <button
                        type="button"
                        {...longPressHandlers}
                        className={cn('session-list-item focus-visible:outline-none', FEED_ROW_CLASS, sortable && 'max-lg:pr-12', effectiveActive && s.pendingRequestsCount > 0 && 'bg-[var(--social-muted)]/60')}
                        style={{ WebkitTouchCallout: 'none' }}
                        aria-current={selected ? 'page' : undefined}
                    >
                        <SessionAvatar
                            session={s}
                            size={44}
                            ring={effectiveActive && s.pendingRequestsCount > 0 ? 'pending' : effectiveThinking ? 'live' : null}
                            muted={!effectiveActive}
                            badgeCount={effectiveActive ? s.pendingRequestsCount : 0}
                            unread={unreadSessions.has(s.id)}
                        />
                        <div className="flex min-w-0 flex-1 flex-col justify-center">
                            <div className="flex items-baseline gap-2">
                                <span className={`min-w-0 flex-1 truncate text-body leading-snug tracking-[-0.01em] ${effectiveActive ? 'font-semibold text-[var(--social-fg)]' : 'text-[var(--social-fg)]'}`}>
                                    {sessionName}
                                </span>
                                <span className="shrink-0 text-caption text-[var(--social-fg-subtle)]">
                                    {snoozeStatus ?? formatRelativeTime(s.updatedAt, t)}
                                </span>
                            </div>
                            <FeedPreview session={s} active={effectiveActive} thinking={effectiveThinking} />
                        </div>
                    </button>
                ) : (
                    <button
                        type="button"
                        {...longPressHandlers}
                        className={`session-list-item flex w-full flex-col text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--social-fg)] select-none ${isCompact ? 'gap-0.5 px-2.5 py-1.5' : 'gap-1.5 px-3 py-3'} ${selected ? 'bg-[var(--social-muted)]' : ''}`}
                        style={{ WebkitTouchCallout: 'none' }}
                        aria-current={selected ? 'page' : undefined}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                                    <span
                                        className={`h-2 w-2 rounded-full ${statusDotClass}`}
                                    />
                                </span>
                                <div className={`truncate font-semibold ${isCompact ? 'text-body' : 'text-base'}`}>
                                    {sessionName}
                                </div>
                            </div>
                            <div className={`flex items-center gap-2 shrink-0 text-xs`}>
                                {effectiveThinking ? (
                                    <span className="text-[var(--app-badge-info-text)] animate-pulse">
                                        {t('session.item.thinking')}
                                    </span>
                                ) : null}
                                {(() => {
                                    const progress = getTodoProgress(s)
                                    if (!progress) return null
                                    return (
                                        <span className="flex items-center gap-1 text-[var(--social-fg-muted)]">
                                            <BulbIcon className="h-3 w-3" />
                                            {progress.completed}/{progress.total}
                                        </span>
                                    )
                                })()}
                                {s.pendingRequestsCount > 0 ? (
                                    <span className="text-[var(--app-badge-warning-text)]">
                                        {t('session.item.pending')} {s.pendingRequestsCount}
                                    </span>
                                ) : null}
                                <span
                                    className={`text-[var(--social-fg-muted)] transition-opacity ${sessionQuickArchiveEnabled && isQuickArchiveVisible ? 'opacity-0 pointer-events-none' : ''}`}
                                >
                                    {formatRelativeTime(s.updatedAt, t)}
                                </span>
                            </div>
                        </div>
                        {showPath ? (
                            <div className="truncate text-xs text-[var(--social-fg-muted)]">
                                {s.metadata?.path ?? s.id}
                            </div>
                        ) : null}
                        {userTags.length ? (
                            <div className="flex flex-wrap gap-1">
                                {userTags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="rounded-full bg-[var(--social-muted)] px-2 py-0.5 text-caption text-[var(--social-fg-muted)]"
                                    >
                                        #{tag}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {!isCompact ? (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--social-fg-muted)]">
                                <span className="inline-flex items-center gap-2">
                                    <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                                        ❖
                                    </span>
                                    {getAgentLabel(s)}
                                </span>
                                <span>{t('session.item.model')}: {s.metadata?.model?.trim() || s.modelMode || 'default'}</span>
                                {s.metadata?.worktree?.branch ? (
                                    <span>{t('session.item.worktree')}: {s.metadata.worktree.branch}</span>
                                ) : null}
                            </div>
                        ) : null}
                    </button>
                )}

                {sortable ? (
                    <button
                        type="button"
                        {...dragAttributes}
                        {...dragListeners}
                        className={cn(
                            'absolute inset-y-0 flex touch-none select-none items-center justify-center text-[var(--social-fg-subtle)] transition-opacity active:cursor-grabbing',
                            isFeed
                                // Phones: a 44px grip on the right (the row's long-press is the menu). Desktop: thin left strip.
                                ? 'right-0 w-11 opacity-60 lg:left-0 lg:right-auto lg:w-3 lg:cursor-grab lg:opacity-0 lg:hover:opacity-100 lg:focus-visible:opacity-100'
                                : 'left-0 w-3 cursor-grab opacity-0 hover:opacity-100 focus-visible:opacity-100 max-md:opacity-40'
                        )}
                        title={t('sessions.reorder')}
                        aria-label={t('sessions.reorder')}
                    >
                        <GripIcon className={isFeed ? 'h-4 w-4 lg:h-3 lg:w-3' : 'h-3 w-3'} />
                    </button>
                ) : null}

                {isFeed ? null : (
                    <SessionQuickArchiveButton
                        enabled={sessionQuickArchiveEnabled}
                        visible={isQuickArchiveVisible}
                        isPending={isPending}
                        compact={isCompact}
                        onArchive={async () => {
                            await archiveSession()
                        }}
                    />
                )}
            </div>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
            sessionActive={s.active}
            pinned={pinned}
            onTogglePin={() => {
                void pinSession(s, !pinned).catch((error) => {
                    console.error('Failed to update session pin', error)
                })
            }}
            onSnooze={(until) => {
                void updateSnooze(until).catch((error) => {
                    console.error('Failed to snooze session', error)
                })
            }}
            onSnoozeCustom={() => setSnoozeOpen(true)}
            onUnsnooze={snoozeStatus === null ? undefined : () => {
                void updateSnooze(null).catch((error) => {
                    console.error('Failed to wake session', error)
                })
            }}
            snoozeStatus={snoozeStatus ?? undefined}
            onRename={() => setRenameOpen(true)}
            onTags={() => setTagsOpen(true)}
            tags={userTags}
            availableTags={availableTags}
            onTagsChange={saveUserTags}
            tagsPending={isPending}
            tasks={menuTasks}
            taskIds={taskIds}
            onTaskToggle={toggleTask}
            onTasks={() => setTasksOpen(true)}
            onSpawnSameConfig={handleSpawnSameConfig}
                onDuplicate={handleDuplicate}
                onArchive={handleArchive}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={sessionName}
                onRename={renameSession}
                isPending={isPending}
            />

            <SessionSnoozeDialog
                isOpen={snoozeOpen}
                onClose={() => setSnoozeOpen(false)}
                onSnooze={updateSnooze}
            />

            <SessionTaskSheet
                open={tasksOpen}
                onOpenChange={setTasksOpen}
                tasks={menuTasks}
                taskIds={taskIds}
                onToggle={toggleTask}
            />

            <SessionTagsDialog
                isOpen={tagsOpen}
                onClose={() => setTagsOpen(false)}
                tags={userTags}
                availableTags={availableTags}
                onSave={saveUserTags}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t(pinned ? 'dialog.archive.descriptionPinned' : 'dialog.archive.description', { name: sessionName })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={archiveSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: sessionName })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={deleteSession}
                isPending={isPending}
                destructive
            />
        </>
    )
}

function SessionGroupRow(props: {
    group: SessionGroup
    isProjectOffline: boolean
    isCollapsed: boolean
    density: SessionListDensity
    /** Mobile section-header look (small caption) instead of the desktop row. */
    minimal?: boolean
    onToggleGroup: (directory: string, isCollapsed: boolean) => void
    onToggleProjectOffline: (directory: string, isOffline: boolean) => void
    onCreateInGroup: (preset?: NewSessionPreset) => void
    onQuickCreateInGroup?: (preset?: NewSessionPreset) => void
    quickCreateInProjectEnabled: boolean
}) {
    const { t } = useTranslation()
    const {
        group,
        isProjectOffline,
        isCollapsed,
        density,
        onToggleGroup,
        onToggleProjectOffline,
        onCreateInGroup,
        onQuickCreateInGroup,
        quickCreateInProjectEnabled
    } = props
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const { setNodeRef, transform, transition, isDragging, isOver, listeners } = useSortable({
        id: group.directory
    })

    const dragStyle = {
        transform: CSS.Transform.toString(transform),
        transition
    }
    const isDropTarget = isOver && !isDragging
    const minimal = props.minimal === true
    const canQuickCreate = quickCreateInProjectEnabled && Boolean(onQuickCreateInGroup)
    const createPreset: NewSessionPreset = {
        directory: group.directory,
        machineId: getGroupMachineId(group)
    }
    const openDetailedCreate = () => {
        onCreateInGroup(createPreset)
    }
    const plusButtonLongPressHandlers = useLongPress({
        onLongPress: () => {
            openDetailedCreate()
        },
        onClick: () => {
            if (canQuickCreate) {
                onQuickCreateInGroup?.(createPreset)
                return
            }
            openDetailedCreate()
        },
        threshold: 500,
        disabled: !canQuickCreate
    })
    const plusButtonHandlers = canQuickCreate
        ? {
            onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                plusButtonLongPressHandlers.onMouseDown(event)
            },
            onMouseUp: (event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                plusButtonLongPressHandlers.onMouseUp(event)
            },
            onMouseLeave: (event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                plusButtonLongPressHandlers.onMouseLeave(event)
            },
            onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                plusButtonLongPressHandlers.onTouchStart(event)
            },
            onTouchEnd: (event: ReactTouchEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                plusButtonLongPressHandlers.onTouchEnd(event)
            },
            onTouchMove: (event: ReactTouchEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                plusButtonLongPressHandlers.onTouchMove(event)
            },
            onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                plusButtonLongPressHandlers.onContextMenu(event)
            },
            onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                plusButtonLongPressHandlers.onKeyDown(event)
            },
            onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
                event.stopPropagation()
            }
        }
        : {
            onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation()
            },
            onTouchStart: (event: ReactTouchEvent<HTMLButtonElement>) => {
                event.stopPropagation()
            },
            onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
                event.stopPropagation()
            },
            onClick: (event: ReactMouseEvent<HTMLButtonElement>) => {
                event.stopPropagation()
                openDetailedCreate()
            }
        }

    return (
        <div
            ref={setNodeRef}
            style={dragStyle}
            className={`z-10 flex w-full items-center gap-1 cursor-grab active:cursor-grabbing select-none ${minimal ? 'px-4 pb-1 pt-4' : `border-b border-[var(--social-divider)] ${density === 'compact' ? 'px-2.5 py-1.5' : 'px-3 py-2'}`} ${isDropTarget ? 'bg-[var(--social-muted)]' : 'bg-[var(--social-surface)]'} ${isDragging ? 'opacity-70' : ''}`}
            onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setMenuAnchorPoint({ x: event.clientX, y: event.clientY })
                setMenuOpen(true)
            }}
            {...listeners}
        >
            <button
                type="button"
                onClick={() => onToggleGroup(group.directory, isCollapsed)}
                className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1 py-1 text-left transition-colors hover:bg-[var(--social-muted)] ${minimal ? 'min-h-11' : ''}`}
            >
                <DisclosureIcon
                    className={minimal ? 'h-3.5 w-3.5 text-[var(--social-fg-subtle)]' : 'h-4 w-4 text-[var(--social-fg-muted)]'}
                    open={!isCollapsed}
                />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                        className={minimal
                            ? 'truncate text-footnote font-semibold tracking-[-0.01em] text-[var(--social-fg)]'
                            : `font-semibold break-words ${density === 'compact' ? 'text-body' : 'text-base'}`}
                        title={group.directory}
                    >
                        {group.displayName}
                    </span>
                    {isProjectOffline ? (
                        <span className="shrink-0 rounded-md bg-[var(--social-hover)] px-1.5 py-0.5 text-caption uppercase tracking-wide text-[var(--social-fg-muted)]">
                            {t('misc.offline')}
                        </span>
                    ) : null}
                    <span className="shrink-0 text-xs text-[var(--social-fg-muted)]">
                        ({group.sessions.length})
                    </span>
                </div>
            </button>
            {group.directory !== 'Other' ? (
                <IconButton
                    {...plusButtonHandlers}
                    size={minimal ? 'default' : 'sm'}
                    label={t('sessions.newInProject')}
                    className={minimal ? '-my-2' : 'text-[var(--social-fg)]'}
                >
                    <PlusIcon className="h-4 w-4" />
                </IconButton>
            ) : null}
            <ProjectActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                anchorPoint={menuAnchorPoint}
                isProjectOffline={isProjectOffline}
                canCreateInProject={group.directory !== 'Other'}
                onToggleProjectOffline={() => onToggleProjectOffline(group.directory, isProjectOffline)}
                onCreateInProject={() => onCreateInGroup({
                    directory: group.directory,
                    machineId: getGroupMachineId(group)
                })}
            />
        </div>
    )
}

function OfflineSectionRow(props: {
    directory: string
    count: number
    isCollapsed: boolean
    density: SessionListDensity
    label?: string
    minimal?: boolean
    onToggleGroup: (directory: string, isCollapsed: boolean) => void
}) {
    const { t } = useTranslation()
    const { directory, count, isCollapsed, density, label, onToggleGroup } = props

    return (
        <button
            type="button"
            onClick={() => onToggleGroup(directory, isCollapsed)}
            aria-expanded={!isCollapsed}
            className={`flex w-full items-center gap-2 text-left text-xs text-[var(--social-fg-muted)] transition-colors hover:text-[var(--social-fg)] ${props.minimal ? 'min-h-11 px-5 py-2' : `border-b border-[var(--social-divider)] ${density === 'compact' ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}`}
        >
            <DisclosureIcon
                className="h-3.5 w-3.5 text-[var(--social-fg-muted)]"
                open={!isCollapsed}
            />
            <span className="uppercase tracking-wide">{label ?? t('misc.offline')}</span>
            <span className="text-[var(--social-fg-muted)]">
                ({count})
            </span>
        </button>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    /** Snoozed sessions, kept out of the groups and folded into one section above the offline projects. */
    snoozedSessions?: SessionSummary[]
    availableTags?: string[]
    onSelect: (sessionId: string) => void
    onNewSession: (preset?: NewSessionPreset) => void
    onQuickCreateInProject?: (preset?: NewSessionPreset) => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
    api: ApiClient | null
    selectedSessionId?: string | null
    density?: SessionListDensity
    /** Content rendered above the rows that scrolls with the list (mobile search/stories). */
    listHeader?: ReactNode
    itemVariant?: 'default' | 'feed'
}) {
    const { t } = useTranslation()
    const { renderHeader = true, api, selectedSessionId, density = 'comfortable', availableTags = [] } = props
    const listHeaderContext = useMemo<ListHeaderContext>(() => ({ header: props.listHeader }), [props.listHeader])
    const { projectQuickCreateEnabled } = useProjectQuickCreate()
    const baseGroups = useMemo(
        () => groupSessionsByDirectory(props.sessions),
        [props.sessions]
    )
    const baseDirectories = useMemo(
        () => baseGroups.map((group) => group.directory),
        [baseGroups]
    )
    const [groupOrder, setGroupOrder] = useState<string[]>(() => loadSessionGroupOrder())
    const {
        projectOfflineDirectories,
        setProjectOfflineDirectories
    } = useProjectOfflineDirectories(api)
    const [collapseOverrides, setCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const [offlineCollapseOverrides, setOfflineCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )
    const [isOfflineProjectsCollapsed, setIsOfflineProjectsCollapsed] = useState(true)
    const snoozedSessions = useSnoozedSessions(props.snoozedSessions)
    const [isSnoozedCollapsed, setIsSnoozedCollapsed] = useSnoozedCollapsed(snoozedSessions, selectedSessionId)
    const [sessionItemOrder, setSessionItemOrder] = useState<string[]>(() => loadSessionItemOrder())
    const groups = useMemo(
        () => applySessionGroupOrder(baseGroups, groupOrder).map((group) => ({
            ...group,
            sessions: applySessionItemOrder(group.sessions, sessionItemOrder)
        })),
        [baseGroups, groupOrder, sessionItemOrder]
    )
    const sortableGroupDirectories = useMemo(
        () => groups.map((group) => group.directory),
        [groups]
    )
    const sensors = useSensors(
        useSensor(MouseSensor, {
            activationConstraint: {
                distance: 4
            }
        }),
        useSensor(TouchSensor, {
            activationConstraint: {
                delay: 220,
                tolerance: 8
            }
        })
    )

    useEffect(() => {
        setGroupOrder((prev) => {
            const next = reconcileSessionGroupOrder(prev, baseDirectories)
            if (prev.length === next.length && prev.every((value, index) => value === next[index])) {
                return prev
            }
            return next
        })
    }, [baseDirectories])

    useEffect(() => {
        persistSessionGroupOrder(groupOrder)
    }, [groupOrder])

    useEffect(() => {
        persistSessionItemOrder(sessionItemOrder)
    }, [sessionItemOrder])

    const isProjectForcedOffline = (directory: string): boolean => projectOfflineDirectories.has(directory)
    const isProjectForcedOfflineGroup = (group: SessionGroup): boolean => isProjectForcedOffline(group.directory)

    const isGroupCollapsed = (group: SessionGroup): boolean => {
        const override = collapseOverrides.get(group.directory)
        if (override !== undefined) return override
        return isProjectForcedOfflineGroup(group) || !group.hasActiveSession
    }
    const isOfflineCollapsed = (directory: string): boolean => {
        const override = offlineCollapseOverrides.get(directory)
        if (override !== undefined) return override
        return true
    }

    const toggleGroup = (directory: string, isCollapsed: boolean) => {
        setCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(directory, !isCollapsed)
            return next
        })
    }
    const toggleOfflineGroup = (directory: string, isCollapsed: boolean) => {
        setOfflineCollapseOverrides((prev) => {
            const next = new Map(prev)
            next.set(directory, !isCollapsed)
            return next
        })
    }
    const toggleProjectOffline = (directory: string, isOffline: boolean) => {
        if (!isOffline) {
            setIsOfflineProjectsCollapsed(false)
        }
        setProjectOfflineDirectories((prev) => {
            const next = new Set(prev)
            if (isOffline) {
                next.delete(directory)
            } else {
                next.add(directory)
            }
            return next
        })
    }
    const toggleOfflineProjectsSection = (_directory: string, isCollapsed: boolean) => {
        setIsOfflineProjectsCollapsed(!isCollapsed)
    }

    useEffect(() => {
        const knownGroups = new Set(groups.map(group => group.directory))
        setCollapseOverrides((prev) => pruneCollapseOverrides(prev, knownGroups))
        setOfflineCollapseOverrides((prev) => pruneCollapseOverrides(prev, knownGroups))
    }, [groups])

    const handleGroupDragEnd = ({ active, over }: DragEndEvent) => {
        if (!over || active.id === over.id) return
        const sourceId = String(active.id)
        const targetId = String(over.id)
        const sourceGroup = groups.find((group) => group.sessions.some((session) => session.id === sourceId))
        if (sourceGroup) {
            // Session drag: only reorder within the same group and the same online/offline half.
            const source = sourceGroup.sessions.find((session) => session.id === sourceId)
            const target = sourceGroup.sessions.find((session) => session.id === targetId)
            if (!source || !target || source.active !== target.active) return
            const groupIds = sourceGroup.sessions.map((session) => session.id)
            setSessionItemOrder((prev) => moveSessionItem(prev, groupIds, sourceId, targetId))
            return
        }
        const sourceDirectory = sourceId
        const targetDirectory = targetId
        setGroupOrder((prev) => {
            const reconciled = reconcileSessionGroupOrder(prev, baseDirectories)
            return moveSessionGroup(reconciled, sourceDirectory, targetDirectory)
        })
    }

    const rows = useMemo(
        () => {
            const groupRows = flattenSessionRows(
                groups,
                isGroupCollapsed,
                isOfflineCollapsed,
                isProjectForcedOfflineGroup,
                isOfflineProjectsCollapsed
            )
            if (snoozedSessions.length === 0) return groupRows
            const snoozedRows: SessionListRow[] = [
                { type: 'snoozed-section', count: snoozedSessions.length, isCollapsed: isSnoozedCollapsed },
                ...(isSnoozedCollapsed ? [] : snoozedSessions.map((session): SessionListRow => ({
                    type: 'session',
                    session,
                    forceOffline: false,
                    snoozed: true
                })))
            ]
            // Snoozed work comes back tomorrow, so it sits above the offline projects.
            const offlineIndex = groupRows.findIndex((row) => row.type === 'projects-offline-section')
            return offlineIndex === -1
                ? [...groupRows, ...snoozedRows]
                : [...groupRows.slice(0, offlineIndex), ...snoozedRows, ...groupRows.slice(offlineIndex)]
        },
        [groups, collapseOverrides, offlineCollapseOverrides, projectOfflineDirectories, isOfflineProjectsCollapsed, snoozedSessions, isSnoozedCollapsed]
    )

    const sortableSessionIds = useMemo(
        () => rows.flatMap((row) => row.type === 'session' && !row.snoozed ? [row.session.id] : []),
        [rows]
    )

    return (
        <div className="mx-auto flex h-full w-full max-w-content min-h-0 flex-col">
            {renderHeader ? (
                <div className="flex items-center justify-between px-3 py-1">
                    <div className="text-xs text-[var(--social-fg-muted)]">
                        {t('sessions.count', { n: props.sessions.length, m: groups.length })}
                    </div>
                    <IconButton
                        size="sm"
                        label={t('sessions.new')}
                        onClick={() => props.onNewSession()}
                        className="session-list-new-button text-[var(--social-fg)]"
                    >
                        <PlusIcon className="h-5 w-5" />
                    </IconButton>
                </div>
            ) : null}

            <div className="flex-1 min-h-0">
                <DndContext
                    sensors={sensors}
                    onDragEnd={handleGroupDragEnd}
                >
                    <SortableContext
                        items={sortableGroupDirectories}
                        strategy={verticalListSortingStrategy}
                    >
                        <SortableContext
                            items={sortableSessionIds}
                            strategy={verticalListSortingStrategy}
                        >
                        <Virtuoso
                            data={rows}
                            style={{ height: '100%' }}
                            defaultItemHeight={density === 'compact' ? 64 : 108}
                            increaseViewportBy={360}
                            initialItemCount={Math.min(rows.length, 24)}
                            context={listHeaderContext}
                            components={{
                                Scroller: SessionListScroller,
                                Header: ListHeader
                            }}
                            computeItemKey={(_, row) => (
                                row.type === 'group'
                                    ? `group:${row.group.directory}`
                                    : row.type === 'projects-offline-section'
                                        ? 'projects-offline'
                                    : row.type === 'offline-section'
                                        ? `offline:${row.group.directory}`
                                    : row.type === 'snoozed-section'
                                        ? 'snoozed'
                                    : `session:${row.session.id}`
                            )}
                            itemContent={(_, row) => {
                                if (row.type === 'group') {
                                    return (
                                        <SessionGroupRow
                                            group={row.group}
                                            isProjectOffline={row.isProjectOffline}
                                            isCollapsed={row.isCollapsed}
                                            density={density}
                                            minimal={props.itemVariant === 'feed'}
                                            quickCreateInProjectEnabled={projectQuickCreateEnabled}
                                            onToggleGroup={toggleGroup}
                                            onToggleProjectOffline={toggleProjectOffline}
                                            onQuickCreateInGroup={props.onQuickCreateInProject}
                                            onCreateInGroup={(preset) => {
                                                if (row.isProjectOffline) {
                                                    setProjectOfflineDirectories((prev) => {
                                                        if (!prev.has(row.group.directory)) return prev
                                                        const next = new Set(prev)
                                                        next.delete(row.group.directory)
                                                        return next
                                                    })
                                                    setIsOfflineProjectsCollapsed(false)
                                                }
                                                props.onNewSession(preset)
                                            }}
                                        />
                                    )
                                }

                                if (row.type === 'projects-offline-section') {
                                    return (
                                        <OfflineSectionRow
                                            directory="__projects_offline__"
                                            count={row.count}
                                            isCollapsed={row.isCollapsed}
                                            density={density}
                                            minimal={props.itemVariant === 'feed'}
                                            label={t('sessions.projectOffline.section')}
                                            onToggleGroup={toggleOfflineProjectsSection}
                                        />
                                    )
                                }

                                if (row.type === 'offline-section') {
                                    return (
                                        <OfflineSectionRow
                                            directory={row.group.directory}
                                            count={row.offlineCount}
                                            isCollapsed={row.isCollapsed}
                                            density={density}
                                            minimal={props.itemVariant === 'feed'}
                                            onToggleGroup={toggleOfflineGroup}
                                        />
                                    )
                                }

                                if (row.type === 'snoozed-section') {
                                    return (
                                        <OfflineSectionRow
                                            directory="__snoozed__"
                                            count={row.count}
                                            isCollapsed={row.isCollapsed}
                                            density={density}
                                            minimal={props.itemVariant === 'feed'}
                                            label={t('sessions.snoozed.section')}
                                            onToggleGroup={(_directory, isCollapsed) => setIsSnoozedCollapsed(!isCollapsed)}
                                        />
                                    )
                                }

                                return (
                                    <div className={props.itemVariant === 'feed' ? '' : 'border-b border-[var(--social-divider)]'}>
                                        <SessionItem
                                            session={row.session}
                                            onSelect={props.onSelect}
                                            showPath={false}
                                            api={api}
                                            availableTags={availableTags}
                                            selected={row.session.id === selectedSessionId}
                                            density={density}
                                            forceOffline={row.forceOffline}
                                            variant={props.itemVariant}
                                            sortable={!row.snoozed}
                                        />
                                    </div>
                                )
                            }}
                        />
                        </SortableContext>
                    </SortableContext>
                </DndContext>
            </div>
        </div>
    )
}

type FeedRow = { type: 'session'; session: SessionSummary } | { type: 'offline-section' } | { type: 'snoozed-section' }

function sortByRecency(sessions: SessionSummary[]): SessionSummary[] {
    return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

function useSnoozedSessions(sessions: SessionSummary[] | undefined): SessionSummary[] {
    return useMemo(() => sortByRecency(sessions ?? []), [sessions])
}

/** The snoozed section starts folded; a selected snoozed session keeps it open so the row stays visible. */
function useSnoozedCollapsed(
    snoozedSessions: SessionSummary[],
    selectedSessionId: string | null | undefined
): [boolean, (collapsed: boolean) => void] {
    const [collapsed, setCollapsed] = useState(true)
    const selectedIsSnoozed = snoozedSessions.some((session) => session.id === selectedSessionId)
    useEffect(() => {
        if (selectedIsSnoozed) setCollapsed(false)
    }, [selectedIsSnoozed])
    return [collapsed, setCollapsed]
}

/**
 * Mobile chat-app style list: one flat, recency-sorted feed (like WeChat "Chats").
 * Sessions waiting for approval are pinned on top.
 */
export function SessionFeed(props: {
    sessions: SessionSummary[]
    /** Snoozed sessions, folded into one section between the running and the offline ones. */
    snoozedSessions?: SessionSummary[]
    availableTags?: string[]
    selectedSessionId?: string | null
    onSelect: (sessionId: string) => void
    api: ApiClient | null
    listHeader?: ReactNode
    /** Shown when the list has no rows (loading line or empty state). */
    empty?: ReactNode
}) {
    const { t } = useTranslation()
    const { api, availableTags = [] } = props
    const [offlineCollapsed, setOfflineCollapsed] = useState(true)
    const snoozedSessions = useSnoozedSessions(props.snoozedSessions)
    const [snoozedCollapsed, setSnoozedCollapsed] = useSnoozedCollapsed(snoozedSessions, props.selectedSessionId)
    const byRecency = (a: SessionSummary, b: SessionSummary) => {
        if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
        return a.id.localeCompare(b.id)
    }
    // Running sessions first (waiting-for-approval on top); offline ones fold into a section below.
    const { activeSessions, offlineSessions } = useMemo(() => ({
        activeSessions: props.sessions.filter((session) => session.active).sort((a, b) => {
            const aPinned = getLivePendingCount(a) > 0 ? 1 : 0
            const bPinned = getLivePendingCount(b) > 0 ? 1 : 0
            if (aPinned !== bPinned) return bPinned - aPinned
            return byRecency(a, b)
        }),
        offlineSessions: props.sessions.filter((session) => !session.active).sort(byRecency)
    }), [props.sessions])
    // A selected offline session keeps its section open so the row stays visible.
    const selectedIsOffline = offlineSessions.some((session) => session.id === props.selectedSessionId)
    useEffect(() => {
        if (selectedIsOffline) setOfflineCollapsed(false)
    }, [selectedIsOffline])
    // Snoozed work comes back tomorrow, so it sits between the running and the offline sessions.
    const rows = useMemo<FeedRow[]>(() => [
        ...activeSessions.map((session): FeedRow => ({ type: 'session', session })),
        ...(snoozedSessions.length > 0 ? [{ type: 'snoozed-section' } as const] : []),
        ...(snoozedCollapsed ? [] : snoozedSessions.map((session): FeedRow => ({ type: 'session', session }))),
        ...(offlineSessions.length > 0 ? [{ type: 'offline-section' } as const] : []),
        ...(offlineCollapsed ? [] : offlineSessions.map((session): FeedRow => ({ type: 'session', session })))
    ], [activeSessions, offlineSessions, offlineCollapsed, snoozedSessions, snoozedCollapsed])
    const listHeaderContext = useMemo<ListHeaderContext>(() => ({ header: props.listHeader }), [props.listHeader])

    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            <Virtuoso
                data={rows}
                style={{ height: '100%' }}
                defaultItemHeight={68}
                increaseViewportBy={480}
                initialItemCount={Math.min(rows.length, 20)}
                context={listHeaderContext}
                components={{
                    Scroller: SessionListScroller,
                    Header: ListHeader,
                    EmptyPlaceholder: () => <>{props.empty}</>
                }}
                computeItemKey={(_, row) => row.type === 'session' ? row.session.id : row.type === 'snoozed-section' ? '__snoozed__' : '__offline__'}
                itemContent={(_, row) => row.type === 'snoozed-section' ? (
                    <OfflineSectionRow
                        directory="__feed_snoozed__"
                        count={snoozedSessions.length}
                        isCollapsed={snoozedCollapsed}
                        density="comfortable"
                        minimal
                        label={t('sessions.snoozed.section')}
                        onToggleGroup={(_directory, isCollapsed) => setSnoozedCollapsed(!isCollapsed)}
                    />
                ) : row.type === 'offline-section' ? (
                    <OfflineSectionRow
                        directory="__feed_offline__"
                        count={offlineSessions.length}
                        isCollapsed={offlineCollapsed}
                        density="comfortable"
                        minimal
                        label={t('misc.offline')}
                        onToggleGroup={(_directory, isCollapsed) => setOfflineCollapsed(!isCollapsed)}
                    />
                ) : (
                    <SessionItem
                        session={row.session}
                        onSelect={props.onSelect}
                        showPath={false}
                        api={api}
                        availableTags={availableTags}
                        selected={row.session.id === props.selectedSessionId}
                        density="comfortable"
                        variant="feed"
                        sortable={false}
                    />
                )}
            />
        </div>
    )
}
