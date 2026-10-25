import { DotBadge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { CheckRing, ProgressOrb } from './indicators'
import type { ProgressItem } from './types'
import { FitText } from '@/components/ui/FitText'

export function ProgressRow(props: { item: ProgressItem; onOpen: () => void }) {
    const { item } = props
    const attention = item.tone === 'stuck' || item.tone === 'wait'
    return (
        <button type="button" onClick={props.onOpen} className="flex min-h-[52px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-[var(--social-hover)]">
            <span className="relative">
                {item.tone === 'done' ? (
                    <CheckRing state="done" />
                ) : (
                    <ProgressOrb seed={item.seed ?? item.id} size={24} progress={item.total > 0 ? item.done / item.total : 0} tone={item.tone} />
                )}
                {item.unread ? <DotBadge className="absolute -right-1 -top-1" /> : null}
            </span>
            <FitText kind="label" lines={1} text={item.name} className="w-24 shrink-0 text-body text-[var(--social-fg)]" />
            <FitText kind="preview" text={item.status} className={cn('flex-1 text-footnote', attention ? 'text-[var(--app-badge-warning-text)]' : 'text-[var(--social-fg-muted)]')} />
            <span className="shrink-0 text-footnote tabular-nums text-[var(--social-fg-subtle)]">
                {item.tone === 'done' ? item.when : `${item.done}/${item.total}`}
            </span>
        </button>
    )
}

/** Compact grouped list of every goal: ring, name, one-line status, count or time. */
export function ProgressList(props: { items: ProgressItem[]; onOpen: (item: ProgressItem) => void }) {
    return (
        <div className="divide-y divide-[var(--social-divider)] overflow-hidden rounded-2xl border border-[var(--social-border)]">
            {props.items.map((item) => (
                <ProgressRow key={item.id} item={item} onOpen={() => props.onOpen(item)} />
            ))}
        </div>
    )
}
