import { useMemo, type CSSProperties } from 'react'
import { cn } from '@/lib/utils'

type SessionLike = {
    id: string
    metadata?: {
        path?: string
        worktree?: { basePath?: string } | null
    } | null
}

export function getSessionProjectPath(session: Pick<SessionLike, 'metadata'>): string {
    return session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
}

/** Last path segment, used as the human-friendly project name. */
export function getProjectName(path: string): string {
    const parts = path.split(/[\\/]+/).filter(Boolean)
    return parts[parts.length - 1] ?? path
}

// ElevenLabs-style orb palettes [blob, blob, blob, base]: spread across hues so a long list stays varied.
const ORB_FAMILIES: ReadonlyArray<readonly [string, string, string, string]> = [
    ['#7dd3fc', '#38bdf8', '#a5f3fc', '#e0f2fe'],
    ['#6ee7b7', '#34d399', '#a7f3d0', '#ecfdf5'],
    ['#fdba74', '#fb923c', '#fde68a', '#fff7ed'],
    ['#fda4af', '#fb7185', '#fecdd3', '#fff1f2'],
    ['#c4b5fd', '#a78bfa', '#ddd6fe', '#f5f3ff'],
    ['#fde047', '#facc15', '#fef9c3', '#fefce8'],
    ['#93c5fd', '#60a5fa', '#c7d2fe', '#eff6ff'],
    ['#5eead4', '#2dd4bf', '#99f6e4', '#f0fdfa'],
    ['#fdba74', '#f472b6', '#fda4af', '#fff7ed'],
    ['#a5f3fc', '#c4b5fd', '#86efac', '#f0f9ff'],
    ['#93c5fd', '#fdba74', '#bae6fd', '#fff7ed'],
    ['#86efac', '#fde047', '#bbf7d0', '#f7fee7'],
    ['#f9a8d4', '#a5b4fc', '#fbcfe8', '#fdf2f8'],
    ['#cbd5e1', '#94a3b8', '#e2e8f0', '#f8fafc']
]

function hashString(value: string): number {
    let hash = 2166136261
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
}

/** Small deterministic PRNG so every seed always renders the same orb. */
function createRandom(seed: string): () => number {
    let state = hashString(seed) || 1
    return () => {
        state = (state + 0x6d2b79f5) | 0
        let value = Math.imul(state ^ (state >>> 15), 1 | state)
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296
    }
}

export function getOrbBackground(seed: string): string {
    const random = createRandom(seed)
    const between = (min: number, max: number) => Math.round(min + random() * (max - min))
    const [first, second, third, base] = ORB_FAMILIES[Math.floor(random() * ORB_FAMILIES.length)]
    return [
        'radial-gradient(circle at 30% 24%, rgba(255,255,255,0.6) 0%, rgba(255,255,255,0.14) 22%, rgba(255,255,255,0) 42%)',
        `radial-gradient(circle at ${between(8, 42)}% ${between(10, 45)}%, ${first} 0%, transparent 58%)`,
        `radial-gradient(circle at ${between(58, 92)}% ${between(25, 70)}%, ${second} 0%, transparent 56%)`,
        `radial-gradient(circle at ${between(25, 70)}% ${between(62, 95)}%, ${third} 0%, transparent 62%)`,
        `linear-gradient(160deg, ${base}, ${second})`
    ].join(', ')
}

/** ElevenLabs-style soft gradient orb, unique per seed (no initials, no badges). */
export function Orb(props: { seed: string; size: number; muted?: boolean; className?: string; style?: CSSProperties }) {
    const background = useMemo(() => getOrbBackground(props.seed), [props.seed])
    const size = props.size
    return (
        <span
            className={cn('block shrink-0 rounded-full transition-[filter,opacity]', props.muted ? 'opacity-80 saturate-[0.4]' : '', props.className)}
            style={{
                width: size,
                height: size,
                background,
                boxShadow: [
                    `inset 0 -${Math.round(size * 0.08)}px ${Math.round(size * 0.18)}px rgba(15, 23, 42, 0.10)`,
                    `inset 0 ${Math.round(size * 0.04)}px ${Math.round(size * 0.1)}px rgba(255, 255, 255, 0.45)`,
                    '0 0 0 0.5px rgba(15, 23, 42, 0.06)'
                ].join(', '),
                ...props.style
            }}
            aria-hidden="true"
        />
    )
}

export type AvatarRing = 'live' | 'pending' | 'seen' | null

const RING_BACKGROUNDS: Record<Exclude<AvatarRing, null>, string> = {
    live: 'linear-gradient(45deg, #feda75 0%, #fa7e1e 25%, #d62976 50%, #962fbf 75%, #4f5bd5 100%)',
    pending: 'linear-gradient(45deg, #fcd34d 0%, #fb923c 50%, #f43f5e 100%)',
    seen: 'var(--social-border)'
}

/**
 * Session avatar: an orb wrapped Instagram-style. The outer box size never changes, so rows stay
 * aligned: a ring (live / pending / seen) shrinks the orb inside a white gap; idle online sessions
 * get a green "active now" dot instead; pending approvals show a red counter.
 */
export function SessionAvatar(props: {
    session: Pick<SessionLike, 'id'>
    size: number
    ring?: AvatarRing
    presence?: boolean
    badgeCount?: number
    muted?: boolean
    className?: string
}) {
    const { size } = props
    const ring = props.ring ?? null
    const ringWidth = ring === 'seen' ? 1 : Math.max(2, Math.round(size * 0.04))
    const gap = ring ? Math.max(2, Math.round(size * 0.05)) : 0
    const inset = ring ? ringWidth + gap : 0
    const dotSize = Math.max(10, Math.round(size * 0.22))
    const badgeCount = props.badgeCount ?? 0

    return (
        <span className={cn('relative inline-block shrink-0', props.className)} style={{ width: size, height: size }}>
            {ring ? (
                <>
                    <span className="absolute inset-0 rounded-full" style={{ background: RING_BACKGROUNDS[ring] }} aria-hidden="true" />
                    <span className="absolute rounded-full bg-[var(--app-bg)]" style={{ inset: ringWidth }} aria-hidden="true" />
                </>
            ) : null}
            <Orb
                seed={props.session.id}
                size={size - inset * 2}
                muted={props.muted}
                className="absolute"
                style={{ left: inset, top: inset }}
            />
            {props.presence && !ring ? (
                <span
                    className="absolute rounded-full bg-[#22c55e] ring-[2.5px] ring-[var(--app-bg)]"
                    style={{ width: dotSize, height: dotSize, right: Math.round(size * 0.02), bottom: Math.round(size * 0.02) }}
                    aria-hidden="true"
                />
            ) : null}
            {badgeCount > 0 ? (
                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--social-badge)] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-[var(--app-bg)]">
                    {badgeCount > 99 ? '99+' : badgeCount}
                </span>
            ) : null}
        </span>
    )
}

/** Instagram group-DM look: two overlapping orbs (back top-left, front bottom-right). */
export function PairAvatar(props: { first: Pick<SessionLike, 'id'> | null; second: Pick<SessionLike, 'id'> | null; size: number; seed?: string }) {
    const { size } = props
    const inner = Math.round(size * 0.7)
    const fallback = props.seed ?? 'pair'
    return (
        <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
            <Orb seed={props.first?.id ?? `${fallback}:a`} size={inner} className="absolute left-0 top-0" />
            <Orb
                seed={props.second?.id ?? `${fallback}:b`}
                size={inner}
                className="absolute bottom-0 right-0"
                style={{ outline: '2.5px solid var(--app-bg)' }}
            />
        </span>
    )
}

/** Group avatar: a pair of member orbs, or a single orb seeded by the group itself. */
export function GroupAvatar(props: { seed: string; members: Array<Pick<SessionLike, 'id'>>; size: number }) {
    if (props.members.length >= 2) {
        return <PairAvatar first={props.members[0]} second={props.members[1]} size={props.size} />
    }
    return <Orb seed={props.members[0]?.id ?? props.seed} size={props.size} />
}
