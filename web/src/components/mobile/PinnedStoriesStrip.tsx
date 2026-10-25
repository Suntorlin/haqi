import { useCallback, useMemo, useRef, useState } from 'react'
import { useUnreadSessions } from '@/lib/unread-sessions'
import type { SessionSummary } from '@/types/api'
import { useEdgeBounce } from '@/hooks/useEdgeBounce'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { getSessionLabelCandidates, getSessionTitle } from '@/lib/session-title'
import { FitText } from '@/components/ui/FitText'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { useArchiveConfirmation } from '@/hooks/useArchiveConfirmation'
import { SessionAvatar } from '@/components/mobile/SessionAvatar'
import { ArchiveBoxIcon, ChevronDownIcon, MoonIcon, PinOffIcon, PlusIcon } from '@/components/mobile/icons'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/mobile/ContextMenu'
import { SnoozeOptions } from '@/components/SessionActionMenu'
import { SessionSnoozeDialog } from '@/components/SessionSnoozeDialog'
import { Badge } from '@/components/ui/badge'
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
    const unreadSessions = useUnreadSessions()
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
            className="flex w-16 shrink-0 select-none flex-col items-center gap-1.5 [-webkit-tap-highlight-color:transparent]"
            style={{ WebkitTouchCallout: 'none' }}
            title={title}
        >
            <span className="relative flex h-[46px] w-16 items-center justify-center">
                <SessionAvatar
                    session={session}
                    size={46}
                    ring={isPending ? 'pending' : isLive ? 'live' : session.active ? 'seen' : null}
                    muted={!session.active}
                    unread={unreadSessions.has(session.id) && !isPending}
                />
                {isPending || isLive ? (
                    <Badge
                        variant={isPending ? 'warning' : 'solid'}
                        className={cn(
                            'absolute -bottom-1.5 left-1/2 h-5 -translate-x-1/2 px-2 ring-2 ring-[var(--social-surface)]',
                            !isPending && 'bg-[var(--social-badge)] text-[var(--social-on-accent)]'
                        )}
                    >
                        {isPending ? t('mobile.stories.pending') : t('mobile.stories.live')}
                    </Badge>
                ) : null}
            </span>
            <FitText
                kind="label"
                text={title}
                candidates={getSessionLabelCandidates(session)}
                className={cn('mt-1.5 w-full text-center text-caption', isPending || isLive ? 'font-semibold text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)]')}
            />
        </button>
    )
}

/**
 * Instagram-style row of the sessions the user pinned (WeChat "置顶"): they live here instead
 * of in the list below, with the same status rings. Long-press / right-click to unpin, to snooze
 * (the session leaves the row until it wakes, still pinned), or to archive a running session
 * (which unpins it too).
 * Nothing pinned → no row, the list starts right away (pin from a row's menu).
 */
export function PinnedStoriesStrip(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onUnpin: (session: SessionSummary) => void
    onSnooze?: (session: SessionSummary, until: number) => Promise<void>
    onArchive?: (session: SessionSummary) => Promise<void>
}) {
    const { t } = useTranslation()
    const stories = useMemo(() => sortPinned(props.sessions), [props.sessions])
    const [menu, setMenu] = useState<{ session: SessionSummary; point: { x: number; y: number } } | null>(null)
    const [snoozeExpanded, setSnoozeExpanded] = useState(false)
    const closeMenu = useCallback(() => {
        setMenu(null)
        setSnoozeExpanded(false)
    }, [])
    const [snoozeTarget, setSnoozeTarget] = useState<SessionSummary | null>(null)
    const { skipArchiveConfirmation } = useArchiveConfirmation()
    const [archiveTarget, setArchiveTarget] = useState<SessionSummary | null>(null)
    const [archiving, setArchiving] = useState(false)
    const scrollerRef = useRef<HTMLDivElement>(null)
    const rowRef = useRef<HTMLDivElement>(null)
    useEdgeBounce(scrollerRef, rowRef, stories.length > 0)

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
    const snooze = (session: SessionSummary, until: number) => {
        void props.onSnooze?.(session, until).catch((error) => {
            console.error('Failed to snooze session', error)
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
        <div className="pb-1" role="group" aria-label={t('mobile.stories.pinned')}>
            {/* The inner row carries the side padding (WebKit leaves a scroller's own end padding out of
                its scroll width) and moves with the edge bounce. */}
            <div ref={scrollerRef} className="overflow-x-auto overscroll-x-none">
                <div ref={rowRef} className="flex w-max gap-2 px-4 pb-3 pt-1">
                    <button
                        type="button"
                        onClick={props.onNewSession}
                        className="flex w-16 shrink-0 flex-col items-center gap-1.5 [-webkit-tap-highlight-color:transparent]"
                    >
                        <span className="flex h-[46px] w-[46px] items-center justify-center rounded-full bg-[var(--social-muted)] text-[var(--social-fg-muted)] transition-colors hover:text-[var(--social-fg)]">
                            <PlusIcon className="h-5 w-5" />
                        </span>
                        {/* mt-1.5 matches the story labels (they leave room for the status badge) so the row's captions line up */}
                        <FitText kind="label" text={t('mobile.stories.new')} className="mt-1.5 w-full text-center text-caption text-[var(--social-fg-muted)]" />
                    </button>

                    {stories.map((session) => (
                        <PinnedStory
                            key={session.id}
                            session={session}
                            // Same rule as the list rows: iOS sends a click when the finger lifts after a
                            // long press, and it must not open the session under the menu it just showed.
                            onSelect={(sessionId) => {
                                if (!menu) props.onSelect(sessionId)
                            }}
                            onMenu={(target, point) => setMenu({ session: target, point })}
                        />
                    ))}
                </div>
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
                {menu && props.onSnooze ? (
                    <>
                        <ContextMenuItem
                            icon={<MoonIcon />}
                            label={t('session.action.snooze')}
                            hasPopup
                            expanded={snoozeExpanded}
                            onSelect={() => setSnoozeExpanded((expanded) => !expanded)}
                            trailing={(
                                <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', snoozeExpanded ? 'rotate-180' : '')} />
                            )}
                        />
                        {snoozeExpanded ? (
                            <SnoozeOptions
                                indent
                                onSnooze={(until) => {
                                    snooze(menu.session, until)
                                    closeMenu()
                                }}
                                onCustom={() => {
                                    setSnoozeTarget(menu.session)
                                    closeMenu()
                                }}
                            />
                        ) : null}
                    </>
                ) : null}
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
            <SessionSnoozeDialog
                isOpen={snoozeTarget !== null}
                onClose={() => setSnoozeTarget(null)}
                onSnooze={async (until) => {
                    if (snoozeTarget && props.onSnooze) await props.onSnooze(snoozeTarget, until)
                }}
            />
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
