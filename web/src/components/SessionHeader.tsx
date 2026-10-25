import { useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPermissionModeTone, isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import { permissionModeText, thinkEffortText } from '@/lib/option-labels'
import type { PermissionModeTone } from '@hapi/protocol'
import type { ClaudeRateLimitSnapshot } from '@hapi/protocol/types'
import type { Session } from '@/types/api'
import type { ChatViewMode } from '@/hooks/useChatViewMode'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { BottomSheet, SheetRow, SheetSection, SheetSwitchRow } from '@/components/mobile/BottomSheet'
import { ActionTile } from '@/components/mobile/ActionTile'
import { SegmentedControl } from '@/components/ui/FormControls'
import { setChatZoomLevel, useChatZoomLevel } from '@/components/AssistantChat/chatZoom'
import { ZOOM_ALL, ZOOM_BRIEF, ZOOM_REPLY } from '@/components/AssistantChat/chatZoomText'
import type { SemanticZoomController } from '@/vendor/semantic-zoom'
import { IconButton } from '@/components/ui/IconButton'
import { SessionAvatar, getProjectName, getSessionProjectPath } from '@/components/mobile/SessionAvatar'
import { DesktopPaneHeader } from '@/components/mobile/DesktopPaneHeader'
import {
    ArchiveBoxIcon,
    DuplicateIcon,
    NewSessionIcon,
    MoonIcon,
    SunIcon,
    PinIcon,
    TagIcon,
    ChevronDownIcon,
    ChevronLeftIcon,
    FileIcon,
    GlobeIcon,
    MoreHorizontalIcon,
    PencilIcon,
    PlugIcon as PlugOutlineIcon,
    TerminalIcon,
    TrashIcon
} from '@/components/mobile/icons'
import { UsagePanel } from '@/components/AssistantChat/UsagePanel'
import { cn } from '@/lib/utils'
import type { ApiClient } from '@/api/client'
import { isTelegramApp } from '@/hooks/useTelegram'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useSessionPin, useSessionSnooze } from '@/hooks/mutations/useSessionPin'
import { getSnoozeUntil, getUserTags, isSessionPinned, isSessionSnoozed, withUserTags } from '@/lib/session-pins'
import { formatSnoozeStatus, formatSnoozeWake, getSnoozePresets } from '@/lib/session-snooze'
import { SessionSnoozeDialog } from '@/components/SessionSnoozeDialog'
import { useSessions } from '@/hooks/queries/useSessions'
import { SessionTagsDialog } from '@/components/SessionTagsDialog'
import { useArchiveConfirmation } from '@/hooks/useArchiveConfirmation'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import { accountsKey } from '@/components/ClaudeAccounts/Settings'
import { quotaOptionLabel } from '@/components/ClaudeAccounts/Selector'
import { getMachineTitle } from '@/components/NewSession/MachineSelector'
import { useMachines } from '@/hooks/queries/useMachines'

function getSessionTitle(session: Session): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

const PERMISSION_TONE_TEXT: Record<PermissionModeTone, string> = {
    neutral: 'text-[var(--social-fg-muted)]',
    info: 'text-[var(--app-badge-info-text)]',
    warning: 'text-[var(--social-warning)]',
    danger: 'text-[var(--social-danger)]'
}

/** One-line presence status for the chat header (like WeChat "对方正在输入…"). */
function getChatStatus(
    session: Session,
    t: (key: string) => string
): { text: string; dotClass: string; textClass: string; pulse: boolean } {
    if (!session.active) {
        return { text: t('misc.offline'), dotClass: 'bg-[var(--social-fg-subtle)]', textClass: 'text-[var(--social-fg-muted)]', pulse: false }
    }
    const pendingRequests = session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0
    if (pendingRequests > 0) {
        return { text: t('misc.permissionRequired'), dotClass: 'bg-[var(--social-warning)]', textClass: 'text-[var(--social-warning)]', pulse: true }
    }
    if (session.thinking) {
        return { text: t('mobile.chat.thinking'), dotClass: 'bg-[var(--social-fg)]', textClass: 'font-semibold text-[var(--social-fg)]', pulse: true }
    }
    return { text: t('misc.online'), dotClass: 'bg-[var(--social-success)]', textClass: 'text-[var(--social-fg-muted)]', pulse: false }
}

export function SessionHeader(props: {
    session: Session
    onBack: () => void
    onOpenSession?: (sessionId: string) => void
    onToggleSidebar?: () => void
    sidebarVisible?: boolean
    onViewPreview?: () => void
    onViewFiles?: () => void
    onViewMcpStatus?: () => void
    onViewTerminal?: () => void
    viewMode?: ChatViewMode
    onViewModeChange?: (mode: ChatViewMode) => void
    /** Chat zoom of the conversation view; its level switch sits under the view modes. */
    zoomController?: SemanticZoomController
    usage?: {
        contextSize?: number
        contextWindowTokens?: number
        rateLimitSnapshot?: ClaudeRateLimitSnapshot
        contextPercentLeft?: number | null
    }
    api: ApiClient | null
    onSessionDeleted?: () => void
}) {
    const { t, locale } = useTranslation()
    const { session, api, onSessionDeleted } = props
    const isMobileLayout = useIsMobileLayout()
    const [infoOpen, setInfoOpen] = useState(false)
    const [infoAnchor, setInfoAnchor] = useState<{ right: number; bottom: number } | null>(null)
    const infoButtonRef = useRef<HTMLButtonElement>(null)
    const title = useMemo(() => getSessionTitle(session), [session])
    const worktreeBranch = session.metadata?.worktree?.branch
    const displayModel = session.metadata?.model?.trim() || session.modelMode || 'default'
    const displayThinkEffort = session.metadata?.thinkEffort?.trim()
    const displayServiceTier = session.metadata?.serviceTier?.trim()
    const accountQuery = useQuery({
        queryKey: accountsKey(session.metadata?.machineId ?? ''),
        queryFn: () => api!.getClaudeAccounts(session.metadata!.machineId!),
        enabled: Boolean(api && session.metadata?.flavor === 'claude' && session.metadata?.machineId),
        retry: false
    })
    // Name the machine the session runs on; an offline machine is not listed, so fall back to its host.
    const { machines } = useMachines(api, infoOpen)
    const sessionMachine = machines.find((machine) => machine.id === session.metadata?.machineId)
    const machineLabel = sessionMachine ? getMachineTitle(sessionMachine) : session.metadata?.host
    const machineLoginEmail = accountQuery.data?.machineLogin?.email
    const [accountSwitching, setAccountSwitching] = useState(false)
    const [accountSwitchError, setAccountSwitchError] = useState<string | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    const {
        archiveSession,
        renameSession,
        deleteSession,
        spawnSameConfigSession,
        duplicateSession,
        setTags,
        isPending
    } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null
    )
    const { skipArchiveConfirmation } = useArchiveConfirmation()
    const pinSession = useSessionPin(api)
    const pinned = isSessionPinned(session)
    const snoozeSession = useSessionSnooze(api)
    const snoozeUntil = isSessionSnoozed(session) ? getSnoozeUntil(session) : null
    const [snoozeOpen, setSnoozeOpen] = useState(false)
    const [snoozeExpanded, setSnoozeExpanded] = useState(false)
    const snoozeTo = (until: number) => {
        void snoozeSession(session, until).catch((error) => {
            console.error('Failed to snooze session', error)
        })
    }
    const [tagsOpen, setTagsOpen] = useState(false)
    const { sessions: allSessions } = useSessions(api)
    const availableTags = useMemo(
        () => Array.from(new Set(allSessions.flatMap((item) => getUserTags(item)))).sort((a, b) => a.localeCompare(b)),
        [allSessions]
    )

    const handleDelete = async () => {
        await deleteSession()
        onSessionDeleted?.()
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
            .then((newSessionId) => {
                props.onOpenSession?.(newSessionId)
            })
            .catch((error) => {
                console.error('Failed to create same-config session', error)
            })
    }

    const handleDuplicate = () => {
        void duplicateSession()
            .then((newSessionId) => {
                props.onOpenSession?.(newSessionId)
            })
            .catch((error) => {
                console.error('Failed to duplicate session', error)
            })
    }

    const handleAccountSwitch = async (accountId: string) => {
        if (!api || !accountId || accountId === session.metadata?.claudeAccount?.id) return
        const profile = accountQuery.data?.pool.profiles.find(item => item.id === accountId)
        if (!profile) return
        setAccountSwitching(true)
        setAccountSwitchError(null)
        try {
            const result = await api.switchClaudeAccount(session.id, accountId, accountQuery.data?.pool.autoSwitch ?? false)
            props.onOpenSession?.(result.sessionId)
        } catch (error) {
            const message = error instanceof Error ? error.message : t('sessionAccount.switchFailed')
            setAccountSwitchError(message)
        } finally {
            setAccountSwitching(false)
        }
    }

    // In Telegram, don't render header (Telegram provides its own)
    if (isTelegramApp()) {
        return null
    }

    const dialogs = (
        <>
            <SessionSnoozeDialog
                isOpen={snoozeOpen}
                onClose={() => setSnoozeOpen(false)}
                onSnooze={(until) => snoozeSession(session, until)}
            />

            <SessionTagsDialog
                isOpen={tagsOpen}
                onClose={() => setTagsOpen(false)}
                tags={getUserTags(session)}
                availableTags={availableTags}
                onSave={(tags) => setTags(withUserTags(session, tags))}
                isPending={isPending}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={title}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('dialog.archive.title')}
                description={t(pinned ? 'dialog.archive.descriptionPinned' : 'dialog.archive.description', { name: title })}
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
                description={t('dialog.delete.description', { name: title })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={handleDelete}
                isPending={isPending}
                destructive
            />
        </>
    )

    const status = getChatStatus(session, t)
    const pendingRequestCount = session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0
    const avatarRing = session.active && pendingRequestCount > 0 ? 'pending' as const : session.active && session.thinking ? 'live' as const : null
    const permissionMode = session.permissionMode
    const flavor = session.metadata?.flavor ?? null
    const permissionLabel = permissionMode
        && permissionMode !== 'default'
        && isPermissionModeAllowedForFlavor(permissionMode, flavor)
        ? permissionModeText(permissionMode, t)
        : null
    const permissionToneClass = permissionLabel && permissionMode
        ? PERMISSION_TONE_TEXT[getPermissionModeTone(permissionMode)]
        : ''
    const contextPercentLeft = props.usage?.contextPercentLeft ?? null
    const shortModel = displayModel.replace(/^.*claude-/, '')
    const closeInfoThen = (action?: () => void) => () => {
        setInfoOpen(false)
        action?.()
    }
    const quickActions: Array<{ key: string; label: string; icon: ReactNode; onClick?: () => void }> = [
        { key: 'files', label: t('mobile.chat.files'), icon: <FileIcon className="h-[22px] w-[22px]" />, onClick: props.onViewFiles },
        { key: 'terminal', label: t('mobile.chat.terminal'), icon: <TerminalIcon className="h-[22px] w-[22px]" />, onClick: props.onViewTerminal },
        { key: 'preview', label: t('mobile.chat.preview'), icon: <GlobeIcon className="h-[22px] w-[22px]" />, onClick: props.onViewPreview },
        { key: 'mcp', label: t('mobile.chat.mcp'), icon: <PlugOutlineIcon className="h-[22px] w-[22px]" />, onClick: props.onViewMcpStatus }
    ]
    const viewModes: Array<{ value: ChatViewMode; label: string }> = [
        { value: 'normal', label: t('mobile.chat.view.normal') },
        { value: 'brief', label: t('mobile.chat.view.brief') },
        { value: 'cli', label: t('mobile.chat.view.cli') }
    ]
    const zoomLevel = useChatZoomLevel(props.zoomController)
    const zoomLevels = [
        { value: String(ZOOM_BRIEF), label: t('chat.zoom.brief') },
        { value: String(ZOOM_REPLY), label: t('chat.zoom.reply') },
        { value: String(ZOOM_ALL), label: t('chat.zoom.all') }
    ]
    // The status line names a zoomed level, since nothing floats over the chat to show it.
    const zoomLevelLabel = props.zoomController && zoomLevel !== ZOOM_REPLY
        ? zoomLevels.find((level) => level.value === String(zoomLevel))?.label ?? null
        : null
    const modelValue = [
        shortModel,
        displayThinkEffort ? `${t('session.item.thinkLevel')} ${thinkEffortText(displayThinkEffort, displayThinkEffort, t)}` : null,
        displayServiceTier || null
    ].filter(Boolean).join(' · ')
    const showUsage = Boolean(props.usage && (typeof props.usage.contextSize === 'number' || props.usage.rateLimitSnapshot))

    const statusLine = (
        <>
            <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', status.dotClass, status.pulse ? 'animate-pulse' : '')} />
            <span className={cn('shrink-0', status.textClass)}>{status.text}</span>
            <span className="min-w-0 truncate">
                {zoomLevelLabel ? <span className="text-[var(--social-fg)]">{`· ${zoomLevelLabel} `}</span> : null}
                {shortModel ? `· ${shortModel}` : ''}
                {permissionLabel ? (
                    <span className={permissionToneClass}>{` · ${permissionLabel}`}</span>
                ) : null}
                {contextPercentLeft !== null && contextPercentLeft <= 20 ? (
                    <span className={contextPercentLeft <= 5 ? 'text-[var(--social-danger)]' : 'text-[var(--social-warning)]'}>
                        {` · ${t('mobile.chat.contextLeft', { percent: contextPercentLeft })}`}
                    </span>
                ) : null}
            </span>
        </>
    )

    // Desktop: the card hangs under the "…" button, whichever of title or button opened it.
    const openDesktopInfo = () => {
        const rect = infoButtonRef.current?.getBoundingClientRect()
        setInfoAnchor(rect ? { right: rect.right, bottom: rect.bottom } : null)
        setInfoOpen(true)
    }

    // Session info: bottom sheet on phones, floating card under the "…" button on desktop.
    const infoSheet = (
        <BottomSheet open={infoOpen} onOpenChange={setInfoOpen} title={t('mobile.chat.info')} hideTitle popoverAnchor={isMobileLayout ? null : infoAnchor}>
            <div className="flex items-center gap-3.5 px-5 pb-5 pt-2">
                <SessionAvatar session={session} size={48} ring={avatarRing} muted={!session.active} />
                <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-headline font-semibold leading-snug tracking-[-0.01em] text-[var(--social-fg)]">{title}</div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-footnote text-[var(--social-fg-muted)]">
                        <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', status.dotClass)} />
                        <span className={cn('shrink-0', status.textClass)}>{status.text}</span>
                        <span className="truncate">· {flavor ?? 'unknown'} · {getProjectName(getSessionProjectPath(session))}</span>
                    </div>
                </div>
            </div>

            <div className="grid grid-cols-4 gap-2 px-4 pb-5">
                {quickActions.map((action) => (
                    <ActionTile key={action.key} icon={action.icon} label={action.label} onClick={action.onClick ? closeInfoThen(action.onClick) : undefined} />
                ))}
            </div>

            {props.onViewModeChange ? (
                <SheetSection title={t('mobile.chat.view')}>
                    <SegmentedControl
                        framed={false}
                        label={t('mobile.chat.view')}
                        value={props.viewMode ?? 'normal'}
                        options={viewModes}
                        onChange={(mode) => {
                            props.onViewModeChange?.(mode)
                            setInfoOpen(false)
                        }}
                    />
                </SheetSection>
            ) : null}

            {props.zoomController ? (
                <SheetSection title={t('chat.zoom.label')}>
                    <SegmentedControl
                        framed={false}
                        label={t('chat.zoom.label')}
                        value={String(zoomLevel)}
                        options={zoomLevels}
                        onChange={(level) => {
                            setInfoOpen(false)
                            if (props.zoomController) setChatZoomLevel(props.zoomController, Number(level))
                        }}
                    />
                    <div className="px-4 pb-3 pt-1 text-caption text-[var(--social-fg-muted)]">{t('chat.zoom.hint')}</div>
                </SheetSection>
            ) : null}

            <SheetSection>
                {machineLabel ? <SheetRow label={t('mobile.chat.machine')} value={machineLabel} /> : null}
                <SheetRow label={t('mobile.chat.model')} value={modelValue || 'default'} />
                {session.metadata?.flavor === 'claude' && accountQuery.data?.pool.profiles.length ? (
                    <SheetRow
                        label={t('mobile.chat.account')}
                        value={(
                            <select
                                aria-label={t('sessionAccount.switch')}
                                value={session.metadata.claudeAccount?.id ?? ''}
                                disabled={accountSwitching}
                                onChange={(event) => void handleAccountSwitch(event.target.value)}
                                className="min-h-11 max-w-[210px] truncate bg-transparent text-right text-headline text-[var(--social-fg-muted)] outline-none"
                            >
                                {!session.metadata.claudeAccount ? <option value="">{machineLoginEmail ? `${t('sessionAccount.machineDefault')} · ${machineLoginEmail}` : t('sessionAccount.machineDefault')}</option> : null}
                                {accountQuery.data.pool.profiles.filter(profile => profile.enabled).map(profile => {
                                    const quota = quotaOptionLabel(accountQuery.data?.usage?.[profile.id], t)
                                    return <option key={profile.id} value={profile.id}>{profile.email}{quota ? ` · ${quota}` : ''}</option>
                                })}
                            </select>
                        )}
                    />
                ) : null}
                <SheetRow label={t('mobile.chat.directory')} value={session.metadata?.path ?? '—'} />
                {worktreeBranch ? <SheetRow label={t('mobile.chat.branch')} value={worktreeBranch} /> : null}
            </SheetSection>
            {accountSwitchError ? (
                <div role="alert" className="px-7 pb-3 text-caption text-[var(--social-danger)]">{accountSwitchError}</div>
            ) : null}

            {showUsage ? (
                <SheetSection title={t('mobile.chat.usage')}>
                    <div className="[&>div]:w-full [&>div]:max-w-none [&>div]:rounded-none [&>div]:border-0 [&>div]:bg-transparent [&>div]:shadow-none">
                        <UsagePanel
                            contextSize={props.usage?.contextSize}
                            contextWindowTokens={props.usage?.contextWindowTokens}
                            rateLimitSnapshot={props.usage?.rateLimitSnapshot}
                        />
                    </div>
                </SheetSection>
            ) : null}

            <SheetSection title={t('mobile.chat.manage')}>
                <SheetSwitchRow
                    icon={<PinIcon />}
                    label={t('session.action.pin')}
                    checked={pinned}
                    onCheckedChange={(next) => {
                        void pinSession(session, next).catch((error) => {
                            console.error('Failed to update session pin', error)
                        })
                    }}
                />
                {snoozeUntil === null ? (
                    <>
                        <SheetRow
                            icon={<MoonIcon />}
                            label={t('session.action.snooze')}
                            value={<ChevronDownIcon className={cn('ml-auto h-4 w-4 text-[var(--social-fg-subtle)] transition-transform', snoozeExpanded ? 'rotate-180' : '')} />}
                            onClick={() => setSnoozeExpanded((expanded) => !expanded)}
                        />
                        {snoozeExpanded ? (
                            <>
                                {getSnoozePresets().map((preset) => (
                                    <SheetRow
                                        key={preset.key}
                                        icon={<span aria-hidden="true" />}
                                        label={t(`dialog.snooze.${preset.key}`)}
                                        value={formatSnoozeWake(preset.until, Date.now(), locale, t)}
                                        onClick={closeInfoThen(() => snoozeTo(preset.until))}
                                    />
                                ))}
                                <SheetRow
                                    icon={<span aria-hidden="true" />}
                                    label={t('dialog.snooze.custom')}
                                    onClick={closeInfoThen(() => setSnoozeOpen(true))}
                                />
                            </>
                        ) : null}
                    </>
                ) : (
                    <SheetRow
                        icon={<SunIcon />}
                        label={t('session.action.unsnooze')}
                        value={formatSnoozeStatus(snoozeUntil, Date.now(), locale, t)}
                        onClick={() => {
                            void snoozeSession(session, null).catch((error) => {
                                console.error('Failed to wake session', error)
                            })
                        }}
                    />
                )}
                <SheetRow icon={<PencilIcon />} label={t('session.action.rename')} chevron onClick={closeInfoThen(() => setRenameOpen(true))} />
                <SheetRow icon={<TagIcon />} label={t('session.action.tags')} chevron onClick={closeInfoThen(() => setTagsOpen(true))} />
                <SheetRow icon={<NewSessionIcon />} label={t('session.action.newSameConfig')} chevron onClick={closeInfoThen(handleSpawnSameConfig)} />
                <SheetRow icon={<DuplicateIcon />} label={t('session.action.duplicate')} chevron onClick={closeInfoThen(handleDuplicate)} />
                {session.active ? (
                    <SheetRow icon={<ArchiveBoxIcon />} label={t('session.action.archive')} destructive onClick={closeInfoThen(handleArchive)} />
                ) : (
                    <SheetRow icon={<TrashIcon />} label={t('session.action.delete')} destructive onClick={closeInfoThen(() => setDeleteOpen(true))} />
                )}
            </SheetSection>
            <div className="h-2" />
        </BottomSheet>
    )

    if (!isMobileLayout) {
        return (
            <>
                <DesktopPaneHeader
                    avatar={<SessionAvatar session={session} size={36} ring={avatarRing} muted={!session.active} />}
                    title={title}
                    subtitle={statusLine}
                    listVisible={props.sidebarVisible}
                    onToggleList={props.onToggleSidebar}
                    onTitleClick={openDesktopInfo}
                    titleLabel={t('mobile.chat.info')}
                    actions={(
                        <>
                            {props.onViewFiles ? (
                                <IconButton size="sm" label={t('mobile.chat.files')} onClick={props.onViewFiles}>
                                    <FileIcon className="h-[19px] w-[19px]" />
                                </IconButton>
                            ) : null}
                            {props.onViewTerminal ? (
                                <IconButton size="sm" label={t('mobile.chat.terminal')} onClick={props.onViewTerminal}>
                                    <TerminalIcon className="h-[19px] w-[19px]" />
                                </IconButton>
                            ) : null}
                            {props.onViewPreview ? (
                                <IconButton size="sm" label={t('mobile.chat.preview')} onClick={props.onViewPreview}>
                                    <GlobeIcon className="h-[19px] w-[19px]" />
                                </IconButton>
                            ) : null}
                            <IconButton size="sm" label={t('mobile.chat.info')} onClick={openDesktopInfo} ref={infoButtonRef}>
                                <MoreHorizontalIcon className="h-[21px] w-[21px]" />
                            </IconButton>
                        </>
                    )}
                />
                {infoSheet}
                {dialogs}
            </>
        )
    }

    return (
        <>
            <div className="social-bar relative z-20 shrink-0 border-b border-[var(--social-border)] pt-[env(safe-area-inset-top)]">
                <div className="flex h-[54px] items-center gap-0.5 pl-1 pr-1.5">
                    <IconButton label={t('button.back')} onClick={props.onBack} className="text-[var(--social-fg)]">
                        <ChevronLeftIcon className="h-[26px] w-[26px]" />
                    </IconButton>
                    <button
                        type="button"
                        onClick={() => setInfoOpen(true)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 pr-1 text-left [-webkit-tap-highlight-color:transparent]"
                    >
                        <SessionAvatar session={session} size={38} ring={avatarRing} muted={!session.active} />
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-body font-semibold leading-tight tracking-[-0.01em] text-[var(--social-fg)]">
                                {title}
                            </div>
                            <div className="mt-[3px] flex min-w-0 items-center gap-1.5 text-caption leading-tight text-[var(--social-fg-muted)]">
                                {statusLine}
                            </div>
                        </div>
                    </button>
                    <IconButton label={t('mobile.chat.info')} onClick={() => setInfoOpen(true)} className="text-[var(--social-fg)]">
                        <MoreHorizontalIcon className="h-6 w-6" />
                    </IconButton>
                </div>
            </div>
            {infoSheet}
            {dialogs}
        </>
    )
}
