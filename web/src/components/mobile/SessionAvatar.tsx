import { useMemo, type CSSProperties } from 'react'
import { CountBadge } from '@/components/ui/badge'
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

// ElevenLabs-style orb palettes: 18 families of [blob, blob, blob, base] colours, defined as
// --orb-<family>-<slot> tokens in index.css. Each family blends two or three clearly different hues
// so a list of avatars reads varied, while the grain overlay keeps them matte.
const ORB_FAMILY_COUNT = 18
const ORB_FAMILIES: ReadonlyArray<readonly [string, string, string, string]> = Array.from({ length: ORB_FAMILY_COUNT }, (_, family) => [
    `var(--orb-${family}-0)`,
    `var(--orb-${family}-1)`,
    `var(--orb-${family}-2)`,
    `var(--orb-${family}-3)`
] as const)

// Fine monochrome grain, blended with `overlay` on top of the gradients for a frosted, matte finish.
const GRAIN_LAYER = `url("data:image/svg+xml,${encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>"
    + "<filter id='n' color-interpolation-filters='sRGB'><feTurbulence type='fractalNoise' baseFrequency='1.15' numOctaves='2' stitchTiles='stitch'/>"
    + "<feColorMatrix type='saturate' values='0'/>"
    + "<feComponentTransfer><feFuncR type='linear' slope='0.3' intercept='0.35'/>"
    + "<feFuncG type='linear' slope='0.3' intercept='0.35'/><feFuncB type='linear' slope='0.3' intercept='0.35'/>"
    + "<feFuncA type='linear' slope='0' intercept='1'/></feComponentTransfer></filter>"
    + "<rect width='100%' height='100%' filter='url(%23n)'/></svg>"
).replace(/%2523/g, '%23')}") 0 0 / 96px 96px`

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
        GRAIN_LAYER,
        'linear-gradient(var(--orb-glaze-1), var(--orb-glaze-2))',
        'radial-gradient(circle at 32% 26%, var(--orb-gloss) 0%, transparent 46%)',
        `radial-gradient(circle at ${between(8, 42)}% ${between(10, 45)}%, ${first} 0%, transparent 60%)`,
        `radial-gradient(circle at ${between(58, 92)}% ${between(25, 70)}%, ${second} 0%, transparent 58%)`,
        `radial-gradient(circle at ${between(25, 70)}% ${between(62, 95)}%, ${third} 0%, transparent 64%)`,
        `linear-gradient(160deg, ${base}, ${second})`
    ].join(', ')
}

const ORB_BLEND_MODES = 'overlay, normal, normal, normal, normal, normal, normal'

/** ElevenLabs-style soft gradient orb with a matte grain, unique per seed (no initials, no badges). */
export function Orb(props: { seed: string; size: number; muted?: boolean; className?: string; style?: CSSProperties }) {
    const background = useMemo(() => getOrbBackground(props.seed), [props.seed])
    const size = props.size
    return (
        <span
            className={cn('social-orb block shrink-0 rounded-full transition-[filter,opacity]', props.muted ? 'social-orb-muted' : '', props.className)}
            style={{
                width: size,
                height: size,
                background,
                backgroundBlendMode: ORB_BLEND_MODES,
                boxShadow: [
                    `inset 0 -${Math.round(size * 0.1)}px ${Math.round(size * 0.22)}px var(--orb-shade)`,
                    `inset 0 ${Math.round(size * 0.03)}px ${Math.round(size * 0.08)}px var(--orb-sheen)`,
                    '0 0 0 0.5px var(--orb-edge)'
                ].join(', '),
                ...props.style
            }}
            aria-hidden="true"
        />
    )
}

export type AvatarRing = 'live' | 'pending' | 'seen' | null

const RING_BACKGROUNDS: Record<Exclude<AvatarRing, null>, string> = {
    live: 'var(--ring-live)',
    pending: 'var(--ring-pending)',
    seen: 'var(--social-border)'
}

/**
 * Session avatar: an orb wrapped Instagram-style. The ring is the only status signal (live / pending /
 * seen); offline sessions fade. The outer box size never changes, so rows stay aligned, and pending
 * approvals show a red counter.
 */
export function SessionAvatar(props: {
    session: Pick<SessionLike, 'id'>
    size: number
    ring?: AvatarRing
    badgeCount?: number
    muted?: boolean
    className?: string
}) {
    const { size } = props
    const ring = props.ring ?? null
    const ringWidth = ring === 'seen' ? 1 : Math.max(2, Math.round(size * 0.04))
    const gap = ring ? Math.max(2, Math.round(size * 0.05)) : 0
    const inset = ring ? ringWidth + gap : 0
    const badgeCount = props.badgeCount ?? 0

    return (
        <span className={cn('relative inline-block shrink-0', props.className)} style={{ width: size, height: size }}>
            {ring ? (
                <>
                    <span className="absolute inset-0 rounded-full" style={{ background: RING_BACKGROUNDS[ring] }} aria-hidden="true" />
                    <span className="absolute rounded-full bg-[var(--social-surface)]" style={{ inset: ringWidth }} aria-hidden="true" />
                </>
            ) : null}
            <Orb
                seed={props.session.id}
                size={size - inset * 2}
                muted={props.muted}
                className="absolute"
                style={{ left: inset, top: inset }}
            />
            <CountBadge count={badgeCount} className="absolute -right-1 -top-1" />
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
                style={{ outline: '2.5px solid var(--social-surface)' }}
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
