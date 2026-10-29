import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export type ShotPin = { x: number; y: number; label: string }

/**
 * A screenshot with numbered pins instead of a paragraph that says "the button at the top left…".
 * Tap a pin to read its one line; tap it again or anywhere else to close.
 */
export function PinnedShot(props: { pins: ShotPin[]; caption?: string; src?: string; alt?: string; children?: ReactNode }) {
    const { t } = useTranslation()
    const [active, setActive] = useState<number | null>(null)
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (active === null) return
        const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setActive(null) }
        const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setActive(null) }
        document.addEventListener('pointerdown', close)
        document.addEventListener('keydown', esc)
        return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
    }, [active])
    return (
        <figure className="m-0">
            <div ref={ref} className="relative overflow-hidden rounded-2xl border border-[var(--social-border)]" onClick={(e) => { if (e.target === e.currentTarget) setActive(null) }}>
                {props.src ? <img src={props.src} alt={props.alt ?? ''} className="block w-full" /> : props.children}
                {props.pins.map((pin, i) => {
                    const open = active === i
                    const left = pin.x > 60
                    const above = pin.y > 65
                    return (
                        <span key={pin.label} className="absolute" style={{ left: `${pin.x}%`, top: `${pin.y}%` }}>
                            <button
                                type="button"
                                aria-expanded={open}
                                aria-label={t('report.pin.label', { n: i + 1, text: pin.label })}
                                onClick={() => setActive(open ? null : i)}
                                className={cn(
                                    "relative flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-caption font-semibold tabular-nums shadow-[0_0_0_2px_var(--social-surface)] transition-transform duration-150 after:absolute after:-inset-2.5 after:content-[''] active:scale-95",
                                    open ? 'bg-[var(--social-badge)] text-[var(--social-on-accent)]' : 'bg-[var(--social-primary)] text-[var(--social-primary-fg)]'
                                )}
                            >
                                {i + 1}
                            </button>
                            {open ? (
                                <span
                                    role="status"
                                    className={cn(
                                        'absolute z-10 w-max max-w-[220px] rounded-xl bg-[var(--social-primary)] px-3 py-2 text-footnote leading-snug text-[var(--social-primary-fg)] shadow-[var(--shadow-float)] animate-menu-pop',
                                        left ? 'right-4' : 'left-4',
                                        above ? 'bottom-3' : 'top-3'
                                    )}
                                >
                                    {pin.label}
                                </span>
                            ) : null}
                        </span>
                    )
                })}
            </div>
            {props.caption ? <figcaption className="mt-1.5 text-caption text-[var(--social-fg-muted)]">{props.caption}</figcaption> : null}
        </figure>
    )
}
