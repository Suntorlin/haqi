import { useEffect, useState, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { CriterionSource, TaskDraft, TaskRun, TaskSubtask, TaskView } from '@/types/api'
import { useTask, useTaskActions } from '@/hooks/queries/useTasks'
import { useSession } from '@/hooks/queries/useSession'
import { useTranslation } from '@/lib/use-translation'
import { carryOver, confirmInputFrom, keptCount, type DraftEdits } from '@/lib/tasks'
import { cn } from '@/lib/utils'
import {
    Checklist,
    DecisionCard,
    DecisionConfirmation,
    LeadComposer,
    ProgressList,
    ReportSummary,
    RiskNotice,
    SectionCaption,
    VerdictBar,
    type CheckItem,
    type LatestMessage,
    type ProgressItem,
    type ReportTone
} from '@/components/report'
import { useNavigate } from '@tanstack/react-router'
import { AutoTextarea } from '@/components/ui/AutoTextarea'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckRow } from '@/components/ui/CheckRow'
import { IconButton } from '@/components/ui/IconButton'
import { CloseIcon, PencilIcon, PlusIcon } from '@/components/mobile/icons'

type Translate = ReturnType<typeof useTranslation>['t']

const SOURCE_KEY: Record<CriterionSource, string> = {
    principle: 'taskGuide.source.principle',
    repo: 'taskGuide.source.repo',
    inferred: 'taskGuide.source.inferred',
    user: 'taskGuide.source.user'
}

/** The repository's folder name, shown next to the tag. */
function repoName(path: string | null): string | null {
    return path ? path.split('/').filter(Boolean).pop() ?? path : null
}

function SourceBadge(props: { source: CriterionSource; t: Translate }) {
    const variant = props.source === 'inferred' ? 'warning' : props.source === 'user' ? 'info' : 'default'
    return <Badge variant={variant}>{props.t(SOURCE_KEY[props.source])}</Badge>
}

/** A grouped card, same frame as the report kit's Checklist. */
function Group(props: { children: ReactNode }) {
    return <div className="mx-4 divide-y divide-[var(--social-divider)] overflow-hidden rounded-2xl border border-[var(--social-border)]">{props.children}</div>
}

function AddButton(props: { label: string; onClick: () => void }) {
    return (
        <Button size="sm" variant="ghost" className="-my-1 gap-1" onClick={props.onClick}>
            <PlusIcon className="h-4 w-4" />{props.label}
        </Button>
    )
}

/** One open editor: a growing text field with Save and Cancel. */
function InlineEditor(props: { value: string; label: string; maxLength: number; onSave: (text: string) => void; onCancel: () => void; t: Translate }) {
    const [text, setText] = useState(props.value)
    const save = () => props.onSave(text.trim())
    return (
        <div className="space-y-2 px-3 py-3">
            <AutoTextarea autoFocus value={text} maxLength={props.maxLength} aria-label={props.label} onChange={(event) => setText(event.target.value)} onSubmitKey={save} />
            <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={props.onCancel}>{props.t('button.cancel')}</Button>
                <Button size="sm" disabled={!text.trim()} onClick={save}>{props.t('taskGuide.save')}</Button>
            </div>
        </div>
    )
}

/** A plain line with edit and remove buttons (a non-goal). */
function LineRow(props: { text: string; onEdit: () => void; onRemove: () => void; t: Translate }) {
    return (
        <div className="flex min-h-[52px] items-center gap-1 py-1 pl-4 pr-1">
            <p className="min-w-0 flex-1 py-2 text-body leading-snug text-[var(--social-fg)]">{props.text}</p>
            <IconButton label={props.t('taskGuide.edit')} onClick={props.onEdit} className="shrink-0 text-[var(--social-fg-muted)]">
                <PencilIcon className="h-[18px] w-[18px]" />
            </IconButton>
            <IconButton label={props.t('taskGuide.remove')} onClick={props.onRemove} className="shrink-0 text-[var(--social-fg-muted)]">
                <CloseIcon className="h-[18px] w-[18px]" />
            </IconButton>
        </div>
    )
}

/**
 * The lead asks to run a tool that needs the user's approval (a planner should not, but a stuck one would wait
 * forever where the user cannot see it): show the request with Allow and Deny.
 */
function ApprovalCard(props: { tool: string; args: unknown; onAllow: () => void; onDeny: () => void; pending: boolean; t: Translate }) {
    const args = props.args as { command?: unknown; file_path?: unknown } | null
    const detail = typeof args?.command === 'string' ? args.command : typeof args?.file_path === 'string' ? args.file_path : JSON.stringify(props.args)
    return (
        <>
            <SectionCaption>{props.t('taskReport.approval')}</SectionCaption>
            <div className="mx-4 rounded-2xl bg-[var(--social-muted)] p-4">
                <p className="text-body font-semibold text-[var(--social-fg)]">{props.t('taskReport.approvalTitle', { tool: props.tool })}</p>
                <pre className="mt-2 line-clamp-4 whitespace-pre-wrap break-all rounded-xl bg-[var(--social-surface)] px-3 py-2 font-mono text-footnote text-[var(--social-fg)]">{detail}</pre>
                <div className="mt-3 flex gap-2">
                    <Button variant="secondary" disabled={props.pending} onClick={props.onDeny}>{props.t('taskReport.deny')}</Button>
                    <Button className="flex-1" disabled={props.pending} onClick={props.onAllow}>{props.t('taskReport.allow')}</Button>
                </div>
            </div>
        </>
    )
}

/** The draft as a report: goal, decisions waiting for the user, criteria to tick and edit, non-goals, confirm. */
function DraftReport(props: {
    task: TaskView
    draft: TaskDraft
    edits: DraftEdits
    onChange: (edits: DraftEdits) => void
    onConfirm: () => void
    onAbandon: () => void
    pending: boolean
    t: Translate
}) {
    const { draft, edits, t } = props
    const [editing, setEditing] = useState<string | null>(null)
    const [answered, setAnswered] = useState<Record<string, boolean>>({})
    const patch = (next: Partial<DraftEdits>) => props.onChange({ ...edits, ...next })
    const goal = edits.goal ?? draft.goal
    const nonGoals = edits.nonGoals ?? draft.nonGoals
    const kept = keptCount(draft, edits)
    const waiting = draft.questions.filter((question) => !answered[question.id]).length

    // A new draft version asks again.
    useEffect(() => { setAnswered({}) }, [draft.version])

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

    const lede = [
        t('taskGuide.version', { n: draft.version }),
        t('taskReport.criteriaCount', { n: kept }),
        waiting > 0 ? t('taskReport.waitingCount', { n: waiting }) : null,
        props.task.tag ? `#${props.task.tag}` : null,
        repoName(props.task.repoPath)
    ].filter(Boolean).join(' · ')

    return (
        <>
            {editing === 'goal' ? (
                <div className="px-1 pt-3">{editor('goal', goal, 300, (text) => patch({ goal: text }))}</div>
            ) : (
                <div className="relative">
                    <ReportSummary headline={<span className="block pr-10">{goal}</span>} lede={lede} />
                    <IconButton label={t('taskReport.editGoal')} onClick={() => setEditing('goal')} className="absolute right-2 top-3 text-[var(--social-fg-muted)]">
                        <PencilIcon className="h-[18px] w-[18px]" />
                    </IconButton>
                </div>
            )}

            {draft.questions.length > 0 ? (
                <>
                    <SectionCaption>{t('taskReport.waiting')}</SectionCaption>
                    <div className="mx-4 flex flex-col gap-2">
                        {draft.questions.map((question) => {
                            const answer = edits.answers[question.id] ?? question.default
                            const label = question.options.find((option) => option.id === answer)?.label ?? ''
                            if (answered[question.id]) {
                                return (
                                    <button key={question.id} type="button" className="text-left" onClick={() => setAnswered({ ...answered, [question.id]: false })} aria-label={t('taskReport.changeAnswer', { question: question.text })}>
                                        <DecisionConfirmation label={label} />
                                    </button>
                                )
                            }
                            return (
                                <DecisionCard
                                    key={`${draft.version}:${question.id}`}
                                    decision={{
                                        id: question.id,
                                        question: question.text,
                                        context: question.precedentRef ? t('taskGuide.precedent') : undefined,
                                        options: question.options.map((option) => ({
                                            label: option.label,
                                            good: option.good ?? '',
                                            cost: option.cost ?? '',
                                            recommended: option.id === question.default
                                        }))
                                    }}
                                    onAnswer={(option) => {
                                        const picked = question.options.find((item) => item.label === option.label)
                                        if (picked) patch({ answers: { ...edits.answers, [question.id]: picked.id } })
                                        setAnswered({ ...answered, [question.id]: true })
                                    }}
                                />
                            )
                        })}
                    </div>
                </>
            ) : null}

            <SectionCaption trailing={edits.added.length < 4 ? <AddButton label={t('taskGuide.addCriterion')} onClick={() => { patch({ added: [...edits.added, ''] }); setEditing(`add:${edits.added.length}`) }} /> : undefined}>
                {t('taskGuide.criteria')}
            </SectionCaption>
            <p className="px-5 pb-2 text-footnote text-[var(--social-fg-muted)]">{t('taskGuide.criteriaHint')}</p>
            <Group>
                {draft.criteria.map((criterion) => {
                    const key = `c:${criterion.id}`
                    const text = edits.texts[criterion.id] ?? criterion.text
                    if (editing === key) return editor(key, text, 300, (next) => patch({ texts: { ...edits.texts, [criterion.id]: next } }))
                    return (
                        <CheckRow
                            key={key}
                            className="pl-1.5 pr-1"
                            checked={edits.kept[criterion.id] !== false}
                            onCheckedChange={(checked) => patch({ kept: { ...edits.kept, [criterion.id]: checked } })}
                            label={text}
                            title={text}
                            subtitle={criterion.verify ? t('taskGuide.verify', { how: criterion.verify }) : undefined}
                            tag={<SourceBadge source={text !== criterion.text ? 'user' : criterion.source} t={t} />}
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
                            className="pl-1.5 pr-1"
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
            </Group>
            {kept === 0 ? <p className="px-5 pt-2 text-footnote text-[var(--social-danger)]">{t('taskGuide.keepOne')}</p> : null}

            <SectionCaption trailing={nonGoals.length < 6 ? <AddButton label={t('taskGuide.addNonGoal')} onClick={() => { patch({ nonGoals: [...nonGoals, ''] }); setEditing(`ng:${nonGoals.length}`) }} /> : undefined}>
                {t('taskGuide.nonGoals')}
            </SectionCaption>
            {nonGoals.length > 0 ? (
                <Group>
                    {nonGoals.map((line, index) => {
                        const key = `ng:${index}`
                        const setLine = (text: string | null) => patch({
                            nonGoals: text === null ? nonGoals.filter((_, i) => i !== index) : nonGoals.map((item, i) => (i === index ? text : item))
                        })
                        if (editing === key) return editor(key, line, 200, (text) => setLine(text), () => { if (!line.trim()) setLine(null) })
                        return <LineRow key={key} text={line} t={t} onEdit={() => setEditing(key)} onRemove={() => setLine(null)} />
                    })}
                </Group>
            ) : (
                <p className="px-5 text-footnote text-[var(--social-fg-muted)]">{t('taskReport.noNonGoals')}</p>
            )}

            <div className="mx-4 mt-8 flex gap-2">
                <Button variant="secondary" disabled={props.pending} onClick={props.onAbandon}>{t('taskGuide.abandon')}</Button>
                <Button className="flex-1" disabled={props.pending || kept === 0} onClick={props.onConfirm}>
                    {props.pending ? t('taskGuide.confirming') : t('taskGuide.confirm')}
                </Button>
            </div>
            <p className="px-5 pt-2 text-center text-caption text-[var(--social-fg-muted)]">{t('taskReport.confirmHint')}</p>
        </>
    )
}

const SUBTASK_TONE: Record<TaskSubtask['state'], ReportTone> = { waiting: 'wait', running: 'live', done: 'done', stuck: 'stuck', stopped: 'stuck' }

/** The headline of a running task: one sentence on where it is and what waits for the user. */
function runHeadline(task: TaskView, run: TaskRun, t: Translate): string {
    const open = run.decisions.filter((d) => !d.answer).length
    const workers = run.subtasks.filter((s) => !s.fix && s.id !== 'merge')
    const done = workers.filter((s) => s.state === 'done').length
    const waiting = open > 0 ? t('taskRun.waitingYou', { n: open }) : ''
    switch (run.phase) {
        case 'planning': return t('taskRun.planning')
        case 'running': return t('taskRun.running', { n: workers.length, done }) + waiting
        case 'integrating': return t('taskRun.integrating') + waiting
        case 'reviewing': return t('taskRun.reviewing') + waiting
        case 'fixing': return t('taskRun.fixing', { n: run.review?.results.filter((r) => r.status === 'not_met').length ?? 0 }) + waiting
        case 'reporting': return run.report?.conclusion ?? t('taskRun.reporting')
        case 'accepted': return task.goal ?? task.name
    }
}

/**
 * The task after the guide step, laid out like the report kit's lead report: one sentence on where it is, the
 * decisions that wait for the user, every subtask's progress, the acceptance checks, and the risks.
 */
function RunReport(props: { task: TaskView; run: TaskRun; onAnswer: (decisionId: string, label: string) => void; pending: boolean; t: Translate }) {
    const { task, run, t } = props
    const navigate = useNavigate()
    const open = run.decisions.filter((d) => !d.answer)
    const answered = run.decisions.filter((d) => d.answer)
    const results = new Map((run.review?.results ?? []).map((r) => [r.criterionId, r]))
    const owner = (criterionId: string) => run.subtasks.find((s) => !s.fix && s.criteria.includes(criterionId))
    const items: ProgressItem[] = run.subtasks.map((s) => ({
        id: s.id,
        seed: s.sessionId ?? s.id,
        name: s.title,
        status: s.state === 'done' ? (s.summary ?? t('taskRun.state.done')) : t(`taskRun.state.${s.state}`),
        tone: SUBTASK_TONE[s.state],
        done: s.state === 'done' ? 1 : 0,
        total: 1,
        when: s.doneAt ? new Date(s.doneAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }) : undefined
    }))
    const checks: CheckItem[] = task.acceptance.map((c) => {
        const result = results.get(c.id)
        if (result) {
            return {
                title: c.text,
                subtitle: result.evidence,
                state: result.status === 'met' ? 'done' : 'wait',
                trailing: result.status === 'met' ? undefined : t(`taskRun.verdict.${result.status}`)
            }
        }
        const by = owner(c.id)
        return { title: c.text, subtitle: c.verify ? t('taskGuide.verify', { how: c.verify }) : undefined, state: by?.state === 'done' ? 'live' : by?.state === 'running' ? 'live' : 'todo' }
    })
    const risks = run.signals.filter((s) => s.kind !== 'reminded').map((s) => s.text)
    const lede = [t(`taskRun.phase.${run.phase}`), task.tag ? `#${task.tag}` : null, repoName(task.repoPath), run.integration ? run.integration.branch : null].filter(Boolean).join(' · ')

    return (
        <>
            <ReportSummary headline={runHeadline(task, run, t)} lede={lede} />
            {run.report?.shareUrl ? (
                <a href={run.report.shareUrl} target="_blank" rel="noreferrer" className="mx-5 mt-2 inline-block text-footnote font-semibold text-[var(--social-fg)] underline underline-offset-4">
                    {t('taskRun.fullReport')}
                </a>
            ) : null}

            {open.length > 0 ? (
                <>
                    <SectionCaption>{t('taskReport.waiting')}</SectionCaption>
                    <div className="mx-4 flex flex-col gap-2">
                        {open.map((d) => (
                            <DecisionCard
                                key={d.id}
                                showSource={Boolean(d.subtaskId)}
                                decision={{
                                    id: d.id,
                                    question: d.question,
                                    context: d.context ?? undefined,
                                    source: d.subtaskId ? { seed: d.askedBy ?? d.id, name: run.subtasks.find((s) => s.id === d.subtaskId)?.title ?? d.subtaskId } : undefined,
                                    options: d.options.map((o) => ({ label: o.label, good: o.good ?? '', cost: o.cost ?? '', recommended: o.label === d.recommended }))
                                }}
                                onAnswer={(option) => props.onAnswer(d.id, option.label)}
                            />
                        ))}
                    </div>
                </>
            ) : null}

            {risks.length > 0 ? (
                <>
                    <SectionCaption>{t('taskRun.risks')}</SectionCaption>
                    <div className="mx-4"><RiskNotice risks={risks} /></div>
                </>
            ) : null}

            {items.length > 0 ? (
                <>
                    <SectionCaption>{t('taskRun.progress')}</SectionCaption>
                    <div className="mx-4">
                        <ProgressList items={items} onOpen={(item) => {
                            const sessionId = run.subtasks.find((s) => s.id === item.id)?.sessionId
                            if (sessionId) void navigate({ to: '/sessions/$sessionId', params: { sessionId } })
                        }} />
                    </div>
                </>
            ) : null}

            <SectionCaption>{t('taskGuide.criteria')}</SectionCaption>
            <div className="mx-4"><Checklist items={checks} /></div>

            {answered.length > 0 ? (
                <>
                    <SectionCaption>{t('taskRun.decided')}</SectionCaption>
                    <Group>
                        {answered.map((d) => (
                            <div key={d.id} className="px-4 py-3">
                                <p className="text-body text-[var(--social-fg)]">{d.question} → {d.answer!.label}</p>
                                <p className="mt-0.5 text-footnote text-[var(--social-fg-muted)]">{d.answer!.by === 'precedent' ? t('taskRun.byPrecedent') : t('taskRun.byYou')}</p>
                            </div>
                        ))}
                    </Group>
                </>
            ) : null}
        </>
    )
}

/** The confirmed task: goal, numbers, the acceptance list and what it does not do. */
function ConfirmedReport(props: { task: TaskView; onToggleDone: () => void; pending: boolean; t: Translate }) {
    const { task, t } = props
    const load = task.load ? task.load.progress + task.load.correction + task.load.decision : null
    const status = t(`tasks.status.${task.status}`)
    return (
        <>
            <ReportSummary
                headline={task.goal ?? task.name}
                lede={[status, task.tag ? `#${task.tag}` : null, repoName(task.repoPath)].filter(Boolean).join(' · ')}
                stats={[
                    { value: String(task.acceptance.length), label: t('taskReport.stat.criteria') },
                    { value: String(load ?? 0), label: t('taskReport.stat.load') },
                    { value: String(task.members.filter((member) => member.role !== 'lead').length), label: t('taskReport.stat.sessions') }
                ]}
            />
            <SectionCaption>{t('taskGuide.criteria')}</SectionCaption>
            <div className="mx-4">
                <Checklist items={task.acceptance.map((criterion) => ({
                    title: criterion.text,
                    subtitle: criterion.verify ? t('taskGuide.verify', { how: criterion.verify }) : undefined,
                    state: task.status === 'done' ? 'done' : 'todo'
                }))} />
            </div>
            {task.nonGoals.length > 0 ? (
                <>
                    <SectionCaption>{t('taskGuide.nonGoals')}</SectionCaption>
                    <Group>
                        {task.nonGoals.map((line) => <p key={line} className="flex min-h-[52px] items-center px-4 text-body text-[var(--social-fg-muted)]">{line}</p>)}
                    </Group>
                </>
            ) : null}
            <div className="mx-4 mt-8 flex justify-center">
                <Button variant="secondary" disabled={props.pending} onClick={props.onToggleDone}>
                    {task.status === 'active' ? t('tasks.complete') : t('tasks.reopen')}
                </Button>
            </div>
        </>
    )
}

/**
 * A task page as the lead's live report (report kit): what is being drafted, what waits for the user, the
 * acceptance list; the lead's latest line and the input to talk to it at the bottom. The full group conversation is
 * one tap away ("All chats").
 */
export function TaskReport(props: {
    taskId: string
    api: ApiClient | null
    latest: LatestMessage | null
    onSend: (text: string) => Promise<void>
    onAllChats: () => void
}) {
    const { t } = useTranslation()
    const { task } = useTask(props.api, props.taskId)
    const { session: lead } = useSession(props.api, task?.leadSessionId ?? null)
    const waitingRequest = Object.entries(lead?.agentState?.requests ?? {})[0] ?? null
    const { confirmTask, retryGuide, updateTask, answerDecision, verdict } = useTaskActions(props.api)
    const [changing, setChanging] = useState(false)
    const draft = task?.status === 'guiding' && task.guide.state === 'ready' ? task.draft : null
    const [edits, setEdits] = useState<DraftEdits | null>(null)
    const [message, setMessage] = useState('')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (draft && edits?.version !== draft.version) setEdits((previous) => carryOver(draft, previous))
    }, [draft, edits?.version])

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

    if (!task) return <div className="min-h-0 flex-1" />
    const guiding = task.status === 'guiding'
    const working = guiding && (task.guide.state === 'starting' || task.guide.state === 'drafting')
    const send = () => {
        const text = message.trim()
        if (!text) return
        setMessage('')
        void run(() => props.onSend(text))
    }

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pb-8">
                <div className="mx-auto w-full max-w-2xl">
                    {waitingRequest && lead && props.api ? (
                        <ApprovalCard
                            tool={waitingRequest[1].tool}
                            args={waitingRequest[1].arguments}
                            pending={pending}
                            t={t}
                            onAllow={() => void run(() => props.api!.approvePermission(lead.id, waitingRequest[0]))}
                            onDeny={() => void run(() => props.api!.denyPermission(lead.id, waitingRequest[0], { decision: 'denied', reason: t('taskReport.denyReason') }))}
                        />
                    ) : null}
                    {working ? <ReportSummary headline={t('taskReport.drafting')} lede={t('taskGuide.workingHint')} /> : null}

                    {guiding && task.guide.state === 'failed' ? (
                        <>
                            <ReportSummary headline={t('taskReport.failed')} />
                            <div className="mx-4 mt-4"><RiskNotice risks={[task.guide.error ?? '']} /></div>
                            <div className="mx-4 mt-4 flex gap-2">
                                <Button variant="secondary" disabled={pending} onClick={() => void run(() => updateTask(task.id, { status: 'abandoned' }))}>{t('taskGuide.abandon')}</Button>
                                <Button className="flex-1" disabled={pending} onClick={() => void run(() => retryGuide(task.id))}>{t('taskGuide.retry')}</Button>
                            </div>
                        </>
                    ) : null}

                    {guiding && task.guide.request && !draft ? (
                        <>
                            <SectionCaption>{t('taskGuide.request')}</SectionCaption>
                            <p className="mx-4 whitespace-pre-line rounded-2xl bg-[var(--social-muted)] px-4 py-3 text-body leading-relaxed text-[var(--social-fg)]">{task.guide.request}</p>
                        </>
                    ) : null}

                    {working ? (
                        <div className="mx-4 mt-6 space-y-2" aria-hidden="true">
                            {[0, 1, 2].map((row) => <div key={row} className="h-[52px] animate-pulse rounded-2xl bg-[var(--social-muted)]" />)}
                        </div>
                    ) : null}

                    {draft && edits ? (
                        <DraftReport
                            task={task}
                            draft={draft}
                            edits={edits}
                            onChange={setEdits}
                            pending={pending}
                            t={t}
                            onConfirm={() => void run(() => confirmTask(task.id, confirmInputFrom(draft, edits)))}
                            onAbandon={() => void run(() => updateTask(task.id, { status: 'abandoned' }))}
                        />
                    ) : null}

                    {!guiding && task.run ? (
                        <RunReport task={task} run={task.run} pending={pending} t={t} onAnswer={(decisionId, label) => void run(() => answerDecision(task.id, decisionId, label))} />
                    ) : null}

                    {!guiding && !task.run ? (
                        <ConfirmedReport
                            task={task}
                            pending={pending}
                            t={t}
                            onToggleDone={() => void run(() => updateTask(task.id, { status: task.status === 'active' ? 'done' : 'active' }))}
                        />
                    ) : null}

                    {error ? <p className={cn('px-5 pt-3 text-footnote text-[var(--social-danger)]')}>{error}</p> : null}
                </div>
            </div>
            {task.run?.phase === 'reporting' && !changing ? (
                <VerdictBar
                    onApprove={() => void run(() => verdict(task.id, { approved: true }))}
                    onRequestChanges={() => setChanging(true)}
                />
            ) : (
                <LeadComposer
                    latest={props.latest ?? { from: 'lead', text: t('taskReport.noMessages'), when: '' }}
                    draft={message}
                    onDraft={setMessage}
                    onSend={changing && task.run?.phase === 'reporting'
                        ? () => {
                            const text = message.trim()
                            if (!text) return
                            setMessage('')
                            setChanging(false)
                            void run(() => verdict(task.id, { approved: false, text }))
                        }
                        : send}
                    onAllChats={props.onAllChats}
                    placeholder={guiding ? t('taskGuide.composerPlaceholder') : changing ? t('taskRun.changePlaceholder') : undefined}
                />
            )}
        </div>
    )
}
