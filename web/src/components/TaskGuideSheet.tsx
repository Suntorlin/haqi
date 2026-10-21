import { useEffect, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { CriterionSource, TaskView } from '@/types/api'
import { useTaskActions } from '@/hooks/queries/useTasks'
import { useTranslation } from '@/lib/use-translation'
import { confirmInputFrom, freshDraftEdits, type DraftEdits } from '@/lib/tasks'
import { cn } from '@/lib/utils'
import { BottomSheet, SheetNote, SheetSection } from '@/components/mobile/BottomSheet'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckRow } from '@/components/ui/CheckRow'
import { ChoiceChips } from '@/components/ui/FormControls'
import { TextField } from '@/components/ui/TextField'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'

const SOURCE_KEY: Record<CriterionSource, string> = {
    principle: 'taskGuide.source.principle',
    repo: 'taskGuide.source.repo',
    inferred: 'taskGuide.source.inferred'
}

/**
 * The guide step of a new task: HAQI drafts the goal and the acceptance criteria from the user's memory and the
 * repository conventions; the user unticks, edits and picks, then confirms. A phone sheet; the right panel on desktop.
 */
export function TaskGuideSheet(props: {
    task: TaskView | null
    open: boolean
    onOpenChange: (open: boolean) => void
    api: ApiClient | null
}) {
    const { t } = useTranslation()
    const { confirmTask, reviseDraft, retryGuide, updateTask } = useTaskActions(props.api)
    const task = props.task
    const draft = task?.status === 'guiding' ? task.draft : null
    const [edits, setEdits] = useState<DraftEdits | null>(draft ? freshDraftEdits(draft) : null)
    const [editing, setEditing] = useState<string | null>(null)
    const [revising, setRevising] = useState(false)
    const [feedback, setFeedback] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // A new draft version starts from its own defaults.
    useEffect(() => {
        if (draft && edits?.version !== draft.version) {
            setEdits(freshDraftEdits(draft))
            setEditing(null)
        }
    }, [draft, edits?.version])

    useEffect(() => {
        if (!props.open) {
            setRevising(false)
            setError(null)
        }
    }, [props.open])

    // Confirmed elsewhere (another device): nothing left to do here.
    useEffect(() => {
        if (props.open && task && task.status !== 'guiding') props.onOpenChange(false)
    }, [props, task])

    const run = async (action: () => Promise<unknown>, close = false) => {
        setPending(true)
        setError(null)
        try {
            await action()
            if (close) props.onOpenChange(false)
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
            setPending(false)
        }
    }

    const keptCount = draft && edits ? draft.criteria.filter((criterion) => edits.kept[criterion.id] !== false).length : 0
    const patch = (next: Partial<DraftEdits>) => setEdits((current) => current ? { ...current, ...next } : current)

    const confirm = () => {
        if (!task || !draft || !edits) return
        void run(() => confirmTask(task.id, confirmInputFrom(draft, edits)), true)
    }

    const sendFeedback = () => {
        const text = feedback.trim()
        if (!task || !text) return
        void run(async () => {
            await reviseDraft(task.id, text)
            setFeedback('')
            setRevising(false)
        })
    }

    const working = task?.guide.state === 'starting' || task?.guide.state === 'drafting'

    // One primary action at a time: "Create task", or "Send to HAQI" while the user writes a change request.
    const footer = task?.status === 'guiding' ? (
        <div className="shrink-0 space-y-2 border-t border-[var(--social-divider)] bg-[var(--social-surface)] px-4 pb-3 pt-3">
            {revising ? (
                <>
                    <textarea
                        autoFocus
                        rows={2}
                        value={feedback}
                        maxLength={2000}
                        placeholder={t('taskGuide.revisePlaceholder')}
                        aria-label={t('taskGuide.revisePlaceholder')}
                        onChange={(event) => setFeedback(event.target.value)}
                        className={DIALOG_INPUT_CLASS}
                    />
                    <Button className="w-full" disabled={pending || !feedback.trim()} onClick={sendFeedback}>
                        {t('taskGuide.reviseSend')}
                    </Button>
                    <Button variant="ghost" className="w-full" disabled={pending} onClick={() => setRevising(false)}>
                        {t('button.cancel')}
                    </Button>
                </>
            ) : (
                <>
                    {draft && !working ? (
                        <Button className="w-full" disabled={pending || keptCount === 0} onClick={confirm}>
                            {pending ? t('taskGuide.confirming') : t('taskGuide.confirm')}
                        </Button>
                    ) : null}
                    <div className={cn('flex gap-2', !draft || working ? 'justify-end' : '')}>
                        {draft && !working ? (
                            <Button variant="secondary" className="flex-1" disabled={pending} onClick={() => setRevising(true)}>
                                {t('taskGuide.revise')}
                            </Button>
                        ) : null}
                        <Button
                            variant="ghost"
                            className={draft && !working ? 'flex-1' : ''}
                            disabled={pending}
                            onClick={() => void run(() => updateTask(task.id, { status: 'abandoned' }), true)}
                        >
                            {t('taskGuide.abandon')}
                        </Button>
                    </div>
                </>
            )}
        </div>
    ) : null

    return (
        <BottomSheet open={props.open} onOpenChange={props.onOpenChange} noAutoFocus footer={footer} title={draft ? t('taskGuide.version', { n: draft.version }) : t('taskGuide.title')}>
            {!task ? null : (
                <div>
                    {task.guide.request ? (
                        <SheetSection title={t('taskGuide.request')}>
                            <p className="px-4 pb-2 text-body leading-snug text-[var(--social-fg)]">{task.guide.request}</p>
                        </SheetSection>
                    ) : null}

                    {working ? (
                        <div className="px-4 py-6 text-center">
                            <p className="flex items-center justify-center gap-2 text-body text-[var(--social-fg)]">
                                <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--social-fg-muted)]" aria-hidden="true" />
                                {t('taskGuide.working')}
                            </p>
                            <p className="mt-2 text-footnote text-[var(--social-fg-muted)]">{t('taskGuide.workingHint')}</p>
                        </div>
                    ) : null}

                    {task.guide.state === 'failed' ? (
                        <div className="space-y-3 px-4 py-4">
                            <SheetNote tone="error">{task.guide.error}</SheetNote>
                            <Button className="w-full" disabled={pending} onClick={() => void run(() => retryGuide(task.id))}>
                                {t('taskGuide.retry')}
                            </Button>
                        </div>
                    ) : null}

                    {draft && edits && !working ? (
                        <>
                            <SheetSection title={t('taskGuide.goal')}>
                                {editing === 'goal' ? (
                                    <div className="px-4 pb-2">
                                        <TextField
                                            autoFocus
                                            value={edits.goal ?? draft.goal}
                                            maxLength={120}
                                            aria-label={t('taskGuide.goal')}
                                            onChange={(event) => patch({ goal: event.target.value })}
                                            onBlur={() => setEditing(null)}
                                            onKeyDown={(event) => { if (event.key === 'Enter') setEditing(null) }}
                                        />
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => setEditing('goal')}
                                        title={t('taskGuide.edit')}
                                        className="mx-2 block min-h-11 w-[calc(100%-1rem)] rounded-xl px-2 py-2.5 text-left text-body font-semibold leading-snug text-[var(--social-fg)] transition-colors hover:bg-[var(--social-hover)]"
                                    >
                                        {edits.goal ?? draft.goal}
                                    </button>
                                )}
                                {draft.nonGoals.length > 0 ? (
                                    <div className="px-4 pb-2 pt-1 text-footnote text-[var(--social-fg-muted)]">
                                        <span className="text-caption uppercase tracking-wide">{t('taskGuide.nonGoals')}</span>
                                        <ul className="mt-1 space-y-0.5">
                                            {draft.nonGoals.map((line) => <li key={line}>· {line}</li>)}
                                        </ul>
                                    </div>
                                ) : null}
                            </SheetSection>

                            <SheetSection title={t('taskGuide.criteria')}>
                                <p className="px-4 pb-1 text-footnote text-[var(--social-fg-muted)]">{t('taskGuide.criteriaHint')}</p>
                                {draft.criteria.map((criterion) => {
                                    const kept = edits.kept[criterion.id] !== false
                                    const text = edits.texts[criterion.id] ?? criterion.text
                                    if (editing === criterion.id) {
                                        return (
                                            <div key={criterion.id} className="px-4 py-1.5">
                                                <textarea
                                                    autoFocus
                                                    rows={2}
                                                    value={text}
                                                    maxLength={300}
                                                    aria-label={t('taskGuide.edit')}
                                                    onChange={(event) => patch({ texts: { ...edits.texts, [criterion.id]: event.target.value } })}
                                                    onBlur={() => setEditing(null)}
                                                    className={DIALOG_INPUT_CLASS}
                                                />
                                            </div>
                                        )
                                    }
                                    const changed = text !== criterion.text
                                    return (
                                        <CheckRow
                                            key={criterion.id}
                                            className="px-2"
                                            checked={kept}
                                            onCheckedChange={(checked) => patch({ kept: { ...edits.kept, [criterion.id]: checked } })}
                                            label={text}
                                            title={text}
                                            subtitle={t('taskGuide.verify', { how: criterion.verify })}
                                            onEdit={() => setEditing(criterion.id)}
                                            editLabel={t('taskGuide.edit')}
                                            trailing={(
                                                <Badge variant={changed || criterion.source === 'inferred' ? 'warning' : 'default'}>
                                                    {t(changed ? SOURCE_KEY.inferred : SOURCE_KEY[criterion.source])}
                                                </Badge>
                                            )}
                                        />
                                    )
                                })}
                                {keptCount === 0 ? <SheetNote tone="error">{t('taskGuide.keepOne')}</SheetNote> : null}
                            </SheetSection>

                            {draft.questions.length > 0 ? (
                                <SheetSection title={t('taskGuide.questions')}>
                                    {draft.questions.map((question) => (
                                        <div key={question.id} className="space-y-2 px-4 pb-3">
                                            <p className="text-body leading-snug text-[var(--social-fg)]">{question.text}</p>
                                            <ChoiceChips
                                                label={question.text}
                                                value={edits.answers[question.id] ?? question.default}
                                                options={question.options.map((option) => ({ value: option.id, label: option.label }))}
                                                onChange={(value) => patch({ answers: { ...edits.answers, [question.id]: value } })}
                                            />
                                            {question.precedentRef && (edits.answers[question.id] ?? question.default) === question.default ? (
                                                <p className="text-caption text-[var(--social-fg-muted)]">{t('taskGuide.precedent')}</p>
                                            ) : null}
                                        </div>
                                    ))}
                                </SheetSection>
                            ) : null}
                        </>
                    ) : null}

                    {error ? <SheetNote tone="error">{error}</SheetNote> : null}
                </div>
            )}
        </BottomSheet>
    )
}
