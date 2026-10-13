import { useEffect, useMemo, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { ChatToolCall } from '@/chat/types'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'
import { ChevronDownIcon, CloseIcon } from '@/components/mobile/icons'
import { Spinner } from '@/components/Spinner'
import { usePlatform } from '@/hooks/usePlatform'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import {
    buildInitialQuestionOverlayState,
    buildQuestionToolAnswerPayload,
    buildQuestionToolModel,
    getQuestionOptionLabel,
    isOtherOptionSelected,
    isQuestionAnswered,
    type QuestionToolModel,
    type QuestionOverlayState,
    type QuestionToolOption,
    type QuestionToolQuestion
} from '@/components/ToolCard/questionTools'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'

type QuestionToolDraft = {
    isMinimized?: boolean
    step: number
    stateByQuestion: Record<string, QuestionOverlayState>
}

const questionToolDraftByKey = new Map<string, QuestionToolDraft>()

function buildInitialOverlayStateByQuestion(model: QuestionToolModel): Record<string, QuestionOverlayState> {
    const nextState: Record<string, QuestionOverlayState> = {}
    for (const question of model.questions) {
        nextState[question.id] = buildInitialQuestionOverlayState(question)
    }
    return nextState
}

function mergeDraftStateByQuestion(
    model: QuestionToolModel,
    draft: QuestionToolDraft | undefined
): Record<string, QuestionOverlayState> {
    const nextState = buildInitialOverlayStateByQuestion(model)
    if (!draft) {
        return nextState
    }

    for (const question of model.questions) {
        const saved = draft.stateByQuestion[question.id]
        if (!saved) {
            continue
        }

        const validOptionIds = new Set(question.options.map((option) => option.id))
        nextState[question.id] = {
            selectedOptionIds: saved.selectedOptionIds.filter((optionId) => validOptionIds.has(optionId)),
            note: typeof saved.note === 'string' ? saved.note : ''
        }
    }

    return nextState
}

export function resetQuestionToolOverlayDraftsForTest(): void {
    questionToolDraftByKey.clear()
}

function SelectionMark(props: { checked: boolean; mode: 'single' | 'multi' }) {
    const mark = props.mode === 'multi'
        ? (props.checked ? '☑' : '☐')
        : (props.checked ? '●' : '○')
    return (
        <span className="mt-0.5 w-4 shrink-0 text-center text-[var(--app-hint)]">
            {mark}
        </span>
    )
}

function OptionRow(props: {
    checked: boolean
    mode: 'single' | 'multi'
    disabled: boolean
    title: string
    description?: string | null
    onClick: () => void
}) {
    return (
        <button
            type="button"
            className={cn(
                'flex min-h-11 w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-[15px] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:pointer-events-none disabled:opacity-50',
                props.checked ? 'bg-[var(--app-subtle-bg)]' : null
            )}
            disabled={props.disabled}
            onClick={props.onClick}
        >
            <SelectionMark checked={props.checked} mode={props.mode} />
            <span className="min-w-0 flex-1">
                <div className="font-semibold text-[var(--app-fg)] break-words">{props.title}</div>
                {props.description ? (
                    <div className="mt-0.5 text-[13px] text-[var(--app-hint)] break-words">
                        {props.description}
                    </div>
                ) : null}
            </span>
        </button>
    )
}

function supportsMultilineInput(question: QuestionToolQuestion): boolean {
    return !question.isSecret
}

export function QuestionToolOverlay(props: {
    api: ApiClient
    sessionId: string
    tool: ChatToolCall | null
    disabled: boolean
    onDone: () => void
}) {
    const { t } = useTranslation()
    const { haptic } = usePlatform()
    const permission = props.tool?.permission
    const model = useMemo(
        () => (props.tool ? buildQuestionToolModel(props.tool) : null),
        [props.tool]
    )
    const draftKey = useMemo(() => {
        if (!permission?.id || !model) {
            return null
        }
        return `${props.sessionId}:${permission.id}:${model.toolId}`
    }, [model, permission?.id, props.sessionId])
    const skipNextDraftPersistRef = useRef<string | null>(null)

    const [step, setStep] = useState(0)
    const [stateByQuestion, setStateByQuestion] = useState<Record<string, QuestionOverlayState>>({})
    const [isMinimized, setIsMinimized] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (!model || !permission || permission.status !== 'pending' || !draftKey) {
            setStep(0)
            setStateByQuestion({})
            setIsMinimized(false)
            setLoading(false)
            setError(null)
            skipNextDraftPersistRef.current = null
            return
        }

        const draft = questionToolDraftByKey.get(draftKey)
        const nextState = mergeDraftStateByQuestion(model, draft)

        skipNextDraftPersistRef.current = draftKey
        setStep(Math.min(Math.max(draft?.step ?? 0, 0), Math.max(model.questions.length - 1, 0)))
        setStateByQuestion(nextState)
        setIsMinimized(Boolean(draft?.isMinimized))
        setLoading(false)
        setError(null)
    }, [draftKey])

    useEffect(() => {
        if (!model || !permission || permission.status !== 'pending' || !draftKey) {
            return
        }

        if (skipNextDraftPersistRef.current === draftKey) {
            skipNextDraftPersistRef.current = null
            return
        }

        questionToolDraftByKey.set(draftKey, {
            isMinimized,
            step: Math.min(Math.max(step, 0), Math.max(model.questions.length - 1, 0)),
            stateByQuestion
        })
    }, [draftKey, isMinimized, model?.toolId, model?.questions.length, permission?.status, stateByQuestion, step])

    useEffect(() => {
        if (!draftKey || permission?.status === 'pending') {
            return
        }
        questionToolDraftByKey.delete(draftKey)
    }, [draftKey, permission?.status])

    const run = async (action: () => Promise<void>, hapticType: 'success' | 'error') => {
        if (props.disabled) return
        setError(null)
        try {
            await action()
            if (draftKey) {
                questionToolDraftByKey.delete(draftKey)
            }
            haptic.notification(hapticType)
            props.onDone()
        } catch (cause) {
            haptic.notification('error')
            setError(cause instanceof Error ? cause.message : t('dialog.error.default'))
        }
    }

    const cancel = async () => {
        if (!permission) return
        setLoading(true)
        await run(() => props.api.denyPermission(props.sessionId, permission.id, { decision: 'abort' }), 'success')
        setLoading(false)
    }

    const total = model?.questions.length ?? 0
    const clampedStep = Math.min(Math.max(step, 0), Math.max(total - 1, 0))
    const currentQuestion = model?.questions[clampedStep] ?? null
    const currentState = currentQuestion ? stateByQuestion[currentQuestion.id] : null
    const mode = currentQuestion?.multiSelect ? 'multi' : 'single'

    const selectOption = (question: QuestionToolQuestion, option: QuestionToolOption) => {
        haptic.selection()
        setStateByQuestion((previous) => {
            const current = previous[question.id] ?? buildInitialQuestionOverlayState(question)
            const selected = new Set(current.selectedOptionIds)
            const alreadySelected = selected.has(option.id)

            if (question.multiSelect) {
                if (alreadySelected) {
                    selected.delete(option.id)
                } else {
                    selected.add(option.id)
                }
            } else if (alreadySelected) {
                selected.clear()
            } else {
                selected.clear()
                selected.add(option.id)
            }

            if (option.kind === 'choice' && !question.multiSelect) {
                selected.delete('__other__')
            }

            return {
                ...previous,
                [question.id]: {
                    ...current,
                    selectedOptionIds: Array.from(selected)
                }
            }
        })
    }

    const updateNote = (questionId: string, value: string) => {
        setStateByQuestion((previous) => ({
            ...previous,
            [questionId]: {
                ...(previous[questionId] ?? { selectedOptionIds: [], note: '' }),
                note: value
            }
        }))
    }

    const next = () => {
        if (total <= 1) return
        setError(null)
        setStep((current) => Math.min(current + 1, total - 1))
    }

    const prev = () => {
        setError(null)
        setStep((current) => Math.max(current - 1, 0))
    }

    const submit = async () => {
        if (!model || !permission || loading) return
        setLoading(true)
        const payload = buildQuestionToolAnswerPayload(model, stateByQuestion)
        await run(() => props.api.approvePermission(props.sessionId, permission.id, payload), 'success')
        setLoading(false)
    }

    useEffect(() => {
        if (!model || !permission || permission.status !== 'pending' || isMinimized) {
            return
        }

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || loading) {
                return
            }

            const target = event.target
            const editingText = target instanceof HTMLTextAreaElement
                || (target instanceof HTMLInputElement && target.type !== 'checkbox' && target.type !== 'radio')

            if (event.key === 'Escape') {
                event.preventDefault()
                void cancel()
                return
            }

            if (editingText) {
                return
            }

            if (event.key === 'PageDown') {
                event.preventDefault()
                next()
                return
            }

            if (event.key === 'PageUp') {
                event.preventDefault()
                prev()
                return
            }

            if (event.key === 'Enter') {
                event.preventDefault()
                if (clampedStep < total - 1) {
                    next()
                } else {
                    void submit()
                }
            }
        }

        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [cancel, clampedStep, isMinimized, loading, model, next, permission, prev, submit, total])

    if (!model || !permission || permission.status !== 'pending' || !currentQuestion) {
        return null
    }

    const noteVisible = currentQuestion.supportsNotes
        || currentQuestion.options.every((option) => option.kind !== 'choice')
        || isOtherOptionSelected(currentQuestion, currentState ?? undefined)

    const questionAnswered = isQuestionAnswered(currentQuestion, currentState ?? undefined)
    const answeredCount = model.questions.reduce((count, question) => (
        isQuestionAnswered(question, stateByQuestion[question.id]) ? count + 1 : count
    ), 0)

    if (isMinimized) {
        return (
            <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-end p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:p-4">
                <div className="pointer-events-auto flex w-full max-w-sm flex-col gap-2 rounded-2xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 shadow-2xl">
                    <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[15px] font-semibold text-[var(--app-fg)]">
                                {currentQuestion.header || t('tool.questionOverlay.title')}
                            </div>
                            <div className="text-[13px] text-[var(--app-hint)]">
                                {t('tool.questionOverlay.minimizedDescription', { answeredCount, total })}
                            </div>
                        </div>
                        <Button type="button" disabled={loading} onClick={() => setIsMinimized(false)}>
                            {t('tool.questionOverlay.resume')}
                        </Button>
                        <IconButton label={t('tool.questionOverlay.close')} disabled={props.disabled || loading} onClick={() => void cancel()}>
                            <CloseIcon className="h-4 w-4" />
                        </IconButton>
                    </div>
                    {error ? (
                        <div className="rounded-xl bg-[var(--app-badge-error-bg)] px-3 py-2 text-[13px] text-[var(--social-danger)]">{error}</div>
                    ) : null}
                </div>
            </div>
        )
    }

    return (
        <div className="fixed inset-0 z-[70]">
            <div className="absolute inset-0 bg-black/45" aria-hidden="true" />
            <div className="absolute inset-0 overflow-y-auto px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[calc(env(safe-area-inset-top)+0.75rem)] sm:flex sm:items-center sm:justify-center sm:p-6">
                <div className="mx-auto flex max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1.5rem)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--app-border)] bg-[var(--app-secondary-bg)] shadow-2xl sm:max-h-[min(88vh,860px)]">
                    <div className="flex shrink-0 items-center justify-between gap-2 py-1 pl-4 pr-2">
                        <span className="min-w-0 truncate text-[13px] text-[var(--social-fg-muted)]">
                            {[currentQuestion.header, total > 1 ? `${clampedStep + 1}/${total}` : null].filter(Boolean).join(' · ')}
                        </span>
                        <div className="flex shrink-0 items-center">
                            <IconButton label={t('tool.questionOverlay.minimize')} disabled={loading} onClick={() => setIsMinimized(true)}>
                                <ChevronDownIcon className="h-4 w-4" />
                            </IconButton>
                            <IconButton label={t('tool.questionOverlay.close')} disabled={props.disabled || loading} onClick={() => void cancel()}>
                                <CloseIcon className="h-4 w-4" />
                            </IconButton>
                        </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2 pt-1">
                        {error ? (
                            <div className="mb-3 rounded-xl border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] px-3 py-2 text-xs text-[var(--social-danger)]">
                                {error}
                            </div>
                        ) : null}

                        {currentQuestion.question ? (
                            <div className="text-[16px] font-semibold leading-snug text-[var(--app-fg)] break-words">
                                {currentQuestion.question}
                            </div>
                        ) : null}

                        {currentQuestion.options.length > 0 ? (
                            <div className="mt-4 flex flex-col gap-1">
                                {currentQuestion.options.map((option) => {
                                    const checked = (currentState?.selectedOptionIds ?? []).includes(option.id)
                                    return (
                                        <OptionRow
                                            key={option.id}
                                            checked={checked}
                                            mode={mode}
                                            disabled={props.disabled || loading}
                                            title={getQuestionOptionLabel(option, t('tool.questionOverlay.otherOption'))}
                                            description={option.description}
                                            onClick={() => selectOption(currentQuestion, option)}
                                        />
                                    )
                                })}
                            </div>
                        ) : null}

                        {noteVisible ? (
                            <div className="mt-4">
                                <div className="mb-1 text-xs text-[var(--app-hint)]">
                                    {currentQuestion.supportsNotes
                                        ? t('tool.questionOverlay.noteLabel')
                                        : t('tool.questionOverlay.answerLabel')}
                                </div>
                                {supportsMultilineInput(currentQuestion) ? (
                                    <textarea
                                        value={currentState?.note ?? ''}
                                        onChange={(event) => updateNote(currentQuestion.id, event.target.value)}
                                        disabled={props.disabled || loading}
                                        placeholder={currentQuestion.supportsNotes
                                            ? t('tool.questionOverlay.notePlaceholder')
                                            : t('tool.questionOverlay.answerPlaceholder')}
                                        className={cn(DIALOG_INPUT_CLASS, 'min-h-[88px] resize-y disabled:opacity-50')}
                                    />
                                ) : (
                                    <TextField
                                        type="password"
                                        value={currentState?.note ?? ''}
                                        onChange={(event) => updateNote(currentQuestion.id, event.target.value)}
                                        disabled={props.disabled || loading}
                                        placeholder={t('tool.questionOverlay.secretPlaceholder')}
                                    />
                                )}
                            </div>
                        ) : null}

                        {questionAnswered ? null : (
                            <div className="mt-3 text-[13px] text-[var(--app-hint)]">{t('tool.questionOverlay.skippedHint')}</div>
                        )}
                    </div>

                    <div className="shrink-0 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-3">
                        <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                                {total > 1 ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={props.disabled || loading || clampedStep === 0}
                                        onClick={prev}
                                    >
                                        {t('tool.prev')}
                                    </Button>
                                ) : null}
                            </div>

                            <div className="flex items-center gap-2">
                                {total > 1 && clampedStep < total - 1 ? (
                                    <Button
                                        type="button"
                                        variant="default"
                                        disabled={props.disabled || loading}
                                        onClick={next}
                                    >
                                        {t('tool.next')}
                                    </Button>
                                ) : (
                                    <Button
                                        type="button"
                                        variant="default"
                                        disabled={props.disabled || loading}
                                        onClick={() => void submit()}
                                        aria-busy={loading}
                                        className="gap-2"
                                    >
                                        {loading ? (
                                            <>
                                                <Spinner size="sm" label={null} className="text-[var(--app-button-text)]" />
                                                {t('tool.submitting')}
                                            </>
                                        ) : (
                                            t('tool.submit')
                                        )}
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
