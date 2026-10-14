import { Suspense, lazy, useCallback, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { SwapIcon, CloseIcon } from '@/components/mobile/icons'
import { IconButton } from '@/components/ui/IconButton'
import { PreviewPanel } from '@/routes/sessions/preview'
import {
    DOCK_CHAT_MIN_WIDTH,
    DOCK_MIN_WIDTH,
    DOCK_PANEL_IDS,
    SessionDockProvider,
    useSessionDockState,
    type DockPanelId,
    type DockSide,
    type SessionDock
} from '@/hooks/useSessionDock'
import { useTranslation } from '@/lib/use-translation'

// xterm is loaded the first time a terminal panel opens.
const TerminalPanel = lazy(() => import('@/routes/sessions/terminal').then((m) => ({ default: m.TerminalPanel })))

function DockPanel(props: {
    id: DockPanelId
    sessionId: string
    dock: SessionDock
    maxWidth: () => number
}) {
    const { t } = useTranslation()
    const { id, dock } = props
    const side = dock.sideOf(id)
    const [isResizing, setIsResizing] = useState(false)
    const dragRef = useRef<{ x: number; width: number } | null>(null)

    const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        dragRef.current = { x: event.clientX, width: dock.widthOf(id) }
        setIsResizing(true)
    }, [dock, id])

    const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        const start = dragRef.current
        if (!start) return
        // A right panel grows when its left edge moves left; a left panel is the mirror image.
        const delta = side === 'right' ? start.x - event.clientX : event.clientX - start.x
        const next = Math.min(Math.max(start.width + delta, DOCK_MIN_WIDTH), Math.max(DOCK_MIN_WIDTH, props.maxWidth()))
        dock.setWidth(id, next)
    }, [dock, id, props, side])

    const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        dragRef.current = null
        setIsResizing(false)
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId)
        }
    }, [])

    const moveLabel = side === 'right' ? t('dock.moveLeft') : t('dock.moveRight')
    const actions = (
        <>
            <IconButton size="sm" label={moveLabel} onClick={() => dock.swapSide(id)}>
                <SwapIcon className="h-[18px] w-[18px]" />
            </IconButton>
            <IconButton size="sm" label={t('dock.close')} onClick={() => dock.close(id)}>
                <CloseIcon className="h-[18px] w-[18px]" />
            </IconButton>
        </>
    )

    return (
        <aside
            className={`relative flex shrink flex-col bg-[var(--social-surface)] ${side === 'right' ? 'border-l' : 'border-r'} border-[var(--social-border)]`}
            style={{ width: dock.widthOf(id), minWidth: DOCK_MIN_WIDTH }}
        >
            <div
                className={`group absolute inset-y-0 z-20 w-[9px] cursor-col-resize ${side === 'right' ? '-left-[5px]' : '-right-[5px]'}`}
                role="separator"
                aria-orientation="vertical"
                aria-label={t('dock.resize')}
                title={t('dock.resize')}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
            >
                <div
                    className={`absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors ${isResizing ? 'bg-[var(--social-fg-subtle)]' : 'bg-transparent group-hover:bg-[var(--social-border)]'}`}
                />
            </div>
            <div className="min-h-0 flex-1">
                {id === 'terminal'
                    ? <Suspense fallback={null}><TerminalPanel sessionId={props.sessionId} dockActions={actions} /></Suspense>
                    : <PreviewPanel sessionId={props.sessionId} dockActions={actions} />}
            </div>
        </aside>
    )
}

/**
 * Desktop session pane: chat in the middle, terminal / preview docked left or right of it.
 * The chat keeps at least DOCK_CHAT_MIN_WIDTH and slides over as panels open.
 */
export function SessionDockLayout(props: { sessionId: string; children: ReactNode }) {
    const dock = useSessionDockState()
    const containerRef = useRef<HTMLDivElement>(null)

    const panelsOn = (side: DockSide) => DOCK_PANEL_IDS.filter((id) => dock.isOpen(id) && dock.sideOf(id) === side)
    const maxWidthFor = (id: DockPanelId) => () => {
        const total = containerRef.current?.clientWidth ?? 0
        const others = DOCK_PANEL_IDS
            .filter((other) => other !== id && dock.isOpen(other))
            .reduce((sum, other) => sum + dock.widthOf(other), 0)
        return total - DOCK_CHAT_MIN_WIDTH - others
    }
    const renderPanels = (side: DockSide) => panelsOn(side).map((id) => (
        <DockPanel key={`${props.sessionId}:${id}`} id={id} sessionId={props.sessionId} dock={dock} maxWidth={maxWidthFor(id)} />
    ))

    return (
        <SessionDockProvider value={dock}>
            <div ref={containerRef} className="flex h-full min-h-0">
                {renderPanels('left')}
                <div className="min-w-0 flex-1" style={{ minWidth: DOCK_CHAT_MIN_WIDTH }}>
                    {props.children}
                </div>
                {renderPanels('right')}
            </div>
        </SessionDockProvider>
    )
}
