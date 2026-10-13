import * as React from 'react'
import { cn } from '@/lib/utils'

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
    /** `field`: bordered 12px-radius form input. `pill`: borderless address / search bar. */
    variant?: 'field' | 'pill'
    /** Icon or element inside the left edge. */
    leading?: React.ReactNode
    /** Buttons inside the right edge (clear, go, reload). */
    trailing?: React.ReactNode
    invalid?: boolean
    wrapperClassName?: string
}

/**
 * The one text input. 44px tall, 16px text (smaller makes iOS Safari zoom the page on focus).
 * Focus ring sits on the wrapper so leading/trailing slots are part of the field.
 */
export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
    ({ variant = 'field', leading, trailing, invalid, className, wrapperClassName, ...props }, ref) => (
        <div
            className={cn(
                'flex h-11 min-w-0 items-center gap-1.5 transition-shadow duration-150 focus-within:ring-2 focus-within:ring-[var(--social-fg-subtle)]',
                variant === 'pill'
                    ? 'rounded-full bg-[var(--social-muted)] pl-4 pr-1.5'
                    : 'rounded-xl border bg-[var(--app-bg)] pl-3.5 pr-1.5',
                variant === 'field' && (invalid ? 'border-[var(--social-danger)]' : 'border-[var(--social-border)]'),
                props.disabled && 'opacity-50',
                wrapperClassName
            )}
        >
            {leading ? <span className="flex shrink-0 items-center text-[var(--social-fg-subtle)]">{leading}</span> : null}
            <input
                ref={ref}
                aria-invalid={invalid || undefined}
                className={cn(
                    'h-full min-w-0 flex-1 truncate bg-transparent text-[16px] text-[var(--social-fg)] placeholder:text-[var(--social-fg-subtle)] focus:outline-none',
                    !trailing && variant === 'field' && 'pr-2',
                    className
                )}
                {...props}
            />
            {trailing ? <span className="flex shrink-0 items-center gap-0.5">{trailing}</span> : null}
        </div>
    )
)
TextField.displayName = 'TextField'
