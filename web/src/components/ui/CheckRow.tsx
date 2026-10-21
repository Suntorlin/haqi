import type { ReactNode } from 'react'
import { CheckIcon, PencilIcon } from '@/components/mobile/icons'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/utils'

/**
 * A row the user ticks on or off: a 44px checkbox on the left, the text, an optional tag under it, and an optional
 * pencil button on the right that edits the row. An unticked row stays visible, struck through, so it can be
 * ticked again.
 */
export function CheckRow(props: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    /** Accessible name of the checkbox. */
    label: string
    title: ReactNode
    subtitle?: ReactNode
    /** A tag under the text (a source `Badge`). */
    tag?: ReactNode
    onEdit?: () => void
    editLabel?: string
    disabled?: boolean
    className?: string
}) {
    return (
        <div className={cn('flex min-h-[52px] items-start gap-1 py-1', props.className)}>
            <button
                type="button"
                role="checkbox"
                aria-checked={props.checked}
                aria-label={props.label}
                disabled={props.disabled}
                onClick={() => props.onCheckedChange(!props.checked)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50 [-webkit-tap-highlight-color:transparent]"
            >
                <span className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-md border transition-colors duration-150',
                    props.checked
                        ? 'border-[var(--social-primary)] bg-[var(--social-primary)] text-[var(--social-primary-fg)]'
                        : 'border-[var(--social-fg-subtle)] hover:border-[var(--social-fg)]'
                )}>
                    {props.checked ? <CheckIcon className="h-3.5 w-3.5" /> : null}
                </span>
            </button>
            <div className="min-w-0 flex-1 py-2.5">
                <span className={cn(
                    'block text-body leading-snug',
                    props.checked ? 'text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)] line-through'
                )}>
                    {props.title}
                </span>
                {props.subtitle ? (
                    <span className="mt-0.5 block text-footnote leading-snug text-[var(--social-fg-muted)]">{props.subtitle}</span>
                ) : null}
                {props.tag ? <span className="mt-1.5 block">{props.tag}</span> : null}
            </div>
            {props.onEdit ? (
                <IconButton label={props.editLabel ?? ''} disabled={props.disabled} onClick={props.onEdit} className="shrink-0 text-[var(--social-fg-muted)]">
                    <PencilIcon className="h-[18px] w-[18px]" />
                </IconButton>
            ) : null}
        </div>
    )
}
