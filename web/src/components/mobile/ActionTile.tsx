import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Square-ish quick action (icon over a caption) for the grid at the top of the session info sheet. */
export function ActionTile(props: {
    icon: ReactNode
    label: string
    onClick?: () => void
    className?: string
}) {
    return (
        <button
            type="button"
            disabled={!props.onClick}
            onClick={props.onClick}
            className={cn(
                'flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-[var(--social-border)] px-1 py-3 text-caption text-[var(--social-fg)] transition-[background-color,transform] duration-150 hover:bg-[var(--social-hover)] active:scale-[0.98] active:bg-[var(--social-muted)] disabled:pointer-events-none disabled:opacity-40 [-webkit-tap-highlight-color:transparent]',
                props.className
            )}
        >
            {props.icon}
            <span className="max-w-full truncate">{props.label}</span>
        </button>
    )
}
