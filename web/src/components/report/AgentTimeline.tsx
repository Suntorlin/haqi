import { useLayoutEffect, useRef, useState } from 'react'
import { FitText } from '@/components/ui/FitText'
import { SegmentedControl } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { ChevronRightIcon } from '@/components/mobile/icons'
import { CheckRing, ProgressOrb } from './indicators'
import type { TimelineAgent, TimelineSpan } from './types'

const SPAN_TONE: Record<TimelineSpan['state'], string> = {
    done: 'bg-[var(--social-hover)] text-[var(--social-fg-subtle)]',
    live: 'bg-[var(--social-muted)] text-[var(--social-fg)]',
    wait: 'bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]',
    stuck: 'bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
}

function place(from: number, to: number, window: number) {
    const left = ((from + window) / window) * 100
    const right = ((to + window) / window) * 100
    return { left: `${left}%`, width: `calc(${right - left}% - 2px)` }
}

/** Quarter gridlines, drawn as a background so they cost no extra nodes. */
const GRID = 'bg-[repeating-linear-gradient(90deg,var(--social-divider)_0_1px,transparent_1px_25%)]'

/**
 * A bar's words, shown whole or not at all: a short stretch has no room, and half a word ("3…") says nothing.
 * The full label stays in the bar's hover title.
 */
function SpanLabel(props: { text: string }) {
    const ref = useRef<HTMLSpanElement>(null)
    const [fits, setFits] = useState(true)
    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const check = () => setFits(el.scrollWidth <= el.clientWidth + 1)
        check()
        if (typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(check)
        observer.observe(el)
        return () => observer.disconnect()
    }, [props.text])
    return (
        <span ref={ref} className={cn('min-w-0 flex-1 overflow-hidden whitespace-nowrap', !fits && 'invisible')}>
            {props.text}
        </span>
    )
}

function Span(props: { span: TimelineSpan; window: number; thin?: boolean; onDecide?: () => void }) {
    const { span } = props
    const { t } = useTranslation()
    if (props.thin) {
        return (
            <span className={cn('absolute top-1/2 h-2 -translate-y-1/2 rounded-full', SPAN_TONE[span.state])} style={place(span.from, span.to, props.window)} />
        )
    }
    const className = cn('absolute top-1/2 flex h-7 -translate-y-1/2 items-center gap-1.5 overflow-hidden rounded-full px-3 text-left text-footnote font-semibold', SPAN_TONE[span.state])
    const body = (
        <>
            {span.state === 'live' ? <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--social-badge)]" /> : null}
            <SpanLabel text={span.label} />
        </>
    )
    if (span.state === 'wait' && props.onDecide) {
        // The waiting stretch is itself the way to the decision: tap it to open the card.
        return (
            <button type="button" onClick={props.onDecide} aria-label={`${span.label} · ${t('report.timeline.decide')}`} className={cn(className, 'pr-1.5 transition-opacity active:opacity-70')} style={place(span.from, span.to, props.window)}>
                {body}
                <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />
            </button>
        )
    }
    return (
        <span className={className} style={place(span.from, span.to, props.window)} title={span.label}>
            {body}
        </span>
    )
}

/**
 * Who works on what, on one shared time axis (now at the right edge). One row per agent with its orb;
 * the "steps" view adds a thin row per step under each agent — the report's semantic zoom.
 */
export function AgentTimeline(props: { agents: TimelineAgent[]; window?: number; onDecide?: (agent: TimelineAgent) => void; onOpen?: (agent: TimelineAgent) => void }) {
    const { t } = useTranslation()
    // Round the window up to whole ticks, at most four of them: minutes for short runs, hours for long ones.
    const raw = props.window ?? 40
    const step = [5, 10, 15, 20, 30, 60, 90, 120, 180, 240, 360, 480, 720, 1440].find((s) => raw / s <= 4) ?? 1440
    const window = Math.ceil(raw / step) * step
    const tickLabel = (minutes: number) => (step >= 60 ? t('report.timeline.hours', { n: minutes / 60 }) : t('report.timeline.minutes', { n: minutes }))
    const hasPlan = props.agents.some((a) => a.plan)
    const [mode, setMode] = useState<'summary' | 'steps'>('summary')
    const waiting = props.agents.filter((a) => a.spans.some((s) => s.state === 'wait')).length
    const ticks = Array.from({ length: window / step }, (_, i) => (i * step) / window)
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="flex-1 text-footnote text-[var(--social-fg-muted)]">
                    {t('report.timeline.agents', { n: props.agents.length })}
                    {waiting > 0 ? <span className="font-semibold text-[var(--app-badge-warning-text)]"> · {t('report.timeline.waiting', { n: waiting })}</span> : null}
                </span>
                <div className="w-full sm:w-56">
                    <SegmentedControl
                        label={t('report.timeline.view')}
                        value={mode}
                        options={[{ value: 'summary', label: t('report.timeline.summary') }, { value: 'steps', label: t('report.timeline.steps') }]}
                        onChange={setMode}
                    />
                </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--social-border)]">
                <div className="flex px-4 pt-2 text-caption tabular-nums text-[var(--social-fg-subtle)]">
                    <span className="w-[84px] shrink-0 sm:w-28" />
                    <span className="relative h-4 flex-1">
                        {ticks.map((f) => (
                            <span key={f} className="absolute -translate-x-1/2 first:translate-x-0" style={{ left: `${f * 100}%` }}>
                                −{tickLabel(Math.round(window * (1 - f)))}
                            </span>
                        ))}
                        <span className="absolute right-0 font-semibold text-[var(--social-fg)]">{t('report.timeline.now')}</span>
                    </span>
                </div>
                <div className="divide-y divide-[var(--social-divider)]">
                    {props.agents.map((agent) => (
                        <div key={agent.id}>
                            <div className="flex min-h-[52px] items-center gap-3 px-4">
                                <span
                                    className={cn('flex w-[84px] shrink-0 items-center gap-2 text-left sm:w-28 sm:gap-3', props.onOpen && 'cursor-pointer transition-opacity active:opacity-70')}
                                    role={props.onOpen ? 'button' : undefined}
                                    tabIndex={props.onOpen ? 0 : undefined}
                                    onClick={props.onOpen ? () => props.onOpen?.(agent) : undefined}
                                    onKeyDown={props.onOpen ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); props.onOpen?.(agent) } } : undefined}
                                >
                                    {agent.tone === 'done' ? (
                                        <CheckRing state="done" />
                                    ) : (
                                        <ProgressOrb seed={agent.seed ?? agent.id} size={24} progress={agent.progress} tone={agent.tone} />
                                    )}
                                    <span className="min-w-0 flex-1 leading-tight">
                                        <FitText kind="title" lines={1} text={agent.name} className="text-body text-[var(--social-fg)]" />
                                        {agent.model ? <FitText kind="id" text={agent.model} className="text-caption text-[var(--social-fg-subtle)] max-sm:hidden" /> : null}
                                    </span>
                                </span>
                                <span className={cn('relative h-11 flex-1', GRID)}>
                                    {agent.plan ? (
                                        <span className="absolute top-1/2 h-9 -translate-y-1/2 rounded-full border border-dashed border-[var(--social-fg-subtle)] max-sm:hidden" style={place(agent.plan.from, agent.plan.to, window)} />
                                    ) : null}
                                    {agent.spans.map((span) => (
                                        <Span key={`${span.from}-${span.label}`} span={span} window={window} onDecide={props.onDecide ? () => props.onDecide?.(agent) : undefined} />
                                    ))}
                                    <span className="absolute inset-y-0 right-0 w-px bg-[var(--social-fg)]" aria-hidden="true" />
                                </span>
                            </div>
                            {mode === 'steps' && agent.steps ? (
                                <div className="pb-2">
                                    {agent.steps.map((s) => (
                                        <div key={`${s.from}-${s.label}`} className="flex min-h-7 items-center gap-3 px-4">
                                            <FitText kind="title" lines={1} text={s.label} className="w-[84px] shrink-0 text-footnote text-[var(--social-fg-muted)] sm:w-28 sm:pl-9" />
                                            <span className="relative h-7 flex-1">
                                                <Span span={s} window={window} thin />
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ))}
                </div>
            </div>
            {hasPlan ? <span className="text-caption text-[var(--social-fg-subtle)]">{t('report.timeline.planHint')}</span> : null}
        </div>
    )
}
