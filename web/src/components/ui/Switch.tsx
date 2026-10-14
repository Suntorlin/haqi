import { cn } from '@/lib/utils'

type SwitchProps = {
    checked: boolean
    onCheckedChange: (checked: boolean) => void
    disabled?: boolean
    className?: string
    ariaLabel?: string
}

/** The one switch look (settings rows, sheets): monochrome, readable in both themes. */
export function SwitchTrack(props: { checked: boolean; className?: string }) {
    return (
        <span
            aria-hidden="true"
            className={cn(
                'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors',
                props.checked ? 'bg-[var(--social-primary)]' : 'bg-[var(--social-border)]',
                props.className
            )}
        >
            <span
                className={cn(
                    'h-5 w-5 rounded-full shadow-[var(--shadow-raised)] transition-transform',
                    props.checked ? 'translate-x-[18px] bg-[var(--social-primary-fg)]' : 'translate-x-0.5 bg-[var(--social-on-accent)]'
                )}
            />
        </span>
    )
}

export function Switch(props: SwitchProps) {
    const { checked, onCheckedChange, disabled = false, className, ariaLabel } = props

    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            onClick={() => onCheckedChange(!checked)}
            className={cn(
                'inline-flex shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--social-fg-subtle)]',
                disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                className
            )}
        >
            <SwitchTrack checked={checked} />
        </button>
    )
}
