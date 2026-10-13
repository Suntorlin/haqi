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
        <div className="social-scroll-x flex gap-4 overflow-x-auto px-5 pb-3 pt-1">
            <button
                type="button"
                onClick={props.onNewSession}
                className="flex w-16 shrink-0 flex-col items-center gap-1.5 [-webkit-tap-highlight-color:transparent]"
            >
                <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--social-muted)] text-[var(--social-fg-muted)]">
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                </span>
                <span className="w-full truncate text-center text-[11.5px] text-[var(--social-fg-muted)]">
                    {t('mobile.stories.new')}
                </span>
            </button>

            {stories.map((session) => {
                const isPending = session.pendingRequestsCount > 0
                const isLive = session.thinking
                const title = getSessionTitle(session)
                return (
                    <button
                        key={session.id}
                        type="button"
                        onClick={() => props.onSelect(session.id)}
                        className="flex w-16 shrink-0 flex-col items-center gap-1.5 [-webkit-tap-highlight-color:transparent]"
                        title={title}
                    >
                        <span className="relative flex h-16 w-16 items-center justify-center">
                            {isPending ? (
                                <span className="story-ring-alert absolute inset-0 rounded-full" aria-hidden="true" />
                            ) : isLive ? (
                                <span className="story-ring story-ring-live absolute inset-0 rounded-full" aria-hidden="true" />
                            ) : (
                                <span className="absolute inset-0 rounded-full border border-[var(--social-border)]" aria-hidden="true" />
                            )}
                            <span className="relative rounded-full bg-[var(--app-bg)] p-[3px]">
                                <SessionAvatar session={session} size={54} showAgentBadge={false} />
                            </span>
                            {isPending || isLive ? (
                                <span
                                    className={cn(
                                        'absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 text-[9.5px] font-semibold leading-[15px] ring-2 ring-[var(--app-bg)]',
                                        isPending
                                            ? 'bg-[var(--social-warning)] text-white'
                                            : 'bg-[var(--social-fg)] text-[var(--app-bg)]'
                                    )}
                                >
                                    {isPending ? t('mobile.stories.pending') : t('mobile.stories.live')}
                                </span>
                            ) : null}
                        </span>
                        <span className={cn('w-full truncate text-center text-[11.5px]', isPending || isLive ? 'font-medium text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)]')}>
                            {title}
                        </span>
                    </button>
                )
            })}
        </div>
    )
}
