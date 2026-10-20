import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ReviewRound } from '@/types/api'
import { WorkerOutputPanel } from './WorkerOutputPanel'
import { ProgressBar } from './ProgressBar'
import { CriteriaChecklist } from './CriteriaChecklist'
import { roundStatusLabel, roundStatusVariant } from './roundStatus'

const verdictActionConfig: Record<string, {
    label: string
    variant: 'info' | 'warning' | 'success' | 'destructive'
}> = {
    continue: { label: 'Continue', variant: 'warning' },
    pass: { label: 'Pass', variant: 'success' },
    abort: { label: 'Abort', variant: 'destructive' },
    notify_user: { label: 'Notify', variant: 'info' },
}

function formatTime(ts: number): string {
    return new Date(ts).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })
}

const CAPTION_CLASS = 'text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]'

export function RoundCard({ round, isLatest }: { round: ReviewRound; isLatest: boolean }) {
    const actionCfg = round.verdict ? verdictActionConfig[round.verdict.action] : null

    return (
        <div
            className={cn(
                'min-w-0 overflow-hidden rounded-2xl border',
                isLatest ? 'border-[var(--social-fg-subtle)]' : 'border-[var(--social-border)]'
            )}
        >
            {/* Header */}
            <div className="flex min-w-0 flex-wrap items-center gap-2 border-b border-[var(--social-divider)] bg-[var(--social-muted)] px-4 py-2.5">
                <span className="shrink-0 text-body font-semibold text-[var(--social-fg)]">Round {round.round}</span>
                <Badge variant={roundStatusVariant[round.status] ?? 'default'}>{roundStatusLabel(round.status)}</Badge>
                <span className="shrink-0 text-footnote tabular-nums text-[var(--social-fg-muted)]">{formatTime(round.startedAt)}</span>
            </div>

            {/* Body */}
            <div className="flex min-w-0 flex-col gap-4 overflow-hidden p-4">
                {round.instruction && (
                    <div className="min-w-0">
                        <div className={cn(CAPTION_CLASS, 'mb-1')}>Instruction</div>
                        <div className="whitespace-pre-wrap break-words text-body text-[var(--social-fg)]">
                            {round.instruction}
                        </div>
                    </div>
                )}

                {round.workerOutput && (
                    <WorkerOutputPanel output={round.workerOutput} />
                )}

                {round.verdict && (
                    <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--social-divider)] pt-4">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="text-body font-semibold text-[var(--social-fg)]">Verdict</span>
                            {actionCfg && <Badge variant={actionCfg.variant}>{actionCfg.label}</Badge>}
                        </div>

                        {round.verdict.feedback && (
                            <p className="whitespace-pre-wrap break-words text-body text-[var(--social-fg)]">
                                {round.verdict.feedback}
                            </p>
                        )}

                        <ProgressBar progress={round.verdict.progress} />

                        {round.verdict.criteriaStatus.length > 0 && (
                            <CriteriaChecklist criteria={round.verdict.criteriaStatus} />
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
