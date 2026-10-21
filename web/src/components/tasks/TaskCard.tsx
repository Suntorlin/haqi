import { useEffect, useState, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { AcceptanceCriterion, CriterionSource, TaskDraft, TaskView } from '@/types/api'
import { useTask, useTaskActions } from '@/hooks/queries/useTasks'
import { useTranslation } from '@/lib/use-translation'
import { carryOver, confirmInputFrom, keptCount, type DraftEdits } from '@/lib/tasks'
import { cn } from '@/lib/utils'
import { AutoTextarea } from '@/components/ui/AutoTextarea'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckRow } from '@/components/ui/CheckRow'
import { ChoiceChips } from '@/components/ui/FormControls'
import { IconButton } from '@/components/ui/IconButton'
import { ChevronDownIcon, CloseIcon, PencilIcon, PlusIcon } from '@/components/mobile/icons'

type Translate = ReturnType<typeof useTranslation>['t']

const SOURCE_KEY: Record<CriterionSource, string> = {
    principle: 'taskGuide.source.principle',
    repo: 'taskGuide.source.repo',
    inferred: 'taskGuide.source.inferred',
    user: 'taskGuide.source.user'
}

function SourceBadge(props: { source: CriterionSource; t: Translate }) {
    const variant = props.source === 'inferred' ? 'warning' : props.source === 'user' ? 'info' : 'default'
    return <Badge variant={variant}>{props.t(SOURCE_KEY[props.source])}</Badge>
}

function Caption(props: { children: ReactNode }) {
    return <div className="px-1 pb-1 pt-3 text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{props.children}</div>
}

/** One open editor: a growing text field with Save and Cancel. */
function InlineEditor(props: { value: string; label: string; maxLength: number; onSave: (text: string) => void; onCancel: () => void; t: Translate }) {
    const [text, setText] = useState(props.value)
    const save = () => props.onSave(text.trim())
    return (
        <div className="space-y-2 py-1.5">
            <AutoTextarea autoFocus value={text} maxLength={props.maxLength} aria-label={props.label} onChange={(event) => setText(event.target.value)} onSubmitKey={save} />
            <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={props.onCancel}>{props.t('button.cancel')}</Button>
                <Button size="sm" disabled={!text.trim()} onClick={save}>{props.t('taskGuide.save')}</Button>
            </div>
        </div>
    )
}

/** The draft the user ticks, edits and answers before confirming. */
function DraftEditor(props: { draft: TaskDraft; edits: DraftEdits; onChange: (edits: DraftEdits) => void; t: Translate }) {
    const { draft, edits, t } = props
    const [editing, setEditing] = useState<string | null>(null)
    const patch = (next: Partial<DraftEdits>) => props.onChange({ ...edits, ...next })
    const nonGoals = edits.nonGoals ?? draft.nonGoals
    const goal = edits.goal ?? draft.goal
    const kept = keptCount(draft, edits)

    const editor = (key: string, value: string, maxLength: number, onSave: (text: string) => void, onCancel?: () => void) => (
        <InlineEditor
            key={key}
            value={value}
            label={t('taskGuide.edit')}
            maxLength={maxLength}
            t={t}
            onSave={(text) => { onSave(text); setEditing(null) }}
            onCancel={() => { onCancel?.(); setEditing(null) }}
        />
    )

    return (
        <div>
            <Caption>{t('taskGuide.goal')}</Caption>
            {editing === 'goal' ? editor('goal', goal, 300, (text) => patch({ goal: text })) : (
                <div className="flex items-start gap-1">
                    <p className="min-w-0 flex-1 py-2.5 pl-1 text-headline font-semibold leading-snug text-[var(--social-fg)]">{goal}</p>
                    <IconButton label={t('taskGuide.edit')} onClick={() => setEditing('goal')} className="shrink-0 text-[var(--social-fg-muted)]">
                        <PencilIcon className="h-[18px] w-[18px]" />
                    </IconButton>
                </div>
            )}

            <Caption>{t('taskGuide.nonGoals')}</Caption>
            {nonGoals.map((line, index) => {
                const key = `ng:${index}`
                const setLine = (text: string | null) => patch({
                    nonGoals: text === null ? nonGoals.filter((_, i) => i !== index) : nonGoals.map((item, i) => (i === index ? text : item))
                })
                if (editing === key) return editor(key, line, 200, (text) => setLine(text), () => { if (!line.trim()) setLine(null) })
                return (
                    <div key={key} className="flex items-start gap-1">
                        <p className="min-w-0 flex-1 py-2.5 pl-1 text-body leading-snug text-[var(--social-fg)]">· {line}</p>
                        <IconButton label={t('taskGuide.edit')} onClick={() => setEditing(key)} className="shrink-0 text-[var(--social-fg-muted)]">
                            <PencilIcon className="h-[18px] w-[18px]" />
                        </IconButton>
                        <IconButton label={t('taskGuide.remove')} onClick={() => setLine(null)} className="shrink-0 text-[var(--social-fg-muted)]">
                            <CloseIcon className="h-[18px] w-[18px]" />
                        </IconButton>
                    </div>
                )
            })}
            {nonGoals.length < 6 ? (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { patch({ nonGoals: [...nonGoals, ''] }); setEditing(`ng:${nonGoals.length}`) }}>
                    <PlusIcon className="h-4 w-4" />{t('taskGuide.addNonGoal')}
                </Button>
            ) : null}

            <Caption>{t('taskGuide.criteria')}</Caption>
            <p className="px-1 pb-1 text-footnote text-[var(--social-fg-muted)]">{t('taskGuide.criteriaHint')}</p>
            {draft.criteria.map((criterion) => {
                const key = `c:${criterion.id}`
                const text = edits.texts[criterion.id] ?? criterion.text
                if (editing === key) return editor(key, text, 300, (next) => patch({ texts: { ...edits.texts, [criterion.id]: next } }))
                const changed = text !== criterion.text
                return (
                    <CheckRow
                        key={key}
                        checked={edits.kept[criterion.id] !== false}
                        onCheckedChange={(checked) => patch({ kept: { ...edits.kept, [criterion.id]: checked } })}
                        label={text}
                        title={text}
                        subtitle={criterion.verify ? t('taskGuide.verify', { how: criterion.verify }) : undefined}
                        tag={<SourceBadge source={changed ? 'user' : criterion.source} t={t} />}
                        onEdit={() => setEditing(key)}
                        editLabel={t('taskGuide.edit')}
                    />
                )
            })}
            {edits.added.map((text, index) => {
                const key = `add:${index}`
                const setAdded = (next: string | null) => patch({
                    added: next === null ? edits.added.filter((_, i) => i !== index) : edits.added.map((item, i) => (i === index ? next : item))
                })
                if (editing === key) return editor(key, text, 300, (next) => setAdded(next), () => { if (!text.trim()) setAdded(null) })
                return (
                    <CheckRow
                        key={key}
                        checked
                        onCheckedChange={() => setAdded(null)}
                        label={text}
                        title={text}
                        tag={<SourceBadge source="user" t={t} />}
                        onEdit={() => setEditing(key)}
                        editLabel={t('taskGuide.edit')}
                    />
                )
            })}
            {edits.added.length < 4 ? (
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { patch({ added: [...edits.added, ''] }); setEditing(`add:${edits.added.length}`) }}>
                    <PlusIcon className="h-4 w-4" />{t('taskGuide.addCriterion')}
                </Button>
            ) : null}
            {kept === 0 ? <p className="px-1 pt-1 text-footnote text-[var(--social-danger)]">{t('taskGuide.keepOne')}</p> : null}

            {draft.questions.length > 0 ? (
                <>
                    <Caption>{t('taskGuide.questions')}</Caption>
                    {draft.questions.map((question) => {
                        const answer = edits.answers[question.id] ?? question.default
                        return (
                            <div key={question.id} className="space-y-2 px-1 pb-3">
                                <p className="text-body leading-snug text-[var(--social-fg)]">{question.text}</p>
                                <ChoiceChips
                                    label={question.text}
                                    value={answer}
                                    options={question.options.map((option) => ({ value: option.id, label: option.label }))}
                                    onChange={(value) => patch({ answers: { ...edits.answers, [question.id]: value } })}
                                />
                                {question.precedentRef && answer === question.default ? (
                                    <p className="text-caption text-[var(--social-fg-muted)]">{t('taskGuide.precedent')}</p>
                                ) : null}
                            </div>
                        )
                    })}
                </>
            ) : null}
        </div>
    )
}

/** The confirmed acceptance list, read-only. */
function AcceptanceList(props: { items: AcceptanceCriterion[]; t: Translate }) {
    return (
        <ol aria-label={props.t('tasks.acceptance')} className="space-y-2 py-1">
            {props.items.map((criterion, index) => (
                <li key={criterion.id} className="flex gap-2 px-1">
                    <span className="w-5 shrink-0 text-right text-body tabular-nums text-[var(--social-fg-muted)]">{index + 1}.</span>
                    <div className="min-w-0 flex-1">
                        <p className="text-body leading-snug text-[var(--social-fg)]">{criterion.text}</p>
                        {criterion.verify ? <p className="mt-0.5 text-footnote leading-snug text-[var(--social-fg-muted)]">{props.t('taskGuide.verify', { how: criterion.verify })}</p> : null}
                        <span className="mt-1 block"><SourceBadge source={criterion.source} t={props.t} /></span>
                    </div>
                </li>
            ))}
        </ol>
    )
}

function statusLine(task: TaskView, t: Translate): string {
    if (task.status !== 'guiding') return t(`tasks.status.${task.status}`)
    if (task.guide.state === 'ready' && task.draft) return t('taskGuide.version', { n: task.draft.version })
    if (task.guide.state === 'failed') return t('tasks.guideFailed')
    return t('tasks.guideWorking')
}

/**
 * The card on top of a task group's page. While the task is guiding it holds the draft the user ticks, edits and
 * confirms; asking HAQI to change the draft happens in the group's own composer. After that it shows the goal and the
 * confirmed acceptance list, folded by default.
 */
export function TaskCard(props: { taskId: string; api: ApiClient | null }) {
    const { t } = useTranslation()
    const { task } = useTask(props.api, props.taskId)
    const { confirmTask, retryGuide, updateTask } = useTaskActions(props.api)
    const draft = task?.status === 'guiding' && task.guide.state === 'ready' ? task.draft : null
    const [edits, setEdits] = useState<DraftEdits | null>(null)
    const [open, setOpen] = useState<boolean | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // A new draft version starts from its own defaults, but keeps the criteria the user wrote and the answers to
    // questions it still asks.
    useEffect(() => {
        if (draft && edits?.version !== draft.version) setEdits((previous) => carryOver(draft, previous))
    }, [draft, edits?.version])

    if (!task) return null
    const guiding = task.status === 'guiding'
    const expanded = open ?? guiding
    const working = guiding && (task.guide.state === 'starting' || task.guide.state === 'drafting')

    const run = async (action: () => Promise<unknown>) => {
        setPending(true)
        setError(null)
        try {
            await action()
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
            setPending(false)
        }
    }

    return (
        <section aria-label={t('taskCard.title')} className="shrink-0 border-b border-[var(--social-divider)] bg-[var(--social-surface)]">
            <button
                type="button"
                onClick={() => setOpen(!expanded)}
                aria-expanded={expanded}
                className="flex min-h-12 w-full items-center gap-2 px-4 text-left"
            >
                <span className="shrink-0 text-footnote font-semibold text-[var(--social-fg)]">{t('taskCard.title')}</span>
                <span className={cn('min-w-0 flex-1 truncate text-footnote', guiding && task.guide.state === 'failed' ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg-muted)]')}>
                    {expanded || !task.goal ? statusLine(task, t) : task.goal}
                </span>
                {working ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--social-fg-muted)]" aria-hidden="true" /> : null}
                <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', !expanded && '-rotate-90')} />
            </button>

            {expanded ? (
                <div className={cn('overflow-y-auto overscroll-contain px-3 pb-3', guiding ? 'max-h-[42dvh] lg:max-h-[55dvh]' : 'max-h-[55dvh]')}>
                    {task.guide.request && guiding ? (
                        <p className="mx-1 mb-1 whitespace-pre-line rounded-xl bg-[var(--social-muted)] px-3 py-2 text-footnote leading-snug text-[var(--social-fg-muted)]">
                            {t('taskGuide.request')}：{task.guide.request}
                        </p>
                    ) : null}

                    {working ? (
                        <div className="px-1 py-4">
                            <p className="text-body text-[var(--social-fg)]">{t('taskGuide.working')}</p>
                            <p className="mt-1 text-footnote text-[var(--social-fg-muted)]">{t('taskGuide.workingHint')}</p>
                        </div>
                    ) : null}

                    {guiding && task.guide.state === 'failed' ? (
                        <div className="space-y-3 px-1 py-3">
                            <p className="text-footnote text-[var(--social-danger)]">{task.guide.error}</p>
                            <Button className="w-full" disabled={pending} onClick={() => void run(() => retryGuide(task.id))}>{t('taskGuide.retry')}</Button>
                        </div>
                    ) : null}

                    {draft && edits ? <DraftEditor draft={draft} edits={edits} onChange={setEdits} t={t} /> : null}

                    {!guiding ? (
                        <>
                            {task.goal ? (
                                <>
                                    <Caption>{t('taskGuide.goal')}</Caption>
                                    <p className="px-1 text-body font-semibold leading-snug text-[var(--social-fg)]">{task.goal}</p>
                                </>
                            ) : null}
                            {task.nonGoals.length > 0 ? (
                                <>
                                    <Caption>{t('taskGuide.nonGoals')}</Caption>
                                    {task.nonGoals.map((line) => <p key={line} className="px-1 text-footnote leading-snug text-[var(--social-fg-muted)]">· {line}</p>)}
                                </>
                            ) : null}
                            {task.acceptance.length > 0 ? (
                                <>
                                    <Caption>{t('taskCard.acceptanceCount', { n: task.acceptance.length })}</Caption>
                                    <AcceptanceList items={task.acceptance} t={t} />
                                </>
                            ) : null}
                            {task.load ? (
                                <p className="px-1 pt-2 text-caption text-[var(--social-fg-muted)]">
                                    {t('tasks.load', { n: task.load.progress + task.load.correction + task.load.decision, progress: task.load.progress, correction: task.load.correction, decision: task.load.decision })}
                                </p>
                            ) : null}
                            <div className="flex justify-end pt-3">
                                <Button size="sm" variant="secondary" disabled={pending} onClick={() => void run(() => updateTask(task.id, { status: task.status === 'active' ? 'done' : 'active' }))}>
                                    {task.status === 'active' ? t('tasks.complete') : t('tasks.reopen')}
                                </Button>
                            </div>
                        </>
                    ) : null}

                    {error ? <p className="px-1 pt-2 text-footnote text-[var(--social-danger)]">{error}</p> : null}
                </div>
            ) : null}

            {/* Asking HAQI to change the draft happens in the group composer below; its placeholder says so. */}
            {expanded && guiding ? (
                <div className="flex gap-2 border-t border-[var(--social-divider)] px-4 py-2.5">
                    <Button variant="ghost" className={draft && edits ? 'shrink-0' : 'w-full'} disabled={pending} onClick={() => void run(() => updateTask(task.id, { status: 'abandoned' }))}>
                        {t('taskGuide.abandon')}
                    </Button>
                    {draft && edits ? (
                        <Button className="flex-1" disabled={pending || keptCount(draft, edits) === 0} onClick={() => void run(() => confirmTask(task.id, confirmInputFrom(draft, edits)))}>
                            {pending ? t('taskGuide.confirming') : t('taskGuide.confirm')}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </section>
    )
}
