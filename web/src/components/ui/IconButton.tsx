import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const iconButtonVariants = cva(
    'inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--social-fg-subtle)] disabled:pointer-events-none disabled:opacity-40 [-webkit-tap-highlight-color:transparent]',
    {
        variants: {
            variant: {
                ghost: 'text-[var(--social-fg-muted)] hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)]',
                filled: 'bg-[var(--social-primary)] text-[var(--social-primary-fg)] hover:opacity-90',
                muted: 'bg-[var(--social-muted)] text-[var(--social-fg)] hover:bg-[var(--social-border)]'
            },
            size: {
                // 44px hit area on phones; the glyph stays small.
                default: 'h-11 w-11',
                // Dense toolbars and inside inputs; 36px.
                sm: 'h-9 w-9'
            }
        },
        defaultVariants: { variant: 'ghost', size: 'default' }
    }
)

export interface IconButtonProps
    extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'>,
        VariantProps<typeof iconButtonVariants> {
    /** Required: icon-only buttons need an accessible name (also shown as tooltip). */
    label: string
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
    ({ className, variant, size, label, type = 'button', ...props }, ref) => (
        <button
            ref={ref}
            type={type}
            title={label}
            aria-label={label}
            className={cn(iconButtonVariants({ variant, size }), className)}
            {...props}
        />
    )
)
IconButton.displayName = 'IconButton'
