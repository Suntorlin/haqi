import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ChevronRightIcon } from '@/components/mobile/icons'
import { cn } from '@/lib/utils'
import type { ReviewRound } from '@/types/api'
import { RoundCard } from './RoundCard'
import { roundStatusLabel, roundStatusVariant } from './roundStatus'

export function RoundTimeline({ rounds }: { rounds: ReviewRound[] }) {
    const sorted = [...rounds].sort((a, b) => a.round - b.round)
    const [expandedId, setExpandedId] = useState<string | null>(
        sorted.length > 0 ? sorted[sorted.length - 1].id : null
    )

    return (
        <div className="flex min-w-0 flex-col gap-2">
            {sorted.map((round, i) => {
                const isLatest = i === sorted.length - 1
                const isExpanded = expandedId === round.id

                return (
                    <div key={round.id} className="min-w-0">
                        <button
                            type="button"
                            aria-expanded={isExpanded}
                            className="flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-xl px-3 text-left transition-colors hover:bg-[var(--social-hover)] [-webkit-tap-highlight-color:transparent]"
                            onClick={() => setExpandedId(isExpanded ? null : round.id)}
                        >
                            <ChevronRightIcon className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', isExpanded && 'rotate-90')} />
                            <span className="shrink-0 text-body font-semibold text-[var(--social-fg)]">Round {round.round}</span>
                            <Badge variant={roundStatusVariant[round.status] ?? 'default'}>{roundStatusLabel(round.status)}</Badge>
                            {isLatest ? (
                                <span className="shrink-0 text-footnote text-[var(--social-fg-muted)]">current</span>
                            ) : null}
                        </button>

                        {isExpanded && (
                            <div className="mt-1 min-w-0">
                                <RoundCard round={round} isLatest={isLatest} />
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
