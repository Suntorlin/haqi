import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

type SessionLike = {
    active?: boolean
    metadata?: {
        path?: string
        flavor?: string | null
        worktree?: { basePath?: string } | null
    } | null
}

// Soft "orb" gradients (ElevenLabs-style): [base, highlight]. Bases stay dark enough for white initials.
const PROJECT_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
    ['#7c3aed', '#c4b5fd'],
    ['#2563eb', '#93c5fd'],
    ['#e11d48', '#fda4af'],
    ['#059669', '#6ee7b7'],
    ['#d97706', '#fcd34d'],
    ['#4f46e5', '#a5b4fc'],
    ['#0d9488', '#5eead4'],
    ['#db2777', '#f9a8d4'],
    ['#475569', '#cbd5e1'],
    ['#4d7c0f', '#bef264'],
    ['#0284c7', '#7dd3fc'],
    ['#ea580c', '#fdba74']
]

export function getProjectOrbBackground(path: string): string {
    const [base, highlight] = getProjectGradient(path)
    return `radial-gradient(circle at 28% 20%, ${highlight} 0%, ${base} 78%)`
}

function hashString(value: string): number {
    let hash = 0
    for (let index = 0; index < value.length; index += 1) {
        hash = (hash * 31 + value.charCodeAt(index)) | 0
    }
    return Math.abs(hash)
}

export function getSessionProjectPath(session: SessionLike): string {
    return session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
}

/** Last path segment, used as the human-friendly project name. */
export function getProjectName(path: string): string {
    const parts = path.split(/[\\/]+/).filter(Boolean)
    return parts[parts.length - 1] ?? path
}

export function getProjectInitials(path: string): string {
    const name = getProjectName(path)
    const words = name.split(/[-_.\s]+/).filter(Boolean)
    if (words.length >= 2) {
        return `${words[0][0]}${words[1][0]}`.toUpperCase()
    }
    const word = words[0] ?? name
    const chars = Array.from(word)
    if (chars.length === 0) return '?'
    if (/[^\x00-\x7f]/.test(chars[0])) return chars[0]
    return `${chars[0].toUpperCase()}${(chars[1] ?? '').toLowerCase()}`
}

export function getProjectGradient(path: string): readonly [string, string] {
    return PROJECT_GRADIENTS[hashString(path) % PROJECT_GRADIENTS.length]
}

type AgentKind = 'claude' | 'codex' | 'gemini' | 'other'

function getAgentKind(flavor: string | null | undefined): AgentKind {
    const normalized = flavor?.trim().toLowerCase() ?? ''
    if (normalized === 'claude') return 'claude'
    if (normalized === 'codex') return 'codex'
    if (normalized === 'gemini') return 'gemini'
    return 'other'
}


export function AgentGlyph(props: { flavor?: string | null; className?: string }) {
    const kind = getAgentKind(props.flavor)
    if (kind === 'claude') {
        return (
            <svg viewBox="0 0 24 24" fill="currentColor" className={props.className} aria-hidden="true">
                {[0, 30, 60, 90, 120, 150].map((angle) => (
                    <rect
                        key={angle}
                        x="11"
                        y="2.5"
                        width="2"
                        height="19"
                        rx="1"
                        transform={`rotate(${angle} 12 12)`}
                    />
                ))}
            </svg>
        )
    }
    if (kind === 'codex') {
        return (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
                <polyline points="5 7 10 12 5 17" />
                <line x1="12.5" y1="17" x2="19" y2="17" />
            </svg>
        )
    }
    if (kind === 'gemini') {
        return (
            <svg viewBox="0 0 24 24" fill="currentColor" className={props.className} aria-hidden="true">
                <path d="M12 2c.6 5.4 4.6 9.4 10 10-5.4.6-9.4 4.6-10 10-.6-5.4-4.6-9.4-10-10 5.4-.6 9.4-4.6 10-10z" />
            </svg>
        )
    }
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={props.className} aria-hidden="true">
            <circle cx="12" cy="12" r="5" />
        </svg>
    )
}

/** Monochrome round agent avatar (Claude / Codex / Gemini glyph) shown next to replies. */
export function AgentAvatar(props: { flavor?: string | null; size?: number; className?: string }) {
    const size = props.size ?? 28
    const style: CSSProperties = { width: size, height: size }
    return (
        <span
            className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--social-primary)] text-[var(--social-primary-fg)]', props.className)}
            style={style}
            aria-hidden="true"
        >
            <AgentGlyph flavor={props.flavor} className="h-[52%] w-[52%]" />
        </span>
    )
}

/**
 * Project avatar: soft gradient orb + initials, a monochrome agent badge and an optional
 * red counter (pending approvals) like an unread badge. Offline sessions render in grayscale.
 */
export function SessionAvatar(props: {
    session: SessionLike
    size?: number
    shape?: 'rounded' | 'circle'
    dimmed?: boolean
    badgeCount?: number
    showAgentBadge?: boolean
    className?: string
}) {
    const size = props.size ?? 48
    const path = getSessionProjectPath(props.session)
    const initials = getProjectInitials(path)
    const badgeSize = Math.max(14, Math.round(size * 0.36))
    const showAgentBadge = props.showAgentBadge ?? true
    const badgeCount = props.badgeCount ?? 0

    return (
        <span
            className={cn('relative inline-flex shrink-0', props.className)}
            style={{ width: size, height: size }}
        >
            <span
                className={cn(
                    'flex h-full w-full items-center justify-center font-semibold text-white transition-[filter,opacity]',
                    props.shape === 'rounded' ? 'rounded-[30%]' : 'rounded-full',
                    props.dimmed ? 'opacity-70 grayscale' : ''
                )}
                style={{
                    background: getProjectOrbBackground(path),
                    fontSize: Math.round(size * 0.34),
                    letterSpacing: '-0.02em',
                    textShadow: '0 1px 2px rgba(0,0,0,0.16)'
                }}
            >
                {initials}
            </span>
            {showAgentBadge ? (
                <span
                    className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full bg-[var(--social-primary)] text-[var(--social-primary-fg)] ring-2 ring-[var(--app-bg)]"
                    style={{ width: badgeSize, height: badgeSize }}
                    aria-hidden="true"
                >
                    <AgentGlyph flavor={props.session.metadata?.flavor} className="h-[60%] w-[60%]" />
                </span>
            ) : null}
            {badgeCount > 0 ? (
                <span
                    className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--social-badge)] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-[var(--app-bg)]"
                >
                    {badgeCount > 99 ? '99+' : badgeCount}
                </span>
            ) : null}
        </span>
    )
}

function MiniTile(props: { path: string; fontSize: number }) {
    return (
        <span
            className="flex aspect-square min-h-0 min-w-0 items-center justify-center self-center rounded-full font-semibold text-white"
            style={{ background: getProjectOrbBackground(props.path), fontSize: props.fontSize }}
        >
            {getProjectInitials(props.path)}
        </span>
    )
}

/** WeChat-style group avatar: a grid of the members' avatars inside one rounded square. */
export function GroupAvatar(props: { name: string; members: SessionLike[]; size?: number }) {
    const size = props.size ?? 50
    const tiles = props.members.slice(0, 4)

    if (tiles.length === 0) {
        return (
            <span
                className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
                style={{ width: size, height: size, background: getProjectOrbBackground(props.name), fontSize: Math.round(size * 0.34) }}
            >
                {getProjectInitials(props.name)}
            </span>
        )
    }

    const columns = tiles.length === 1 ? 1 : 2
    const rows = tiles.length <= 2 ? 1 : 2
    return (
        <span
            className="grid shrink-0 gap-[2px] rounded-full border border-[var(--social-border)] bg-[var(--social-muted)] p-[5px]"
            style={{
                width: size,
                height: size,
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                alignContent: 'center'
            }}
        >
            {tiles.map((member, index) => (
                <MiniTile
                    key={index}
                    path={getSessionProjectPath(member)}
                    fontSize={Math.max(8, Math.round(size * (tiles.length === 1 ? 0.34 : 0.17)))}
                />
            ))}
        </span>
    )
}

/** Two overlapping round avatars (Instagram "collab" style) for worker + reviewer pairs. */
export function PairAvatar(props: { first: SessionLike | null; second: SessionLike | null; size?: number }) {
    const size = props.size ?? 50
    const inner = Math.round(size * 0.68)
    return (
        <span className="relative inline-block shrink-0" style={{ width: size, height: size }}>
            <span className="absolute left-0 top-0 rounded-full ring-2 ring-[var(--app-bg)]">
                {props.first ? (
                    <SessionAvatar session={props.first} size={inner} shape="circle" showAgentBadge={false} />
                ) : (
                    <span className="block rounded-full bg-[var(--social-muted)]" style={{ width: inner, height: inner }} />
                )}
            </span>
            <span className="absolute bottom-0 right-0 rounded-full ring-2 ring-[var(--app-bg)]">
                {props.second ? (
                    <SessionAvatar session={props.second} size={inner} shape="circle" showAgentBadge={false} />
                ) : (
                    <span className="block rounded-full bg-[var(--social-muted)]" style={{ width: inner, height: inner }} />
                )}
            </span>
        </span>
    )
}
