import { useEffect, type RefObject } from 'react'

/** Share of the finger travel past the edge that moves the content. */
const RESISTANCE = 0.4
/** The content never moves further than this past the edge. */
const MAX_PULL_PX = 72
/** Finger travel before the gesture counts as horizontal or vertical. */
const AXIS_LOCK_PX = 6
const RELEASE_MS = 320

/** Pull grows with the finger but slows down and stays under MAX_PULL_PX. */
function damp(distance: number): number {
    const pull = Math.abs(distance) * RESISTANCE
    return Math.sign(distance) * MAX_PULL_PX * (1 - 1 / (pull / MAX_PULL_PX + 1))
}

/**
 * Rubber band for a horizontal scroller: a drag past either end pulls `content` along with resistance,
 * showing blank room so the row clearly ends there, and it springs back when the finger lifts.
 * Works the same on iOS and Android; the scroller sets `overscroll-behavior-x: none` so iOS does not
 * add its own bounce on top. Vertical drags are left to the page.
 * Pass `mounted` when the scroller is rendered only some of the time, so the listeners attach once it is.
 */
export function useEdgeBounce(
    scrollerRef: RefObject<HTMLElement | null>,
    contentRef: RefObject<HTMLElement | null>,
    mounted = true
): void {
    useEffect(() => {
        const scroller = scrollerRef.current
        const content = contentRef.current
        if (!scroller || !content) return

        let startX = 0
        let startY = 0
        let lastX = 0
        let axis: 'x' | 'y' | null = null
        // Finger position where the scroller hit an end; null while scrolling normally.
        let edgeX: number | null = null
        let edge: 'start' | 'end' | null = null

        const atStart = () => scroller.scrollLeft <= 0
        const atEnd = () => scroller.scrollLeft >= scroller.scrollWidth - scroller.clientWidth - 1
        const setOffset = (px: number, animate: boolean) => {
            content.style.transition = animate ? `transform ${RELEASE_MS}ms cubic-bezier(0.2, 0.9, 0.3, 1)` : 'none'
            content.style.transform = px === 0 ? '' : `translate3d(${px}px, 0, 0)`
        }
        const release = () => {
            if (edgeX !== null) setOffset(0, true)
            edgeX = null
            edge = null
            axis = null
        }

        const onTouchStart = (event: TouchEvent) => {
            if (event.touches.length !== 1) {
                release()
                return
            }
            const touch = event.touches[0]
            startX = lastX = touch.clientX
            startY = touch.clientY
            axis = null
            edgeX = null
            edge = null
        }

        const onTouchMove = (event: TouchEvent) => {
            if (event.touches.length !== 1) return
            const { clientX: x, clientY: y } = event.touches[0]
            if (axis === null) {
                const dx = x - startX
                const dy = y - startY
                if (Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return
                axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
            }
            if (axis !== 'x') return

            // Finger moving left scrolls toward the end.
            const towardEnd = x < lastX
            lastX = x
            if (edgeX === null) {
                if (x === startX) return
                if (towardEnd && atEnd()) edge = 'end'
                else if (!towardEnd && atStart()) edge = 'start'
                else return
                edgeX = x
                return
            }

            const distance = x - edgeX
            // Back past the point where the end was reached: normal scrolling takes over again.
            if ((edge === 'end' && distance >= 0) || (edge === 'start' && distance <= 0)) {
                setOffset(0, false)
                edgeX = null
                edge = null
                return
            }
            setOffset(damp(distance), false)
        }

        scroller.addEventListener('touchstart', onTouchStart, { passive: true })
        scroller.addEventListener('touchmove', onTouchMove, { passive: true })
        scroller.addEventListener('touchend', release, { passive: true })
        scroller.addEventListener('touchcancel', release, { passive: true })
        return () => {
            scroller.removeEventListener('touchstart', onTouchStart)
            scroller.removeEventListener('touchmove', onTouchMove)
            scroller.removeEventListener('touchend', release)
            scroller.removeEventListener('touchcancel', release)
            setOffset(0, false)
        }
    }, [scrollerRef, contentRef, mounted])
}
