import type { ReactNode } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useSessions } from '@/hooks/queries/useSessions'
import { usePlatform } from '@/hooks/usePlatform'
import { CountBadge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/IconButton'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export type MobileTab = 'sessions' | 'groups' | 'loops' | 'memory' | 'settings'

function ChatsIcon(props: { filled: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="h-[25px] w-[25px]" fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={props.filled ? 0 : 1.7} strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3.5c-4.97 0-9 3.47-9 7.75 0 2.33 1.2 4.42 3.09 5.84-.13 1.17-.62 2.33-1.44 3.25 1.9-.12 3.56-.8 4.73-1.73.84.25 1.72.39 2.62.39 4.97 0 9-3.47 9-7.75S16.97 3.5 12 3.5z" />
        </svg>
    )
}

function GroupsIcon(props: { filled: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="h-[25px] w-[25px]" fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={props.filled ? 0 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="8.5" r="3.5" />
            <path d="M2.5 19.5c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5z" />
            <circle cx="16.8" cy="9.2" r="2.7" />
            <path d="M16.6 13.6c2.6.1 4.4 1.9 4.9 4.9h-4.1" />
        </svg>
    )
}

function LoopsIcon(props: { filled: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="h-[25px] w-[25px]" fill="none" stroke="currentColor" strokeWidth={props.filled ? 2.3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
            <polyline points="4 3.5 4 8 8.5 8" />
            <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
            <polyline points="20 20.5 20 16 15.5 16" />
        </svg>
    )
}

function MemoryIcon(props: { filled: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="h-[25px] w-[25px]" fill="none" stroke="currentColor" strokeWidth={props.filled ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="5" r="2.2" fill={props.filled ? 'currentColor' : 'none'} />
            <circle cx="5.5" cy="12.5" r="2.2" />
            <circle cx="18.5" cy="12.5" r="2.2" />
            <circle cx="9" cy="19.5" r="2" />
            <circle cx="15" cy="19.5" r="2" />
            <path d="M10.5 6.6 6.9 10.6M13.5 6.6l3.6 4M6.6 14.5l1.7 3.1M17.4 14.5l-1.7 3.1" />
        </svg>
    )
}

function MeIcon(props: { filled: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="h-[25px] w-[25px]" fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={props.filled ? 0 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20.5c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5z" />
        </svg>
    )
}

const TAB_ROUTES: Record<MobileTab, '/sessions' | '/groups' | '/review-loops' | '/memory' | '/settings'> = {
    sessions: '/sessions',
    groups: '/groups',
    loops: '/review-loops',
    memory: '/memory',
    settings: '/settings'
}

type NavTab = { key: MobileTab; label: string; icon: (filled: boolean) => ReactNode; badge?: number }

function useNavTabs(sessionsBadge?: number): NavTab[] {
    const { t } = useTranslation()
    return [
        { key: 'sessions', label: t('mobile.tab.sessions'), icon: (filled) => <ChatsIcon filled={filled} />, badge: sessionsBadge },
        { key: 'groups', label: t('mobile.tab.groups'), icon: (filled) => <GroupsIcon filled={filled} /> },
        { key: 'loops', label: t('mobile.tab.loops'), icon: (filled) => <LoopsIcon filled={filled} /> },
        { key: 'memory', label: t('mobile.tab.memory'), icon: (filled) => <MemoryIcon filled={filled} /> },
        { key: 'settings', label: t('mobile.tab.me'), icon: (filled) => <MeIcon filled={filled} /> }
    ]
}

function NavBadge(props: { count?: number }) {
    return <CountBadge count={props.count ?? 0} className="absolute -right-2.5 -top-1.5" />
}

/** Instagram-style icon-only bottom tab bar for the mobile top-level pages. */
export function MobileTabBar(props: { active: MobileTab; sessionsBadge?: number }) {
    const navigate = useNavigate()
    const { haptic } = usePlatform()
    const tabs = useNavTabs(props.sessionsBadge)

    return (
        <nav className="social-bar relative z-20 shrink-0 border-t border-[var(--social-border)] pb-[var(--safe-bottom)]">
            <div className="mx-auto flex h-[50px] max-w-xl">
                {tabs.map((tab) => {
                    const isActive = tab.key === props.active
                    return (
                        <IconButton
                            key={tab.key}
                            label={tab.label}
                            onClick={() => {
                                if (isActive) return
                                haptic.selection()
                                navigate({ to: TAB_ROUTES[tab.key] })
                            }}
                            aria-current={isActive ? 'page' : undefined}
                            className={cn(
                                'relative h-[50px] w-auto flex-1 rounded-xl hover:bg-transparent',
                                isActive ? 'text-[var(--social-fg)]' : 'text-[var(--social-fg-subtle)] hover:text-[var(--social-fg-subtle)]'
                            )}
                        >
                            <span className="relative">
                                {tab.icon(isActive)}
                                <NavBadge count={tab.badge} />
                            </span>
                        </IconButton>
                    )
                })}
            </div>
        </nav>
    )
}

function getActiveTab(pathname: string): MobileTab {
    if (pathname.startsWith('/groups')) return 'groups'
    if (pathname.startsWith('/review-loops')) return 'loops'
    if (pathname.startsWith('/memory')) return 'memory'
    if (pathname.startsWith('/settings')) return 'settings'
    return 'sessions'
}

/** Desktop counterpart of the tab bar: a slim icon rail on the left edge (WeChat / Instagram web). */
export function DesktopNavRail() {
    const navigate = useNavigate()
    const pathname = useLocation({ select: (location) => location.pathname })
    const { api } = useAppContext()
    const { sessions } = useSessions(api)
    const pendingSessions = sessions.filter((session) => session.active && session.pendingRequestsCount > 0).length
    const tabs = useNavTabs(pendingSessions)
    const active = getActiveTab(pathname)

    const renderTab = (tab: NavTab) => {
        const isActive = tab.key === active
        return (
            <IconButton
                key={tab.key}
                label={tab.label}
                onClick={() => navigate({ to: TAB_ROUTES[tab.key] })}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                    'relative',
                    isActive
                        ? 'bg-[var(--social-muted)] text-[var(--social-fg)]'
                        : 'text-[var(--social-fg-muted)] hover:bg-[var(--social-hover)] hover:text-[var(--social-fg)]'
                )}
            >
                <span className="relative">
                    {tab.icon(isActive)}
                    <NavBadge count={tab.badge} />
                </span>
            </IconButton>
        )
    }

    return (
        <nav className="flex h-full w-[72px] shrink-0 flex-col items-center border-r border-[var(--social-border)] bg-[var(--social-surface)] pb-4 pt-[calc(1rem+env(safe-area-inset-top))]">
            <button
                type="button"
                onClick={() => navigate({ to: '/sessions' })}
                className="mb-6 flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--social-primary)] text-[15px] font-semibold tracking-[-0.04em] text-[var(--social-primary-fg)] [-webkit-tap-highlight-color:transparent]"
                aria-label="HAQI"
                title="HAQI"
            >
                H
            </button>
            <div className="flex flex-col items-center gap-2">
                {tabs.filter((tab) => tab.key !== 'settings').map(renderTab)}
            </div>
            <div className="mt-auto flex flex-col items-center gap-2">
                {tabs.filter((tab) => tab.key === 'settings').map(renderTab)}
            </div>
        </nav>
    )
}

/** Compact large-title page header of the top-level pages (phone pages, desktop list columns). */
export function MobilePageHeader(props: {
    title: ReactNode
    subtitle?: ReactNode
    actions?: ReactNode
    /** Align with a `max-w-content` page body (settings) instead of the list column. */
    contentWidth?: boolean
}) {
    return (
        <header className="social-bar relative z-20 shrink-0 pt-[env(safe-area-inset-top)]">
            <div className={cn('mx-auto flex h-[54px] items-center gap-2 pr-3 lg:h-[68px]', props.contentWidth ? 'max-w-content pl-3' : 'max-w-xl pl-5')}>
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[20px] font-semibold leading-none tracking-[-0.035em] text-[var(--social-fg)]">
                        {props.title}
                    </div>
                    {props.subtitle ? (
                        <div className="mt-1 truncate text-[12px] leading-none text-[var(--social-fg-muted)]">
                            {props.subtitle}
                        </div>
                    ) : null}
                </div>
                {props.actions ? (
                    <div className="flex shrink-0 items-center gap-1">
                        {props.actions}
                    </div>
                ) : null}
            </div>
        </header>
    )
}

export function MobileHeaderIconButton(props: { label: string; onClick: () => void; children: ReactNode; active?: boolean }) {
    return (
        <IconButton
            label={props.label}
            onClick={props.onClick}
            className={cn('text-[var(--social-fg)]', props.active ? 'bg-[var(--social-muted)]' : '')}
        >
            {props.children}
        </IconButton>
    )
}
