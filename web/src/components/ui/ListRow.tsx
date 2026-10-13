import type { ReactNode } from 'react'
import { ChevronRightIcon } from '@/components/mobile/icons'
import { cn } from '@/lib/utils'

/** Group of rows with a hairline between them (iOS inset-grouped list, Instagram settings). */
export function ListGroup(props: { title?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn('flex flex-col gap-1.5', props.className)}>
            {props.title ? (
                <h3 className="px-4 text-[12px] font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{props.title}</h3>
            ) : null}
            <div className="divide-y divide-[var(--social-divider)] overflow-hidden rounded-2xl border border-[var(--social-border)] bg-[var(--app-bg)]">
                {props.children}
            </div>
        </section>
    )
}

/** One row: optional leading icon, title (+ subtitle), trailing value / control, chevron when it navigates. */
export function ListRow(props: {
    icon?: ReactNode
    title: ReactNode
    subtitle?: ReactNode
    trailing?: ReactNode
    onClick?: () => void
    destructive?: boolean
}) {
    const content = (
        <>
            {props.icon ? <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[var(--social-fg-muted)]">{props.icon}</span> : null}
            <span className="min-w-0 flex-1 text-left">
                <span className={cn('block truncate text-[15px]', props.destructive ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg)]')}>{props.title}</span>
                {props.subtitle ? <span className="mt-0.5 block truncate text-[13px] text-[var(--social-fg-muted)]">{props.subtitle}</span> : null}
            </span>
            {props.trailing ? <span className="shrink-0 text-[14px] text-[var(--social-fg-muted)]">{props.trailing}</span> : null}
            {props.onClick ? <ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--social-fg-subtle)]" /> : null}
        </>
    )
    const className = 'flex min-h-[52px] w-full items-center gap-3 px-4 py-2'
    return props.onClick ? (
        <button type="button" onClick={props.onClick} className={cn(className, 'transition-colors hover:bg-[var(--social-hover)] active:bg-[var(--social-muted)] [-webkit-tap-highlight-color:transparent]')}>
            {content}
        </button>
    ) : (
        <div className={className}>{content}</div>
    )
}
