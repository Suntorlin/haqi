import { useCallback, type ReactNode } from 'react'
import { useParams } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useReviewLoop } from '@/hooks/queries/useReviewLoop'
import { useReviewLoopActions } from '@/hooks/mutations/useReviewLoopActions'
import { LoadingState } from '@/components/LoadingState'
import { Badge } from '@/components/ui/badge'
import {
    ReviewLoopStatusBadge,
    ProgressBar,
    CriteriaChecklist,
    LoopControls,
    LoopSettingsPanel,
    RoundTimeline,
} from '@/components/ReviewLoop'
import type { ReviewLoopUserPreference } from '@/types/api'

// ─── Layout helpers ──────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="flex min-w-0 flex-col gap-1.5">
            <h2 className="px-1 text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{title}</h2>
            {children}
        </section>
    )
}

function Card({ children }: { children: ReactNode }) {
    return <div className="min-w-0 rounded-2xl border border-[var(--social-border)] p-4">{children}</div>
}

// ─── Main Detail Page ────────────────────────────────────────────────────────────

export default function ReviewLoopDetailPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { loopId } = useParams({ from: '/review-loops/$loopId' })
    const { loop, rounds, isLoading, error } = useReviewLoop(api, loopId)
    const { continueLoop, cancelLoop, pauseLoop, updateLoop, isPending } = useReviewLoopActions(api, loopId)

    const handleContinue = useCallback((instruction?: string) => {
        void continueLoop(instruction ? { additionalInstruction: instruction } : undefined)
    }, [continueLoop])

    const handlePause = useCallback(() => {
        void pauseLoop()
    }, [pauseLoop])

    const handleCancel = useCallback(() => {
        void cancelLoop()
    }, [cancelLoop])

    const handleUpdatePreference = useCallback((pref: ReviewLoopUserPreference) => {
        void updateLoop({ userPreference: pref })
    }, [updateLoop])

    const handleUpdateMaxRounds = useCallback((n: number) => {
        void updateLoop({ maxRounds: n })
    }, [updateLoop])

    if (isLoading || !loop) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <LoadingState label={t('loading')} className="text-body" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <div className="text-body text-[var(--social-danger)]">{error}</div>
            </div>
        )
    }

    // Compute latest progress from the most recent verdict
    const latestVerdict = rounds
        .filter((r) => r.verdict)
        .sort((a, b) => b.round - a.round)[0]?.verdict
    const latestProgress = latestVerdict?.progress ?? 0

    const isTerminal = loop.status === 'accepted' || loop.status === 'aborted' || loop.status === 'canceled'

    return (
        <div className="flex h-full min-w-0 flex-col overflow-y-auto">
            <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <Card>
                    <div className="whitespace-pre-wrap text-body leading-relaxed text-[var(--social-fg)]">
                        {loop.requirement.length > 300
                            ? loop.requirement.slice(0, 300) + '...'
                            : loop.requirement}
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                        <ReviewLoopStatusBadge status={loop.status} />
                        <Badge>{t('mobile.loops.round', { n: loop.currentRound, max: loop.maxRounds })}</Badge>
                    </div>
                    <div className="mt-3">
                        <ProgressBar progress={latestProgress} />
                    </div>
                </Card>

                {loop.acceptanceCriteria && latestVerdict?.criteriaStatus && latestVerdict.criteriaStatus.length > 0 ? (
                    <Section title={t('loops.create.criteria')}>
                        <Card>
                            <CriteriaChecklist criteria={latestVerdict.criteriaStatus} />
                        </Card>
                    </Section>
                ) : loop.acceptanceCriteria ? (
                    <Section title={t('loops.create.criteria')}>
                        <Card>
                            <div className="whitespace-pre-wrap text-body text-[var(--social-fg)]">{loop.acceptanceCriteria}</div>
                        </Card>
                    </Section>
                ) : null}

                <Section title={t('settings.title')}>
                    <Card>
                        <LoopSettingsPanel
                            userPreference={loop.userPreference}
                            maxRounds={loop.maxRounds}
                            currentRound={loop.currentRound}
                            onUpdatePreference={handleUpdatePreference}
                            onUpdateMaxRounds={handleUpdateMaxRounds}
                            disabled={isPending || isTerminal}
                        />
                    </Card>
                </Section>

                {isTerminal ? null : (
                    <Section title={t('loops.detail.controls')}>
                        <Card>
                            <LoopControls
                                status={loop.status}
                                onContinue={handleContinue}
                                onPause={handlePause}
                                onCancel={handleCancel}
                                isPending={isPending}
                            />
                        </Card>
                    </Section>
                )}

                <Section title={t('loops.detail.timeline', { n: rounds.length })}>
                    {rounds.length === 0 ? (
                        <div className="px-1 py-2 text-body text-[var(--social-fg-muted)]">{t('loops.detail.noRounds')}</div>
                    ) : (
                        <RoundTimeline rounds={rounds} />
                    )}
                </Section>
            </div>
        </div>
    )
}
