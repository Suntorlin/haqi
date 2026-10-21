import type { ReactNode } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { SidebarIcon } from '@/components/mobile/icons'
import { useTranslation } from '@/lib/use-translation'

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
                <div className="truncate text-body font-semibold leading-tight tracking-[-0.01em] text-[var(--social-fg)]">
                    {props.title}
                </div>
                {props.subtitle ? (
                    <div className="mt-[3px] flex min-w-0 items-center gap-1.5 text-caption leading-tight text-[var(--social-fg-muted)]">
                        {props.subtitle}
                    </div>
                ) : null}
            </div>
        </>
    )

    return (
        <header className="relative z-20 flex h-[60px] shrink-0 items-center gap-1.5 border-b border-[var(--social-border)] bg-[var(--social-surface)] pl-3 pr-4">
            {props.onToggleList ? (
                <IconButton size="sm" label={toggleLabel} onClick={props.onToggleList}>
                    <SidebarIcon className="h-[19px] w-[19px]" />
                </IconButton>
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
