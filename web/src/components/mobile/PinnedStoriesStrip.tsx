import { useCallback, useMemo, useState } from 'react'
import type { SessionSummary } from '@/types/api'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { getSessionTitle } from '@/lib/session-title'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { useArchiveConfirmation } from '@/hooks/useArchiveConfirmation'
import { SessionAvatar } from '@/components/mobile/SessionAvatar'
import { ArchiveBoxIcon, PinOffIcon } from '@/components/mobile/icons'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/mobile/ContextMenu'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

/** Pinned sessions that need attention come first: waiting for approval, then running, then recent. */
function sortPinned(sessions: SessionSummary[]): SessionSummary[] {
    const rank = (session: SessionSummary) => {
        if (session.active && session.pendingRequestsCount > 0) return 0
        if (session.active && session.thinking) return 1
        if (session.active) return 2
        return 3
    }
    return [...sessions].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
}

function PinnedStory(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    onMenu: (session: SessionSummary, point: { x: number; y: number }) => void
}) {
    const { t } = useTranslation()
    const { haptic } = usePlatform()
    const { session } = props
    const isPending = session.active && session.pendingRequestsCount > 0
    const isLive = session.active && session.thinking
    const title = getSessionTitle(session)
    const pressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            props.onMenu(session, point)
        },
        onClick: () => props.onSelect(session.id),
        threshold: 450
    })

    return (
        <button
            type="button"
            {...pressHandlers}
            className="flex w-14 shrink-0 select-none flex-col items-center gap-1.5 [-webkit-tap-highlight-color:transparent]"
            style={{ WebkitTouchCallout: 'none' }}
            title={title}
        >
            <span className="relative flex h-[46px] w-14 items-center justify-center">
                <SessionAvatar
                    session={session}
                    size={46}
                    ring={isPending ? 'pending' : isLive ? 'live' : session.active ? 'seen' : null}
                    muted={!session.active}
                />
                {isPending || isLive ? (
                    <span
                        className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 text-[12px] font-semibold leading-4 text-white ring-2 ring-[var(--app-bg)]"
                        style={{
                            background: isPending
                                ? 'linear-gradient(90deg, #f59e0b, #f43f5e)'
                                : 'linear-gradient(90deg, #c13584, #e1306c, #fd1d1d)'
                        }}
                    >
                        {isPending ? t('mobile.stories.pending') : t('mobile.stories.live')}
                    </span>
                ) : null}
            </span>
            <span className={cn('mt-1.5 w-full truncate text-center text-[12px]', isPending || isLive ? 'font-semibold text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)]')}>
                {title}
            </span>
        </button>
    )
}

/**
 * Instagram-style row of the sessions the user pinned (WeChat "置顶"): they live here instead
 * of in the list below, with the same status rings. Long-press / right-click to unpin, or to
 * archive a running session (which unpins it too).
 * Nothing pinned → no row, the list starts right away (pin from a row's menu).
 */
export function PinnedStoriesStrip(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onUnpin: (session: SessionSummary) => void
    onArchive?: (session: SessionSummary) => Promise<void>
}) {
    const { t } = useTranslation()
    const stories = useMemo(() => sortPinned(props.sessions), [props.sessions])
    const [menu, setMenu] = useState<{ session: SessionSummary; point: { x: number; y: number } } | null>(null)
    const closeMenu = useCallback(() => setMenu(null), [])
    const { skipArchiveConfirmation } = useArchiveConfirmation()
    const [archiveTarget, setArchiveTarget] = useState<SessionSummary | null>(null)
    const [archiving, setArchiving] = useState(false)

    // Same rule as the session menu: archive (stop) only applies to a running session.
    const archive = (session: SessionSummary) => {
        if (!props.onArchive) return
        if (!skipArchiveConfirmation) {
            setArchiveTarget(session)
            return
        }
        void props.onArchive(session).catch((error) => {
            console.error('Failed to archive session', error)
        })
    }
    const confirmArchive = async () => {
        if (!archiveTarget || !props.onArchive) return
        setArchiving(true)
        try {
            await props.onArchive(archiveTarget)
        } finally {
            setArchiving(false)
        }
    }

    if (stories.length === 0) return null

    return (
        <div className="pb-1">
            <div className="px-5 pb-1.5 text-[12px] font-semibold text-[var(--social-fg-muted)]">
                {t('mobile.stories.pinned')}
            </div>
            <div className="social-scroll-x flex gap-4 overflow-x-auto px-5 pb-3 pt-1">
                <button
                    type="button"
                    onClick={props.onNewSession}
                    className="flex w-14 shrink-0 flex-col items-center gap-1.5 [-webkit-tap-highlight-color:transparent]"
                >
                    <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-[var(--social-muted)] text-[var(--social-fg-muted)] transition-colors hover:text-[var(--social-fg)]">
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </span>
                    <span className="w-full truncate text-center text-[12px] text-[var(--social-fg-muted)]">
                        {t('mobile.stories.new')}
                    </span>
                </button>

                {stories.map((session) => (
                    <PinnedStory
                        key={session.id}
                        session={session}
                        onSelect={props.onSelect}
                        onMenu={(target, point) => setMenu({ session: target, point })}
                    />
                ))}
            </div>
            <ContextMenu open={menu !== null} anchorPoint={menu?.point ?? { x: 0, y: 0 }} onClose={closeMenu} label={t('session.more')}>
                <ContextMenuItem
                    icon={<PinOffIcon />}
                    label={t('session.action.unpin')}
                    onSelect={() => {
                        if (menu) props.onUnpin(menu.session)
                        closeMenu()
                    }}
                />
                {menu?.session.active && props.onArchive ? (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                            icon={<ArchiveBoxIcon />}
                            label={t('session.action.archive')}
                            destructive
                            onSelect={() => {
                                archive(menu.session)
                                closeMenu()
                            }}
                        />
                    </>
                ) : null}
            </ContextMenu>
            <ConfirmDialog
                isOpen={archiveTarget !== null}
                onClose={() => setArchiveTarget(null)}
                title={t('dialog.archive.title')}
                description={t('dialog.archive.descriptionPinned', { name: archiveTarget ? getSessionTitle(archiveTarget) : '' })}
                confirmLabel={t('dialog.archive.confirm')}
                confirmingLabel={t('dialog.archive.confirming')}
                onConfirm={confirmArchive}
                isPending={archiving}
                destructive
            />
        </div>
    )
}
