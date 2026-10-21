import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * What a page, pane or list shows when it has nothing to show.
 * - `page`: centered block for a whole page or pane (optional illustration, title, subtitle, one action).
 * - `inline` (default): one muted line inside a list, sheet or panel.
 */
export function EmptyState(props: {
    variant?: 'page' | 'inline'
    title: ReactNode
    /** Page only: one muted line under the title. */
    subtitle?: ReactNode
    /** Page only: picture above the title (e.g. an `Orb`, an icon). */
    illustration?: ReactNode
    /** Page only: the one button under the text. */
    action?: { label: string; onClick: () => void; disabled?: boolean }
    /** Page only: custom controls under the text, when one `action` is not enough. */
    children?: ReactNode
    role?: 'status'
    className?: string
}) {
    if (props.variant !== 'page') {
        return (
            <div role={props.role} className={cn('px-4 py-4 text-center text-footnote leading-relaxed text-[var(--social-fg-muted)]', props.className)}>
                {props.title}
            </div>
        )
    }
    return (
        <div role={props.role} className={cn('flex flex-col items-center justify-center px-8 py-16 text-center', props.className)}>
            {props.illustration ? <div className="mb-5">{props.illustration}</div> : null}
            <div className="text-headline font-semibold tracking-[-0.01em] text-[var(--social-fg)]">{props.title}</div>
            {props.subtitle ? (
                <div className="mt-1.5 max-w-sm text-footnote leading-relaxed text-[var(--social-fg-muted)]">{props.subtitle}</div>
            ) : null}
            {props.action ? (
                <Button type="button" onClick={props.action.onClick} disabled={props.action.disabled} className="mt-5">
                    {props.action.label}
                </Button>
            ) : null}
            {props.children ? <div className="mt-5">{props.children}</div> : null}
        </div>
    )
}
