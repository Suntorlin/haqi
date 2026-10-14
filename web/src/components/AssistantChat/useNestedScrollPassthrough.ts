import { useEffect, type RefObject } from 'react'

const LINE_HEIGHT_PX = 16

function canScrollY(el: Element): boolean {
    const style = getComputedStyle(el)
    return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1
}

/**
 * Wheel over a scrollable block inside a message (tool output, diff list, table) normally scrolls only
 * that block, and browsers keep the gesture latched to it even once it hits its edge, so the chat itself
 * seems stuck while the pointer rests on a message. Decide per wheel event: a block that can still move in
 * that direction keeps the wheel; a block that is exhausted (or cannot scroll) hands it to the chat.
 */
export function useNestedScrollPassthrough(viewportRef: RefObject<HTMLElement | null>): void {
    useEffect(() => {
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }

        const onWheel = (event: WheelEvent) => {
            if (event.ctrlKey || event.defaultPrevented) {
                return
            }
            const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
                ? LINE_HEIGHT_PX
                : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
                    ? viewport.clientHeight
                    : 1
            const deltaY = event.deltaY * unit
            // Mostly horizontal gestures stay with whatever scrolls sideways.
            if (deltaY === 0 || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
                return
            }

            let sawExhaustedBlock = false
            for (let el = event.target instanceof Element ? event.target : null; el && el !== viewport; el = el.parentElement) {
                if (!canScrollY(el)) {
                    continue
                }
                const atTop = el.scrollTop <= 0
                const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
                if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) {
                    return // this block can still take it
                }
                sawExhaustedBlock = true
            }

            if (sawExhaustedBlock) {
                event.preventDefault()
                viewport.scrollTop += deltaY
            }
        }

        viewport.addEventListener('wheel', onWheel, { passive: false })
        return () => viewport.removeEventListener('wheel', onWheel)
    }, [viewportRef])
}
