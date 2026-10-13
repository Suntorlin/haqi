import type { ReactNode } from 'react'
import { useTranslation } from '@/lib/use-translation'

function SidebarToggleIcon(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={props.className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M9.5 4v16" />
        </svg>
    )
}

/** Round icon button used in desktop pane headers. */
export function DesktopIconButton(props: { label: string; onClick?: () => void; children: ReactNode; disabled?: boolean }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[var(--social-fg-muted)] transition-colors hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)] disabled:opacity-40"
            title={props.label}
            aria-label={props.label}
        >
            {props.children}
        </button>
    )
}

/**
 * One-line header of a desktop content pane (chat, group, loop): list toggle, avatar,
 * title with a status line, then icon actions on the right.
 */
export function DesktopPaneHeader(props: {
    avatar?: ReactNode
    title: ReactNode
    subtitle?: ReactNode
    actions?: ReactNode
    listVisible?: boolean
    onToggleList?: () => void
    onTitleClick?: () => void
    titleLabel?: string
}) {
    const { t } = useTranslation()
    const toggleLabel = props.listVisible ? t('sessions.sidebar.hideDesktop') : t('sessions.sidebar.showDesktop')
    const identity = (
        <>
            {props.avatar}
            <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold leading-tight tracking-[-0.01em] text-[var(--social-fg)]">
                    {props.title}
                </div>
                {props.subtitle ? (
                    <div className="mt-[3px] flex min-w-0 items-center gap-1.5 text-[12px] leading-tight text-[var(--social-fg-muted)]">
                        {props.subtitle}
                    </div>
                ) : null}
            </div>
        </>
    )

    return (
        <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-1.5 border-b border-[var(--social-border)] bg-[var(--app-bg)] pl-3 pr-4">
            {props.onToggleList ? (
                <DesktopIconButton label={toggleLabel} onClick={props.onToggleList}>
                    <SidebarToggleIcon className="h-[19px] w-[19px]" />
                </DesktopIconButton>
            ) : null}
            {props.onTitleClick ? (
                <button
                    type="button"
                    onClick={props.onTitleClick}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-xl py-1 pl-1.5 pr-2 text-left transition-colors hover:bg-[var(--social-hover)]"
                    title={props.titleLabel}
                >
                    {identity}
                </button>
            ) : (
                <div className="flex min-w-0 flex-1 items-center gap-3 py-1 pl-1.5 pr-2">
                    {identity}
                </div>
            )}
            {props.actions ? (
                <div className="flex shrink-0 items-center gap-0.5">
                    {props.actions}
                </div>
            ) : null}
        </header>
    )
}
