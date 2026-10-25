import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/utils'
import { FitText } from './FitText'

const FEED_ROW_CLASS = 'social-pressable flex w-full items-center gap-3.5 px-5 py-2.5 text-left select-none lg:mx-2 lg:w-[calc(100%-1rem)] lg:rounded-2xl lg:px-3'

/**
 * Feed row (sessions, groups, review loops, scheduled tasks): avatar + title + one line under it,
 * full-bleed on phones, inset rounded pill on desktop. Not a ListRow: no group container, no chevron.
 * The title takes up to two lines; the line under it is a preview (one line, full text on hover).
 */
export function FeedRow(props: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
    avatar?: ReactNode
    title: string
    titleClassName?: string
    /** Right of the title: time, badges. */
    aside?: ReactNode
    /** Start of the second line, before the subtitle: status ("thinking", a badge, a dot). */
    status?: ReactNode
    subtitle?: string
    /** End of the second line: progress. */
    end?: ReactNode
    ref?: Ref<HTMLButtonElement>
}) {
    const { avatar, title, titleClassName, aside, status, subtitle, end, className, type, ...button } = props
    return (
        <button type={type ?? 'button'} {...button} className={cn(FEED_ROW_CLASS, className)}>
            {avatar}
            <div className="flex min-w-0 flex-1 flex-col justify-center">
                <div className="flex items-baseline gap-2">
                    <FitText kind="title" text={title} className={cn('flex-1 text-body leading-snug tracking-[-0.01em] text-[var(--social-fg)]', titleClassName)} />
                    {aside ? <span className="flex shrink-0 items-center gap-2 text-caption text-[var(--social-fg-subtle)]">{aside}</span> : null}
                </div>
                {status || subtitle || end ? (
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-footnote leading-snug text-[var(--social-fg-muted)]">
                        {status}
                        {subtitle ? <FitText kind="preview" text={subtitle} className="flex-1" /> : <span className="flex-1" />}
                        {end}
                    </div>
                ) : null}
            </div>
        </button>
    )
}
