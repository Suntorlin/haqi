import { useCallback, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { AcceptanceCriterion, TaskDecision, TaskRun, TaskSubtask, TaskView } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import {
    CheckRing,
    AgentTimeline,
    AtDetail,
    DetailSwitch,
    ReportDetailProvider,
    StoryCards,
    StatTiles,
    Checklist,
    DecisionCard,
    DecisionConfirmation,
    DecisionPeek,
    ProgressList,
    ProgressOrb,
    ReportSummary,
    RiskNotice,
    SectionCaption,
    type CheckItem,
    type ProgressItem,
    type ReportStat,
    type ReportTone,
    type TimelineAgent,
    type TimelineSpan
} from '@/components/report'
import { BottomSheet } from '@/components/mobile/BottomSheet'
import { ChevronLeftIcon } from '@/components/mobile/icons'
import { Button } from '@/components/ui/button'
import { FitText } from '@/components/ui/FitText'
import { InfoTip } from '@/components/ui/InfoTip'
import { BriefFullMarkdownContent } from '@/components/AssistantChat/BriefFullMarkdownContent'
import { ReportSheet, reportMarkdownForApp } from './ReportSheet'

type Translate = ReturnType<typeof useTranslation>['t']

const SUBTASK_TONE: Record<TaskSubtask['state'], ReportTone> = { waiting: 'wait', running: 'live', done: 'done', stuck: 'stuck', stopped: 'stuck' }

export function duration(ms: number, t: Translate): string {
    const minutes = Math.max(1, Math.round(ms / 60_000))
    return minutes < 60 ? t('taskRun.minutes', { n: minutes }) : t('taskRun.hours', { h: Math.floor(minutes / 60), m: minutes % 60 })
}

function clock(at: number): string {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

function workers(run: TaskRun): TaskSubtask[] {
    return run.subtasks.filter((s) => s.id !== 'merge')
}

/** How far a subtask is, counted in its acceptance criteria: met by review, or all once it reported done. */
function criteriaDone(run: TaskRun, subtask: TaskSubtask): { done: number; total: number } {
    const total = Math.max(1, subtask.criteria.length)
    if (run.review) return { done: subtask.criteria.filter((id) => run.review!.results.some((r) => r.criterionId === id && r.status === 'met')).length, total }
    return { done: subtask.state === 'done' ? total : 0, total }
}

function openDecisionOf(run: TaskRun, subtask: TaskSubtask): TaskDecision | undefined {
    return run.decisions.find((d) => !d.answer && (d.subtaskId === subtask.id || (subtask.sessionId && d.askedBy === subtask.sessionId)))
}

/** Same as the observer's first threshold: after this long without a message a session counts as not moving. */
const SILENT_MS = 20 * 60_000

function ago(at: number, now: number, t: Translate): string {
    const minutes = Math.floor((now - at) / 60_000)
    if (minutes < 1) return t('taskRun.ago.now')
    return minutes < 60 ? t('taskRun.ago.minutes', { n: minutes }) : t('taskRun.ago.hours', { n: Math.floor(minutes / 60) })
}

/** One line on a subtask: what blocks it, or what its session does right now as the observer last saw it. */
function subtaskStatus(run: TaskRun, subtask: TaskSubtask, now: number, t: Translate): { text: string; tone: ReportTone } {
    const waiting = openDecisionOf(run, subtask)
    if (waiting) return { text: t('taskRun.waitsFor', { what: waiting.question }), tone: 'wait' }
    if (subtask.state === 'done') return { text: subtask.summary ?? t('taskRun.state.done'), tone: 'done' }
    const live = subtask.live
    if (live?.waiting) return { text: t('taskRun.live.approval', { what: live.waiting }), tone: 'wait' }
    if (subtask.state === 'stopped' || (live && !live.active)) return { text: t('taskRun.live.stopped'), tone: 'stuck' }
    const lastAt = live?.lastActivityAt ?? subtask.startedAt
    if (subtask.state === 'stuck' || (subtask.state === 'running' && lastAt && now - lastAt >= SILENT_MS)) {
        return { text: t('taskRun.noProgress', { time: duration(now - (lastAt ?? now), t) }), tone: 'stuck' }
    }
    if (subtask.state === 'running' && live) {
        const what = live.step ?? (live.thinking ? t('taskRun.live.thinking') : t('taskRun.state.running'))
        return { text: live.lastActivityAt ? `${what} · ${ago(live.lastActivityAt, now, t)}` : what, tone: 'live' }
    }
    return { text: t(`taskRun.state.${subtask.state}`), tone: SUBTASK_TONE[subtask.state] }
}

/**
 * What the observer did: when it last looked, and the log of what it flagged, reminded or pushed, newest first.
 * Read-only requests it approved for the lead fold into one count.
 */
function WatchLog(props: { run: TaskRun; live: boolean; now: number; t: Translate }) {
    const { t, now } = props
    const [all, setAll] = useState(false)
    const log = props.run.watch?.log ?? []
    const approvals = log.filter((e) => e.kind === 'auto_approved').length
    const entries = log.filter((e) => e.kind !== 'auto_approved').reverse()
    const shown = all ? entries : entries.slice(0, 3)
    const checkedAt = props.run.watch?.checkedAt ?? null
    const checked = checkedAt === null
        ? t('taskRun.watch.notYet')
        : now - checkedAt < 60_000 ? t('taskRun.watch.checkedSeconds', { n: Math.max(1, Math.round((now - checkedAt) / 1000)) }) : t('taskRun.watch.checked', { time: ago(checkedAt, now, t) })
    const summary = [props.live ? checked : null, approvals ? t('taskRun.watch.autoApproved', { n: approvals }) : null].filter(Boolean).join(' · ')
    return (
        <>
            <SectionCaption trailing={<InfoTip text={t('taskRun.watch.rules')} align="end" />}>{t('taskRun.watch.title')}</SectionCaption>
            <div className="mx-4 divide-y divide-[var(--social-divider)] overflow-hidden rounded-2xl border border-[var(--social-border)]">
                {summary ? (
                    <p className="flex items-center gap-2 px-4 py-3 text-footnote text-[var(--social-fg-muted)]">
                        {props.live ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[var(--social-success)]" aria-hidden="true" /> : null}
                        {summary}
                    </p>
                ) : null}
                {shown.length === 0 ? (
                    <p className="px-4 py-3 text-body text-[var(--social-fg-muted)]">{t('taskRun.watch.empty')}</p>
                ) : shown.map((entry, index) => (
                    <div key={`${entry.at}-${index}`} className="flex items-start gap-3 px-4 py-3">
                        <span className="w-11 shrink-0 pt-px text-footnote tabular-nums text-[var(--social-fg-subtle)]">{clock(entry.at)}</span>
                        <span className="min-w-0 flex-1 text-body leading-snug text-[var(--social-fg)]">{entry.text}</span>
                        {entry.notified ? <span className="shrink-0 pt-px text-caption text-[var(--social-fg-subtle)]">{t('taskRun.watch.pushed')}</span> : null}
                    </div>
                ))}
                {entries.length > 3 ? (
                    <button type="button" onClick={() => setAll((value) => !value)} className="w-full px-4 py-3 text-left text-footnote font-semibold text-[var(--social-fg-muted)] hover:bg-[var(--social-muted)]">
                        {all ? t('taskRun.watch.less') : t('taskRun.watch.more', { n: entries.length - 3 })}
                    </button>
                ) : null}
            </div>
        </>
    )
}

/** One acceptance check: its state, trailing text, and the subtask responsible for it. */
function checkOf(run: TaskRun, criterion: AcceptanceCriterion, t: Translate): CheckItem & { owner: TaskSubtask | undefined } {
    const owner = workers(run).find((s) => !s.fix && s.criteria.includes(criterion.id))
    const result = run.review?.results.find((r) => r.criterionId === criterion.id)
    if (result?.status === 'met') return { title: criterion.text, state: 'done', trailing: owner?.doneAt ? clock(owner.doneAt) : undefined, owner }
    if (result) return { title: criterion.text, state: 'wait', trailing: t(`taskRun.verdict.${result.status}`), owner }
    if (owner && openDecisionOf(run, owner)) return { title: criterion.text, state: 'wait', waiting: true, owner }
    if (owner?.state === 'done') return { title: criterion.text, state: 'live', trailing: t('taskRun.toReview'), owner }
    if (owner?.state === 'running' || owner?.state === 'stuck') return { title: criterion.text, state: 'live', owner }
    return { title: criterion.text, state: 'todo', owner }
}

/** The details behind one acceptance check: how it is verified, what the review saw, who works on it. */
function CheckSheet(props: { task: TaskView; run: TaskRun; criterion: AcceptanceCriterion | null; onClose: () => void; t: Translate }) {
    const { t, criterion, run } = props
    const navigate = useNavigate()
    const check = criterion ? checkOf(run, criterion, t) : null
    const result = criterion ? run.review?.results.find((r) => r.criterionId === criterion.id) : undefined
    const owner = check?.owner
    const stateLabel = check ? (result ? t(`taskRun.verdict.${result.status}`) : t(`taskRun.check.${check.state}`)) : ''
    return (
        <BottomSheet open={criterion !== null} onOpenChange={(open) => { if (!open) props.onClose() }} title={criterion?.text ?? ''}>
            {criterion && check ? (
                <div className="space-y-4 px-5 pb-6">
                    <p className="flex items-center gap-2 text-body font-semibold text-[var(--social-fg)]">
                        <CheckRing state={check.state} />
                        {stateLabel}
                    </p>
                    {criterion.verify ? (
                        <div>
                            <p className="text-caption font-semibold text-[var(--social-fg-muted)]">{t('taskRun.howVerified')}</p>
                            <p className="mt-1 text-body leading-relaxed text-[var(--social-fg)]">{criterion.verify}</p>
                        </div>
                    ) : null}
                    {result ? (
                        <div>
                            <p className="text-caption font-semibold text-[var(--social-fg-muted)]">{t('taskRun.evidence')}</p>
                            <p className="mt-1 whitespace-pre-line text-body leading-relaxed text-[var(--social-fg)]">{result.evidence}</p>
                        </div>
                    ) : null}
                    {owner ? (
                        <div className="flex items-center gap-3 border-t border-[var(--social-divider)] pt-4">
                            <ProgressOrb seed={owner.sessionId ?? owner.id} size={36} progress={criteriaDone(run, owner).done / criteriaDone(run, owner).total} tone={SUBTASK_TONE[owner.state]} />
                            <span className="min-w-0 flex-1">
                                <FitText kind="title" text={owner.title} className="text-body text-[var(--social-fg)]" />
                                <FitText kind="label" lines={1} text={t(`taskRun.state.${owner.state}`)} className="text-footnote text-[var(--social-fg-muted)]" />
                            </span>
                            {owner.sessionId ? (
                                <Button size="sm" variant="secondary" onClick={() => void navigate({ to: '/sessions/$sessionId', params: { sessionId: owner.sessionId! } })}>{t('taskRun.seeProcess')}</Button>
                            ) : null}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </BottomSheet>
    )
}

/** Open decisions: the first is open, the rest fold to a line each; "Ask" sends a question back to the asker. */
function Decisions(props: { run: TaskRun; decisions: TaskDecision[]; onAnswer: (id: string, label: string) => void; onAsk: (id: string, text: string) => Promise<void>; now: number; t: Translate }) {
    const { t } = props
    const [openId, setOpenId] = useState<string | null>(null)
    const [confirmed, setConfirmed] = useState<string | null>(null)
    if (props.decisions.length === 0) return confirmed ? <div className="mx-4"><DecisionConfirmation label={confirmed} /></div> : null
    const current = props.decisions.find((d) => d.id === openId) ?? props.decisions[0]!
    const toDecision = (d: TaskDecision) => ({
        id: d.id,
        question: d.question,
        context: d.context ?? undefined,
        source: {
            seed: d.askedBy ?? d.id,
            name: props.run.subtasks.find((s) => s.id === d.subtaskId)?.title ?? t('report.composer.lead'),
            meta: t('taskRun.waited', { time: duration(props.now - d.askedAt, t) })
        },
        options: d.options.map((o) => ({ label: o.label, good: o.good ?? '', cost: o.cost ?? '', recommended: o.label === d.recommended })),
        asked: d.asked?.text
    })
    return (
        <div className="mx-4 flex flex-col gap-2">
            {confirmed ? <DecisionConfirmation label={confirmed} /> : null}
            {props.decisions.map((d) => d.id === current.id ? (
                <DecisionCard
                    key={d.id}
                    showSource
                    decision={toDecision(d)}
                    onAnswer={(option) => { setConfirmed(option.label); setOpenId(null); props.onAnswer(d.id, option.label) }}
                    onAsk={(text) => props.onAsk(d.id, text)}
                />
            ) : (
                <DecisionPeek key={d.id} decision={toDecision(d)} onOpen={() => setOpenId(d.id)} />
            ))}
        </div>
    )
}

/** The executor's own summary: three lines, the rest on a tap. */
function Summary(props: { text: string; t: Translate }) {
    const [open, setOpen] = useState(false)
    return (
        <>
            <SectionCaption>{props.t('taskRun.summary')}</SectionCaption>
            <button type="button" onClick={() => setOpen(!open)} className="mx-5 block text-left">
                {open
                    ? <span className="block whitespace-pre-line text-body leading-relaxed text-[var(--social-fg-muted)]">{props.text}</span>
                    : <FitText kind="preview" lines={3} text={props.text} className="whitespace-pre-line text-body leading-relaxed text-[var(--social-fg-muted)]" />}
            </button>
        </>
    )
}

/** One subtask: a big progress ring, its checks, its own decisions, and its session. */
function SubtaskDetail(props: { task: TaskView; run: TaskRun; subtask: TaskSubtask; onBack: () => void; onAnswer: (id: string, label: string) => void; onAsk: (id: string, text: string) => Promise<void>; onRestart?: (subtaskId: string) => Promise<void>; onOpenCheck: (criterion: AcceptanceCriterion) => void; now: number; t: Translate }) {
    const { run, subtask, t } = props
    const navigate = useNavigate()
    const progress = criteriaDone(run, subtask)
    const status = subtask.state === 'done' && subtask.doneAt
        ? { text: t('taskRun.doneAt', { time: clock(subtask.doneAt) }), tone: 'done' as ReportTone }
        : subtaskStatus(run, subtask, props.now, t)
    const criteria = props.task.acceptance.filter((c) => subtask.criteria.includes(c.id))
    const decisions = run.decisions.filter((d) => !d.answer && (d.subtaskId === subtask.id || d.askedBy === subtask.sessionId))
    const used = subtask.startedAt ? duration((subtask.doneAt ?? props.now) - subtask.startedAt, t) : null
    const [restarting, setRestarting] = useState(false)
    // Why it stopped, if HAQI knows: "could not start: …" or the observer's note.
    const why = run.signals.find((s) => s.key.endsWith(`:${subtask.id}`) && (s.kind === 'stopped' || s.kind === 'stuck'))?.text
    const canRestart = Boolean(props.onRestart) && (subtask.state === 'stopped' || subtask.state === 'stuck') && (run.phase === 'running' || subtask.fix)
    return (
        <>
            <button type="button" onClick={props.onBack} className="flex min-h-11 w-full items-center gap-1 px-4 text-left">
                <ChevronLeftIcon className="h-4 w-4 shrink-0 text-[var(--social-fg-muted)]" />
                <span className="min-w-0 flex-1">
                    <FitText kind="title" text={subtask.title} className="text-body font-semibold text-[var(--social-fg)]" />
                    {used ? <span className="block text-caption text-[var(--social-fg-muted)]">{t('taskRun.used', { time: used })}{subtask.branch ? ` · ${subtask.branch}` : ''}</span> : null}
                </span>
            </button>
            <div className="flex flex-col items-center px-5 pb-2 pt-6">
                <ProgressOrb seed={subtask.sessionId ?? subtask.id} size={120} progress={progress.done / progress.total} tone={status.tone} />
                <p className="mt-4 text-[2.5rem] font-semibold leading-none tabular-nums text-[var(--social-fg)]">
                    {progress.done}<span className="text-[var(--social-fg-subtle)]"> / {progress.total}</span>
                </p>
                <p className="mt-3 flex items-center gap-2 text-body text-[var(--social-fg-muted)]">
                    {status.tone === 'live' ? <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--social-badge)]" aria-hidden="true" /> : null}
                    <span className={status.tone === 'wait' || status.tone === 'stuck' ? 'text-[var(--app-badge-warning-text)]' : undefined}>{status.text}</span>
                </p>
            </div>
            {criteria.length > 0 ? (
                <div className="mx-4 mt-4">
                    <Checklist items={criteria.map((c) => ({ ...checkOf(run, c, t), onClick: () => props.onOpenCheck(c) }))} />
                </div>
            ) : null}
            {decisions.length > 0 ? (
                <>
                    <SectionCaption>{t('taskReport.waiting')}</SectionCaption>
                    <Decisions run={run} decisions={decisions} onAnswer={props.onAnswer} onAsk={props.onAsk} now={props.now} t={t} />
                </>
            ) : null}
            {subtask.summary ? <Summary text={subtask.summary} t={t} /> : null}
            {canRestart && why ? <p className="mx-5 mt-4 text-footnote text-[var(--app-badge-warning-text)]">{why}</p> : null}
            {canRestart || subtask.sessionId ? (
                <div className="mx-4 mt-6 flex justify-center gap-2">
                    {subtask.sessionId ? (
                        <Button variant="secondary" onClick={() => void navigate({ to: '/sessions/$sessionId', params: { sessionId: subtask.sessionId! } })}>{t('taskRun.seeProcess')}</Button>
                    ) : null}
                    {canRestart ? (
                        <Button
                            disabled={restarting}
                            onClick={() => {
                                setRestarting(true)
                                void props.onRestart!(subtask.id).finally(() => setRestarting(false))
                            }}
                        >
                            {restarting ? t('taskRun.restarting') : t('taskRun.restart')}
                        </Button>
                    ) : null}
                </div>
            ) : null}
        </>
    )
}

/** Every subtask that started, as a row on the task's shared time axis (minutes before now). */
function timelineAgents(run: TaskRun, now: number, t: Translate): { agents: TimelineAgent[]; window: number } {
    const started = workers(run).filter((s) => s.startedAt)
    const earliest = started.reduce((min, s) => Math.min(min, s.startedAt!), now)
    const span = Math.max(10, Math.ceil((now - earliest) / 60_000 / 10) * 10)
    const agents = started.map((s): TimelineAgent => {
        const status = subtaskStatus(run, s, now, t)
        const waiting = Boolean(openDecisionOf(run, s) || s.live?.waiting)
        const state: TimelineSpan['state'] = s.state === 'done' ? 'done' : s.state === 'stuck' || s.state === 'stopped' ? 'stuck' : waiting ? 'wait' : 'live'
        const progress = criteriaDone(run, s)
        return {
            id: s.id,
            seed: s.sessionId ?? s.id,
            name: s.title,
            tone: status.tone,
            progress: progress.total > 0 ? progress.done / progress.total : 0,
            spans: [{ from: (s.startedAt! - now) / 60_000, to: s.doneAt ? (s.doneAt - now) / 60_000 : 0, state, label: s.state === 'done' && s.doneAt ? duration(s.doneAt - s.startedAt!, t) : status.text }]
        }
    })
    return { agents, window: span }
}

function runHeadline(task: TaskView, run: TaskRun, t: Translate): string {
    const open = run.decisions.filter((d) => !d.answer).length
    const list = workers(run).filter((s) => !s.fix)
    const done = list.filter((s) => s.state === 'done').length
    const waiting = open > 0 ? t('taskRun.waitingYou', { n: open }) : ''
    switch (run.phase) {
        case 'planning': return t('taskRun.planning') + waiting
        case 'running': return t('taskRun.running', { n: list.length, done }) + waiting
        case 'integrating': return t('taskRun.integrating') + waiting
        case 'reviewing': return t('taskRun.reviewing') + waiting
        case 'fixing': {
            // A fix the user asked for at the report is not a failed review.
            const asked = run.revisions?.at(-1)
            if (asked?.fixId && run.subtasks.some((s) => s.id === asked.fixId && s.state !== 'done')) return t('taskRun.revision.working') + waiting
            return t('taskRun.fixing', { n: run.review?.results.filter((r) => r.status === 'not_met').length ?? 0 }) + waiting
        }
        case 'delivering': return t('taskRun.delivering') + waiting
        case 'reporting': return run.report?.conclusion ?? t('taskRun.reporting')
        case 'accepted': return run.report?.conclusion ?? task.goal ?? task.name
    }
}

/**
 * The task after the guide step, following the report prototype: one sentence and three numbers on top, what waits
 * for the user, every subtask as one progress row, the risks, and the acceptance checks; a subtask opens its own
 * page, a check opens its details. With a report it is the finished report: conclusion, numbers, checks, risks.
 */
export function RunReport(props: {
    task: TaskView
    run: TaskRun
    onAnswer: (decisionId: string, label: string) => void
    onAsk: (id: string, text: string) => Promise<void>
    /** Starts a stopped subtask again. */
    onRestart?: (subtaskId: string) => Promise<void>
    /** While the verdict buttons replace the composer, the way into the conversation sits here. */
    onAllChats?: () => void
}) {
    const { task, run } = props
    const { t } = useTranslation()
    const navigate = useNavigate()
    const [subtaskId, setSubtaskId] = useState<string | null>(null)
    const [checkId, setCheckId] = useState<string | null>(null)
    const [reportOpen, setReportOpen] = useState(false)
    const [storiesOpen, setStoriesOpen] = useState(false)
    // One stable callback: an inline one runs on every re-render (data refresh) and pulls the page back to the top.
    const scrollToTop = useCallback((el: HTMLSpanElement | null) => el?.scrollIntoView({ block: 'start' }), [])
    const now = Date.now()
    const startedAt = run.subtasks.reduce((min, s) => Math.min(min, s.startedAt ?? min), task.updatedAt)
    const open = run.decisions.filter((d) => !d.answer)
    const answered = run.decisions.filter((d) => d.answer)
    const stuck = workers(run).filter((s) => s.state === 'stuck' || s.state === 'stopped').length
    const finished = run.phase === 'reporting' || run.phase === 'accepted'
    const results = run.review?.results ?? []
    const met = results.filter((r) => r.status === 'met').length
    const fixes = run.subtasks.filter((s) => s.fix && s.id !== 'merge').length
    const risks = [
        ...(finished ? results.filter((r) => r.status !== 'met').map((r) => `${task.acceptance.find((c) => c.id === r.criterionId)?.text ?? r.criterionId}：${r.evidence}`) : []),
        ...run.signals.filter((s) => s.kind !== 'reminded' && (!finished || s.kind === 'danger')).map((s) => s.text)
    ]
    const stats: ReportStat[] = finished
        ? [
            { value: `${met}/${task.acceptance.length}`, label: t('taskRun.stat.met') },
            { value: String(fixes), label: t('taskRun.stat.fixes') },
            { value: duration(((run.report?.at ?? now) - startedAt), t), label: t('taskRun.stat.used') }
        ]
        : [
            { value: duration(now - startedAt, t), label: t('taskRun.stat.used') },
            { value: t('taskRun.count', { n: stuck }), label: t('taskRun.stat.stuck') },
            { value: t('taskRun.count', { n: open.length }), label: t('taskRun.stat.waiting') }
        ]
    const meta = [task.tag ? `#${task.tag}` : null, task.repoPath?.split('/').filter(Boolean).pop(), task.machineName, run.integration?.branch].filter(Boolean).join(' · ')
    const subtask = subtaskId ? run.subtasks.find((s) => s.id === subtaskId) ?? null : null
    // What the lead handed over leads the page, newest version only; it is stale once the user asks for a change.
    const lastRevision = run.revisions?.at(-1) ?? null
    const delivery = run.delivery && (!lastRevision || run.delivery.at > lastRevision.at) ? run.delivery : null
    // A change the user asked for and the lead has not handed over yet: the user's words, and the fixer's account
    // only if no hand-over is coming (HAQI's report went out instead).
    const revision = delivery || run.phase === 'accepted' ? null : lastRevision
    const check = checkId ? task.acceptance.find((c) => c.id === checkId) ?? null : null
    const sheet = (
        <>
            <CheckSheet task={task} run={run} criterion={check} onClose={() => setCheckId(null)} t={t} />
            {run.report ? <ReportSheet open={reportOpen} onOpenChange={setReportOpen} title={task.name} markdown={run.report.markdown} shareUrl={run.report.shareUrl} /> : null}
        </>
    )

    if (subtask) {
        return (
            <>
                {/* Keyed by subtask: the page jumps to the top once when a subtask opens, not on each refresh. */}
                <span key={subtask.id} ref={scrollToTop} aria-hidden="true" />
                <SubtaskDetail task={task} run={run} subtask={subtask} now={now} t={t} onBack={() => setSubtaskId(null)} onAnswer={props.onAnswer} onAsk={props.onAsk} onRestart={props.onRestart} onOpenCheck={(c) => setCheckId(c.id)} />
                {sheet}
            </>
        )
    }

    const items: ProgressItem[] = workers(run).map((s) => {
        const status = subtaskStatus(run, s, now, t)
        const progress = criteriaDone(run, s)
        return {
            id: s.id, seed: s.sessionId ?? s.id, name: s.title, status: status.text, tone: status.tone, done: progress.done, total: progress.total,
            when: s.doneAt ? clock(s.doneAt) : undefined, unread: s.state === 'done' && run.phase === 'reporting'
        }
    })
    // The lead leads the list; opening it shows its conversation, like a subtask's "See process".
    if (task.leadSessionId && !finished) {
        items.unshift({
            id: 'lead', seed: task.leadSessionId, name: t('report.composer.lead'),
            status: t(`taskRun.lead.${run.phase}`), tone: 'live',
            done: workers(run).filter((s) => s.state === 'done').length, total: workers(run).length
        })
    }
    const openProgress = (item: ProgressItem) => {
        if (item.id === 'lead' && task.leadSessionId) void navigate({ to: '/sessions/$sessionId', params: { sessionId: task.leadSessionId } })
        else setSubtaskId(item.id)
    }
    const timeline = finished ? null : timelineAgents(run, now, t)
    const toDecisions = () => document.getElementById('task-decisions')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    // The same report as a few cards, one idea each, for a quick look on a phone.
    const stories = [
        { id: 'result', label: t('taskRun.story.result'), content: <div className="flex flex-col gap-4"><p className="m-0 text-title font-semibold leading-snug text-[var(--social-fg)]">{runHeadline(task, run, t)}</p><StatTiles stats={stats} /></div> },
        ...(open.length > 0 ? [{ id: 'waiting', label: t('taskReport.waiting'), content: <Decisions run={run} decisions={open} onAnswer={props.onAnswer} onAsk={props.onAsk} now={now} t={t} /> }] : []),
        ...(timeline && timeline.agents.length > 0 ? [{ id: 'progress', label: t('taskRun.progress'), content: <AgentTimeline agents={timeline.agents} window={timeline.window} /> }] : items.length > 0 ? [{ id: 'progress', label: t('taskRun.progress'), content: <ProgressList items={items} onOpen={() => {}} /> }] : []),
        ...(risks.length > 0 ? [{ id: 'risks', label: t('taskRun.risks'), content: <RiskNotice risks={risks} /> }] : []),
        { id: 'checks', label: t('taskGuide.criteria'), content: <Checklist items={task.acceptance.map((c) => checkOf(run, c, t))} /> }
    ]

    return (
        <>
            <ReportSummary headline={runHeadline(task, run, t)} lede={finished ? task.goal ?? undefined : undefined} stats={stats} />
            {meta || run.report ? (
                <p className="mx-5 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-[var(--social-fg-muted)]">
                    {meta ? <span>{meta}</span> : null}
                    {run.report ? (
                        <button type="button" onClick={() => setReportOpen(true)} className="font-semibold text-[var(--social-fg)] underline underline-offset-4">{t('taskRun.fullReport')}</button>
                    ) : null}
                    {props.onAllChats ? (
                        <button type="button" onClick={props.onAllChats} className="font-semibold text-[var(--social-fg)] underline underline-offset-4">{t('report.composer.allChats')}</button>
                    ) : null}
                </p>
            ) : null}
            <div className="mx-4 mt-3 sm:hidden">
                <Button variant="secondary" size="sm" className="w-full" onClick={() => setStoriesOpen(true)}>{t('taskRun.story.open')}</Button>
            </div>
            {storiesOpen ? (
                <div className="fixed inset-0 z-50 bg-[var(--social-surface)] pt-[env(safe-area-inset-top)]">
                    <StoryCards title={task.name} seed={task.leadSessionId ?? task.id} stories={stories} onClose={() => setStoriesOpen(false)} />
                </div>
            ) : null}

            {delivery && delivery.body ? (
                <>
                    <SectionCaption>{t('taskRun.delivery')}</SectionCaption>
                    {delivery.details ? (
                        // One line / key points / everything: the lead's conclusion, its body, and the folded details.
                        <ReportDetailProvider initial="points">
                            <div className="mx-4 flex flex-col gap-3 rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)] p-4">
                                <DetailSwitch />
                                <p className="m-0 text-body font-semibold text-[var(--social-fg)]">{delivery.conclusion}</p>
                                <AtDetail from="points"><BriefFullMarkdownContent content={reportMarkdownForApp(delivery.body)} className="text-body [&>*:first-child]:!mt-0" /></AtDetail>
                                <AtDetail from="full"><BriefFullMarkdownContent content={reportMarkdownForApp(delivery.details)} className="border-t border-[var(--social-divider)] pt-3 text-body [&>*:first-child]:!mt-0" /></AtDetail>
                            </div>
                        </ReportDetailProvider>
                    ) : (
                        <div className="mx-4 rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)] p-4">
                            <BriefFullMarkdownContent content={reportMarkdownForApp(delivery.body)} className="text-body [&>*:first-child]:!mt-0" />
                        </div>
                    )}
                </>
            ) : revision ? (
                <>
                    <SectionCaption>{run.phase === 'reporting' && revision.summary ? t('taskRun.revision.done') : t('taskRun.revision.working')}</SectionCaption>
                    <div className="mx-4 rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)] p-4">
                        <p className="text-footnote text-[var(--social-fg-muted)]">{t('taskRun.revision.request', { text: revision.request })}</p>
                        {run.phase === 'reporting' && revision.summary ? (
                            <BriefFullMarkdownContent content={reportMarkdownForApp(revision.summary)} className="mt-2 text-body" />
                        ) : null}
                    </div>
                </>
            ) : null}

            {open.length > 0 ? (
                <>
                    <span id="task-decisions" className="block scroll-mt-16" aria-hidden="true" />
                    <SectionCaption>{t('taskReport.waiting')}</SectionCaption>
                    <Decisions run={run} decisions={open} onAnswer={props.onAnswer} onAsk={props.onAsk} now={now} t={t} />
                </>
            ) : null}

            {finished ? null : items.length > 0 ? (
                <>
                    <SectionCaption>{t('taskRun.progress')}</SectionCaption>
                    {timeline && timeline.agents.length > 0 ? (
                        <div className="mx-4 mb-3">
                            <AgentTimeline agents={timeline.agents} window={timeline.window} onDecide={toDecisions} onOpen={(agent) => setSubtaskId(agent.id)} />
                        </div>
                    ) : null}
                    <div className="mx-4"><ProgressList items={items} onOpen={openProgress} /></div>
                </>
            ) : null}

            <SectionCaption trailing={finished ? undefined : <InfoTip text={t('taskRun.checksHint')} align="end" />}>{t('taskGuide.criteria')}</SectionCaption>
            <div className="mx-4">
                <Checklist items={task.acceptance.map((c) => ({ ...checkOf(run, c, t), onClick: () => setCheckId(c.id) }))} />
            </div>

            {risks.length > 0 ? (
                <>
                    <SectionCaption>{t('taskRun.risks')}</SectionCaption>
                    <div className="mx-4"><RiskNotice risks={risks} /></div>
                </>
            ) : null}

            {!finished || (run.watch?.log.length ?? 0) > 0 ? <WatchLog run={run} live={!finished} now={now} t={t} /> : null}

            {finished && items.length > 0 ? (
                <>
                    <SectionCaption>{t('taskRun.progress')}</SectionCaption>
                    <div className="mx-4"><ProgressList items={items} onOpen={openProgress} /></div>
                </>
            ) : null}

            {answered.length > 0 ? (
                <>
                    <SectionCaption>{t('taskRun.decided')}</SectionCaption>
                    <div className="mx-4 divide-y divide-[var(--social-divider)] overflow-hidden rounded-2xl border border-[var(--social-border)]">
                        {answered.map((d) => (
                            <div key={d.id} className="flex min-h-[52px] items-center gap-3 px-4 py-3">
                                <span className="min-w-0 flex-1 text-body text-[var(--social-fg)]">{d.question} → {d.answer!.label}</span>
                                <span className="shrink-0 text-footnote text-[var(--social-fg-subtle)]">{d.answer!.by === 'precedent' ? t('taskRun.byPrecedent') : t('taskRun.byYou')}</span>
                            </div>
                        ))}
                    </div>
                </>
            ) : null}
            {sheet}
        </>
    )
}
