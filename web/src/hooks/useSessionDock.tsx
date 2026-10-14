import { createContext, useContext, useMemo, useState } from 'react'

export type DockPanelId = 'terminal' | 'preview'
export type DockSide = 'left' | 'right'

export const DOCK_PANEL_IDS: readonly DockPanelId[] = ['terminal', 'preview']
export const DOCK_MIN_WIDTH = 280
export const DOCK_CHAT_MIN_WIDTH = 320

const STORAGE_KEY = 'hapi:sessionDock'
const DEFAULT_WIDTH = 440

type DockWidths = Record<DockPanelId, number>

const DEFAULT_WIDTHS: DockWidths = { terminal: DEFAULT_WIDTH, preview: DEFAULT_WIDTH }

function loadWidths(): DockWidths {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return DEFAULT_WIDTHS
        const parsed = JSON.parse(raw) as Partial<DockWidths>
        const next = { ...DEFAULT_WIDTHS }
        for (const id of DOCK_PANEL_IDS) {
            const width = parsed[id]
            if (typeof width === 'number' && Number.isFinite(width)) next[id] = Math.max(DOCK_MIN_WIDTH, Math.round(width))
        }
        return next
    } catch {
        return DEFAULT_WIDTHS
    }
}

function saveWidths(widths: DockWidths): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(widths))
    } catch {
        // Ignore storage errors
    }
}

export type SessionDock = {
    isOpen: (id: DockPanelId) => boolean
    sideOf: (id: DockPanelId) => DockSide
    widthOf: (id: DockPanelId) => number
    toggle: (id: DockPanelId) => void
    open: (id: DockPanelId) => void
    close: (id: DockPanelId) => void
    swapSide: (id: DockPanelId) => void
    setWidth: (id: DockPanelId, width: number) => void
}

const SessionDockContext = createContext<SessionDock | null>(null)

/** Desktop only: null on the phone layout, where terminal and preview stay full pages. */
export function useSessionDock(): SessionDock | null {
    return useContext(SessionDockContext)
}

export const SessionDockProvider = SessionDockContext.Provider

/** Open state and side live in memory (panels always open on the right); only widths are remembered. */
export function useSessionDockState(): SessionDock {
    const [open, setOpen] = useState<Record<DockPanelId, boolean>>({ terminal: false, preview: false })
    const [sides, setSides] = useState<Record<DockPanelId, DockSide>>({ terminal: 'right', preview: 'right' })
    const [widths, setWidths] = useState<DockWidths>(loadWidths)

    return useMemo<SessionDock>(() => ({
        isOpen: (id) => open[id],
        sideOf: (id) => sides[id],
        widthOf: (id) => widths[id],
        toggle: (id) => {
            // A reopened panel starts on the right again.
            setSides((prev) => (open[id] ? prev : { ...prev, [id]: 'right' }))
            setOpen((prev) => ({ ...prev, [id]: !prev[id] }))
        },
        open: (id) => {
            if (!open[id]) setSides((prev) => ({ ...prev, [id]: 'right' }))
            setOpen((prev) => ({ ...prev, [id]: true }))
        },
        close: (id) => setOpen((prev) => ({ ...prev, [id]: false })),
        swapSide: (id) => setSides((prev) => ({ ...prev, [id]: prev[id] === 'left' ? 'right' : 'left' })),
        setWidth: (id, width) => setWidths((prev) => {
            const next = { ...prev, [id]: Math.max(DOCK_MIN_WIDTH, Math.round(width)) }
            saveWidths(next)
            return next
        })
    }), [open, sides, widths])
}
