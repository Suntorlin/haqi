import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * The one button. Pill-shaped, 44px tall by default (Apple HIG touch target); `sm` is the dense
 * 36px size for desktop toolbars and table rows. One primary (filled) button per view.
 */
export const buttonVariants = cva(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-[background-color,opacity,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--social-fg-subtle)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--app-bg)] disabled:pointer-events-none disabled:opacity-40 [-webkit-tap-highlight-color:transparent]',
    {
        variants: {
            variant: {
                default: 'bg-[var(--social-primary)] text-[var(--social-primary-fg)] hover:opacity-90',
                secondary: 'bg-[var(--social-muted)] text-[var(--social-fg)] hover:bg-[var(--social-border)]',
                outline: 'border border-[var(--social-border)] bg-transparent text-[var(--social-fg)] hover:bg-[var(--social-hover)]',
                ghost: 'bg-transparent text-[var(--social-fg-muted)] hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)]',
                destructive: 'bg-[var(--social-danger)] text-white hover:opacity-90'
            },
            size: {
                default: 'h-11 px-5 text-[15px]',
                sm: 'h-9 px-4 text-[13px]',
                lg: 'h-12 px-6 text-[16px]'
            }
        },
        defaultVariants: {
            variant: 'default',
            size: 'default'
        }
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : 'button'
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = 'Button'
