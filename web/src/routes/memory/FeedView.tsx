import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { Candidate, CandidateOutcome, Maturity, MemoryLayer } from './types'
import { MEMORIES, PROJECT_SECTIONS, TODAY, USER_SECTIONS } from './mock'
import {
    ConfidencePill,
    JevAnswerView,
    LayerTag,
    MaturityBadge,
    Panel,
    PrimaryButton,
    Segmented,
    SOURCE_LABEL,
    SourceGlyph
} from './ui'

export const OUTCOME_STYLE: Record<CandidateOutcome, { label: string; className: string }> = {
    written: { label: '已新增', className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    reinforced: { label: '已加强', className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' },
    pending: { label: '待确认', className: 'bg-amber-500/12 text-amber-600 dark:text-amber-400' },
    rejected: { label: '已拒绝', className: 'bg-[var(--social-muted)] text-[var(--social-fg-muted)]' },
    merged: { label: '已合并', className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400' }
}

export type Override = {
    layer: MemoryLayer | 'none'
    section: string
    maturity: Maturity
    text: string
    addToTraining: boolean
}

export function OutcomeChip(props: { outcome: CandidateOutcome }) {
    const style = OUTCOME_STYLE[props.outcome]
    return <span className={cn('inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-semibold', style.className)}>{style.label}</span>
}

/** Today's capture → judge → decide funnel. */
export function PipelineFunnel(props: { compact?: boolean }) {
    const total = TODAY.captured
    const segments = [
        { label: '新增', n: TODAY.written, className: 'bg-emerald-500' },
        { label: '加强', n: TODAY.reinforced, className: 'bg-sky-500' },
        { label: '待确认', n: TODAY.pending, className: 'bg-amber-500' },
        { label: '拒绝', n: TODAY.rejected, className: 'bg-[var(--social-fg-subtle)]' }
    ]
    const stages = [
        { label: '采集', value: `${TODAY.captured}` },
        { label: '打码', value: '2 处' },
        { label: props.compact ? '判断' : 'Jev 判断', value: `${TODAY.judged}`, sub: `超时 ${TODAY.timeout}` },
        { label: '规则', value: '6 条' },
        { label: props.compact ? '生效' : '结果', value: props.compact ? `${TODAY.written + TODAY.reinforced}` : `${TODAY.written + TODAY.reinforced} 生效` }
    ]
    return (
        <Panel
            title={<span>今天 · 记忆采集流水线</span>}
            actions={<span className="text-[11px] tabular-nums text-[var(--social-fg-muted)]">Jev ${TODAY.costUsd.toFixed(4)} · 中位 {(TODAY.latencyMs / 1000).toFixed(2)} 秒</span>}
        >
            <div className={cn('flex items-stretch', props.compact ? 'gap-1' : 'gap-1.5')}>
                {stages.map((stage, index) => (
                    <div key={stage.label} className="flex min-w-0 flex-1 items-center gap-1">
                        <div className="min-w-0 flex-1 rounded-xl bg-[var(--social-muted)] px-2 py-2 text-center">
                            <div className="truncate text-[11px] text-[var(--social-fg-muted)]">{stage.label}</div>
                            <div className="truncate text-[15px] font-semibold tabular-nums text-[var(--social-fg)]">{stage.value}</div>
                            {stage.sub && !props.compact ? <div className="truncate text-[10px] text-[var(--social-fg-subtle)]">{stage.sub}</div> : null}
                        </div>
                        {index < stages.length - 1 ? <span className="shrink-0 text-[11px] text-[var(--social-fg-subtle)]">›</span> : null}
                    </div>
                ))}
            </div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full">
                {segments.map((segment) => (
                    <div key={segment.label} className={segment.className} style={{ width: `${(segment.n / total) * 100}%` }} />
                ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--social-fg-muted)]">
                {segments.map((segment) => (
                    <span key={segment.label} className="inline-flex items-center gap-1.5">
                        <span className={cn('h-2 w-2 rounded-full', segment.className)} />
                        {segment.label} <b className="font-semibold tabular-nums text-[var(--social-fg)]">{segment.n}</b>
                    </span>
                ))}
                <span className="ml-auto hidden sm:inline">来源：{TODAY.bySource.map((s) => `${s.label} ${s.n}`).join(' · ')}</span>
            </div>
        </Panel>
    )
}

function PipelineSteps(props: { candidate: Candidate; compact?: boolean }) {
    const c = props.candidate
    if (props.compact) {
        return (
            <div className="flex items-center gap-2 text-[11px] text-[var(--social-fg-muted)]">
                <span>Jev {(c.jev.latencyMs / 1000).toFixed(2)}s · 规则 {c.rules.length} 步</span>
                <span className="h-px w-3 bg-[var(--social-border)]" />
                <OutcomeChip outcome={c.outcome} />
            </div>
        )
    }
    const steps = [
        { label: SOURCE_LABEL[c.source], ok: true },
        { label: c.redacted ? '已打码' : '清理', ok: true },
        { label: `Jev ${(c.jev.latencyMs / 1000).toFixed(2)}s`, ok: true },
        { label: `规则 ${c.rules.length} 步`, ok: c.rules.every((r) => r.ok) }
    ]
    return (
        <div className="flex min-w-0 items-center gap-1 overflow-hidden text-[11px] text-[var(--social-fg-muted)]">
            {steps.map((step, index) => (
                <span key={step.label} className="flex min-w-0 shrink items-center gap-1">
                    <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', step.ok ? 'bg-[var(--social-fg-subtle)]' : 'bg-amber-500')} />
                    <span className="truncate">{step.label}</span>
                    {index < steps.length - 1 ? <span className="mx-0.5 h-px w-3 shrink-0 bg-[var(--social-border)]" /> : null}
                </span>
            ))}
            <span className="mx-0.5 h-px w-3 shrink-0 bg-[var(--social-border)]" />
            <OutcomeChip outcome={c.outcome} />
        </div>
    )
}

export function FeedCard(props: { candidate: Candidate; selected?: boolean; overridden?: boolean; onOpen: () => void; compact?: boolean }) {
    const c = props.candidate
    const scope = c.jev.answers.scope
    const noise = c.outcome === 'rejected' && c.source === 'user_message' && !c.redacted
    return (
        <button
            type="button"
            onClick={props.onOpen}
            aria-current={props.selected ? 'true' : undefined}
            className={cn(
                'block w-full rounded-2xl border px-4 py-3.5 text-left transition-colors [-webkit-tap-highlight-color:transparent]',
                props.selected ? 'border-[var(--social-fg)] bg-[var(--social-hover)]' : 'border-[var(--social-border)] hover:bg-[var(--social-hover)]',
                noise ? 'opacity-60' : ''
            )}
        >
            <div className="flex items-center gap-2 text-[12px] text-[var(--social-fg-muted)]">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--social-muted)] text-[var(--social-fg)]">
                    <SourceGlyph source={c.source} className="h-3.5 w-3.5" />
                </span>
                <span className="shrink-0 font-medium text-[var(--social-fg)]">{SOURCE_LABEL[c.source]}</span>
                <span className="min-w-0 truncate">{c.agent ? `${c.agent} · ` : ''}{c.session}</span>
                {props.overridden ? <span className="shrink-0 rounded-full bg-[var(--social-primary)] px-1.5 text-[10px] font-semibold leading-4 text-[var(--social-primary-fg)]">你改判</span> : null}
                <span className="ml-auto shrink-0 text-[var(--social-fg-subtle)]">{c.at}</span>
            </div>
            <div className="mt-2 text-[14.5px] leading-relaxed text-[var(--social-fg)]">
                {c.said ? <span className="mr-1 rounded bg-[var(--social-muted)] px-1 text-[11px] font-semibold text-[var(--social-fg-muted)]">你说</span> : null}
                {c.text}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                {c.result.layer ? <LayerTag layer={c.result.layer} project={c.project} section={c.result.section} /> : null}
                {c.result.maturity ? <MaturityBadge maturity={c.result.maturity} /> : null}
                {scope.kind === 'choice' ? <ConfidencePill value={scope.confidence} /> : null}
                <span className="min-w-0 truncate text-[12px] text-[var(--social-fg-muted)]">{c.result.note}</span>
            </div>
            <div className="mt-2.5">
                <PipelineSteps candidate={c} compact={props.compact} />
            </div>
        </button>
    )
}

const FILTERS: Array<{ value: 'all' | CandidateOutcome; label: string }> = [
    { value: 'all', label: '全部' },
    { value: 'written', label: '新增' },
    { value: 'reinforced', label: '加强' },
    { value: 'pending', label: '待确认' },
    { value: 'rejected', label: '拒绝' }
]

export function FeedList(props: { candidates: Candidate[]; selectedId: string | null; overrides: Record<string, Override>; onOpen: (id: string) => void; compact?: boolean }) {
    const [filter, setFilter] = useState<'all' | CandidateOutcome>('all')
    const shown = props.candidates.filter((c) => filter === 'all' || c.outcome === filter)
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                {FILTERS.map((option) => (
                    <button
                        key={option.value}
                        type="button"
                        onClick={() => setFilter(option.value)}
                        className={cn(
                            'h-8 shrink-0 rounded-full border px-3.5 text-[13px]',
                            filter === option.value
                                ? 'border-[var(--social-primary)] bg-[var(--social-primary)] font-semibold text-[var(--social-primary-fg)]'
                                : 'border-[var(--social-border)] text-[var(--social-fg)]'
                        )}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
            {shown.map((candidate) => (
                <FeedCard
                    key={candidate.id}
                    candidate={candidate}
                    selected={candidate.id === props.selectedId}
                    overridden={Boolean(props.overrides[candidate.id])}
                    onOpen={() => props.onOpen(candidate.id)}
                    compact={props.compact}
                />
            ))}
        </div>
    )
}

const LAYER_OPTIONS: Array<{ value: MemoryLayer | 'none'; label: string }> = [
    { value: 'user', label: '用户层' },
    { value: 'project', label: '项目层' },
    { value: 'task', label: '任务层' },
    { value: 'none', label: '不记' }
]
const MATURITY_OPTIONS: Array<{ value: Maturity; label: string }> = [
    { value: 'fact', label: '事实' },
    { value: 'experience', label: '经验' },
    { value: 'principle', label: '原则' }
]

export function defaultOverride(c: Candidate): Override {
    return {
        layer: c.result.layer ?? 'none',
        section: c.result.section ?? '其他',
        maturity: c.result.maturity ?? 'fact',
        text: c.text,
        addToTraining: true
    }
}

/** Everything Jev was asked, how the rules turned it into a decision, and the controls to change it. */
export function DecisionDetail(props: { candidate: Candidate; override: Override | null; onOverride: (next: Override | null) => void }) {
    const c = props.candidate
    const base = defaultOverride(c)
    const draft = props.override ?? base
    const changed = props.override !== null
    const set = (patch: Partial<Override>) => props.onOverride({ ...draft, ...patch })
    const sections = draft.layer === 'user' ? USER_SECTIONS : draft.layer === 'project' ? PROJECT_SECTIONS : ['进展']
    const target = c.result.memoryId ? MEMORIES.find((m) => m.id === c.result.memoryId) : null
    const answers = c.jev.answers

    return (
        <div className="space-y-4">
            <Panel title="候选">
                <div className="flex items-center gap-2 text-[12px] text-[var(--social-fg-muted)]">
                    <SourceGlyph source={c.source} className="h-3.5 w-3.5" />
                    <span>{SOURCE_LABEL[c.source]}{c.agent ? ` · ${c.agent}` : ''} · {c.session} · {c.at}</span>
                </div>
                <div className="mt-2 rounded-xl bg-[var(--social-muted)] px-3 py-2.5 text-[14px] leading-relaxed text-[var(--social-fg)]">
                    {c.said ? <span className="mr-1 rounded bg-[var(--social-surface)] px-1 text-[11px] font-semibold text-[var(--social-fg-muted)]">你说</span> : null}
                    {c.text}
                </div>
                <div className="mt-2 text-[12px] text-[var(--social-fg-muted)]">
                    发给 Jev 的只有这段文字和 {Object.keys(answers.match.kind === 'choice' ? answers.match.probs : {}).length - 1} 条相似旧条目；{c.redacted ? '原文已在本地打码。' : '本地正则没发现密钥。'}
                </div>
            </Panel>

            <Panel
                title="Jev 的判断"
                actions={<span className="text-[11px] tabular-nums text-[var(--social-fg-muted)]">jev-1.13 · {(c.jev.latencyMs / 1000).toFixed(2)} 秒 · ${c.jev.costUsd.toFixed(5)}</span>}
            >
                <div className="grid gap-4 sm:grid-cols-2">
                    <JevAnswerView answer={answers.scope} />
                    <JevAnswerView answer={answers.section} dense />
                    <JevAnswerView answer={answers.maturity} />
                    <JevAnswerView answer={answers.match} />
                    <JevAnswerView answer={answers.lasting} />
                    <JevAnswerView answer={answers.secret} />
                </div>
            </Panel>

            <Panel title="规则怎么得出结果">
                <ol className="space-y-2">
                    {c.rules.map((rule, index) => (
                        <li key={index} className="flex gap-2.5 text-[13px] leading-relaxed">
                            <span className={cn('mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold', rule.ok ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-amber-500/15 text-amber-600 dark:text-amber-400')}>
                                {rule.ok ? '✓' : '!'}
                            </span>
                            <span className="text-[var(--social-fg)]">{rule.text}</span>
                        </li>
                    ))}
                </ol>
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[var(--social-border)] px-3 py-2.5">
                    <OutcomeChip outcome={c.outcome} />
                    <span className="text-[13px] text-[var(--social-fg)]">{c.result.note}</span>
                    {target ? <span className="text-[12px] text-[var(--social-fg-muted)]">→ {target.id} v{Math.max(1, target.versions.length)}</span> : null}
                </div>
            </Panel>

            <Panel
                title={(
                    <span className="flex items-center gap-2">
                        改判与最终版本
                        {changed ? <span className="rounded-full bg-[var(--social-primary)] px-2 text-[11px] font-semibold leading-5 text-[var(--social-primary-fg)]">已改判</span> : null}
                    </span>
                )}
                actions={changed ? <button type="button" className="text-[12px] text-[var(--social-fg-muted)] underline" onClick={() => props.onOverride(null)}>恢复 Jev 的判断</button> : null}
            >
                <div className="space-y-3">
                    <OverrideRow label="层" jev={c.result.layer ? labelOfLayer(c.result.layer) : '不记'} changed={draft.layer !== base.layer}>
                        <Segmented size="sm" value={draft.layer} options={LAYER_OPTIONS} onChange={(layer) => set({ layer, section: layer === 'user' ? USER_SECTIONS[0] : layer === 'project' ? PROJECT_SECTIONS[0] : '进展' })} />
                    </OverrideRow>
                    {draft.layer !== 'none' ? (
                        <OverrideRow label="节" jev={c.result.section ?? '—'} changed={draft.section !== base.section}>
                            <Segmented size="sm" value={draft.section} options={sections.map((s) => ({ value: s, label: s }))} onChange={(section) => set({ section })} />
                        </OverrideRow>
                    ) : null}
                    {draft.layer !== 'none' ? (
                        <OverrideRow label="成熟度" jev={c.result.maturity ? MATURITY_OPTIONS.find((m) => m.value === c.result.maturity)?.label ?? '' : '—'} changed={draft.maturity !== base.maturity}>
                            <Segmented size="sm" value={draft.maturity} options={MATURITY_OPTIONS} onChange={(maturity) => set({ maturity })} />
                        </OverrideRow>
                    ) : null}
                    <div>
                        <div className="mb-1.5 flex items-center justify-between text-[12px] text-[var(--social-fg-muted)]">
                            <span>最终写入的文字</span>
                            {draft.text !== c.text ? <span className="text-[var(--social-fg)]">已修改</span> : <span>可直接编辑</span>}
                        </div>
                        <textarea
                            value={draft.text}
                            onChange={(event) => set({ text: event.target.value })}
                            rows={3}
                            className="w-full resize-none rounded-xl border border-[var(--social-border)] bg-[var(--social-surface)] px-3 py-2.5 text-[14px] leading-relaxed text-[var(--social-fg)] outline-none focus:border-[var(--social-fg-muted)]"
                        />
                    </div>
                    <label className="flex items-center gap-2 text-[12.5px] text-[var(--social-fg)]">
                        <input type="checkbox" checked={draft.addToTraining} onChange={(event) => set({ addToTraining: event.target.checked })} className="h-4 w-4 accent-[var(--social-primary)]" />
                        把这次纠正加入训练集（用来校准阈值和改写判断标准）
                    </label>
                    <div className="flex flex-wrap gap-2 pt-1">
                        <PrimaryButton>{changed ? '按我的改判写入' : '确认 Jev 的判断'}</PrimaryButton>
                        <PrimaryButton tone="ghost">先放待确认</PrimaryButton>
                        <PrimaryButton tone="danger">拒绝</PrimaryButton>
                    </div>
                </div>
            </Panel>
        </div>
    )
}

function labelOfLayer(layer: MemoryLayer): string {
    return layer === 'user' ? '用户层' : layer === 'project' ? '项目层' : '任务层'
}

function OverrideRow(props: { label: string; jev: string; changed: boolean; children: ReactNode }) {
    return (
        <div className="grid grid-cols-[52px_1fr] items-start gap-3">
            <div className="pt-1.5 text-[12px] font-medium text-[var(--social-fg-muted)]">{props.label}</div>
            <div className="min-w-0 space-y-1">
                {props.children}
                <div className="text-[11px] text-[var(--social-fg-subtle)]">
                    Jev：{props.jev}{props.changed ? <span className="ml-1 font-semibold text-[var(--social-fg)]">→ 你改了</span> : null}
                </div>
            </div>
        </div>
    )
}
