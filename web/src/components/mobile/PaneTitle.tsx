import type { ReactNode } from 'react'
import { FitLine, FitText } from '@/components/ui/FitText'
import { cn } from '@/lib/utils'

/**
 * Avatar + one-line title + subtitle, the identity part of the page headers (SubPageHeader on
 * phones, DesktopPaneHeader on desktop). A string subtitle is a one-line preview, or `id` for a path
 * (cut in the middle so the file name stays); a node is laid out in a row (status dot, text).
 */
export function PaneTitle(props: {
    avatar?: ReactNode
    title: ReactNode
    /** Shorter forms of a string title, tried when it does not fit on the line. */
    titleCandidates?: ReadonlyArray<string | null | undefined>
    subtitle?: ReactNode
    subtitleKind?: 'preview' | 'id'
    /** Larger title for headers without an avatar. */
    large?: boolean
}) {
    return (
        <>
            {props.avatar}
            <div className="min-w-0 flex-1">
                <FitLine
                    text={props.title}
                    candidates={props.titleCandidates}
                    className={cn('font-semibold leading-tight tracking-[-0.01em] text-[var(--social-fg)]', props.large ? 'text-headline' : 'text-body')}
                />
                {typeof props.subtitle === 'string' ? (
                    <FitText kind={props.subtitleKind ?? 'preview'} text={props.subtitle} className="mt-[3px] text-caption leading-tight text-[var(--social-fg-muted)]" />
                ) : props.subtitle ? (
                    <div className="mt-[3px] flex min-w-0 items-center gap-1.5 text-caption leading-tight text-[var(--social-fg-muted)]">{props.subtitle}</div>
                ) : null}
            </div>
        </>
    )
}
