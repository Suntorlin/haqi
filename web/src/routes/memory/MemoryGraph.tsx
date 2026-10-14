import { findMemory, GLOBAL_SCOPE, LEVEL_LABEL, MEMORIES, SHORT, type Level, type Memory } from './mock'

const SLOT = 96
const PILL_W = 84
const PILL_H = 32
const LABEL_W = 48
const ROW_Y: Record<Level, number> = { principle: 28, experience: 100, fact: 172 }
const HEIGHT = 206
const LEVELS: Level[] = ['principle', 'experience', 'fact']

type Placed = { memory: Memory; x: number; y: number }

/** Clusters per scope: a principle with the experiences and facts under it, stacked in one column block. */
function layout(scope: string): { placed: Placed[]; width: number } {
    const inScope = MEMORIES.filter((m) => m.scope === scope)
    const used = new Set<string>()
    const clusters: Array<Record<Level, Memory[]>> = []
    const take = (m: Memory | undefined, bucket: Memory[]) => {
        if (m && m.scope === scope && !used.has(m.id)) {
            used.add(m.id)
            bucket.push(m)
        }
    }
    // A pending rewrite sits right after the principle it would replace, so the conflict line stays short.
    const principles = inScope.filter((m) => m.level === 'principle' && !m.replaces)
    for (const rewrite of inScope.filter((m) => m.level === 'principle' && m.replaces)) {
        const index = principles.findIndex((m) => m.id === rewrite.replaces)
        principles.splice(index === -1 ? principles.length : index + 1, 0, rewrite)
    }
    for (const top of principles) {
        const cluster: Record<Level, Memory[]> = { principle: [], experience: [], fact: [] }
        take(top, cluster.principle)
        for (const id of top.evidence ?? []) {
            const child = findMemory(id)
            if (child?.level === 'experience') {
                take(child, cluster.experience)
                for (const factId of child.evidence ?? []) take(findMemory(factId), cluster.fact)
            } else {
                take(child, cluster.fact)
            }
        }
        clusters.push(cluster)
    }
    for (const mid of inScope.filter((m) => m.level === 'experience' && !used.has(m.id))) {
        const cluster: Record<Level, Memory[]> = { principle: [], experience: [], fact: [] }
        take(mid, cluster.experience)
        for (const factId of mid.evidence ?? []) take(findMemory(factId), cluster.fact)
        clusters.push(cluster)
    }
    for (const fact of inScope.filter((m) => !used.has(m.id))) {
        clusters.push({ principle: [], experience: [], fact: [fact] })
        used.add(fact.id)
    }

    const placed: Placed[] = []
    let x = LABEL_W
    for (const cluster of clusters) {
        const slots = Math.max(1, ...LEVELS.map((level) => cluster[level].length))
        for (const level of LEVELS) {
            const row = cluster[level]
            const offset = (slots - row.length) * SLOT / 2
            row.forEach((memory, index) => placed.push({ memory, x: x + offset + index * SLOT + SLOT / 2, y: ROW_Y[level] }))
        }
        x += slots * SLOT
    }
    return { placed, width: x + 8 }
}

function ScopeGraph(props: { scope: string; onOpen: (id: string) => void }) {
    const { placed, width } = layout(props.scope)
    const at = new Map(placed.map((p) => [p.memory.id, p]))
    const edges: Array<{ from: Placed; to: Placed; conflict?: boolean }> = []
    for (const p of placed) {
        for (const id of p.memory.evidence ?? []) {
            const child = at.get(id)
            if (child) edges.push({ from: child, to: p })
        }
        const replaced = p.memory.replaces ? at.get(p.memory.replaces) : undefined
        if (replaced) edges.push({ from: p, to: replaced, conflict: true })
    }

    return (
        <section className="overflow-hidden rounded-2xl border border-[var(--social-border)]">
            <h3 className="px-4 pt-3 text-[12px] font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{props.scope}</h3>
            <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} className="block" role="img" aria-label={`${props.scope} 记忆图谱`}>
                    {LEVELS.map((level) => (
                        <text key={level} x={12} y={ROW_Y[level] + 4} fontSize={12} fill="var(--social-fg-subtle)">{LEVEL_LABEL[level]}</text>
                    ))}
                    {edges.map(({ from, to, conflict }) => conflict ? (
                        <path key={`${from.memory.id}-${to.memory.id}`} d={`M ${from.x - PILL_W / 2} ${from.y} H ${to.x + PILL_W / 2}`} stroke="var(--social-danger)" strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
                    ) : (
                        <path
                            key={`${from.memory.id}-${to.memory.id}`}
                            d={`M ${from.x} ${from.y - PILL_H / 2} C ${from.x} ${(from.y + to.y) / 2}, ${to.x} ${(from.y + to.y) / 2}, ${to.x} ${to.y + PILL_H / 2}`}
                            stroke="var(--social-fg-subtle)"
                            strokeWidth={1.25}
                            fill="none"
                        />
                    ))}
                    {placed.map(({ memory, x, y }) => {
                        const principle = memory.level === 'principle' && memory.status === 'active'
                        const fact = memory.level === 'fact'
                        const pending = memory.status === 'pending'
                        return (
                            <g key={memory.id} transform={`translate(${x - PILL_W / 2}, ${y - PILL_H / 2})`} className="cursor-pointer" onClick={() => props.onOpen(memory.id)}>
                                <title>{memory.text}</title>
                                <rect
                                    width={PILL_W}
                                    height={PILL_H}
                                    rx={PILL_H / 2}
                                    fill={principle ? 'var(--social-primary)' : fact ? 'var(--social-muted)' : 'var(--social-surface)'}
                                    stroke={pending ? 'var(--social-warning)' : principle ? 'var(--social-primary)' : fact ? 'var(--social-muted)' : 'var(--social-fg-subtle)'}
                                    strokeWidth={1.25}
                                    strokeDasharray={pending ? '4 3' : undefined}
                                />
                                <text x={PILL_W / 2} y={PILL_H / 2 + 4} textAnchor="middle" fontSize={12} fill={principle ? 'var(--social-primary-fg)' : fact ? 'var(--social-fg-muted)' : 'var(--social-fg)'}>
                                    {SHORT[memory.id] ?? memory.id}
                                </text>
                            </g>
                        )
                    })}
                </svg>
            </div>
        </section>
    )
}

/** One small tree per scope: facts at the bottom, the experiences they back, the principles on top. */
export function MemoryGraph(props: { onOpen: (id: string) => void }) {
    const scopes = [GLOBAL_SCOPE, ...Array.from(new Set(MEMORIES.map((m) => m.scope).filter((s) => s !== GLOBAL_SCOPE)))]
    return (
        <div className="space-y-4">
            {scopes.map((scope) => <ScopeGraph key={scope} scope={scope} onOpen={props.onOpen} />)}
            <p className="px-1 text-[13px] text-[var(--social-fg-muted)]">黑底是原则，白底是经验，灰底是事实；连线是“依据”，虚线框等你确认，红色虚线是冲突。点任意一条可以改。</p>
        </div>
    )
}
