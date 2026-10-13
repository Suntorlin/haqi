import * as React from 'react'
import { cn } from '@/lib/utils'

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Filled when chosen (filters, single-choice groups). */
    selected?: boolean
}

/** Pill shortcut / filter / choice. 32px tall; keep rows scrollable or wrapping with 8px gaps. */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
    ({ className, selected, type = 'button', ...props }, ref) => (
        <button
            ref={ref}
            type={type}
            aria-pressed={selected}
            className={cn(
                'inline-flex h-8 max-w-full items-center truncate rounded-full border px-3.5 text-[13px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 [-webkit-tap-highlight-color:transparent]',
                selected
                    ? 'border-[var(--social-primary)] bg-[var(--social-primary)] font-semibold text-[var(--social-primary-fg)]'
                    : 'border-[var(--social-border)] text-[var(--social-fg)] hover:bg-[var(--social-hover)]',
                className
            )}
            {...props}
        />
    )
)
Chip.displayName = 'Chip'
