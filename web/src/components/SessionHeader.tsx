import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPermissionModeLabel, getPermissionModeTone, isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import type { PermissionModeTone } from '@hapi/protocol'
import type { ClaudeRateLimitSnapshot } from '@hapi/protocol/types'
import type { Session } from '@/types/api'
import type { ChatViewMode } from '@/hooks/useChatViewMode'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { BottomSheet, SheetRow, SheetSection } from '@/components/mobile/BottomSheet'
import { SessionAvatar, getProjectName, getSessionProjectPath } from '@/components/mobile/SessionAvatar'
import {
    ArchiveBoxIcon,
    ChevronLeftIcon,
    CopyPlusIcon,
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
import { useArchiveConfirmation } from '@/hooks/useArchiveConfirmation'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/lib/use-translation'
import { SessionAccountInline } from '@/components/ClaudeAccounts/SessionAccountBar'
import { accountsKey } from '@/components/ClaudeAccounts/Settings'
import { quotaOptionLabel } from '@/components/ClaudeAccounts/Selector'

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
    neutral: 'text-[var(--app-hint)]',
    info: 'text-blue-500',
    warning: 'text-amber-500',
    danger: 'text-red-500'
}

/** One-line presence status for the mobile chat header (like WeChat "对方正在输入…"). */
function getMobileStatus(
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
        return { text: t('mobile.chat.thinking'), dotClass: 'bg-[var(--social-fg)]', textClass: 'font-medium text-[var(--social-fg)]', pulse: true }
    }
    return { text: t('misc.online'), dotClass: 'bg-[var(--social-success)]', textClass: 'text-[var(--social-fg-muted)]', pulse: false }
}

function FilesIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
        </svg>
    )
}

function BrowserIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M3 9h18" />
            <path d="M7 6.5h.01" />
            <path d="M10 6.5h.01" />
        </svg>
    )
}

function SidebarIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18" />
        </svg>
    )
}

function PlugIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M12 2v7" />
            <path d="M9 5h6" />
            <path d="M6 9h12v2a6 6 0 0 1-6 6 6 6 0 0 1-6-6z" />
            <path d="M12 17v5" />
        </svg>
    )
}

function MoreVerticalIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={props.className}
        >
            <circle cx="12" cy="5" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="12" cy="19" r="2" />
        </svg>
    )
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
    usage?: {
        contextSize?: number
        contextWindowTokens?: number
        rateLimitSnapshot?: ClaudeRateLimitSnapshot
        contextPercentLeft?: number | null
    }
    api: ApiClient | null
    onSessionDeleted?: () => void
}) {
    const { t } = useTranslation()
    const { session, api, onSessionDeleted } = props
    const isMobileLayout = useIsMobileLayout()
    const [infoOpen, setInfoOpen] = useState(false)
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
    const [accountSwitching, setAccountSwitching] = useState(false)
    const [accountSwitchError, setAccountSwitchError] = useState<string | null>(null)
    const sidebarToggleLabel = props.sidebarVisible
        ? t('sessions.sidebar.hideDesktop')
        : t('sessions.sidebar.showDesktop')

    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const menuId = useId()
    const menuAnchorRef = useRef<HTMLButtonElement | null>(null)
    const [renameOpen, setRenameOpen] = useState(false)
    const [archiveOpen, setArchiveOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    const {
        archiveSession,
        renameSession,
        deleteSession,
        spawnSameConfigSession,
        duplicateSession,
        isPending
    } = useSessionActions(
        api,
        session.id,
        session.metadata?.flavor ?? null
    )
    const { skipArchiveConfirmation } = useArchiveConfirmation()

    const handleDelete = async () => {
        await deleteSession()
        onSessionDeleted?.()
    }

    const handleMenuToggle = () => {
        if (!menuOpen && menuAnchorRef.current) {
            const rect = menuAnchorRef.current.getBoundingClientRect()
            setMenuAnchorPoint({ x: rect.right, y: rect.bottom })
        }
        setMenuOpen((open) => !open)
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
                description={t('dialog.archive.description', { name: title })}
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

    if (isMobileLayout) {
        const status = getMobileStatus(session, t)
        const permissionMode = session.permissionMode
        const flavor = session.metadata?.flavor ?? null
        const permissionLabel = permissionMode
            && permissionMode !== 'default'
            && isPermissionModeAllowedForFlavor(permissionMode, flavor)
            ? getPermissionModeLabel(permissionMode)
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
        const viewModes: Array<{ mode: ChatViewMode; label: string }> = [
            { mode: 'normal', label: t('mobile.chat.view.normal') },
            { mode: 'brief', label: t('mobile.chat.view.brief') },
            { mode: 'cli', label: t('mobile.chat.view.cli') }
        ]
        const modelValue = [
            shortModel,
            displayThinkEffort ? `${t('session.item.thinkLevel')} ${displayThinkEffort}` : null,
            displayServiceTier || null
        ].filter(Boolean).join(' · ')
        const showUsage = Boolean(props.usage && (typeof props.usage.contextSize === 'number' || props.usage.rateLimitSnapshot))

        return (
            <>
                <div className="social-bar relative z-20 shrink-0 border-b border-[var(--social-border)] pt-[env(safe-area-inset-top)]">
                    <div className="flex h-[54px] items-center gap-0.5 pl-1 pr-1.5">
                        <button
                            type="button"
                            onClick={props.onBack}
                            className="flex h-11 w-9 shrink-0 items-center justify-center text-[var(--app-fg)] [-webkit-tap-highlight-color:transparent]"
                            aria-label="Back"
                        >
                            <ChevronLeftIcon className="h-[26px] w-[26px]" />
                        </button>
                        <button
                            type="button"
                            onClick={() => setInfoOpen(true)}
                            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 pr-1 text-left [-webkit-tap-highlight-color:transparent]"
                        >
                            <SessionAvatar session={session} size={34} dimmed={!session.active} showAgentBadge={false} />
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-[15.5px] font-semibold leading-tight tracking-[-0.01em] text-[var(--social-fg)]">
                                    {title}
                                </div>
                                <div className="mt-[3px] flex min-w-0 items-center gap-1.5 text-[12px] leading-tight text-[var(--social-fg-muted)]">
                                    <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', status.dotClass, status.pulse ? 'animate-pulse' : '')} />
                                    <span className={cn('shrink-0', status.textClass)}>{status.text}</span>
                                    <span className="min-w-0 truncate">
                                        {shortModel ? `· ${shortModel}` : ''}
                                        {permissionLabel ? (
                                            <span className={permissionToneClass}>{` · ${permissionLabel}`}</span>
                                        ) : null}
                                        {contextPercentLeft !== null && contextPercentLeft <= 20 ? (
                                            <span className={contextPercentLeft <= 5 ? 'text-red-500' : 'text-amber-500'}>
                                                {` · ${t('mobile.chat.contextLeft', { percent: contextPercentLeft })}`}
                                            </span>
                                        ) : null}
                                    </span>
                                </div>
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => setInfoOpen(true)}
                            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[var(--app-fg)] [-webkit-tap-highlight-color:transparent] active:bg-[var(--app-subtle-bg)]"
                            aria-label={t('mobile.chat.info')}
                            title={t('mobile.chat.info')}
                        >
                            <MoreHorizontalIcon className="h-6 w-6" />
                        </button>
                    </div>
                </div>

                <BottomSheet open={infoOpen} onOpenChange={setInfoOpen} title={t('mobile.chat.info')} hideTitle>
                    <div className="flex items-center gap-3.5 px-5 pb-5 pt-2">
                        <SessionAvatar session={session} size={52} dimmed={!session.active} />
                        <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[var(--social-fg)]">{title}</div>
                            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--social-fg-muted)]">
                                <span className={cn('h-[7px] w-[7px] shrink-0 rounded-full', status.dotClass)} />
                                <span className={cn('shrink-0', status.textClass)}>{status.text}</span>
                                <span className="truncate">· {flavor ?? 'unknown'} · {getProjectName(getSessionProjectPath(session))}</span>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 px-4 pb-5">
                        {quickActions.map((action) => (
                            <button
                                key={action.key}
                                type="button"
                                disabled={!action.onClick}
                                onClick={closeInfoThen(action.onClick)}
                                className="flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--social-border)] py-3 text-[12px] text-[var(--social-fg)] transition-colors active:bg-[var(--social-muted)] disabled:opacity-35"
                            >
                                {action.icon}
                                {action.label}
                            </button>
                        ))}
                    </div>

                    {props.onViewModeChange ? (
                        <SheetSection title={t('mobile.chat.view')}>
                            <div className="flex gap-1 bg-[var(--social-muted)] p-1">
                                {viewModes.map((item) => (
                                    <button
                                        key={item.mode}
                                        type="button"
                                        onClick={() => {
                                            props.onViewModeChange?.(item.mode)
                                            setInfoOpen(false)
                                        }}
                                        className={cn(
                                            'flex-1 rounded-[10px] py-2 text-[14px] transition-colors',
                                            props.viewMode === item.mode
                                                ? 'bg-[var(--app-bg)] font-medium text-[var(--social-fg)] shadow-sm'
                                                : 'text-[var(--social-fg-muted)]'
                                        )}
                                    >
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </SheetSection>
                    ) : null}

                    <SheetSection>
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
                                        className="max-w-[210px] truncate bg-transparent text-right text-[14px] text-[var(--app-hint)] outline-none"
                                    >
                                        {!session.metadata.claudeAccount ? <option value="">{t('sessionAccount.machineDefault')}</option> : null}
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
                        <div role="alert" className="px-7 pb-3 text-[12px] text-red-500">{accountSwitchError}</div>
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
                        <SheetRow icon={<PencilIcon className="h-4 w-4" />} label={t('session.action.rename')} chevron onClick={closeInfoThen(() => setRenameOpen(true))} />
                        <SheetRow icon={<CopyPlusIcon className="h-4 w-4" />} label={t('session.action.newSameConfig')} chevron onClick={closeInfoThen(handleSpawnSameConfig)} />
                        <SheetRow icon={<CopyPlusIcon className="h-4 w-4" />} label={t('session.action.duplicate')} chevron onClick={closeInfoThen(handleDuplicate)} />
                        {session.active ? (
                            <SheetRow icon={<ArchiveBoxIcon className="h-4 w-4" />} label={t('session.action.archive')} destructive onClick={closeInfoThen(handleArchive)} />
                        ) : (
                            <SheetRow icon={<TrashIcon className="h-4 w-4" />} label={t('session.action.delete')} destructive onClick={closeInfoThen(() => setDeleteOpen(true))} />
                        )}
                    </SheetSection>
                    <div className="h-2" />
                </BottomSheet>

                {dialogs}
            </>
        )
    }

    return (
        <>

            <div className="bg-[var(--app-bg)] pt-[env(safe-area-inset-top)]">
                <div className="mx-auto w-full max-w-content flex items-center gap-2 p-3">
                    <div className="flex items-center gap-1">
                        {/* Back button */}
                        <button
                            type="button"
                            onClick={props.onBack}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        >
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
                            >
                                <polyline points="15 18 9 12 15 6" />
                            </svg>
                        </button>

                        {props.onToggleSidebar ? (
                            <button
                                type="button"
                                onClick={props.onToggleSidebar}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                                title={sidebarToggleLabel}
                                aria-label={sidebarToggleLabel}
                            >
                                <SidebarIcon />
                            </button>
                        ) : null}
                    </div>

                    {/* Session info - two lines: title and path */}
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-semibold">
                            {title}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--app-hint)]">
                            <span className="inline-flex items-center gap-1">
                                <span aria-hidden="true">❖</span>
                                {session.metadata?.flavor?.trim() || 'unknown'}
                            </span>
                            <span>
                                {t('session.item.model')}: {displayModel}
                                {displayThinkEffort ? ` · ${t('session.item.thinkLevel')}: ${displayThinkEffort}` : ''}
                                {displayServiceTier ? ` · ${t('newSession.serviceTier')}: ${displayServiceTier}` : ''}
                            </span>
                            {worktreeBranch ? (
                                <span>{t('session.item.worktree')}: {worktreeBranch}</span>
                            ) : null}
                            {session.metadata?.flavor === 'claude' && session.metadata.claudeAccount ? (
                                <SessionAccountInline
                                    account={session.metadata.claudeAccount}
                                    snapshot={session.metadata.rateLimitSnapshot}
                                />
                            ) : null}
                            {session.metadata?.flavor === 'claude' && accountQuery.data?.pool.profiles.length ? (
                                <>
                                <select
                                    aria-label={t('sessionAccount.switch')}
                                    value={session.metadata.claudeAccount?.id ?? ''}
                                    disabled={accountSwitching}
                                    onChange={(event) => void handleAccountSwitch(event.target.value)}
                                    className="max-w-[220px] rounded border border-[var(--app-divider)] bg-transparent px-1 text-xs"
                                >
                                    {!session.metadata.claudeAccount ? <option value="">{t('sessionAccount.machineDefault')}</option> : null}
                                    {accountQuery.data.pool.profiles.filter(profile => profile.enabled).map(profile => {
                                        const quota = quotaOptionLabel(accountQuery.data?.usage?.[profile.id], t)
                                        return <option key={profile.id} value={profile.id}>{profile.email}{quota ? ` · ${quota}` : ''}</option>
                                    })}
                                </select>
                                {accountSwitchError ? <span role="alert" className="text-red-500">{accountSwitchError}</span> : null}
                                </>
                            ) : null}
                        </div>
                    </div>

                    {props.onViewPreview ? (
                        <button
                            type="button"
                            onClick={props.onViewPreview}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title="Preview"
                            aria-label="Preview"
                        >
                            <BrowserIcon />
                        </button>
                    ) : null}

                    {props.onViewFiles ? (
                        <button
                            type="button"
                            onClick={props.onViewFiles}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.title')}
                        >
                            <FilesIcon />
                        </button>
                    ) : null}

                    {props.onViewMcpStatus ? (
                        <button
                            type="button"
                            onClick={props.onViewMcpStatus}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                            title={t('session.mcpStatus')}
                            aria-label={t('session.mcpStatus')}
                        >
                            <PlugIcon />
                        </button>
                    ) : null}

                    <button
                        type="button"
                        onClick={handleMenuToggle}
                        onPointerDown={(e) => e.stopPropagation()}
                        ref={menuAnchorRef}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        aria-controls={menuOpen ? menuId : undefined}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                        title={t('session.more')}
                    >
                        <MoreVerticalIcon />
                    </button>
                </div>
            </div>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={session.active}
                onRename={() => setRenameOpen(true)}
                onSpawnSameConfig={handleSpawnSameConfig}
                onDuplicate={handleDuplicate}
                onArchive={handleArchive}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
                menuId={menuId}
            />

            {dialogs}
        </>
    )
}
