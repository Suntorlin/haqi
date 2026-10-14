import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { Maturity, MemoryItem, MemoryLayer } from './types'
import { LAYER_HINT, LAYER_LABEL, LINKS, MATURITY_HINT, MATURITY_LABEL, MEMORIES, PROJECT_SECTIONS, USER_SECTIONS } from './mock'
import { LayerDot, LayerTag, LockGlyph, MaturityBadge, Panel, PrimaryButton, Segmented, StatusChip, SupportMeter } from './ui'

const BUDGET: Record<string, { used: number; max: number }> = {
    user: { used: 1240, max: 1500 },
    haqi: { used: 980, max: 1500 },
    'agent-engine': { used: 210, max: 1500 },
    'shop-studio': { used: 120, max: 1500 },
    task: { used: 160, max: 600 }
}

export type LibraryScope = { layer: MemoryLayer; project?: string }

export function itemsIn(scope: LibraryScope): MemoryItem[] {
    return MEMORIES.filter((m) => m.layer === scope.layer && (scope.layer !== 'project' || m.project === scope.project))
}

function promotable(item: MemoryItem): boolean {
    return item.maturity === 'experience' && !item.inference && item.support >= 3 && item.status === 'active'
}

export function MemoryCard(props: { item: MemoryItem; selected?: boolean; onOpen: () => void }) {
    const { item } = props
    const evidence = LINKS.filter((l) => l.to === item.id && l.kind === 'supports').length
    return (
        <button
            type="button"
            onClick={props.onOpen}
            aria-current={props.selected ? 'true' : undefined}
            className={cn(
                'block w-full rounded-2xl border px-3.5 py-3 text-left transition-colors [-webkit-tap-highlight-color:transparent]',
                props.selected ? 'border-[var(--social-fg)] bg-[var(--social-hover)]' : 'border-[var(--social-border)] bg-[var(--social-surface)] hover:bg-[var(--social-hover)]',
                item.status === 'stale' ? 'opacity-60' : '',
                item.status === 'conflict' ? 'border-[var(--social-danger)]/60' : ''
            )}
        >
            <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-semibold tabular-nums text-[var(--social-fg-subtle)]">{item.id}</span>
                <span className="text-[11px] text-[var(--social-fg-muted)]">{item.section}</span>
                {item.said ? <span className="rounded bg-[var(--social-muted)] px-1 text-[10px] font-semibold text-[var(--social-fg-muted)]">你说</span> : null}
                {item.inference ? <span className="rounded border border-dashed border-[var(--social-fg-subtle)] px-1 text-[10px] text-[var(--social-fg-muted)]">推断</span> : null}
                <span className="ml-auto flex items-center gap-1.5">
                    {item.locked ? <LockGlyph /> : null}
                    <StatusChip status={item.status} />
                </span>
            </div>
            <div className="mt-1.5 text-[13.5px] leading-relaxed text-[var(--social-fg)]">{item.text}</div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                {item.maturity !== 'fact' ? <SupportMeter support={item.support} /> : <span className="text-[11px] text-[var(--social-fg-muted)]">{item.createdAt} · {item.sources[0]}</span>}
                {evidence > 0 ? <span className="text-[11px] text-[var(--social-fg-muted)]">依据 {evidence} 条</span> : null}
                {item.versions.length > 1 ? <span className="text-[11px] text-[var(--social-fg-muted)]">v{item.versions.length}</span> : null}
                {promotable(item) ? <span className="rounded-full bg-[var(--social-primary)] px-2 text-[10.5px] font-semibold leading-[18px] text-[var(--social-primary-fg)]">可升为原则</span> : null}
            </div>
        </button>
    )
}

const COLUMNS: Maturity[] = ['principle', 'experience', 'fact']

export function LibraryHeader(props: { scope: LibraryScope; items: MemoryItem[] }) {
    const key = props.scope.layer === 'project' ? props.scope.project ?? '' : props.scope.layer
    const budget = BUDGET[key] ?? { used: 0, max: 1500 }
    const injectedCount = props.items.filter((i) => i.injected).length
    return (
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div className="min-w-0">
                <div className="flex items-center gap-2 text-[18px] font-semibold tracking-[-0.02em] text-[var(--social-fg)]">
                    <LayerDot layer={props.scope.layer} className="h-2.5 w-2.5" />
                    {props.scope.layer === 'project' ? `项目层 · ${props.scope.project}` : LAYER_LABEL[props.scope.layer]}
                </div>
                <div className="mt-1 text-[12.5px] text-[var(--social-fg-muted)]">{LAYER_HINT[props.scope.layer]} · {props.items.length} 条，其中 {injectedCount} 条正在注入</div>
            </div>
            <div className="ml-auto w-[220px] max-w-full">
                <div className="flex justify-between text-[11.5px] text-[var(--social-fg-muted)]">
                    <span>注入预算</span>
                    <span className="tabular-nums">{budget.used.toLocaleString()} / {budget.max.toLocaleString()} token</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--social-muted)]">
                    <div className={cn('h-full rounded-full', budget.used / budget.max > 0.8 ? 'bg-amber-500' : 'bg-[var(--social-fg)]')} style={{ width: `${(budget.used / budget.max) * 100}%` }} />
                </div>
            </div>
        </div>
    )
}

/** Three maturity columns side by side (desktop) or one at a time (phone). */
export function LibraryBoard(props: { scope: LibraryScope; selectedId: string | null; onOpen: (id: string) => void; mobile?: boolean }) {
    const items = itemsIn(props.scope)
    const [column, setColumn] = useState<Maturity>('principle')
    const columns = props.mobile ? [column] : COLUMNS
    return (
        <div className="space-y-4">
            <LibraryHeader scope={props.scope} items={items} />
            {props.mobile ? (
                <Segmented
                    value={column}
                    onChange={setColumn}
                    options={COLUMNS.map((m) => ({ value: m, label: `${MATURITY_LABEL[m]} ${items.filter((i) => i.maturity === m).length}` }))}
                />
            ) : null}
            <div className={cn('grid gap-4', props.mobile ? 'grid-cols-1' : 'grid-cols-3')}>
                {columns.map((maturity) => {
                    const list = items.filter((i) => i.maturity === maturity)
                    return (
                        <div key={maturity} className="min-w-0">
                            <div className="mb-2.5 px-1">
                                {props.mobile ? null : (
                                    <div className="flex items-center gap-2">
                                        <MaturityBadge maturity={maturity} size="md" />
                                        <span className="text-[12px] tabular-nums text-[var(--social-fg-muted)]">{list.length}</span>
                                    </div>
                                )}
                                <div className={cn('text-[11.5px] leading-snug text-[var(--social-fg-muted)]', props.mobile ? '' : 'mt-1.5')}>{MATURITY_HINT[maturity]}</div>
                            </div>
                            <div className="space-y-2.5">
                                {list.map((item) => (
                                    <MemoryCard key={item.id} item={item} selected={item.id === props.selectedId} onOpen={() => props.onOpen(item.id)} />
                                ))}
                            </div>
                        </div>
                    )
                })}
            </div>
            {!props.mobile ? (
                <div className="flex items-center gap-2 rounded-xl bg-[var(--social-muted)] px-3 py-2 text-[12px] text-[var(--social-fg-muted)]">
                    <span className="shrink-0 whitespace-nowrap font-semibold text-[var(--social-fg)]">成熟路径</span>
                    事实攒够 2 条同类 → 整理会话归纳成经验（Jev 做支撑核查）→ 支撑 ≥3、跨 2 个会话、14 天无冲突 → 提议升为原则（你确认）
                </div>
            ) : null}
        </div>
    )
}

/** One memory: final text, where it lives, how it got here (versions) and what backs it (evidence). */
export function MemoryDetail(props: { item: MemoryItem; onOpenMemory: (id: string) => void }) {
    const { item } = props
    const evidence = LINKS.filter((l) => l.to === item.id).map((l) => ({ link: l, memory: MEMORIES.find((m) => m.id === l.from) })).filter((e) => e.memory)
    const supports = LINKS.filter((l) => l.from === item.id).map((l) => ({ link: l, memory: MEMORIES.find((m) => m.id === l.to) })).filter((e) => e.memory)
    const [maturity, setMaturity] = useState<Maturity>(item.maturity)
    const sections = item.layer === 'user' ? USER_SECTIONS : item.layer === 'project' ? PROJECT_SECTIONS : ['进展']
    const [section, setSection] = useState(item.section)
    const [text, setText] = useState(item.text)
    const [locked, setLocked] = useState(Boolean(item.locked))

    return (
        <div className="space-y-4">
            <Panel>
                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-semibold tabular-nums text-[var(--social-fg-subtle)]">{item.id}</span>
                    <MaturityBadge maturity={item.maturity} inference={item.inference} size="md" />
                    <StatusChip status={item.status} />
                    <span className="ml-auto text-[12px] text-[var(--social-fg-muted)]">{item.injected ? '注入中' : '不注入'}</span>
                </div>
                <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={3}
                    className="mt-3 w-full resize-none rounded-xl border border-[var(--social-border)] bg-[var(--social-surface)] px-3 py-2.5 text-[15px] leading-relaxed text-[var(--social-fg)] outline-none focus:border-[var(--social-fg-muted)]"
                />
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <LayerTag layer={item.layer} project={item.project} section={item.section} />
                    {item.maturity !== 'fact' ? <SupportMeter support={item.support} /> : null}
                    <span className="text-[11px] text-[var(--social-fg-muted)]">创建 {item.createdAt} · 最近被提到 {item.reinforcedAt}</span>
                </div>
                <div className="mt-4 space-y-3">
                    <div className="grid grid-cols-[52px_1fr] items-center gap-3">
                        <span className="text-[12px] font-medium text-[var(--social-fg-muted)]">成熟度</span>
                        <Segmented size="sm" value={maturity} onChange={setMaturity} options={[{ value: 'fact', label: '事实' }, { value: 'experience', label: '经验' }, { value: 'principle', label: '原则' }]} />
                    </div>
                    <div className="grid grid-cols-[52px_1fr] items-center gap-3">
                        <span className="text-[12px] font-medium text-[var(--social-fg-muted)]">节</span>
                        <Segmented size="sm" value={section} onChange={setSection} options={sections.map((s) => ({ value: s, label: s }))} />
                    </div>
                    <label className="flex items-center gap-2 text-[12.5px] text-[var(--social-fg)]">
                        <input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} className="h-4 w-4 accent-[var(--social-primary)]" />
                        锁定（会话和整理都不能改它，只能你改）
                    </label>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    <PrimaryButton>保存为 v{item.versions.length + 1}</PrimaryButton>
                    <PrimaryButton tone="ghost">换层…</PrimaryButton>
                    <PrimaryButton tone="ghost">归档</PrimaryButton>
                    <PrimaryButton tone="danger">删除</PrimaryButton>
                </div>
            </Panel>

            {evidence.length > 0 || supports.length > 0 ? (
                <Panel title="关系">
                    <div className="space-y-3">
                        {supports.length > 0 ? (
                            <div>
                                <div className="mb-1.5 text-[11.5px] font-medium text-[var(--social-fg-muted)]">它支撑了</div>
                                {supports.map(({ link, memory }) => memory ? (
                                    <RelationRow key={link.to} kind={link.kind} memory={memory} onOpen={() => props.onOpenMemory(memory.id)} />
                                ) : null)}
                            </div>
                        ) : null}
                        {evidence.length > 0 ? (
                            <div>
                                <div className="mb-1.5 text-[11.5px] font-medium text-[var(--social-fg-muted)]">依据</div>
                                {evidence.map(({ link, memory }) => memory ? (
                                    <RelationRow key={link.from} kind={link.kind} memory={memory} onOpen={() => props.onOpenMemory(memory.id)} />
                                ) : null)}
                            </div>
                        ) : null}
                    </div>
                </Panel>
            ) : null}

            {item.versions.length > 0 ? (
                <Panel title={`版本（${item.versions.length}）`}>
                    <ol className="relative space-y-3 border-l border-[var(--social-border)] pl-4">
                        {[...item.versions].reverse().map((version, index) => (
                            <li key={version.version} className="relative">
                                <span className={cn('absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--social-surface)]', index === 0 ? 'bg-[var(--social-fg)]' : 'bg-[var(--social-fg-subtle)]')} />
                                <div className="flex items-center gap-2 text-[11.5px] text-[var(--social-fg-muted)]">
                                    <span className="font-semibold text-[var(--social-fg)]">v{version.version}</span>
                                    <span>{version.at}</span>
                                    <span>· {version.by}</span>
                                    {index === 0 ? <span className="rounded-full bg-[var(--social-muted)] px-1.5 text-[10px] font-semibold">当前</span> : <button type="button" className="ml-auto text-[11px] underline">回到这一版</button>}
                                </div>
                                <div className={cn('mt-1 text-[13px] leading-relaxed', index === 0 ? 'text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)]')}>{version.text}</div>
                                {version.note ? <div className="mt-0.5 text-[11.5px] text-[var(--social-fg-subtle)]">{version.note}</div> : null}
                            </li>
                        ))}
                    </ol>
                </Panel>
            ) : null}

            <Panel title="来源">
                <div className="flex flex-wrap gap-1.5">
                    {item.sources.map((source) => (
                        <span key={source} className="rounded-full border border-[var(--social-border)] px-2.5 py-1 text-[12px] text-[var(--social-fg)]">{source}</span>
                    ))}
                </div>
            </Panel>
        </div>
    )
}

function RelationRow(props: { kind: string; memory: MemoryItem; onOpen: () => void }) {
    const kindLabel = props.kind === 'conflicts' ? '冲突' : props.kind === 'supersedes' ? '取代' : '支撑'
    return (
        <button type="button" onClick={props.onOpen} className="flex w-full items-start gap-2 rounded-xl px-2 py-1.5 text-left hover:bg-[var(--social-hover)]">
            <span className={cn('mt-0.5 shrink-0 rounded px-1 text-[10px] font-semibold', props.kind === 'conflicts' ? 'bg-[var(--social-danger)]/12 text-[var(--social-danger)]' : 'bg-[var(--social-muted)] text-[var(--social-fg-muted)]')}>{kindLabel}</span>
            <MaturityBadge maturity={props.memory.maturity} inference={props.memory.inference} />
            <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--social-fg)]">{props.memory.text}</span>
        </button>
    )
}

export const LIBRARY_NAV: Array<{ scope: LibraryScope; label: string; count: number }> = [
    { scope: { layer: 'user' }, label: '用户层', count: itemsIn({ layer: 'user' }).length },
    { scope: { layer: 'project', project: 'haqi' }, label: 'haqi', count: itemsIn({ layer: 'project', project: 'haqi' }).length },
    { scope: { layer: 'project', project: 'agent-engine' }, label: 'agent-engine', count: itemsIn({ layer: 'project', project: 'agent-engine' }).length },
    { scope: { layer: 'task' }, label: '任务层（近 7 天）', count: itemsIn({ layer: 'task' }).length }
]

export function maturityCount(maturity: Maturity): number {
    return MEMORIES.filter((m) => m.maturity === maturity && m.status !== 'rejected').length
}

export { MATURITY_LABEL }
