import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { CountBadge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { FitText } from '@/components/ui/FitText'

/**
 * Square-ish quick action (icon over a caption) for action grids: the top of the session info
 * card and the composer "+" panel. Without `onClick` (and no `disabled` given) the tile is disabled.
 * Extra button props pass through, so a primitive with `asChild` can render it.
 */
export function ActionTile({
    icon,
    label,
    badge,
    className,
    disabled,
    ref,
    ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    icon: ReactNode
    label: string
    /** Count shown as a red badge on the top-right corner (hidden when 0). */
    badge?: number
    ref?: Ref<HTMLButtonElement>
}) {
    return (
        <button
            ref={ref}
            type="button"
            {...rest}
            disabled={disabled ?? !rest.onClick}
            className={cn(
                'relative flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-[var(--social-border)] px-1 py-3 text-caption text-[var(--social-fg)] transition-[background-color,transform] duration-150 hover:bg-[var(--social-hover)] active:scale-[0.98] active:bg-[var(--social-muted)] disabled:pointer-events-none disabled:opacity-40 [-webkit-tap-highlight-color:transparent]',
                className
            )}
        >
            {icon}
            <FitText kind="label" text={label} className="w-full text-center leading-tight" />
            {badge ? <CountBadge count={badge} className="absolute -right-1 -top-1" /> : null}
        </button>
    )
}
