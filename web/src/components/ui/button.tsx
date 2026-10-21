import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * The one button. Pill-shaped, 44px tall by default (Apple HIG touch target); `sm` is the dense
 * 36px size for desktop toolbars and table rows; `xs` is 28px inside content, padded to a 44px hit area.
 * One primary (filled) button per view.
 */
export const buttonVariants = cva(
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-[background-color,opacity,transform] duration-150 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--social-fg-subtle)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--social-surface)] disabled:pointer-events-none disabled:opacity-40 [-webkit-tap-highlight-color:transparent]',
    {
        variants: {
            variant: {
                default: 'bg-[var(--social-primary)] text-[var(--social-primary-fg)] hover:opacity-90',
                secondary: 'bg-[var(--social-muted)] text-[var(--social-fg)] hover:bg-[var(--social-border)]',
                outline: 'border border-[var(--social-border)] bg-transparent text-[var(--social-fg)] hover:bg-[var(--social-hover)]',
                ghost: 'bg-transparent text-[var(--social-fg-muted)] hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)]',
                destructive: 'bg-[var(--social-danger)] text-[var(--social-on-accent)] hover:opacity-90'
            },
            size: {
                default: 'h-11 px-5 text-body',
                sm: 'h-9 px-4 text-footnote',
                // Inline in content (voice strip, process list): 28px visual, still a 44px hit area.
                xs: "relative h-7 px-3 text-footnote after:absolute after:-inset-2 after:content-['']",
                lg: 'h-12 px-6 text-headline'
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
