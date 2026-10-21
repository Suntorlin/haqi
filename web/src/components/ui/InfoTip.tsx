import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { InfoIcon } from '@/components/mobile/icons'
import { cn } from '@/lib/utils'

/**
 * An explanation that is not always on screen: an (i) icon next to a title. Hover shows it on desktop, a tap shows
 * it on phones; a tap outside or Escape hides it. The icon keeps a 44px hit area.
 */
export function InfoTip(props: { text: string; label?: string; align?: 'start' | 'end'; className?: string }) {
    const [open, setOpen] = useState(false)
    const [place, setPlace] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(null)
    const root = useRef<HTMLSpanElement>(null)

    // Fixed to the viewport and kept 8px inside it, so a tip near an edge is never cut off. It renders into <body>:
    // a dialog that is moved with `translate` would otherwise become the box that `fixed` is measured from.
    useEffect(() => {
        if (!open || !root.current) return
        const rect = root.current.getBoundingClientRect()
        const width = Math.min(256, window.innerWidth - 16)
        const wanted = props.align === 'end' ? rect.right - width : rect.left - 8
        const left = Math.max(8, Math.min(wanted, window.innerWidth - width - 8))
        // In the lower half of the screen the tip opens upward, so it does not run off the bottom.
        setPlace(rect.top > window.innerHeight / 2
            ? { bottom: window.innerHeight - rect.top + 8, left, width }
            : { top: rect.bottom + 8, left, width })
    }, [open, props.align])

    useEffect(() => {
        if (!open) return
        const close = (event: Event) => {
            if (event instanceof KeyboardEvent ? event.key === 'Escape' : !root.current?.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('pointerdown', close)
        document.addEventListener('keydown', close)
        return () => {
            document.removeEventListener('pointerdown', close)
            document.removeEventListener('keydown', close)
        }
    }, [open])

    return (
        <span
            ref={root}
            className={cn('relative inline-flex align-middle', props.className)}
            // Hover only for a mouse: a tap fires enter then click, which would open and close it at once.
            onPointerEnter={(event) => { if (event.pointerType === 'mouse') setOpen(true) }}
            onPointerLeave={(event) => { if (event.pointerType === 'mouse') setOpen(false) }}
        >
            <button
                type="button"
                aria-label={props.label ?? props.text}
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className="relative -m-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--social-fg-subtle)] transition-colors hover:text-[var(--social-fg-muted)] after:absolute after:-inset-2 after:content-['']"
            >
                <InfoIcon className="h-4 w-4" />
            </button>
            {open && place ? createPortal(
                <span
                    role="tooltip"
                    style={{ top: place.top, bottom: place.bottom, left: place.left, maxWidth: place.width }}
                    className="social-float-card fixed z-[90] w-max rounded-xl px-3 py-2 text-left text-footnote font-normal normal-case leading-snug tracking-normal text-[var(--social-fg)]"
                >
                    {props.text}
                </span>,
                document.body
            ) : null}
        </span>
    )
}
