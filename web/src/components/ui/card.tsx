import * as React from 'react'
import { cn } from '@/lib/utils'

/** The one card surface: rounded-2xl, hairline border, page background, no shadow (DESIGN.md 2.3 / 2.2b). */
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div
            ref={ref}
            className={cn('rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)]', className)}
            {...props}
        />
    )
)
Card.displayName = 'Card'

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn('flex flex-col space-y-1.5 p-4', className)} {...props} />
    )
)
CardHeader.displayName = 'CardHeader'

export const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
    ({ className, ...props }, ref) => (
        <h3
            ref={ref}
            className={cn('text-base font-semibold leading-none tracking-tight', className)}
            {...props}
        />
    )
)
CardTitle.displayName = 'CardTitle'

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
    ({ className, ...props }, ref) => (
        <p ref={ref} className={cn('text-footnote text-[var(--social-fg-muted)]', className)} {...props} />
    )
)
CardDescription.displayName = 'CardDescription'

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    ({ className, ...props }, ref) => (
        <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
    )
)
CardContent.displayName = 'CardContent'
