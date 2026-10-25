import * as React from 'react'
import { cn } from '@/lib/utils'
import { FitText } from './FitText'

export interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    /** Filled when chosen (filters, single-choice groups). */
    selected?: boolean
    /** default 32px; sm 24px for links inside a caption line (still a 44px hit area). */
    size?: 'default' | 'sm'
}

/** Pill shortcut / filter / choice. 32px tall; keep rows scrollable or wrapping with 8px gaps. */
export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
    ({ className, selected, size = 'default', type = 'button', children, ...props }, ref) => {
        const text = chipText(children)
        return (
            <button
                ref={ref}
                type={type}
                aria-pressed={selected}
                className={cn(
                    'inline-flex max-w-full items-center rounded-full border transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 [-webkit-tap-highlight-color:transparent]',
                    size === 'sm'
                        ? "relative h-6 gap-1 px-2.5 text-caption after:absolute after:-inset-2.5 after:content-['']"
                        : 'h-8 px-3.5 text-footnote',
                    selected
                        ? 'border-[var(--social-primary)] bg-[var(--social-primary)] font-semibold text-[var(--social-primary-fg)]'
                        : 'border-[var(--social-border)] text-[var(--social-fg)] hover:bg-[var(--social-hover)]',
                    className
                )}
                {...props}
            >
                {text !== null ? <FitText kind="label" lines={1} text={text} /> : children}
            </button>
        )
    }
)
Chip.displayName = 'Chip'

/** Text children (`#{tag}` is an array of strings) as one string, so the chip fits it on its line. */
function chipText(children: React.ReactNode): string | null {
    const parts = Array.isArray(children) ? children : [children]
    return parts.every((part) => typeof part === 'string' || typeof part === 'number') ? parts.join('') : null
}
