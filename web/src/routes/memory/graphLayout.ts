import dagre from '@dagrejs/dagre'
import type { MemoryItem, MemoryLink } from '@/types/api'
import { evidenceOf, scopeLabel, scopesInOrder, type Level } from './model'

export const NODE_W = 132
export const NODE_H = 44
const RANK: Record<Level, number> = { fact: 0, experience: 1, principle: 2 }
const LEVELS: Level[] = ['principle', 'experience', 'fact']
const COL_GAP = 20
const SLOT = NODE_W + COL_GAP
const ROW_GAP = 16
const LEVEL_GAP = 52
const PER_ROW = 6
const BOX_PAD_X = 24
const LABEL_COL = 84
const TITLE_H = 52
const BOX_GAP = 32

export type PlacedMemory = { memory: MemoryItem; x: number; y: number }
export type Point = { x: number; y: number }
export type RoutedEdge = { child: string; parent: string; points: Point[] }
export type ScopeBox = { scope: string; label: string; count: number; x: number; y: number; width: number; height: number; rowY: Record<Level, number> }

/**
 * Left-to-right order per level inside one scope. dagre minimises crossings for linked memories;
 * an unlinked memory stands on its own chain of invisible spacers so it keeps its level.
 * A pending rewrite goes right after the memory it would replace.
 */
function orderScope(items: MemoryItem[], links: MemoryLink[]): Record<Level, MemoryItem[]> {
    const byId = new Map(items.map((m) => [m.id, m]))
    const g = new dagre.graphlib.Graph()
    g.setGraph({ rankdir: 'BT', nodesep: COL_GAP, ranksep: LEVEL_GAP, marginx: 0, marginy: 0 })
    g.setDefaultEdgeLabel(() => ({}))
    for (const m of items) g.setNode(m.id, { width: NODE_W, height: NODE_H })
    const linked = new Set<string>()
    for (const m of items) {
        for (const childId of evidenceOf(m.id, links)) {
            const child = byId.get(childId)
            if (!child || RANK[m.level] <= RANK[child.level]) continue
            g.setEdge(child.id, m.id, { minlen: RANK[m.level] - RANK[child.level], weight: 2 })
            linked.add(child.id)
            linked.add(m.id)
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

    const order = {} as Record<Level, MemoryItem[]>
    for (const level of LEVELS) {
        const row = items.filter((m) => m.level === level)
        const rewrites = row.filter((m) => m.replaces && row.some((r) => r.id === m.replaces))
        const ordered = row
            .filter((m) => !rewrites.includes(m))
            .sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)) || (g.node(a.id).x ?? 0) - (g.node(b.id).x ?? 0))
        for (const rewrite of rewrites) ordered.splice(ordered.findIndex((m) => m.id === rewrite.replaces) + 1, 0, rewrite)
        order[level] = ordered
    }
    return order
}

const rowsOf = (count: number) => Math.max(1, Math.ceil(count / PER_ROW))
const levelHeight = (count: number) => rowsOf(count) * NODE_H + (rowsOf(count) - 1) * ROW_GAP

/**
 * One box per scope, packed into rows no wider than ~the widest box. Inside a box: principles,
 * experiences, facts; a level with many memories wraps after PER_ROW so the box stays readable.
 */
export function layoutGraph(memories: MemoryItem[], links: MemoryLink[]): { nodes: PlacedMemory[]; boxes: ScopeBox[]; edges: RoutedEdge[] } {
    const scopes = scopesInOrder(memories).map((scope) => {
        const items = memories.filter((m) => m.scope === scope)
        const order = orderScope(items, links)
        const cols = Math.max(1, ...LEVELS.map((level) => Math.min(PER_ROW, order[level].length)))
        const top = {} as Record<Level, number>
        let cursor = TITLE_H
        for (const level of LEVELS) {
            top[level] = cursor
            cursor += levelHeight(order[level].length) + LEVEL_GAP
        }
        return {
            scope,
            items,
            order,
            cols,
            top,
            width: LABEL_COL + BOX_PAD_X * 2 + cols * SLOT - COL_GAP,
            height: cursor - LEVEL_GAP + 24
        }
    })
    const maxWidth = Math.max(0, ...scopes.map((s) => s.width))
    const nodes: PlacedMemory[] = []
    const boxes: ScopeBox[] = []
    const edges: RoutedEdge[] = []
    let x = 0
    let y = 0
    let shelf = 0
    for (const s of scopes) {
        if (x > 0 && x + s.width > maxWidth * 1.25) {
            x = 0
            y += shelf + BOX_GAP
            shelf = 0
        }
        const rowY = {} as Record<Level, number>
        for (const level of LEVELS) {
            rowY[level] = y + s.top[level]
            const list = s.order[level]
            list.forEach((memory, index) => {
                const row = Math.floor(index / PER_ROW)
                const inRow = Math.min(PER_ROW, list.length - row * PER_ROW)
                const offset = (s.cols - inRow) * SLOT / 2
                nodes.push({
                    memory,
                    x: x + LABEL_COL + BOX_PAD_X + offset + (index % PER_ROW) * SLOT + NODE_W / 2,
                    y: rowY[level] + row * (NODE_H + ROW_GAP)
                })
            })
        }
        for (const m of s.items) {
            for (const childId of evidenceOf(m.id, links)) {
                if (s.items.some((item) => item.id === childId)) edges.push({ child: childId, parent: m.id, points: [] })
            }
        }
        boxes.push({ scope: s.scope, label: scopeLabel(s.scope), count: s.items.length, x, y, width: s.width, height: s.height, rowY })
        shelf = Math.max(shelf, s.height)
        x += s.width + BOX_GAP
    }
    return { nodes, boxes, edges }
}

/** Everything a memory stands on and everything it holds up. */
export function lineage(id: string, memories: MemoryItem[], links: MemoryLink[]): Set<string> {
    const seen = new Set<string>([id])
    const walk = (current: string, next: (from: string) => string[]) => {
        for (const other of next(current)) {
            if (!seen.has(other)) {
                seen.add(other)
                walk(other, next)
            }
        }
    }
    walk(id, (from) => evidenceOf(from, links))
    walk(id, (from) => links.filter((link) => link.fromId === from).map((link) => link.toId))
    const self = memories.find((m) => m.id === id)
    if (self?.replaces) seen.add(self.replaces)
    for (const m of memories) if (m.replaces === id) seen.add(m.id)
    return seen
}
