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

const PROJECT_GRADIENTS: ReadonlyArray<readonly [string, string]> = [
    ['#ff7a59', '#ff4d79'],
    ['#ffb547', '#ff7a45'],
    ['#34d399', '#0ea371'],
    ['#38bdf8', '#3b82f6'],
    ['#818cf8', '#6366f1'],
    ['#c084fc', '#9333ea'],
    ['#f472b6', '#db2777'],
    ['#2dd4bf', '#0891b2'],
    ['#fb7185', '#e11d48'],
    ['#a3e635', '#16a34a'],
    ['#fbbf24', '#ea580c'],
    ['#94a3b8', '#475569']
]

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

const AGENT_BACKGROUNDS: Record<AgentKind, string> = {
    claude: '#d97757',
    codex: '#111111',
    gemini: 'linear-gradient(135deg, #4f8cff, #9b6cff)',
    other: '#8e8e93'
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

/** Round agent avatar (Claude / Codex / Gemini) used next to chat bubbles. */
export function AgentAvatar(props: { flavor?: string | null; size?: number; className?: string }) {
    const size = props.size ?? 32
    const kind = getAgentKind(props.flavor)
    const style: CSSProperties = {
        width: size,
        height: size,
        background: AGENT_BACKGROUNDS[kind]
    }
    return (
        <span
            className={cn('inline-flex shrink-0 items-center justify-center rounded-full text-white shadow-sm', props.className)}
            style={style}
            aria-hidden="true"
        >
            <AgentGlyph flavor={props.flavor} className="h-[55%] w-[55%]" />
        </span>
    )
}

/**
 * WeChat-style rounded-square avatar: project gradient + initials, with an agent badge
 * and an optional red counter (pending approvals) like an unread badge.
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
    const [from, to] = getProjectGradient(path)
    const initials = getProjectInitials(path)
    const badgeSize = Math.max(16, Math.round(size * 0.38))
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
                    props.shape === 'circle' ? 'rounded-full' : 'rounded-[28%]',
                    props.dimmed ? 'opacity-55 grayscale-[70%]' : ''
                )}
                style={{
                    background: `linear-gradient(135deg, ${from}, ${to})`,
                    fontSize: Math.round(size * 0.36),
                    letterSpacing: '-0.02em',
                    textShadow: '0 1px 2px rgba(0,0,0,0.18)'
                }}
            >
                {initials}
            </span>
            {showAgentBadge ? (
                <span
                    className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full text-white ring-2 ring-[var(--app-bg)]"
                    style={{
                        width: badgeSize,
                        height: badgeSize,
                        background: AGENT_BACKGROUNDS[getAgentKind(props.session.metadata?.flavor)]
                    }}
                    aria-hidden="true"
                >
                    <AgentGlyph flavor={props.session.metadata?.flavor} className="h-[60%] w-[60%]" />
                </span>
            ) : null}
            {badgeCount > 0 ? (
                <span
                    className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--social-badge)] px-1 text-[11px] font-semibold leading-none text-white ring-2 ring-[var(--app-bg)]"
                >
                    {badgeCount > 99 ? '99+' : badgeCount}
                </span>
            ) : null}
        </span>
    )
}

function MiniTile(props: { path: string; fontSize: number }) {
    const [from, to] = getProjectGradient(props.path)
    return (
        <span
            className="flex min-h-0 min-w-0 items-center justify-center rounded-[5px] font-semibold text-white"
            style={{ background: `linear-gradient(135deg, ${from}, ${to})`, fontSize: props.fontSize }}
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
        const [from, to] = getProjectGradient(props.name)
        return (
            <span
                className="flex shrink-0 items-center justify-center rounded-[28%] font-semibold text-white"
                style={{ width: size, height: size, background: `linear-gradient(135deg, ${from}, ${to})`, fontSize: Math.round(size * 0.36) }}
            >
                {getProjectInitials(props.name)}
            </span>
        )
    }

    const columns = tiles.length === 1 ? 1 : 2
    const rows = tiles.length <= 2 ? 1 : 2
    return (
        <span
            className="grid shrink-0 gap-[2px] rounded-[28%] bg-[var(--social-search-bg)] p-[3px]"
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
                    <span className="block rounded-full bg-[var(--social-search-bg)]" style={{ width: inner, height: inner }} />
                )}
            </span>
            <span className="absolute bottom-0 right-0 rounded-full ring-2 ring-[var(--app-bg)]">
                {props.second ? (
                    <SessionAvatar session={props.second} size={inner} shape="circle" showAgentBadge={false} />
                ) : (
                    <span className="block rounded-full bg-[var(--social-search-bg)]" style={{ width: inner, height: inner }} />
                )}
            </span>
        </span>
    )
}
