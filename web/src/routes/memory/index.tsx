import { useMemo, useState, type ReactNode } from 'react'
import { MobilePageHeader, MobileTabBar } from '@/components/mobile/MobileTabBar'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'
import { IconButton } from '@/components/ui/IconButton'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { cn } from '@/lib/utils'
import { CANDIDATES, MEMORIES, TODAY } from './mock'
import { DecisionDetail, FeedList, PipelineFunnel, type Override } from './FeedView'
import { GraphView } from './GraphView'
import { LIBRARY_NAV, LibraryBoard, MemoryDetail, maturityCount, type LibraryScope } from './LibraryView'
import { ReviewView } from './ReviewView'
import { TrainingView } from './TrainingView'
import { LayerDot } from './ui'

type View = 'feed' | 'review' | 'library' | 'graph' | 'train'

const VIEWS: Array<{ key: View; label: string; hint: string }> = [
    { key: 'feed', label: '动态', hint: '每条记忆从采集到写入的全过程' },
    { key: 'review', label: '待确认', hint: '冲突、升级提议、拿不准的判断、每周复核' },
    { key: 'library', label: '记忆库', hint: '按层和成熟度管理每一条记忆' },
    { key: 'graph', label: '图谱', hint: '事实如何长成经验和原则' },
    { key: 'train', label: '训练', hint: '校准 Jev、改判断标准、看健康信号' }
]

const PENDING_COUNT = TODAY.pending

function scopeFromParam(value: string | null): LibraryScope {
    if (value === 'haqi' || value === 'agent-engine' || value === 'fish-studio') return { layer: 'project', project: value }
    if (value === 'task') return { layer: 'task' }
    return { layer: 'user' }
}

function sameScope(a: LibraryScope, b: LibraryScope): boolean {
    return a.layer === b.layer && a.project === b.project
}

/** Prototype memory page (mock data): capture feed, Jev decisions you can override, library, graph, training. */
export function MemoryPage() {
    const isMobile = useIsMobileLayout()
    const params = useMemo(() => new URLSearchParams(window.location.search), [])
    const [view, setView] = useState<View>((params.get('view') as View | null) ?? 'feed')
    const [candidateId, setCandidateId] = useState<string | null>(params.get('c') ?? (isMobile ? null : 'c2'))
    const [memoryId, setMemoryId] = useState<string | null>(params.get('m'))
    const [graphNode, setGraphNode] = useState<string | null>(params.get('g'))
    const [scope, setScope] = useState<LibraryScope>(scopeFromParam(params.get('scope')))
    const [overrides, setOverrides] = useState<Record<string, Override>>(() => {
        const initial: Record<string, Override> = {}
        if (params.get('o') === '1') {
            initial.c2 = { layer: 'project', section: '架构', maturity: 'principle', text: '记忆按成熟度分三层：事实 → 经验/推断 → 原则/偏好；原则需要确认后才注入。', addToTraining: true }
        }
        return initial
    })

    const candidate = candidateId ? CANDIDATES.find((c) => c.id === candidateId) ?? null : null
    const memory = memoryId ? MEMORIES.find((m) => m.id === memoryId) ?? null : null
    const openMemory = (id: string) => {
        const item = MEMORIES.find((m) => m.id === id)
        if (item && view === 'library') setScope(item.layer === 'project' ? { layer: 'project', project: item.project } : { layer: item.layer })
        setMemoryId(id)
    }

    const content = (mobile: boolean): ReactNode => {
        switch (view) {
            case 'feed':
                return (
                    <div className="space-y-4">
                        <PipelineFunnel compact={mobile} />
                        <FeedList candidates={CANDIDATES} selectedId={candidateId} overrides={overrides} onOpen={setCandidateId} compact={mobile} />
                    </div>
                )
            case 'review':
                return <ReviewView mobile={mobile} onOpenMemory={openMemory} />
            case 'library':
                return (
                    <div className="space-y-4">
                        {mobile ? (
                            <div className="flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                                {LIBRARY_NAV.map((entry) => (
                                    <button
                                        key={entry.label}
                                        type="button"
                                        onClick={() => setScope(entry.scope)}
                                        className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px]', sameScope(scope, entry.scope) ? 'border-[var(--social-primary)] bg-[var(--social-primary)] font-semibold text-[var(--social-primary-fg)]' : 'border-[var(--social-border)] text-[var(--social-fg)]')}
                                    >
                                        <LayerDot layer={entry.scope.layer} />
                                        {entry.label}
                                    </button>
                                ))}
                            </div>
                        ) : null}
                        <LibraryBoard scope={scope} selectedId={memoryId} onOpen={openMemory} mobile={mobile} />
                    </div>
                )
            case 'graph':
                return <GraphView selectedId={graphNode} onSelect={setGraphNode} onOpenMemory={(id) => { setView('library'); openMemory(id) }} mobile={mobile} />
            case 'train':
                return <TrainingView mobile={mobile} />
        }
    }

    const detail = (): { title: string; subtitle?: string; body: ReactNode; close: () => void } | null => {
        if (view === 'feed' && candidate) {
            return {
                title: 'Jev 决策',
                subtitle: `${candidate.at} · ${candidate.session}`,
                body: (
                    <DecisionDetail
                        candidate={candidate}
                        override={overrides[candidate.id] ?? null}
                        onOverride={(next) => setOverrides((current) => {
                            const copy = { ...current }
                            if (next) copy[candidate.id] = next
                            else delete copy[candidate.id]
                            return copy
                        })}
                    />
                ),
                close: () => setCandidateId(null)
            }
        }
        if ((view === 'library' || view === 'review') && memory) {
            return {
                title: `记忆 ${memory.id}`,
                subtitle: memory.layer === 'project' ? `项目层 · ${memory.project}` : memory.layer === 'user' ? '用户层' : '任务层',
                body: <MemoryDetail key={memory.id} item={memory} onOpenMemory={openMemory} />,
                close: () => setMemoryId(null)
            }
        }
        return null
    }

    const panel = detail()
    const viewMeta = VIEWS.find((v) => v.key === view) ?? VIEWS[0]

    if (isMobile) {
        if (panel) {
            return (
                <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
                    <SubPageHeader title={panel.title} subtitle={panel.subtitle} onBack={panel.close} />
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-4">{panel.body}</div>
                </div>
            )
        }
        return (
            <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
                <MobilePageHeader title="记忆" subtitle={`影子模式 · 今天采集 ${TODAY.captured} 条`} actions={<ModeBadge />} />
                <div className="flex shrink-0 gap-2 overflow-x-auto px-4 pb-2.5 pt-1 [scrollbar-width:none]">
                    {VIEWS.map((item) => (
                        <button
                            key={item.key}
                            type="button"
                            onClick={() => setView(item.key)}
                            className={cn('flex h-8 shrink-0 items-center gap-1 rounded-full border px-3.5 text-[13px]', view === item.key ? 'border-[var(--social-primary)] bg-[var(--social-primary)] font-semibold text-[var(--social-primary-fg)]' : 'border-[var(--social-border)] text-[var(--social-fg)]')}
                        >
                            {item.label}
                            {item.key === 'review' ? <span className={cn('rounded-full px-1.5 text-[11px] leading-4', view === item.key ? 'bg-[var(--social-primary-fg)] text-[var(--social-primary)]' : 'bg-amber-500 text-white')}>{PENDING_COUNT}</span> : null}
                        </button>
                    ))}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-1">{content(true)}</div>
                <MobileTabBar active="memory" />
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0">
            <aside className="flex h-full w-[288px] shrink-0 flex-col border-r border-[var(--social-border)] bg-[var(--social-surface)]">
                <MobilePageHeader title="记忆" subtitle={`影子模式 · 今天采集 ${TODAY.captured} 条`} actions={<ModeBadge />} />
                <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
                    {VIEWS.filter((item) => item.key !== 'library').map((item) => (
                        <NavRow key={item.key} active={view === item.key} onClick={() => setView(item.key)} label={item.label} hint={item.hint} badge={item.key === 'review' ? PENDING_COUNT : item.key === 'feed' ? TODAY.captured : undefined} warn={item.key === 'review'} />
                    ))}
                    <div className="px-3 pb-1.5 pt-4 text-[11.5px] font-semibold text-[var(--social-fg-muted)]">记忆库</div>
                    {LIBRARY_NAV.map((entry) => (
                        <NavRow
                            key={entry.label}
                            active={view === 'library' && sameScope(scope, entry.scope)}
                            onClick={() => { setView('library'); setScope(entry.scope); setMemoryId(null) }}
                            label={entry.label}
                            icon={<LayerDot layer={entry.scope.layer} className="h-2.5 w-2.5" />}
                            badge={entry.count}
                        />
                    ))}
                    <div className="mx-3 mt-4 rounded-2xl bg-[var(--social-muted)] px-3 py-3">
                        <div className="text-[11.5px] font-semibold text-[var(--social-fg)]">成熟度分布</div>
                        <div className="mt-2 space-y-1.5">
                            {([
                                ['principle', '原则 · 偏好', '始终注入'],
                                ['experience', '经验 · 推断', '按项目注入'],
                                ['fact', '事实', '只做证据']
                            ] as const).map(([key, label, hint]) => (
                                <div key={key} className="flex items-center gap-2 text-[12px]">
                                    <span className="w-[76px] text-[var(--social-fg)]">{label}</span>
                                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--social-surface)]">
                                        <div className="h-full rounded-full bg-[var(--social-fg)]" style={{ width: `${(maturityCount(key) / MEMORIES.length) * 100 * 2}%`, opacity: key === 'principle' ? 1 : key === 'experience' ? 0.6 : 0.3 }} />
                                    </div>
                                    <span className="w-5 text-right tabular-nums text-[var(--social-fg-muted)]">{maturityCount(key)}</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 text-[11px] leading-snug text-[var(--social-fg-muted)]">原则需要你确认；事实攒够了会被归纳成经验。</div>
                    </div>
                </nav>
            </aside>
            <main className="flex min-w-0 flex-1 flex-col bg-[var(--social-surface)]">
                <header className="flex h-[60px] shrink-0 items-center gap-3 border-b border-[var(--social-border)] px-6">
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[var(--social-fg)]">
                            {view === 'library' ? `记忆库 · ${LIBRARY_NAV.find((entry) => sameScope(entry.scope, scope))?.label ?? ''}` : viewMeta.label}
                        </div>
                        <div className="mt-[3px] truncate text-[12px] text-[var(--social-fg-muted)]">{viewMeta.hint}</div>
                    </div>
                    <span className="hidden rounded-full border border-[var(--social-border)] px-3 py-1 text-[12px] text-[var(--social-fg-muted)] xl:inline">原型 · 假数据</span>
                </header>
                <div className="flex min-h-0 flex-1">
                    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-6 py-5">{content(false)}</div>
                    {panel ? (
                        <aside className="flex h-full w-[440px] shrink-0 flex-col border-l border-[var(--social-border)] bg-[var(--social-surface)]">
                            <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[var(--social-border)] pl-5 pr-3">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-[14px] font-semibold text-[var(--social-fg)]">{panel.title}</div>
                                    {panel.subtitle ? <div className="truncate text-[11.5px] text-[var(--social-fg-muted)]">{panel.subtitle}</div> : null}
                                </div>
                                <IconButton label="关闭" size="sm" onClick={panel.close}>
                                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                                </IconButton>
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{panel.body}</div>
                        </aside>
                    ) : null}
                </div>
            </main>
        </div>
    )
}

function ModeBadge() {
    return (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-[var(--social-border)] px-2.5 text-[12px] font-medium text-[var(--social-fg)]">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            影子
        </span>
    )
}

function NavRow(props: { active: boolean; onClick: () => void; label: string; hint?: string; badge?: number; icon?: ReactNode; warn?: boolean }) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-current={props.active ? 'page' : undefined}
            className={cn(
                'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left transition-colors',
                props.active ? 'bg-[var(--social-muted)]' : 'hover:bg-[var(--social-hover)]'
            )}
        >
            {props.icon}
            <div className="min-w-0 flex-1">
                <div className={cn('truncate text-[14px]', props.active ? 'font-semibold text-[var(--social-fg)]' : 'text-[var(--social-fg)]')}>{props.label}</div>
                {props.hint ? <div className="truncate text-[11.5px] text-[var(--social-fg-muted)]">{props.hint}</div> : null}
            </div>
            {props.badge !== undefined ? (
                <span className={cn('shrink-0 rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-[18px]', props.warn ? 'bg-amber-500 text-white' : 'text-[var(--social-fg-muted)]')}>{props.badge}</span>
            ) : null}
        </button>
    )
}
