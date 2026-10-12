import { useMemo } from 'react'
import type { SessionSummary } from '@/types/api'
import { getSessionTitle } from '@/lib/session-title'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { SessionAvatar } from '@/components/mobile/SessionAvatar'

function sortStories(sessions: SessionSummary[]): SessionSummary[] {
    const rank = (session: SessionSummary) => {
        if (session.pendingRequestsCount > 0) return 0
        if (session.thinking) return 1
        return 2
    }
    return [...sessions].sort((a, b) => {
        const diff = rank(a) - rank(b)
        if (diff !== 0) return diff
        return b.updatedAt - a.updatedAt
    })
}

/**
 * Instagram-style "stories" row of the sessions that are currently online.
 * Thinking sessions get a spinning gradient ring and a LIVE badge; sessions waiting for
 * approval get an orange ring.
 */
export function ActiveStoriesStrip(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
}) {
    const { t } = useTranslation()
    const stories = useMemo(
        () => sortStories(props.sessions.filter((session) => session.active)),
        [props.sessions]
    )

    return (
        <div className="social-scroll-x flex gap-3.5 overflow-x-auto px-4 pb-3 pt-1">
            <button
                type="button"
                onClick={props.onNewSession}
                className="flex w-[66px] shrink-0 flex-col items-center gap-1 [-webkit-tap-highlight-color:transparent]"
            >
                <span className="relative flex h-[66px] w-[66px] items-center justify-center rounded-full border-[1.5px] border-dashed border-[var(--app-hint)]/60">
                    <svg viewBox="0 0 24 24" className="h-7 w-7 text-[var(--app-hint)]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                </span>
                <span className="w-full truncate text-center text-[11px] text-[var(--app-hint)]">
                    {t('mobile.stories.new')}
                </span>
            </button>

            {stories.map((session) => {
                const isPending = session.pendingRequestsCount > 0
                const isLive = session.thinking
                const ringClass = isPending
                    ? 'story-ring-alert'
                    : isLive
                        ? 'story-ring story-ring-live'
                        : 'story-ring-idle'
                const title = getSessionTitle(session)
                return (
                    <button
                        key={session.id}
                        type="button"
                        onClick={() => props.onSelect(session.id)}
                        className="flex w-[66px] shrink-0 flex-col items-center gap-1 [-webkit-tap-highlight-color:transparent]"
                        title={title}
                    >
                        <span className="relative flex h-[66px] w-[66px] items-center justify-center">
                            <span className={cn('absolute inset-0 rounded-full', ringClass)} aria-hidden="true" />
                            <span className="relative rounded-full bg-[var(--app-bg)] p-[2.5px]">
                                <SessionAvatar session={session} size={56} shape="circle" showAgentBadge={false} />
                            </span>
                            {isPending || isLive ? (
                                <span
                                    className={cn(
                                        'absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-[5px] px-1.5 py-[1px] text-[9px] font-bold uppercase leading-[13px] tracking-wide text-white ring-2 ring-[var(--app-bg)]',
                                        isPending ? 'bg-[#ff9500]' : 'story-live-badge'
                                    )}
                                >
                                    {isPending ? t('mobile.stories.pending') : t('mobile.stories.live')}
                                </span>
                            ) : null}
                        </span>
                        <span className={cn('w-full truncate text-center text-[11px]', isPending || isLive ? 'text-[var(--app-fg)]' : 'text-[var(--app-hint)]')}>
                            {title}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
