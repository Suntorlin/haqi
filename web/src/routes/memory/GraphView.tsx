import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type { Maturity, MemoryItem } from './types'
import { GRAPH_EVENTS, GRAPH_LABEL, GRAPH_REGIONS, LINKS, MEMORIES, TIMELINE_DAYS } from './mock'
import { LAYER_COLOR, LayerTag, MaturityBadge, StatusChip, SupportMeter } from './ui'

const COL_W = 100
const PILL_W = 90
const PILL_H = 26
const REGION_GAP = 26
const LEFT = 96
const BAND_Y: Record<Maturity, number> = { principle: 70, experience: 206, fact: 342 }
const ROW_GAP = 40
const BAND_H = 108
const BANDS: Array<{ key: Maturity; label: string; hint: string }> = [
    { key: 'principle', label: '原则 · 偏好', hint: '始终注入' },
    { key: 'experience', label: '经验 · 推断', hint: '按项目注入' },
    { key: 'fact', label: '事实', hint: '只做证据' }
]

type Pos = { x: number; y: number }

function layout() {
    const positions: Record<string, Pos> = {}
    const regions: Array<{ key: string; label: string; x: number; width: number; color: string }> = []
    let x = LEFT
    for (const region of GRAPH_REGIONS) {
        const cols = Math.max(1, ...(['principle', 'experience', 'fact'] as const).map((band) => Math.ceil(region.bands[band].length / 2)))
        const width = cols * COL_W
        for (const band of ['principle', 'experience', 'fact'] as const) {
            const ids = region.bands[band]
            const bandCols = Math.ceil(ids.length / 2)
            const offset = (cols - bandCols) * COL_W / 2
            ids.forEach((id, index) => {
                const col = Math.floor(index / 2)
                const row = index % 2
                positions[id] = { x: x + offset + col * COL_W + COL_W / 2, y: BAND_Y[band] + row * ROW_GAP }
            })
        }
        regions.push({ key: region.key, label: region.label, x, width, color: LAYER_COLOR[region.layer] })
        x += width + REGION_GAP
    }
    return { positions, regions, width: x - REGION_GAP + 16 }
}

function lineage(id: string): Set<string> {
    const seen = new Set<string>([id])
    const walk = (current: string, dir: 'up' | 'down') => {
        for (const link of LINKS) {
            const next = dir === 'up' ? (link.from === current ? link.to : null) : (link.to === current ? link.from : null)
            if (next && !seen.has(next)) {
                seen.add(next)
                walk(next, dir)
            }
        }
    }
    walk(id, 'up')
    walk(id, 'down')
    for (const link of LINKS) {
        if (link.kind === 'conflicts' && (link.from === id || link.to === id)) {
            seen.add(link.from)
            seen.add(link.to)
        }
    }
    return seen
}

function dayIndex(day: string): number {
    const index = TIMELINE_DAYS.indexOf(day)
    return index === -1 ? TIMELINE_DAYS.length - 1 : index
}

export function GraphView(props: { selectedId: string | null; onSelect: (id: string | null) => void; onOpenMemory: (id: string) => void; mobile?: boolean }) {
    const { positions, regions, width } = useMemo(layout, [])
    const height = BAND_Y.fact + ROW_GAP + PILL_H + 30
    const [day, setDay] = useState(TIMELINE_DAYS.length - 1)
    const [playing, setPlaying] = useState(false)
    const [hover, setHover] = useState<string | null>(null)
    const focus = hover ?? props.selectedId
    const lit = focus ? lineage(focus) : null
    const visible = (item: MemoryItem) => dayIndex(item.createdAt) <= day

    useEffect(() => {
        if (!playing) return
        const timer = window.setInterval(() => {
            setDay((current) => {
                if (current >= TIMELINE_DAYS.length - 1) {
                    setPlaying(false)
                    return current
                }
                return current + 1
            })
        }, 700)
        return () => window.clearInterval(timer)
    }, [playing])

    const scrollRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        const el = scrollRef.current
        const pos = props.selectedId ? positions[props.selectedId] : null
        if (!el || !pos || !props.mobile) return
        const scale = (width * 0.92) / width
        el.scrollLeft = Math.max(0, pos.x * scale - el.clientWidth / 2)
    }, [props.selectedId, props.mobile, positions, width])

    const byId = new Map(MEMORIES.map((m) => [m.id, m]))
    const selected = props.selectedId ? byId.get(props.selectedId) ?? null : null
    const currentDay = TIMELINE_DAYS[day]

    return (
        <div className="space-y-3">
            <div ref={scrollRef} className="relative overflow-x-auto rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)]">
                <svg viewBox={`0 0 ${width} ${height}`} className="block" style={{ width: props.mobile ? width * 0.92 : '100%', minWidth: props.mobile ? width * 0.92 : undefined }} role="img" aria-label="记忆图谱">
                    {BANDS.map((band) => (
                        <g key={band.key}>
                            <rect x={8} y={BAND_Y[band.key] - 24} width={width - 16} height={BAND_H - 12} rx={14} fill="var(--social-muted)" opacity={band.key === 'principle' ? 0.9 : band.key === 'experience' ? 0.55 : 0.3} />
                            <text x={18} y={BAND_Y[band.key] - 6} fontSize={11} fontWeight={600} fill="var(--social-fg)">{band.label}</text>
                            <text x={18} y={BAND_Y[band.key] + 9} fontSize={10} fill="var(--social-fg-muted)">{band.hint}</text>
                        </g>
                    ))}
                    {regions.map((region) => (
                        <g key={region.key}>
                            <circle cx={region.x + 6} cy={18} r={4} fill={region.color} />
                            <text x={region.x + 15} y={22} fontSize={11.5} fontWeight={600} fill="var(--social-fg)">{region.label}</text>
                        </g>
                    ))}
                    {LINKS.map((link) => {
                        const from = positions[link.from]
                        const to = positions[link.to]
                        const a = byId.get(link.from)
                        const b = byId.get(link.to)
                        if (!from || !to || !a || !b || !visible(a) || !visible(b)) return null
                        const dim = lit && !(lit.has(link.from) && lit.has(link.to))
                        if (link.kind === 'conflicts') {
                            const midY = Math.min(from.y, to.y) - 30
                            return (
                                <path key={`${link.from}-${link.to}`} d={`M ${from.x} ${from.y - PILL_H / 2} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y - PILL_H / 2}`} fill="none" stroke="var(--social-danger)" strokeWidth={1.6} strokeDasharray="4 3" opacity={dim ? 0.15 : 0.9} />
                            )
                        }
                        const y1 = from.y - PILL_H / 2
                        const y2 = to.y + PILL_H / 2
                        const pending = b.status === 'pending'
                        return (
                            <path
                                key={`${link.from}-${link.to}`}
                                d={`M ${from.x} ${y1} C ${from.x} ${(y1 + y2) / 2}, ${to.x} ${(y1 + y2) / 2}, ${to.x} ${y2}`}
                                fill="none"
                                stroke={lit && !dim ? 'var(--social-fg)' : 'var(--social-fg-subtle)'}
                                strokeWidth={lit && !dim ? 1.6 : 1.1}
                                strokeDasharray={pending ? '3 3' : undefined}
                                opacity={dim ? 0.12 : 0.8}
                            />
                        )
                    })}
                    {MEMORIES.map((item) => {
                        const pos = positions[item.id]
                        if (!pos || !visible(item)) return null
                        const dim = lit && !lit.has(item.id)
                        const isNew = dayIndex(item.createdAt) === day && day < TIMELINE_DAYS.length - 1
                        const isSelected = item.id === props.selectedId
                        const principle = item.maturity === 'principle'
                        const fact = item.maturity === 'fact'
                        const stroke = item.status === 'conflict' ? 'var(--social-danger)' : item.status === 'pending' ? '#f59e0b' : principle ? 'var(--social-primary)' : 'var(--social-border)'
                        return (
                            <g
                                key={item.id}
                                transform={`translate(${pos.x - PILL_W / 2}, ${pos.y - PILL_H / 2})`}
                                opacity={dim ? 0.18 : item.status === 'stale' ? 0.5 : 1}
                                className="cursor-pointer"
                                onMouseEnter={() => setHover(item.id)}
                                onMouseLeave={() => setHover(null)}
                                onClick={() => props.onSelect(isSelected ? null : item.id)}
                            >
                                {isSelected || isNew ? <rect x={-4} y={-4} width={PILL_W + 8} height={PILL_H + 8} rx={(PILL_H + 8) / 2} fill="none" stroke={isNew ? '#10b981' : 'var(--social-fg)'} strokeWidth={1.5} /> : null}
                                <rect
                                    width={PILL_W}
                                    height={PILL_H}
                                    rx={PILL_H / 2}
                                    fill={principle && item.status === 'active' ? 'var(--social-primary)' : fact ? 'var(--social-muted)' : 'var(--social-surface)'}
                                    stroke={stroke}
                                    strokeWidth={item.status === 'pending' || item.status === 'conflict' ? 1.6 : 1}
                                    strokeDasharray={item.inference || item.status === 'pending' ? '3 2.5' : undefined}
                                />
                                <circle cx={11} cy={PILL_H / 2} r={3.2} fill={LAYER_COLOR[item.layer]} />
                                <text
                                    x={PILL_W / 2 + 5}
                                    y={PILL_H / 2 + 3.8}
                                    textAnchor="middle"
                                    fontSize={10.5}
                                    fontWeight={principle ? 600 : 500}
                                    fill={principle && item.status === 'active' ? 'var(--social-primary-fg)' : fact ? 'var(--social-fg-muted)' : 'var(--social-fg)'}
                                >
                                    {GRAPH_LABEL[item.id] ?? item.id}
                                </text>
                                {item.support >= 3 && item.maturity !== 'fact' ? (
                                    <g transform={`translate(${PILL_W - 6}, -4)`}>
                                        <circle r={7.5} fill="var(--social-surface)" stroke="var(--social-border)" />
                                        <text y={3.2} textAnchor="middle" fontSize={9} fontWeight={700} fill="var(--social-fg)">{item.support}</text>
                                    </g>
                                ) : null}
                            </g>
                        )
                    })}
                </svg>
            </div>

            {selected ? (
                <div className="rounded-2xl border border-[var(--social-border)] p-3.5">
                    <GraphNodeCard item={selected} onOpen={() => props.onOpenMemory(selected.id)} wide={!props.mobile} />
                </div>
            ) : (
                <div className="rounded-2xl border border-dashed border-[var(--social-border)] px-4 py-3 text-[12.5px] text-[var(--social-fg-muted)]">点任意一条记忆，看它的依据链：哪些事实撑起了它、它又撑起了哪条原则。</div>
            )}

            <div className="rounded-2xl border border-[var(--social-border)] px-4 py-3">
                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={() => {
                            if (day >= TIMELINE_DAYS.length - 1) setDay(0)
                            setPlaying((value) => !value)
                        }}
                        className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[var(--social-primary)] px-3 text-[12px] font-semibold text-[var(--social-primary-fg)]"
                    >
                        {playing ? '暂停' : '回放成长过程'}
                    </button>
                    <input
                        type="range"
                        min={0}
                        max={TIMELINE_DAYS.length - 1}
                        value={day}
                        onChange={(event) => { setPlaying(false); setDay(Number(event.target.value)) }}
                        className="min-w-0 flex-1 accent-[var(--social-primary)]"
                        aria-label="时间"
                    />
                    <span className="w-12 shrink-0 text-right text-[12px] font-semibold tabular-nums text-[var(--social-fg)]">{currentDay}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--social-fg-muted)]">
                    {(GRAPH_EVENTS[currentDay] ?? ['这一天没有变化']).map((event) => <span key={event}>· {event}</span>)}
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-[11.5px] text-[var(--social-fg-muted)]">
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-6 rounded-full bg-[var(--social-primary)]" />原则 / 偏好</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-6 rounded-full border border-[var(--social-border)]" />经验</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-6 rounded-full border border-dashed border-[var(--social-fg-subtle)]" />推断 / 待确认</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-3 w-6 rounded-full bg-[var(--social-muted)]" />事实</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-px w-6 bg-[var(--social-fg-subtle)]" />支撑</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-px w-6 border-t border-dashed border-[var(--social-danger)]" />冲突</span>
                <span className="inline-flex items-center gap-1.5"><span className="flex h-4 w-4 items-center justify-center rounded-full border border-[var(--social-border)] text-[9px] font-bold text-[var(--social-fg)]">3</span>支撑数</span>
                {(['user', 'project', 'task'] as const).map((layer) => (
                    <span key={layer} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: LAYER_COLOR[layer] }} />{layer === 'user' ? '用户层' : layer === 'project' ? '项目层' : '任务层'}</span>
                ))}
            </div>
        </div>
    )
}

function GraphNodeCard(props: { item: MemoryItem; onOpen: () => void; wide?: boolean }) {
    const { item } = props
    const above = LINKS.filter((l) => l.from === item.id && l.kind === 'supports').map((l) => MEMORIES.find((m) => m.id === l.to)).filter((m): m is MemoryItem => Boolean(m))
    const below = LINKS.filter((l) => l.to === item.id && l.kind === 'supports').map((l) => MEMORIES.find((m) => m.id === l.from)).filter((m): m is MemoryItem => Boolean(m))
    const conflicts = LINKS.filter((l) => l.kind === 'conflicts' && (l.from === item.id || l.to === item.id)).map((l) => MEMORIES.find((m) => m.id === (l.from === item.id ? l.to : l.from))).filter((m): m is MemoryItem => Boolean(m))
    const chips = (label: string, list: MemoryItem[], danger?: boolean) => list.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn('text-[11.5px] font-medium', danger ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg-muted)]')}>{label}</span>
            {list.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full border border-[var(--social-border)] px-2 py-0.5 text-[11.5px] text-[var(--social-fg)]">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: LAYER_COLOR[m.layer] }} />
                    {GRAPH_LABEL[m.id] ?? m.id}
                </span>
            ))}
        </div>
    ) : null
    return (
        <div className={cn(props.wide ? 'grid grid-cols-[1.2fr_1fr] gap-5' : '')}>
            <div>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold tabular-nums text-[var(--social-fg-subtle)]">{item.id}</span>
                    <MaturityBadge maturity={item.maturity} inference={item.inference} />
                    <StatusChip status={item.status} />
                </div>
                <div className="mt-2 text-[13.5px] leading-relaxed text-[var(--social-fg)]">{item.text}</div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <LayerTag layer={item.layer} project={item.project} section={item.section} />
                    {item.maturity !== 'fact' ? <SupportMeter support={item.support} /> : null}
                    <span className="text-[11px] text-[var(--social-fg-muted)]">{item.injected ? '注入中' : '不注入'}</span>
                </div>
            </div>
            <div className={cn('space-y-2', props.wide ? '' : 'mt-3')}>
                {chips('撑起了', above)}
                {chips('依据', below)}
                {chips('冲突', conflicts, true)}
                {above.length + below.length + conflicts.length === 0 ? <div className="text-[12px] text-[var(--social-fg-muted)]">还没有关联：等同类事实出现后会被归纳。</div> : null}
                <button type="button" onClick={props.onOpen} className="text-[12.5px] font-semibold text-[var(--social-fg)] underline underline-offset-2">打开详情和版本</button>
            </div>
        </div>
    )
}
