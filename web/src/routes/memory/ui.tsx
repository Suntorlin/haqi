import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { JevAnswer, Maturity, MemoryItem, MemoryLayer, MemorySource, MemoryStatus } from './types'
import { LAYER_LABEL, MATURITY_LABEL } from './mock'

export const LAYER_COLOR: Record<MemoryLayer, string> = {
    user: '#8b5cf6',
    project: '#0ea5e9',
    task: '#f59e0b'
}

export function LayerDot(props: { layer: MemoryLayer; className?: string }) {
    return <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', props.className)} style={{ background: LAYER_COLOR[props.layer] }} aria-hidden="true" />
}

export function LayerTag(props: { layer: MemoryLayer; project?: string; section?: string }) {
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-[var(--social-fg-muted)]">
            <LayerDot layer={props.layer} />
            <span className="truncate">
                {props.layer === 'project' && props.project ? props.project : LAYER_LABEL[props.layer]}
                {props.section ? ` / ${props.section}` : ''}
            </span>
        </span>
    )
}

const MATURITY_LEVEL: Record<Maturity, number> = { fact: 1, experience: 2, principle: 3 }

/** 事实 ●○○ · 经验 ●●○ · 原则 ●●● — how far a memory has matured. */
export function MaturityBadge(props: { maturity: Maturity; inference?: boolean; size?: 'sm' | 'md' }) {
    const level = MATURITY_LEVEL[props.maturity]
    const label = props.inference ? '推断' : MATURITY_LABEL[props.maturity]
    return (
        <span
            className={cn(
                'inline-flex shrink-0 items-center gap-1 rounded-full border font-medium',
                props.size === 'md' ? 'h-6 px-2.5 text-[12px]' : 'h-5 px-2 text-[11px]',
                props.maturity === 'principle'
                    ? 'border-[var(--social-primary)] bg-[var(--social-primary)] text-[var(--social-primary-fg)]'
                    : props.inference
                        ? 'border-dashed border-[var(--social-fg-subtle)] text-[var(--social-fg-muted)]'
                        : 'border-[var(--social-border)] text-[var(--social-fg)]'
            )}
        >
            <span className="flex gap-[2px]" aria-hidden="true">
                {[1, 2, 3].map((i) => (
                    <span key={i} className={cn('h-[5px] w-[5px] rounded-full', i <= level ? 'bg-current' : 'bg-current opacity-25')} />
                ))}
            </span>
            {label}
        </span>
    )
}

const STATUS_STYLE: Partial<Record<MemoryStatus, { label: string; className: string }>> = {
    pending: { label: '待确认', className: 'bg-amber-500/12 text-amber-600 dark:text-amber-400' },
    conflict: { label: '冲突', className: 'bg-[var(--social-danger)]/12 text-[var(--social-danger)]' },
    stale: { label: '可能过时', className: 'bg-[var(--social-muted)] text-[var(--social-fg-muted)]' },
    rejected: { label: '已拒绝', className: 'bg-[var(--social-muted)] text-[var(--social-fg-muted)] line-through' },
    superseded: { label: '已取代', className: 'bg-[var(--social-muted)] text-[var(--social-fg-muted)]' }
}

export function StatusChip(props: { status: MemoryStatus }) {
    const style = STATUS_STYLE[props.status]
    if (!style) return null
    return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium', style.className)}>{style.label}</span>
}

export function LockGlyph() {
    return (
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-[var(--social-fg-muted)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="锁定">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
    )
}

/** Support count as small bars: how many facts / repeats back this memory. */
export function SupportMeter(props: { support: number }) {
    const filled = Math.min(props.support, 6)
    return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-[var(--social-fg-muted)]" title={`支撑 ${props.support}`}>
            <span className="flex items-end gap-[2px]" aria-hidden="true">
                {[0, 1, 2, 3, 4, 5].map((i) => (
                    <span key={i} className={cn('w-[3px] rounded-full', i < filled ? 'bg-[var(--social-fg)]' : 'bg-[var(--social-border)]')} style={{ height: 5 + i * 1.5 }} />
                ))}
            </span>
            支撑 {props.support}
        </span>
    )
}

export const SOURCE_LABEL: Record<MemorySource, string> = {
    propose: '会话提交',
    claude_auto: 'Claude 自带记忆',
    user_message: '你的消息',
    curator: '整理会话',
    user_edit: '你手改',
    import: '导入'
}

export function SourceGlyph(props: { source: MemorySource; className?: string }) {
    const common = { viewBox: '0 0 24 24', className: cn('h-4 w-4', props.className), fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }
    switch (props.source) {
        case 'propose':
            return <svg {...common}><path d="M4 5h16v11H8l-4 4z" /><path d="M8.5 10.5h7" /></svg>
        case 'claude_auto':
            return <svg {...common}><path d="M6 3h9l3 3v15H6z" /><path d="M9 10h6M9 14h6M9 18h3" /></svg>
        case 'user_message':
            return <svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.7-3.6 3.4-5.5 7-5.5s6.3 1.9 7 5.5" /></svg>
        case 'curator':
            return <svg {...common}><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3" /></svg>
        default:
            return <svg {...common}><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
    }
}

/** One Jev answer: Choice = sorted probability bars + confidence, Noul = one yes-probability bar. */
export function JevAnswerView(props: { answer: JevAnswer; dense?: boolean }) {
    const { answer } = props
    if (answer.kind === 'noul') {
        return (
            <div className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-[var(--social-fg)]">{answer.label}</span>
                    <span className="text-[12px] tabular-nums text-[var(--social-fg-muted)]">是 {answer.p.toFixed(2)}</span>
                </div>
                <ProbTrack value={answer.p} strong={answer.p >= 0.5} />
            </div>
        )
    }
    const entries = Object.entries(answer.probs).sort((a, b) => b[1] - a[1])
    const shown = props.dense ? entries.slice(0, 3) : entries
    return (
        <div className="space-y-1.5">
            <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-[var(--social-fg)]">{answer.label}</span>
                <ConfidencePill value={answer.confidence} />
            </div>
            <div className="space-y-1">
                {shown.map(([option, p], index) => (
                    <div key={option} className="grid grid-cols-[72px_1fr_34px] items-center gap-2">
                        <span className={cn('truncate text-[12px]', index === 0 ? 'font-semibold text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)]')}>{option}</span>
                        <ProbTrack value={p} strong={index === 0} />
                        <span className="text-right text-[11px] tabular-nums text-[var(--social-fg-muted)]">{p.toFixed(2)}</span>
                    </div>
                ))}
            </div>
        </div>
    )
}

function ProbTrack(props: { value: number; strong?: boolean }) {
    return (
        <div className="h-[6px] w-full overflow-hidden rounded-full bg-[var(--social-muted)]">
            <div className={cn('h-full rounded-full', props.strong ? 'bg-[var(--social-fg)]' : 'bg-[var(--social-fg-subtle)]')} style={{ width: `${Math.max(2, props.value * 100)}%` }} />
        </div>
    )
}

export function ConfidencePill(props: { value: number }) {
    const tone = props.value >= 0.6 ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : props.value >= 0.4 ? 'text-amber-600 dark:text-amber-400 bg-amber-500/12' : 'text-[var(--social-danger)] bg-[var(--social-danger)]/10'
    return <span className={cn('inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium tabular-nums', tone)}>置信 {props.value.toFixed(2)}</span>
}

export function Panel(props: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <section className={cn('rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)]', props.className)}>
            {props.title ? (
                <div className="flex items-center gap-2 px-4 pb-1 pt-3.5">
                    <div className="min-w-0 flex-1 text-[13px] font-semibold text-[var(--social-fg)]">{props.title}</div>
                    {props.actions}
                </div>
            ) : null}
            <div className="px-4 pb-4 pt-2">{props.children}</div>
        </section>
    )
}

/** Small segmented choice used by the override controls. */
export function Segmented<T extends string>(props: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; size?: 'sm' | 'md' }) {
    return (
        <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-[var(--social-muted)] p-1">
            {props.options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => props.onChange(option.value)}
                    className={cn(
                        'rounded-lg px-2.5 font-medium transition-colors [-webkit-tap-highlight-color:transparent]',
                        props.size === 'sm' ? 'h-7 text-[12px]' : 'h-8 text-[13px]',
                        option.value === props.value
                            ? 'bg-[var(--social-surface)] text-[var(--social-fg)] shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                            : 'text-[var(--social-fg-muted)] hover:text-[var(--social-fg)]'
                    )}
                >
                    {option.label}
                </button>
            ))}
        </div>
    )
}

export function MemoryMeta(props: { item: MemoryItem }) {
    const { item } = props
    return (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <LayerTag layer={item.layer} project={item.project} section={item.section} />
            {item.maturity !== 'fact' ? <SupportMeter support={item.support} /> : null}
            {item.injected ? <span className="text-[11px] text-[var(--social-fg-muted)]">注入中</span> : null}
        </div>
    )
}

export function PrimaryButton(props: { children: ReactNode; onClick?: () => void; tone?: 'primary' | 'danger' | 'ghost'; className?: string }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            className={cn(
                'inline-flex h-9 items-center justify-center rounded-full px-4 text-[13px] font-semibold transition-opacity hover:opacity-90 [-webkit-tap-highlight-color:transparent]',
                props.tone === 'danger'
                    ? 'border border-[var(--social-border)] text-[var(--social-danger)]'
                    : props.tone === 'ghost'
                        ? 'border border-[var(--social-border)] text-[var(--social-fg)]'
                        : 'bg-[var(--social-primary)] text-[var(--social-primary-fg)]',
                props.className
            )}
        >
            {props.children}
        </button>
    )
}
