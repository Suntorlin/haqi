import type { ReactNode } from 'react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import { useSessions } from '@/hooks/queries/useSessions'
import { usePlatform } from '@/hooks/usePlatform'
import { CountBadge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/IconButton'
import { ChatsIcon, GroupsIcon, MeIcon, MemoryIcon, ScheduledIcon } from '@/components/mobile/icons'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { FitLine } from '@/components/ui/FitText'

export type MobileTab = 'sessions' | 'groups' | 'memory' | 'scheduled' | 'settings'

const TAB_ROUTES: Record<MobileTab, '/sessions' | '/groups' | '/memory' | '/scheduled' | '/settings'> = {
    sessions: '/sessions',
    groups: '/groups',
    memory: '/memory',
    scheduled: '/scheduled',
    settings: '/settings'
}

type NavTab = { key: MobileTab; label: string; icon: (filled: boolean) => ReactNode; badge?: number }

function useNavTabs(sessionsBadge?: number): NavTab[] {
    const { t } = useTranslation()
    return [
        { key: 'sessions', label: t('mobile.tab.sessions'), icon: (filled) => <ChatsIcon filled={filled} />, badge: sessionsBadge },
        { key: 'groups', label: t('mobile.tab.groups'), icon: (filled) => <GroupsIcon filled={filled} /> },
        { key: 'memory', label: t('mobile.tab.memory'), icon: (filled) => <MemoryIcon filled={filled} /> },
        { key: 'scheduled', label: t('mobile.tab.scheduled'), icon: (filled) => <ScheduledIcon filled={filled} /> },
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
    // Review loops and employees have no entry of their own; their pages light 我 (settings).
    if (pathname.startsWith('/review-loops')) return 'settings'
    if (pathname.startsWith('/employees')) return 'settings'
    if (pathname.startsWith('/scheduled')) return 'scheduled'
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
            <IconButton
                variant="filled"
                label="HAQI"
                onClick={() => navigate({ to: '/sessions' })}
                className="mb-6 rounded-xl text-body font-semibold tracking-[-0.04em]"
            >
                H
            </IconButton>
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
                    <FitLine text={props.title} className="text-title font-semibold leading-tight tracking-[-0.035em] text-[var(--social-fg)]" />
                    {props.subtitle ? (
                        <FitLine text={props.subtitle} className="mt-0.5 text-caption leading-tight text-[var(--social-fg-muted)]" />
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

