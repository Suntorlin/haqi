import dagre from '@dagrejs/dagre'
import { findMemory, GLOBAL_SCOPE, MEMORIES, type Level, type Memory } from './mock'

export const NODE_W = 132
export const NODE_H = 44
const RANK: Record<Level, number> = { fact: 0, experience: 1, principle: 2 }
const ROW = NODE_H + 52
const BOX_PAD_X = 24
const LABEL_COL = 84
const TITLE_H = 52
const BOX_GAP = 32
const GAP = 20

export type PlacedMemory = { memory: Memory; x: number; y: number }
export type Point = { x: number; y: number }
export type RoutedEdge = { child: string; parent: string; points: Point[] }
export type ScopeBox = { scope: string; count: number; x: number; y: number; width: number; height: number; rowY: Record<Level, number> }

export function scopesInOrder(): string[] {
    const projects = Array.from(new Set(MEMORIES.map((m) => m.scope).filter((s) => s !== GLOBAL_SCOPE)))
    return [GLOBAL_SCOPE, ...projects]
}

/**
 * x order inside one scope from dagre (crossing minimisation); y is fixed by level.
 * An unlinked memory stands on its own chain of invisible spacers, so it keeps its level
 * without tying unrelated memories together.
 */
function orderScope(scope: string): { items: Memory[]; centerX: Map<string, number>; span: number; routes: RoutedEdge[] } {
    const items = MEMORIES.filter((m) => m.scope === scope)
    const ids = new Set(items.map((m) => m.id))
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'BT', nodesep: GAP, ranksep: 52, marginx: 0, marginy: 0 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const m of items) g.setNode(m.id, { width: NODE_W, height: NODE_H })

    const linked = new Set<string>()
    for (const m of items) {
        for (const childId of m.evidence ?? []) {
            const child = findMemory(childId)
            if (!child || !ids.has(childId)) continue
            g.setEdge(childId, m.id, { minlen: RANK[m.level] - RANK[child.level], weight: 2 })
            linked.add(m.id)
            linked.add(childId)
        }
    }
    for (const m of items) {
        if (linked.has(m.id) || RANK[m.level] === 0) continue
        let below = ''
        for (let rank = 0; rank < RANK[m.level]; rank++) {
            const spacer = `${m.id}__spacer${rank}`
            g.setNode(spacer, { width: 1, height: NODE_H })
            if (below) g.setEdge(below, spacer, { minlen: 1 })
            below = spacer
        }
        g.setEdge(below, m.id, { minlen: 1 })
    }
    dagre.layout(g)

    // Left-to-right order per level from dagre; a pending rewrite goes right after what it would replace.
    const centerX = new Map<string, number>()
    for (const level of ['fact', 'experience', 'principle'] as const) {
        const row = items.filter((m) => m.level === level)
        const rewrites = row.filter((m) => m.replaces && row.some((r) => r.id === m.replaces))
        const ordered = row.filter((m) => !rewrites.includes(m)).sort((a, b) => (g.node(a.id).x ?? 0) - (g.node(b.id).x ?? 0))
        for (const rewrite of rewrites) ordered.splice(ordered.findIndex((m) => m.id === rewrite.replaces) + 1, 0, rewrite)
        let prev = -Infinity
        for (const m of ordered) {
            const wanted = m.replaces && rewrites.includes(m) ? prev : g.node(m.id).x ?? 0
            const x = Math.max(wanted, prev + NODE_W + GAP)
            centerX.set(m.id, x)
            prev = x
        }
    }
    let min = Infinity
    let max = -Infinity
    for (const x of centerX.values()) {
        min = Math.min(min, x)
        max = Math.max(max, x)
    }
    for (const [id, x] of centerX) centerX.set(id, x - min)

    // A link that skips a level passes the middle level through the gap dagre kept for it.
    const routes: RoutedEdge[] = []
    for (const m of items) {
        for (const childId of m.evidence ?? []) {
            const child = findMemory(childId)
            if (!child || !ids.has(childId)) continue
            const points: Point[] = (g.edge(childId, m.id)?.points ?? []).map((p: Point) => ({ x: p.x - min, y: p.y }))
            const skips = RANK[m.level] - RANK[child.level] > 1 && points.length > 2
            let via: Point | null = null
            if (skips) {
                const middleY = (points[0].y + points[points.length - 1].y) / 2
                via = points.reduce((best, p) => Math.abs(p.y - middleY) < Math.abs(best.y - middleY) ? p : best)
            }
            routes.push({ child: childId, parent: m.id, points: via ? [via] : [] })
        }
    }
    return { items, centerX, span: Math.max(0, max - min), routes }
}

/** One box per scope, packed into rows no wider than the widest box; inside: principles, experiences, facts. */
export function layoutGraph(): { nodes: PlacedMemory[]; boxes: ScopeBox[]; edges: RoutedEdge[] } {
    const ordered = scopesInOrder().map((scope) => ({ scope, ...orderScope(scope) }))
    const widthOf = (span: number) => LABEL_COL + BOX_PAD_X * 2 + span + NODE_W
    const maxWidth = Math.max(...ordered.map((o) => widthOf(o.span)))
    const height = TITLE_H + ROW * 2 + NODE_H + 24
    const nodes: PlacedMemory[] = []
    const boxes: ScopeBox[] = []
    const edges: RoutedEdge[] = []
    let x = 0
    let y = 0
    for (const o of ordered) {
        const width = widthOf(o.span)
        if (x > 0 && x + width > maxWidth * 1.25) {
            x = 0
            y += height + BOX_GAP
        }
        const rowY: Record<Level, number> = { principle: y + TITLE_H, experience: y + TITLE_H + ROW, fact: y + TITLE_H + ROW * 2 }
        const left = x + LABEL_COL + BOX_PAD_X + NODE_W / 2
        for (const memory of o.items) {
            nodes.push({ memory, x: left + (o.centerX.get(memory.id) ?? 0), y: rowY[memory.level] })
        }
        for (const route of o.routes) {
            edges.push({ ...route, points: route.points.map((p) => ({ x: left + p.x, y: y + TITLE_H + p.y })) })
        }
        boxes.push({ scope: o.scope, count: o.items.length, x, y, width, height, rowY })
        x += width + BOX_GAP
    }
    return { nodes, boxes, edges }
}

/** Everything a memory stands on and everything it holds up. */
export function lineage(id: string): Set<string> {
    const seen = new Set<string>([id])
    const down = (current: string) => {
        for (const childId of findMemory(current)?.evidence ?? []) {
            if (!seen.has(childId)) { seen.add(childId); down(childId) }
        }
    }
    const up = (current: string) => {
        for (const parent of MEMORIES.filter((m) => m.evidence?.includes(current))) {
            if (!seen.has(parent.id)) { seen.add(parent.id); up(parent.id) }
        }
    }
    down(id)
    up(id)
    const self = findMemory(id)
    if (self?.replaces) seen.add(self.replaces)
    for (const m of MEMORIES) if (m.replaces === id) seen.add(m.id)
    return seen
}
