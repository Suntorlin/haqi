import type { ReactNode } from 'react'
import { ChevronLeftIcon } from '@/components/mobile/icons'
import { IconButton } from '@/components/ui/IconButton'
import { FitLine, FitText } from '@/components/ui/FitText'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

/** Round icon button for sub-page header actions. */
export function SubPageHeaderButton(props: { label: string; onClick: () => void; children: ReactNode }) {
    return (
        <IconButton label={props.label} onClick={props.onClick}>
            {props.children}
        </IconButton>
    )
}

/**
 * Header of second-level pages (new session, files, terminal, a chat, a group, a loop): back, an
 * optional avatar, title with a subtitle or status line, actions. With `onTitleClick` the avatar and
 * title open the page's info. The title keeps to one line: pass `titleCandidates` for shorter forms.
 */
export function SubPageHeader(props: {
    title: ReactNode
    /** Shorter forms of a string title, tried when it does not fit on the line. */
    titleCandidates?: ReadonlyArray<string | null | undefined>
    /** A string is a one-line preview; a node is laid out in a row (status dot, text). */
    subtitle?: ReactNode
    avatar?: ReactNode
    onTitleClick?: () => void
    onBack?: () => void
    actions?: ReactNode
}) {
    const { t } = useTranslation()
    const identity = (
        <>
            {props.avatar}
            <div className="min-w-0 flex-1">
                <FitLine
                    text={props.title}
                    candidates={props.titleCandidates}
                    className={cn('font-semibold leading-tight tracking-[-0.01em] text-[var(--social-fg)]', props.avatar ? 'text-body' : 'text-headline')}
                />
                {typeof props.subtitle === 'string' ? (
                    <FitText kind="preview" text={props.subtitle} className="mt-0.5 text-caption leading-tight text-[var(--social-fg-muted)]" />
                ) : props.subtitle ? (
                    <div className="mt-[3px] flex min-w-0 items-center gap-1.5 text-caption leading-tight text-[var(--social-fg-muted)]">{props.subtitle}</div>
                ) : null}
            </div>
        </>
    )
    return (
        <header className="social-bar relative z-20 shrink-0 border-b border-[var(--social-border)] pt-[env(safe-area-inset-top)]">
            <div className="flex h-[54px] items-center gap-1 pl-1 pr-3 lg:h-[60px] lg:pl-2 lg:pr-4">
                {props.onBack ? (
                    <IconButton label={t('button.back')} onClick={props.onBack} className="text-[var(--social-fg)]">
                        <ChevronLeftIcon className="h-6 w-6" />
                    </IconButton>
                ) : (
                    <span className="w-3 shrink-0" />
                )}
                {props.onTitleClick ? (
                    <button
                        type="button"
                        onClick={props.onTitleClick}
                        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl py-1 pr-1 text-left [-webkit-tap-highlight-color:transparent]"
                    >
                        {identity}
                    </button>
                ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">{identity}</div>
                )}
                {props.actions ? <div className="flex shrink-0 items-center gap-1">{props.actions}</div> : null}
            </div>
        </header>
    )
}
