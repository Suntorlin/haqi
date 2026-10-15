import '@xyflow/react/dist/base.css'
import './memoryGraph.css'
import { useMemo, useRef, useState } from 'react'
import {
    Background,
    BackgroundVariant,
    BaseEdge,
    Handle,
    MarkerType,
    NodeToolbar,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
    type Edge,
    type EdgeProps,
    type Node,
    type NodeProps
} from '@xyflow/react'
import { SearchIcon } from '@/components/mobile/icons'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'
import { cn } from '@/lib/utils'
import { layoutGraph, lineage, NODE_H, NODE_W, type Point, type ScopeBox } from './graphLayout'
import { LevelIcon } from './MemoryDetail'
import { LEVEL_LABEL, MEMORIES, SHORT, type Level, type Memory } from './mock'

type MemoryNodeData = { memory: Memory; dim: boolean; focus: boolean; tip: boolean }
type BoxNodeData = { box: ScopeBox }
type RouteEdgeData = { bends: Point[] }
type MemoryFlowNode = Node<MemoryNodeData, 'memory'>
type BoxFlowNode = Node<BoxNodeData, 'box'>
type RouteFlowEdge = Edge<RouteEdgeData, 'route'>

const HIDDEN_HANDLE = '!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent'

function MemoryNode(props: NodeProps<MemoryFlowNode>) {
    const { memory, dim, focus, tip } = props.data
    const pending = memory.status === 'pending'
    const principle = memory.level === 'principle' && !pending
    return (
        <>
            <NodeToolbar isVisible={tip} position={Position.Top} offset={10}>
                <div className="w-[280px] rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)] px-4 py-3 shadow-[var(--shadow-float)]">
                    <p className="text-[13px] leading-relaxed text-[var(--social-fg)]">{memory.text}</p>
                    <p className="mt-1.5 text-[12px] text-[var(--social-fg-muted)]">
                        {LEVEL_LABEL[memory.level]} · {memory.scope}{pending ? ' · 等你确认' : ''} · 点击编辑
                    </p>
                </div>
            </NodeToolbar>
            <Handle type="target" position={Position.Bottom} id="b" className={HIDDEN_HANDLE} />
            <Handle type="source" position={Position.Top} id="t" className={HIDDEN_HANDLE} />
            <Handle type="target" position={Position.Right} id="r" className={HIDDEN_HANDLE} />
            <Handle type="source" position={Position.Left} id="l" className={HIDDEN_HANDLE} />
            <div
                style={{ width: NODE_W, height: NODE_H }}
                className={cn(
                    'flex items-center gap-2 rounded-full border px-3 text-[13px] transition-opacity',
                    principle && 'border-[var(--social-primary)] bg-[var(--social-primary)] font-semibold text-[var(--social-primary-fg)]',
                    memory.level === 'experience' && !pending && 'border-[var(--social-fg-subtle)] bg-[var(--social-surface)] text-[var(--social-fg)]',
                    memory.level === 'fact' && !pending && 'border-[var(--social-muted)] bg-[var(--social-muted)] text-[var(--social-fg-muted)]',
                    pending && 'border-dashed border-[var(--social-warning)] bg-[var(--social-surface)] text-[var(--social-fg)]',
                    focus && 'ring-2 ring-[var(--social-fg)] ring-offset-2 ring-offset-[var(--social-surface)]',
                    dim && 'opacity-25'
                )}
            >
                <LevelIcon level={memory.level} className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{SHORT[memory.id] ?? memory.id}</span>
            </div>
        </>
    )
}

function BoxNode(props: NodeProps<BoxFlowNode>) {
    const { box } = props.data
    return (
        <div style={{ width: box.width, height: box.height }} className="relative rounded-2xl border border-[var(--social-border)] bg-[var(--social-hover)]">
            <div className="flex items-baseline gap-2 px-6 pt-4">
                <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--social-fg)]">{box.scope}</span>
                <span className="text-[12px] text-[var(--social-fg-muted)]">{box.count} 条</span>
            </div>
            {(['principle', 'experience', 'fact'] as const).map((level) => (
                <div key={level} className="absolute left-6 text-[12px] text-[var(--social-fg-muted)]" style={{ top: box.rowY[level] - box.y + NODE_H / 2 - 8 }}>
                    {LEVEL_LABEL[level]}
                </div>
            ))}
        </div>
    )
}

/** A smooth vertical curve; a link that skips a level bends once through its gap on the middle level. */
function RouteEdge(props: EdgeProps<RouteFlowEdge>) {
    const points = [{ x: props.sourceX, y: props.sourceY }, ...(props.data?.bends ?? []), { x: props.targetX, y: props.targetY }]
    let path = `M ${points[0].x} ${points[0].y}`
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]
        const b = points[i]
        const midY = (a.y + b.y) / 2
        path += ` C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`
    }
    return <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} />
}

const NODE_TYPES = { memory: MemoryNode, box: BoxNode }
const EDGE_TYPES = { route: RouteEdge }

function Legend() {
    return (
        <div className="flex items-center gap-4 text-[12px] text-[var(--social-fg-muted)]">
            <span className="flex items-center gap-1.5"><LevelIcon level="principle" className="h-3.5 w-3.5 text-[var(--social-fg)]" />原则</span>
            <span className="flex items-center gap-1.5"><LevelIcon level="experience" className="h-3.5 w-3.5 text-[var(--social-fg)]" />经验</span>
            <span className="flex items-center gap-1.5"><LevelIcon level="fact" className="h-3.5 w-3.5 text-[var(--social-fg)]" />事实</span>
            <span className="flex items-center gap-1.5"><span className="h-3 w-5 rounded-full border border-dashed border-[var(--social-warning)]" />等你确认</span>
            <span className="flex items-center gap-1.5"><span className="h-px w-5 bg-[var(--social-danger)]" />冲突</span>
        </div>
    )
}

function GraphCanvas(props: { onOpen: (id: string) => void; mobile?: boolean }) {
    const flow = useReactFlow()
    const layout = useMemo(layoutGraph, [])
    const canvasRef = useRef<HTMLDivElement | null>(null)
    const [hover, setHover] = useState<string | null>(null)
    const [focusId, setFocusId] = useState<string | null>(null)
    const [query, setQuery] = useState('')
    const active = hover ?? focusId
    const lit = active ? lineage(active) : null

    const needle = query.trim()
    const matches = needle ? MEMORIES.filter((m) => m.text.includes(needle) || (SHORT[m.id] ?? '').includes(needle)) : []

    const nodes: Array<MemoryFlowNode | BoxFlowNode> = [
        ...layout.boxes.map((box): BoxFlowNode => ({
            id: `box:${box.scope}`,
            type: 'box',
            position: { x: box.x, y: box.y },
            data: { box },
            draggable: false,
            selectable: false,
            focusable: false,
            zIndex: -1
        })),
        ...layout.nodes.map(({ memory, x, y }): MemoryFlowNode => ({
            id: memory.id,
            type: 'memory',
            position: { x: x - NODE_W / 2, y },
            data: { memory, dim: Boolean(lit && !lit.has(memory.id)), focus: memory.id === focusId, tip: !props.mobile && memory.id === active },
            draggable: false
        }))
    ]

    const edges: Array<RouteFlowEdge | Edge> = layout.edges.map((route): RouteFlowEdge => {
        const parent = MEMORIES.find((m) => m.id === route.parent)
        const on = Boolean(lit?.has(route.child) && lit.has(route.parent))
        const off = Boolean(lit && !on)
        const color = on ? 'var(--social-fg)' : 'var(--social-fg-subtle)'
        return {
            id: `${route.child}->${route.parent}`,
            type: 'route',
            source: route.child,
            sourceHandle: 't',
            target: route.parent,
            targetHandle: 'b',
            data: { bends: route.points },
            style: { stroke: color, strokeWidth: on ? 2 : 1.25, opacity: off ? 0.12 : 1, strokeDasharray: parent?.status === 'pending' ? '5 4' : undefined },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color }
        }
    })
    for (const m of MEMORIES) {
        if (!m.replaces) continue
        const off = Boolean(lit && !(lit.has(m.id) && lit.has(m.replaces)))
        edges.push({
            id: `${m.id}-x-${m.replaces}`,
            source: m.id,
            sourceHandle: 'l',
            target: m.replaces,
            targetHandle: 'r',
            type: 'straight',
            animated: true,
            style: { stroke: 'var(--social-danger)', strokeWidth: 1.5, opacity: off ? 0.12 : 1 }
        })
    }

    const focusOn = (id: string) => {
        const placed = layout.nodes.find((n) => n.memory.id === id)
        if (!placed) return
        setFocusId(id)
        void flow.setCenter(placed.x, placed.y + NODE_H / 2, { zoom: 1.1, duration: 400 })
    }

    // Fit everything, top-aligned, so no empty band sits above the boxes.
    const showAll = (duration = 0) => {
        const el = canvasRef.current
        if (!el || layout.boxes.length === 0) return
        const width = Math.max(...layout.boxes.map((b) => b.x + b.width))
        const height = Math.max(...layout.boxes.map((b) => b.y + b.height))
        const pad = 16
        const zoom = Math.min((el.clientWidth - pad * 2) / width, (el.clientHeight - pad * 2) / height, 1)
        void flow.setViewport({ x: (el.clientWidth - width * zoom) / 2, y: pad, zoom }, { duration })
    }

    // Phones open at a readable zoom on the top-left of the first box; "看全部" shows everything.
    const onInit = () => {
        const first = layout.boxes[0]
        if (!props.mobile) {
            showAll()
            return
        }
        if (!first) return
        const zoom = 0.72
        void flow.setViewport({ x: 12 - first.x * zoom, y: 12 - first.y * zoom, zoom })
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--social-border)] px-3 py-2">
                <div className={props.mobile ? 'min-w-0 flex-1' : 'w-[260px]'}>
                    <TextField
                        variant="pill"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={(event) => { if (event.key === 'Enter' && matches[0]) focusOn(matches[0].id) }}
                        placeholder="搜索记忆，回车定位"
                        aria-label="搜索记忆"
                        leading={<SearchIcon className="h-[18px] w-[18px]" />}
                        trailing={needle ? <span className="pr-3 text-[12px] text-[var(--social-fg-muted)]">{matches.length} 条</span> : undefined}
                    />
                </div>
                {props.mobile ? null : <Legend />}
                <div className="ml-auto flex items-center gap-1">
                    {props.mobile ? null : (
                        <>
                            <IconButton size="sm" label="缩小" onClick={() => void flow.zoomOut({ duration: 200 })}>
                                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
                            </IconButton>
                            <IconButton size="sm" label="放大" onClick={() => void flow.zoomIn({ duration: 200 })}>
                                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                            </IconButton>
                        </>
                    )}
                    <IconButton size={props.mobile ? 'default' : 'sm'} label="看全部" onClick={() => { setFocusId(null); showAll(300) }}>
                        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
                    </IconButton>
                </div>
            </div>
            <div ref={canvasRef} className="min-h-0 flex-1">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={NODE_TYPES}
                    edgeTypes={EDGE_TYPES}
                    onInit={onInit}
                    minZoom={0.25}
                    maxZoom={2}
                    nodesConnectable={false}
                    nodesDraggable={false}
                    onNodeMouseEnter={(_, node) => { if (node.type === 'memory') setHover(node.id) }}
                    onNodeMouseLeave={() => setHover(null)}
                    onNodeClick={(_, node) => { if (node.type === 'memory') props.onOpen(node.id) }}
                    onPaneClick={() => setFocusId(null)}
                    attributionPosition="bottom-right"
                    className="memory-graph"
                >
                    <Background variant={BackgroundVariant.Dots} gap={16} size={1.2} color="var(--social-border)" />
                </ReactFlow>
            </div>
        </div>
    )
}

/** Pan / zoom canvas of all memories: dagre orders and routes each level, React Flow draws and handles input. */
export default function MemoryGraph(props: { onOpen: (id: string) => void; mobile?: boolean }) {
    return (
        <ReactFlowProvider>
            <div className="h-full w-full overflow-hidden rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)]">
                <GraphCanvas onOpen={props.onOpen} mobile={props.mobile} />
            </div>
        </ReactFlowProvider>
    )
}
