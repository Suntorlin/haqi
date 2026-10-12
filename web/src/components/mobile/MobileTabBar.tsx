import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { usePlatform } from '@/hooks/usePlatform'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export type MobileTab = 'sessions' | 'groups' | 'loops' | 'settings'

function ChatsIcon(props: { filled: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={props.filled ? 0 : 1.8} strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3.5c-4.97 0-9 3.47-9 7.75 0 2.33 1.2 4.42 3.09 5.84-.13 1.17-.62 2.33-1.44 3.25 1.9-.12 3.56-.8 4.73-1.73.84.25 1.72.39 2.62.39 4.97 0 9-3.47 9-7.75S16.97 3.5 12 3.5z" />
            {props.filled ? null : (
                <>
                    <circle cx="8.2" cy="11.3" r="0.9" fill="currentColor" stroke="none" />
                    <circle cx="12" cy="11.3" r="0.9" fill="currentColor" stroke="none" />
                    <circle cx="15.8" cy="11.3" r="0.9" fill="currentColor" stroke="none" />
                </>
            )}
        </svg>
    )
}

function GroupsIcon(props: { filled: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={props.filled ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="9" cy="8.5" r="3.5" />
            <path d="M2.5 19.5c.6-3.4 3.3-5.5 6.5-5.5s5.9 2.1 6.5 5.5z" />
            <circle cx="16.8" cy="9.2" r="2.7" />
            <path d="M16.6 13.6c2.6.1 4.4 1.9 4.9 4.9h-4.1" />
        </svg>
    )
}

function LoopsIcon(props: { filled: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill="none" stroke="currentColor" strokeWidth={props.filled ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
            <polyline points="4 3.5 4 8 8.5 8" />
            <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
            <polyline points="20 20.5 20 16 15.5 16" />
        </svg>
    )
}

function MeIcon(props: { filled: boolean }) {
    return (
        <svg viewBox="0 0 24 24" className="h-[26px] w-[26px]" fill={props.filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={props.filled ? 0 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20.5c.8-4 4-6.5 8-6.5s7.2 2.5 8 6.5z" />
        </svg>
    )
}

const TAB_ROUTES: Record<MobileTab, '/sessions' | '/groups' | '/review-loops' | '/settings'> = {
    sessions: '/sessions',
    groups: '/groups',
    loops: '/review-loops',
    settings: '/settings'
}

/** WeChat / Instagram style bottom tab bar for the mobile top-level pages. */
export function MobileTabBar(props: { active: MobileTab; sessionsBadge?: number }) {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { haptic } = usePlatform()

    const tabs: Array<{ key: MobileTab; label: string; icon: (filled: boolean) => ReactNode; badge?: number }> = [
        { key: 'sessions', label: t('mobile.tab.sessions'), icon: (filled) => <ChatsIcon filled={filled} />, badge: props.sessionsBadge },
        { key: 'groups', label: t('mobile.tab.groups'), icon: (filled) => <GroupsIcon filled={filled} /> },
        { key: 'loops', label: t('mobile.tab.loops'), icon: (filled) => <LoopsIcon filled={filled} /> },
        { key: 'settings', label: t('mobile.tab.me'), icon: (filled) => <MeIcon filled={filled} /> }
    ]

    return (
        <nav className="social-bar relative z-20 shrink-0 border-t border-[var(--social-bar-border)] pb-[env(safe-area-inset-bottom)]">
            <div className="mx-auto flex h-[52px] max-w-xl">
                {tabs.map((tab) => {
                    const isActive = tab.key === props.active
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => {
                                if (isActive) return
                                haptic.selection()
                                navigate({ to: TAB_ROUTES[tab.key] })
                            }}
                            className={cn(
                                'relative flex flex-1 flex-col items-center justify-center gap-0.5 text-[10.5px] font-medium [-webkit-tap-highlight-color:transparent]',
                                isActive ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]'
                            )}
                            aria-current={isActive ? 'page' : undefined}
                        >
                            <span className="relative">
                                {tab.icon(isActive)}
                                {tab.badge && tab.badge > 0 ? (
                                    <span className="absolute -right-2.5 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--social-badge)] px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-[var(--social-sheet-bg)]">
                                        {tab.badge > 99 ? '99+' : tab.badge}
                                    </span>
                                ) : null}
                            </span>
                            <span>{tab.label}</span>
                        </button>
                    )
                })}
            </div>
        </nav>
    )
}

/** Compact large-title page header used by the mobile top-level pages. */
export function MobilePageHeader(props: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
    return (
        <header className="social-bar relative z-20 shrink-0 border-b border-[var(--social-bar-border)] pt-[env(safe-area-inset-top)]">
            <div className="mx-auto flex h-[50px] max-w-xl items-center gap-2 px-4">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[22px] font-bold leading-tight tracking-[-0.02em]">
                        {props.title}
                    </div>
                    {props.subtitle ? (
                        <div className="truncate text-[11px] leading-tight text-[var(--app-hint)]">
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
        <button
            type="button"
            onClick={props.onClick}
            className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full transition-colors [-webkit-tap-highlight-color:transparent] active:bg-[var(--app-subtle-bg)]',
                props.active ? 'text-[var(--app-fg)] bg-[var(--app-subtle-bg)]' : 'text-[var(--app-fg)]'
            )}
            title={props.label}
            aria-label={props.label}
        >
            {props.children}
        </button>
    )
}
