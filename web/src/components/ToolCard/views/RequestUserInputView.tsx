import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import {
    parseRequestUserInputInput,
    parseRequestUserInputAnswers
} from '@/components/ToolCard/requestUserInput'
import { maskSecretValue } from '@/components/ToolCard/questionTools'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function getSelectionMark(isSelected: boolean): string {
    return isSelected ? '●' : '○'
}

function parseResultAsAnswers(result: unknown): unknown {
    // tool.result from history may be a JSON string
    if (typeof result === 'string') {
        try {
            return JSON.parse(result)
        } catch {
            return undefined
        }
    }
    return result
}

export function RequestUserInputView(props: ToolViewProps) {
    const { t } = useTranslation()
    const parsed = parseRequestUserInputInput(props.block.tool.input)
    const questions = parsed.questions
    // Try permission.answers first (live), fall back to tool.result (history)
    const rawAnswers = props.block.tool.permission?.answers ?? parseResultAsAnswers(props.block.tool.result) ?? undefined
    const parsedAnswers = rawAnswers ? parseRequestUserInputAnswers(rawAnswers) : null
    const hasAnswers = parsedAnswers && Object.keys(parsedAnswers).length > 0

    if (questions.length === 0) {
        return null
    }

    return (
        <div className="flex flex-col gap-3">
            {questions.map((q) => {
                const answer = parsedAnswers?.[q.id]
                const isPureTextQuestion = q.options.length === 0

                return (
                    <div key={q.id} className="rounded-2xl border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
                        {q.header ? (
                            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                {q.header}
                            </div>
                        ) : null}

                        {q.question ? (
                            <div className="text-[13px] text-[var(--app-fg)] break-words">
                                {q.question}
                            </div>
                        ) : null}

                        {answer?.isSkipped ? (
                            <div className="mt-3 rounded-xl border border-[var(--app-border)] px-2 py-2 text-[13px] text-[var(--app-hint)]">
                                {t('tool.questionOverlay.skippedValue')}
                            </div>
                        ) : isPureTextQuestion ? (
                            // Pure text question - show the answer directly
                            hasAnswers && (answer?.otherAnswer || answer?.userNote) ? (
                                <div className="mt-3">
                                    <div className="rounded-xl border border-[var(--app-badge-success-border)] bg-[var(--app-badge-success-bg)] px-2 py-2">
                                        <div className="flex items-start gap-2">
                                            <span className="shrink-0 text-[13px] text-[var(--app-badge-success-text)]">●</span>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-[13px] text-[var(--app-badge-success-text)] font-semibold break-words">
                                                    {q.isSecret
                                                        ? maskSecretValue(answer.otherAnswer ?? answer.userNote ?? '')
                                                        : (answer.otherAnswer ?? answer.userNote)}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : null
                        ) : (
                            // Question with options
                            <div className="mt-3 flex flex-col gap-1">
                                {q.options.map((opt, optIdx) => {
                                    const isSelected = answer?.selected === opt.label

                                    return (
                                        <div
                                            key={optIdx}
                                            className={cn(
                                                "rounded-xl border px-2 py-2",
                                                isSelected
                                                    ? "border-[var(--app-badge-success-border)] bg-[var(--app-badge-success-bg)]"
                                                    : "border-[var(--app-border)]"
                                            )}
                                        >
                                            <div className="flex items-start gap-2">
                                                {hasAnswers && (
                                                    <span className={cn(
                                                        "shrink-0 text-[13px]",
                                                        isSelected
                                                            ? "text-[var(--app-badge-success-text)]"
                                                            : "text-[var(--app-hint)]"
                                                    )}>
                                                        {getSelectionMark(isSelected)}
                                                    </span>
                                                )}
                                                <div className="min-w-0 flex-1">
                                                    <div className={cn(
                                                        "text-[13px] break-words",
                                                        isSelected
                                                            ? "text-[var(--app-badge-success-text)] font-semibold"
                                                            : "text-[var(--app-fg)]"
                                                    )}>
                                                        {opt.label}
                                                    </div>
                                                    {opt.description ? (
                                                        <div className="mt-0.5 text-xs text-[var(--app-hint)] break-words">
                                                            {opt.description}
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}

                                {/* Show user note if present */}
                                {hasAnswers && answer?.userNote ? (
                                    <div className="mt-2 rounded-xl border border-[var(--app-badge-info-border)] bg-[var(--app-badge-info-bg)] px-2 py-2">
                                        <div className="flex items-start gap-2">
                                            <span className="shrink-0 text-xs text-[var(--app-badge-info-text)]">📝</span>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs text-[var(--app-hint)]">{t('tool.questionOverlay.noteValueLabel')}</div>
                                                <div className="text-[13px] text-[var(--app-badge-info-text)] break-words">
                                                    {answer.userNote}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}

                                {hasAnswers && answer?.otherAnswer ? (
                                    <div className="mt-2 rounded-xl border border-[var(--app-badge-success-border)] bg-[var(--app-badge-success-bg)] px-2 py-2">
                                        <div className="flex items-start gap-2">
                                            <span className="shrink-0 text-[13px] text-[var(--app-badge-success-text)]">●</span>
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs text-[var(--app-hint)]">{t('tool.questionOverlay.otherValueLabel')}</div>
                                                <div className="text-[13px] text-[var(--app-badge-success-text)] font-semibold break-words">
                                                    {q.isSecret ? maskSecretValue(answer.otherAnswer) : answer.otherAnswer}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
