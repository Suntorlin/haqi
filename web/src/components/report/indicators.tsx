import { Orb } from '@/components/mobile/SessionAvatar'
import { CheckIcon } from '@/components/mobile/icons'
import type { CheckState, ReportTone } from './types'

/** Orb with a story ring that fills like a progress arc. Done goals drop the ring. */
export function ProgressOrb(props: { seed: string; size: number; progress: number; tone: ReportTone }) {
    const { size, tone } = props
    const hasRing = tone !== 'done'
    const ringWidth = Math.max(2, Math.round(size * 0.045))
    const gap = Math.max(2, Math.round(size * 0.05))
    const inset = hasRing ? ringWidth + gap : 0
    const pct = Math.round(Math.min(1, Math.max(0, props.progress)) * 100)
    const fill = tone === 'wait' ? 'var(--ring-pending)' : tone === 'stuck' ? 'var(--social-warning)' : 'var(--ring-live)'
    const mask = `conic-gradient(black ${pct}%, transparent 0)`
    return (
        <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
            {hasRing ? (
                <>
                    <span className="absolute inset-0 rounded-full bg-[var(--social-border)]" aria-hidden="true" />
                    <span className="absolute inset-0 rounded-full" style={{ background: fill, WebkitMask: mask, mask }} aria-hidden="true" />
                    <span className="absolute rounded-full bg-[var(--social-surface)]" style={{ inset: ringWidth }} aria-hidden="true" />
                </>
            ) : null}
            <Orb seed={props.seed} size={size - inset * 2} className="absolute" style={{ left: inset, top: inset }} />
        </span>
    )
}

/** Round state mark for acceptance checks: done / live / wait / todo. */
export function CheckRing(props: { state: CheckState }) {
    if (props.state === 'done') {
        return (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--social-success)] text-[var(--social-on-accent)]">
                <CheckIcon className="h-3.5 w-3.5" />
            </span>
        )
    }
    if (props.state === 'live') {
        return (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--social-border)]">
                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--social-badge)]" />
            </span>
        )
    }
    if (props.state === 'wait') {
        return (
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-[var(--social-warning)]">
                <span className="h-2 w-2 rounded-full bg-[var(--social-warning)]" />
            </span>
        )
    }
    return <span className="h-6 w-6 shrink-0 rounded-full border-2 border-[var(--social-border)]" />
}
