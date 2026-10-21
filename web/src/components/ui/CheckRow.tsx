import type { ReactNode } from 'react'
import { CheckIcon } from '@/components/mobile/icons'
import { cn } from '@/lib/utils'

/**
 * A row the user ticks on or off: a 44px checkbox on the left, the text, and an optional trailing tag.
 * An unticked row stays visible, struck through, so it can be ticked again. With `onEdit`, tapping the
 * text edits it (the checkbox still only ticks).
 */
export function CheckRow(props: {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    /** Accessible name of the checkbox. */
    label: string
    title: ReactNode
    subtitle?: ReactNode
    trailing?: ReactNode
    onEdit?: () => void
    editLabel?: string
    disabled?: boolean
    className?: string
}) {
    const text = (
        <span className="block min-w-0">
            <span className={cn(
                'block text-[15px] leading-snug',
                props.checked ? 'text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)] line-through'
            )}>
                {props.title}
            </span>
            {props.subtitle ? (
                <span className="mt-0.5 block text-[13px] leading-snug text-[var(--social-fg-muted)]">{props.subtitle}</span>
            ) : null}
        </span>
    )

    return (
        <div className={cn('flex min-h-[52px] items-start gap-1 py-1 pr-2', props.className)}>
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
            {props.onEdit ? (
                <button
                    type="button"
                    onClick={props.onEdit}
                    title={props.editLabel}
                    disabled={props.disabled}
                    className="min-h-11 min-w-0 flex-1 rounded-xl py-2.5 text-left transition-colors hover:bg-[var(--social-hover)]"
                >
                    {text}
                </button>
            ) : (
                <div className="min-h-11 min-w-0 flex-1 py-2.5">{text}</div>
            )}
            {props.trailing ? <span className="shrink-0 pt-3">{props.trailing}</span> : null}
        </div>
    )
}
