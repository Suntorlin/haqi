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
import { DndContext, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Virtuoso } from 'react-virtuoso'
import type { SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { ProjectActionMenu } from '@/components/ProjectActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { SessionTagsDialog } from '@/components/SessionTagsDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
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
        type: 'session'
        session: SessionSummary
        forceOffline: boolean
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

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

type ListHeaderContext = { header?: ReactNode }

const SessionListScroller = forwardRef<HTMLDivElement, React.ComponentProps<'div'> & { context?: ListHeaderContext }>(
    function SessionListScroller(props, ref) {
        const { context: _context, ...rest } = props
        return (
            <div
                {...rest}
                ref={ref}
                className={`session-list-scroll ${props.className ?? ''}`.trim()}
            />
        )
    }
)

function ListHeader(props: { context?: ListHeaderContext }) {
    return <>{props.context?.header ?? null}</>
}

function GripIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
            aria-hidden="true"
        >
            <circle cx="9" cy="6" r="1.8" />
            <circle cx="15" cy="6" r="1.8" />
            <circle cx="9" cy="12" r="1.8" />
            <circle cx="15" cy="12" r="1.8" />
            <circle cx="9" cy="18" r="1.8" />
            <circle cx="15" cy="18" r="1.8" />
        </svg>
    )
}

function BulbIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2a7 7 0 0 0-4-12Z" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
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

export function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string | null {
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
    return new Date(ms).toLocaleDateString()
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
        ...(s.metadata?.tags ?? []).map((tag) => `#${tag}`)
    ].filter(Boolean).join(' · ')

    return (
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[13.5px] leading-snug text-[var(--social-fg-muted)]">
            {props.active && s.pendingRequestsCount > 0 ? (
                <span className="shrink-0 font-medium text-[var(--social-badge)]">
                    {t('mobile.feed.pending', { n: s.pendingRequestsCount })} ·
                </span>
            ) : props.thinking ? (
                <span className="inline-flex shrink-0 items-center font-medium text-[var(--social-fg)]">
                    {t('mobile.feed.thinking')}
                    <span className="typing-dots ml-0.5 inline-flex items-center" aria-hidden="true">
                        <span /><span /><span />
                    </span>
                </span>
            ) : null}
            <span className="min-w-0 truncate">{meta}</span>
            {progress ? (
                <span className="ml-auto shrink-0 pl-1 text-[12px] tabular-nums text-[var(--social-fg-subtle)]">
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
    const { t } = useTranslation()
    const { session: s, onSelect, showPath = true, api, availableTags = [], selected = false, density, forceOffline = false, variant = 'default', sortable = true } = props
    const isFeed = variant === 'feed'
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [tagsOpen, setTagsOpen] = useState(false)
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
    const effectiveActive = forceOffline ? false : s.active
    const effectiveThinking = forceOffline ? false : s.thinking
    const statusDotClass = effectiveActive
        ? (effectiveThinking ? 'bg-[#007AFF]' : 'bg-[var(--app-badge-success-text)]')
        : 'bg-[var(--app-hint)]'
    const isCompact = density === 'compact'

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
                className={`group/session-item relative ${isDragging ? 'z-10 bg-[var(--app-bg)] opacity-70' : ''}`}
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
                        className={`session-list-item social-pressable flex w-full items-center gap-3.5 px-5 py-2.5 text-left select-none focus-visible:outline-none lg:mx-2 lg:w-[calc(100%-1rem)] lg:rounded-2xl lg:px-3 ${effectiveActive && s.pendingRequestsCount > 0 ? 'bg-[var(--social-muted)]/60' : ''}`}
                        style={{ WebkitTouchCallout: 'none' }}
                        aria-current={selected ? 'page' : undefined}
                    >
                        <SessionAvatar
                            session={s}
                            size={52}
                            ring={effectiveActive && s.pendingRequestsCount > 0 ? 'pending' : effectiveThinking ? 'live' : null}
                            muted={!effectiveActive}
                            badgeCount={effectiveActive ? s.pendingRequestsCount : 0}
                        />
                        <div className="flex min-w-0 flex-1 flex-col justify-center">
                            <div className="flex items-baseline gap-2">
                                <span className={`min-w-0 flex-1 truncate text-[15px] leading-snug tracking-[-0.01em] ${effectiveActive ? 'font-medium text-[var(--social-fg)]' : 'text-[var(--social-fg)]'}`}>
                                    {sessionName}
                                </span>
                                <span className="shrink-0 text-[12px] text-[var(--social-fg-subtle)]">
                                    {formatRelativeTime(s.updatedAt, t)}
                                </span>
                            </div>
                            <FeedPreview session={s} active={effectiveActive} thinking={effectiveThinking} />
                        </div>
                    </button>
                ) : (
                    <button
                        type="button"
                        {...longPressHandlers}
                        className={`session-list-item flex w-full flex-col text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none ${isCompact ? 'gap-0.5 px-2.5 py-1.5' : 'gap-1.5 px-3 py-3'} ${selected ? 'bg-[var(--app-secondary-bg)]' : ''}`}
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
                                <div className={`truncate font-medium ${isCompact ? 'text-sm' : 'text-base'}`}>
                                    {sessionName}
                                </div>
                            </div>
                            <div className={`flex items-center gap-2 shrink-0 ${isCompact ? 'text-[11px]' : 'text-xs'}`}>
                                {effectiveThinking ? (
                                    <span className="text-[#007AFF] animate-pulse">
                                        {t('session.item.thinking')}
                                    </span>
                                ) : null}
                                {(() => {
                                    const progress = getTodoProgress(s)
                                    if (!progress) return null
                                    return (
                                        <span className="flex items-center gap-1 text-[var(--app-hint)]">
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
                                    className={`text-[var(--app-hint)] transition-opacity ${sessionQuickArchiveEnabled && isQuickArchiveVisible ? 'opacity-0 pointer-events-none' : ''}`}
                                >
                                    {formatRelativeTime(s.updatedAt, t)}
                                </span>
                            </div>
                        </div>
                        {showPath ? (
                            <div className="truncate text-xs text-[var(--app-hint)]">
                                {s.metadata?.path ?? s.id}
                            </div>
                        ) : null}
                        {s.metadata?.tags?.length ? (
                            <div className="flex flex-wrap gap-1">
                                {s.metadata.tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="rounded-full bg-[var(--app-secondary-bg)] px-2 py-0.5 text-[10px] text-[var(--app-hint)]"
                                    >
                                        #{tag}
                                    </span>
                                ))}
                            </div>
                        ) : null}
                        {!isCompact ? (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--app-hint)]">
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
                        className="absolute inset-y-0 left-0 flex w-3 cursor-grab touch-none select-none items-center justify-center text-[var(--app-hint)] opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing max-md:opacity-40"
                        title={t('sessions.reorder')}
                        aria-label={t('sessions.reorder')}
                    >
                        <GripIcon className="h-3 w-3" />
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
            onRename={() => setRenameOpen(true)}
            onTags={() => setTagsOpen(true)}
            tags={s.metadata?.tags ?? []}
            availableTags={availableTags}
            onTagsChange={setTags}
            tagsPending={isPending}
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

            <SessionTagsDialog
                isOpen={tagsOpen}
                onClose={() => setTagsOpen(false)}
                tags={s.metadata?.tags ?? []}
                availableTags={availableTags}
                onSave={setTags}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.description', { name: sessionName })}
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
            className={`z-10 flex w-full items-center gap-1 cursor-grab active:cursor-grabbing select-none ${minimal ? 'px-4 pb-1 pt-4' : `border-b border-[var(--app-divider)] ${density === 'compact' ? 'px-2.5 py-1.5' : 'px-3 py-2'}`} ${isDropTarget ? 'bg-[var(--app-secondary-bg)]' : 'bg-[var(--app-bg)]'} ${isDragging ? 'opacity-70' : ''}`}
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
                className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-[var(--app-secondary-bg)]"
            >
                <ChevronIcon
                    className={minimal ? 'h-3.5 w-3.5 text-[var(--social-fg-subtle)]' : 'h-4 w-4 text-[var(--app-hint)]'}
                    collapsed={isCollapsed}
                />
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span
                        className={minimal
                            ? 'truncate text-[13px] font-semibold tracking-[-0.01em] text-[var(--social-fg)]'
                            : `font-medium break-words ${density === 'compact' ? 'text-sm' : 'text-base'}`}
                        title={group.directory}
                    >
                        {group.displayName}
                    </span>
                    {isProjectOffline ? (
                        <span className="shrink-0 rounded bg-[var(--app-subtle-bg)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                            {t('misc.offline')}
                        </span>
                    ) : null}
                    <span className="shrink-0 text-xs text-[var(--app-hint)]">
                        ({group.sessions.length})
                    </span>
                </div>
            </button>
            {group.directory !== 'Other' ? (
                <button
                    type="button"
                    {...plusButtonHandlers}
                    className={minimal
                        ? 'shrink-0 rounded-full p-1.5 text-[var(--social-fg-muted)] transition-colors active:bg-[var(--social-muted)]'
                        : 'shrink-0 rounded p-1.5 text-[var(--app-link)] transition-colors hover:bg-[var(--app-secondary-bg)]'}
                    title={t('sessions.newInProject')}
                    aria-label={t('sessions.newInProject')}
                >
                    <PlusIcon className="h-4 w-4" />
                </button>
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
            className={`flex w-full items-center gap-2 text-left text-xs text-[var(--app-hint)] transition-colors hover:text-[var(--app-fg)] ${props.minimal ? 'px-5 py-2' : `border-b border-[var(--app-divider)] ${density === 'compact' ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}`}
        >
            <ChevronIcon
                className="h-3.5 w-3.5 text-[var(--app-hint)]"
                collapsed={isCollapsed}
            />
            <span className="uppercase tracking-wide">{label ?? t('misc.offline')}</span>
            <span className="text-[var(--app-hint)]">
                ({count})
            </span>
        </button>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
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
        () => flattenSessionRows(
            groups,
            isGroupCollapsed,
            isOfflineCollapsed,
            isProjectForcedOfflineGroup,
            isOfflineProjectsCollapsed
        ),
        [groups, collapseOverrides, offlineCollapseOverrides, projectOfflineDirectories, isOfflineProjectsCollapsed]
    )

    const sortableSessionIds = useMemo(
        () => rows.flatMap((row) => row.type === 'session' ? [row.session.id] : []),
        [rows]
    )

    return (
        <div className="mx-auto flex h-full w-full max-w-content min-h-0 flex-col">
            {renderHeader ? (
                <div className="flex items-center justify-between px-3 py-1">
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('sessions.count', { n: props.sessions.length, m: groups.length })}
                    </div>
                    <button
                        type="button"
                        onClick={() => props.onNewSession()}
                        className="session-list-new-button p-1.5 rounded-full text-[var(--app-link)] transition-colors"
                        title={t('sessions.new')}
                    >
                        <PlusIcon className="h-5 w-5" />
                    </button>
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

                                return (
                                    <div className={props.itemVariant === 'feed' ? '' : 'border-b border-[var(--app-divider)]'}>
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

/**
 * Mobile chat-app style list: one flat, recency-sorted feed (like WeChat "Chats").
 * Sessions waiting for approval are pinned on top.
 */
export function SessionFeed(props: {
    sessions: SessionSummary[]
    availableTags?: string[]
    selectedSessionId?: string | null
    onSelect: (sessionId: string) => void
    api: ApiClient | null
    listHeader?: ReactNode
    emptyLabel?: string
}) {
    const { api, availableTags = [] } = props
    const sortedSessions = useMemo(() => [...props.sessions].sort((a, b) => {
        const aPinned = getLivePendingCount(a) > 0 ? 1 : 0
        const bPinned = getLivePendingCount(b) > 0 ? 1 : 0
        if (aPinned !== bPinned) return bPinned - aPinned
        if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt
        return a.id.localeCompare(b.id)
    }), [props.sessions])
    const listHeaderContext = useMemo<ListHeaderContext>(() => ({ header: props.listHeader }), [props.listHeader])

    return (
        <div className="flex h-full min-h-0 w-full flex-col">
            <Virtuoso
                data={sortedSessions}
                style={{ height: '100%' }}
                defaultItemHeight={68}
                increaseViewportBy={480}
                initialItemCount={Math.min(sortedSessions.length, 20)}
                context={listHeaderContext}
                components={{
                    Scroller: SessionListScroller,
                    Header: ListHeader,
                    EmptyPlaceholder: () => (
                        <div className="px-6 py-16 text-center text-sm text-[var(--app-hint)]">
                            {props.emptyLabel}
                        </div>
                    )
                }}
                computeItemKey={(_, session) => session.id}
                itemContent={(_, session) => (
                    <SessionItem
                        session={session}
                        onSelect={props.onSelect}
                        showPath={false}
                        api={api}
                        availableTags={availableTags}
                        selected={session.id === props.selectedSessionId}
                        density="comfortable"
                        variant="feed"
                        sortable={false}
                    />
                )}
            />
        </div>
    )
}
