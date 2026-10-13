import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionSummary } from '@/types/api'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { getSessionTitle } from '@/lib/session-title'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { SessionAvatar } from '@/components/mobile/SessionAvatar'
import { PinOffIcon } from '@/components/mobile/icons'

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
            className="flex w-16 shrink-0 select-none flex-col items-center gap-1.5 [-webkit-tap-highlight-color:transparent]"
            style={{ WebkitTouchCallout: 'none' }}
            title={title}
        >
            <span className="relative flex h-16 w-16 items-center justify-center">
                <SessionAvatar
                    session={session}
                    size={64}
                    ring={isPending ? 'pending' : isLive ? 'live' : session.active ? 'seen' : null}
                    muted={!session.active}
                />
                {isPending || isLive ? (
                    <span
                        className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[5px] px-[5px] text-[9.5px] font-bold leading-[15px] tracking-wide text-white ring-2 ring-[var(--app-bg)]"
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
            <span className={cn('w-full truncate text-center text-[11.5px]', isPending || isLive ? 'font-medium text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)]')}>
                {title}
            </span>
        </button>
    )
}

/** Small context menu for a pinned story: currently only "unpin". */
function PinnedStoryMenu(props: { point: { x: number; y: number }; onUnpin: () => void; onClose: () => void }) {
    const { t } = useTranslation()
    const menuRef = useRef<HTMLDivElement | null>(null)
    const { onClose } = props

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current?.contains(event.target as Node)) return
            onClose()
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('resize', onClose)
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', onClose)
        }
    }, [onClose])

    const width = 168
    const left = Math.min(Math.max(props.point.x - width / 2, 8), window.innerWidth - width - 8)
    const top = Math.min(props.point.y + 8, window.innerHeight - 64)

    return createPortal(
        <div
            ref={menuRef}
            role="menu"
            className="animate-menu-pop fixed z-50 rounded-xl border border-[var(--social-border)] bg-[var(--app-bg)] p-1 shadow-lg"
            style={{ left, top, width }}
        >
            <button
                type="button"
                role="menuitem"
                autoFocus
                onClick={() => {
                    props.onUnpin()
                    onClose()
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[14px] text-[var(--social-fg)] transition-colors hover:bg-[var(--social-muted)] focus-visible:bg-[var(--social-muted)] focus-visible:outline-none"
            >
                <PinOffIcon className="h-4 w-4 text-[var(--social-fg-muted)]" />
                {t('session.action.unpin')}
            </button>
        </div>,
        document.body
    )
}

/**
 * Instagram-style row of the sessions the user pinned (WeChat "置顶"): they live here instead
 * of in the list below, with the same status rings. Long-press / right-click to unpin.
 * Nothing pinned → no row, the list starts right away (pin from a row's menu).
 */
export function PinnedStoriesStrip(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onUnpin: (session: SessionSummary) => void
}) {
    const { t } = useTranslation()
    const stories = useMemo(() => sortPinned(props.sessions), [props.sessions])
    const [menu, setMenu] = useState<{ session: SessionSummary; point: { x: number; y: number } } | null>(null)
    const closeMenu = useCallback(() => setMenu(null), [])

    if (stories.length === 0) return null

    return (
        <div className="pb-1">
            <div className="px-5 pb-1.5 text-[12px] font-medium text-[var(--social-fg-muted)]">
                {t('mobile.stories.pinned')}
            </div>
            <div className="social-scroll-x flex gap-4 overflow-x-auto px-5 pb-3 pt-1">
                <button
                    type="button"
                    onClick={props.onNewSession}
                    className="flex w-16 shrink-0 flex-col items-center gap-1.5 [-webkit-tap-highlight-color:transparent]"
                >
                    <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--social-muted)] text-[var(--social-fg-muted)] transition-colors hover:text-[var(--social-fg)]">
                        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </span>
                    <span className="w-full truncate text-center text-[11.5px] text-[var(--social-fg-muted)]">
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
            {menu ? (
                <PinnedStoryMenu
                    point={menu.point}
                    onUnpin={() => props.onUnpin(menu.session)}
                    onClose={closeMenu}
                />
            ) : null}
        </div>
    )
}
