import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

const STORAGE_KEY = 'hapi:sessionsSidebarWidth'
const MIN_SIDEBAR_WIDTH = 280
const DEFAULT_SIDEBAR_WIDTH = 380
const DEFAULT_XL_SIDEBAR_WIDTH = 400
const MAX_WIDTH_VIEWPORT_RATIO = 0.7
const FALLBACK_MAX_WIDTH = 860

function getViewportWidth(): number | undefined {
    if (typeof window === 'undefined') return undefined
    return window.innerWidth
}

export function getSessionSidebarMaxWidth(viewportWidth?: number): number {
    if (!viewportWidth || !Number.isFinite(viewportWidth) || viewportWidth <= 0) {
        return FALLBACK_MAX_WIDTH
    }
    return Math.max(MIN_SIDEBAR_WIDTH + 120, Math.floor(viewportWidth * MAX_WIDTH_VIEWPORT_RATIO))
}

export function getDefaultSessionSidebarWidth(viewportWidth?: number): number {
    if (!viewportWidth || !Number.isFinite(viewportWidth)) {
        return DEFAULT_SIDEBAR_WIDTH
    }
    return viewportWidth >= 1280 ? DEFAULT_XL_SIDEBAR_WIDTH : DEFAULT_SIDEBAR_WIDTH
}

export function clampSessionSidebarWidth(width: number, viewportWidth?: number): number {
    const maxWidth = getSessionSidebarMaxWidth(viewportWidth)
    if (!Number.isFinite(width)) {
        return getDefaultSessionSidebarWidth(viewportWidth)
    }
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(Math.round(width), maxWidth))
}

function loadSidebarWidth(): number {
    const viewportWidth = getViewportWidth()
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) {
            const parsed = Number(raw)
            return clampSessionSidebarWidth(parsed, viewportWidth)
        }
    } catch {
        // Ignore storage errors and fall back to defaults
    }
    return clampSessionSidebarWidth(getDefaultSessionSidebarWidth(viewportWidth), viewportWidth)
}

function saveSidebarWidth(width: number): void {
    try {
        localStorage.setItem(STORAGE_KEY, String(width))
    } catch {
        // Ignore storage errors
    }
}

export function useSessionSidebarWidth(): {
    sidebarWidth: number
    isResizing: boolean
    startSidebarResize: (event: ReactPointerEvent<HTMLDivElement>) => void
} {
    const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
    const [isResizing, setIsResizing] = useState(false)
    const dragStartRef = useRef<{ x: number; width: number } | null>(null)
    const widthRef = useRef(sidebarWidth)

    useEffect(() => {
        widthRef.current = sidebarWidth
    }, [sidebarWidth])

    useEffect(() => {
        function handleWindowResize() {
            const next = clampSessionSidebarWidth(widthRef.current, getViewportWidth())
            if (next === widthRef.current) return
            widthRef.current = next
            setSidebarWidth(next)
            saveSidebarWidth(next)
        }

        window.addEventListener('resize', handleWindowResize)
        return () => window.removeEventListener('resize', handleWindowResize)
    }, [])

    const startSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        event.preventDefault()
        dragStartRef.current = {
            x: event.clientX,
            width: widthRef.current
        }
        setIsResizing(true)
    }, [])

    useEffect(() => {
        if (!isResizing) return

        const originalCursor = document.body.style.cursor
        const originalUserSelect = document.body.style.userSelect
        document.body.style.cursor = 'col-resize'
        document.body.style.userSelect = 'none'

        function stopResizing() {
            setIsResizing(false)
            dragStartRef.current = null
            saveSidebarWidth(widthRef.current)
        }

        function handlePointerMove(event: PointerEvent) {
            const dragStart = dragStartRef.current
            if (!dragStart) return
            const next = clampSessionSidebarWidth(
                dragStart.width + (event.clientX - dragStart.x),
                getViewportWidth()
            )
            widthRef.current = next
            setSidebarWidth(next)
        }

        window.addEventListener('pointermove', handlePointerMove)
        window.addEventListener('pointerup', stopResizing)
        window.addEventListener('blur', stopResizing)

        return () => {
            window.removeEventListener('pointermove', handlePointerMove)
            window.removeEventListener('pointerup', stopResizing)
            window.removeEventListener('blur', stopResizing)
            document.body.style.cursor = originalCursor
            document.body.style.userSelect = originalUserSelect
        }
    }, [isResizing])

    return {
        sidebarWidth,
        isResizing,
        startSidebarResize
    }
}
