import type { BarDatum } from './types'
import { FitText } from '@/components/ui/FitText'
import { cn } from '@/lib/utils'

/**
 * A small bar chart whose title states the conclusion. One colour: the bar that matters is filled
 * with the primary colour, the rest are light. Values sit above the bars, so it reads without hover.
 */
export function BarChart(props: { title: string; lede?: string; data: BarDatum[]; format?: (value: number) => string }) {
    const max = Math.max(...props.data.map((d) => d.value), 1)
    const format = props.format ?? ((v: number) => String(v))
    return (
        <figure className="m-0 rounded-2xl border border-[var(--social-border)] p-4">
            <figcaption>
                <div className="text-body font-semibold text-[var(--social-fg)]">{props.title}</div>
                {props.lede ? <div className="mt-0.5 text-footnote text-[var(--social-fg-muted)]">{props.lede}</div> : null}
            </figcaption>
            <div className="mt-4 flex h-40 items-end gap-2 border-b border-[var(--social-divider)] sm:gap-4">
                {props.data.map((d) => (
                    <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                        <span className={cn('text-caption tabular-nums', d.highlight ? 'font-semibold text-[var(--social-fg)]' : 'text-[var(--social-fg-subtle)]')}>{format(d.value)}</span>
                        <span
                            className={cn('w-full max-w-11 rounded-t-md transition-[height] duration-200', d.highlight ? 'bg-[var(--social-primary)]' : 'bg-[var(--social-border)]')}
                            style={{ height: `${(d.value / max) * 100}%` }}
                            aria-label={`${d.label} ${format(d.value)}`}
                            role="img"
                        />
                    </div>
                ))}
            </div>
            <div className="mt-1.5 flex gap-2 sm:gap-4">
                {props.data.map((d) => (
                    <FitText key={d.label} kind="label" lines={1} text={d.label} className={cn('min-w-0 flex-1 text-center text-caption', d.highlight ? 'font-semibold text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)]')} />
                ))}
            </div>
        </figure>
    )
}
