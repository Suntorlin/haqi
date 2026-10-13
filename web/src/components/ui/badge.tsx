import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
    'inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold leading-none',
    {
        variants: {
            variant: {
                default: 'bg-[var(--social-muted)] text-[var(--social-fg-muted)]',
                solid: 'bg-[var(--social-primary)] text-[var(--social-primary-fg)]',
                info: 'bg-[var(--app-badge-info-bg)] text-[var(--app-badge-info-text)]',
                warning: 'bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]',
                success: 'bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)]',
                destructive: 'bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
            }
        },
        defaultVariants: {
            variant: 'default'
        }
    }
)

export interface BadgeProps
    extends React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {
    /** Leading status dot in the badge's text colour; pulses when `live`. */
    dot?: boolean
    live?: boolean
}

/** Status pill: soft tint, no border. Use for state (running, pending, failed), never for actions. */
export function Badge({ className, variant, dot, live, children, ...props }: BadgeProps) {
    return (
        <span className={cn(badgeVariants({ variant }), className)} {...props}>
            {dot ? <span aria-hidden="true" className={cn('h-1.5 w-1.5 rounded-full bg-current', live && 'animate-pulse')} /> : null}
            {children}
        </span>
    )
}

/**
 * Unread counter (Instagram red). Sits on the corner of an avatar or icon: wrap that in `relative`
 * and pass className="absolute -right-1 -top-1". The ring cuts it out of what is behind it.
 */
export function CountBadge({ count, max = 99, className }: { count: number; max?: number; className?: string }) {
    if (count <= 0) return null
    return (
        <span
            className={cn(
                'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--social-badge)] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-[var(--social-surface)]',
                className
            )}
        >
            {count > max ? `${max}+` : count}
        </span>
    )
}

/** Unread / live marker without a number. */
export function DotBadge({ className }: { className?: string }) {
    return <span aria-hidden="true" className={cn('inline-block h-2.5 w-2.5 rounded-full bg-[var(--social-badge)] ring-2 ring-[var(--social-surface)]', className)} />
}
