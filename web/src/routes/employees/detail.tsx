import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { LoadingState } from '@/components/LoadingState'
import { formatRelativeTime } from '@/components/SessionList'
import { getMachineTitle } from '@/components/NewSession/MachineSelector'
import { DesktopPaneHeader } from '@/components/mobile/DesktopPaneHeader'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/Chip'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { FeedRow } from '@/components/ui/FeedRow'
import { FitText } from '@/components/ui/FitText'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { Switch } from '@/components/ui/Switch'
import { TextField } from '@/components/ui/TextField'
import { useEmployeeActions } from '@/hooks/mutations/useEmployeeActions'
import { useEmployee, useEmployeeMemory, useEmployeeMetrics, useEmployeeReviews } from '@/hooks/queries/useEmployees'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSessions } from '@/hooks/queries/useSessions'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { useAppContext } from '@/lib/app-context'
import { apiErrorText } from '@/lib/schedules'
import { getSessionTitle } from '@/lib/session-title'
import { useTranslation } from '@/lib/use-translation'
import type { Employee, EmployeeIssue, EmployeeMetrics } from '@/types/api'

/** A label on the left, its value on the right; long values (paths) wrap under the label. */
function InfoRow(props: { label: string; value: ReactNode; long?: boolean }) {
    if (props.long) {
        return <ListRow wrap title={props.label} subtitle={<span className="break-all">{props.value}</span>} />
    }
    const trailing = typeof props.value === 'string'
        ? <FitText kind="value" text={props.value} className="max-w-[55vw] text-right sm:max-w-sm" />
        : <span className="block max-w-[55vw] text-right sm:max-w-sm">{props.value}</span>
    return <ListRow title={props.label} trailing={trailing} />
}

const SECTIONS = ['overview', 'memory', 'performance', 'sessions'] as const
type Section = typeof SECTIONS[number]

/** 概览: the switch, the settings and the delete; the other sections live in their own components below. */
function OverviewSection(props: {
    employee: Employee
    openIssues: EmployeeIssue[]
    machineName: string
    updatePending: boolean
    onToggle: (active: boolean) => void
    onDelete: () => void
}) {
    const { t, locale } = useTranslation()
    const { employee, openIssues } = props
    return (
        <>
            <ListGroup>
                <ListRow
                    title={t('employees.detail.active')}
                    subtitle={t(`employees.status.${employee.status}`)}
                    trailing={(
                        <Switch
                            checked={employee.status === 'active'}
                            disabled={props.updatePending || employee.status === 'retired'}
                            onCheckedChange={props.onToggle}
                            ariaLabel={t('employees.detail.active')}
                        />
                    )}
                />
            </ListGroup>

            <ListGroup title={t('employees.detail.settings')}>
                <InfoRow label={t('newSession.machine')} value={props.machineName} />
                <InfoRow label={t('employees.form.directory')} value={employee.directory} long />
                <InfoRow label={t('employees.form.agent')} value={<span className="capitalize">{employee.agent}</span>} />
                <InfoRow label={t('employees.detail.home')} value={employee.homePath} long />
                <InfoRow label={t('employees.detail.timezone')} value={employee.timezone} />
            </ListGroup>

            <ListGroup title={t('employees.detail.issues', { n: openIssues.length })}>
                {openIssues.length === 0 ? (
                    <ListRow title={t('employees.detail.noIssues')} />
                ) : openIssues.map((issue) => (
                    <ListRow
                        key={issue.id}
                        wrap
                        title={issue.text}
                        subtitle={t('employees.detail.issueMeta', {
                            when: new Date(issue.firstSeen).toLocaleDateString(locale),
                            n: issue.seenCount
                        })}
                    />
                ))}
            </ListGroup>

            <ListGroup>
                <ListRow
                    title={<span className="text-[var(--social-danger)]">{t('employees.detail.delete')}</span>}
                    onClick={props.onDelete}
                />
            </ListGroup>
        </>
    )
}

/** 记忆: the MEMORY.md snapshot, the employee's own memory rows, and the file actions. */
function MemorySection(props: {
    employee: Employee
    busy: boolean
    onGenerate: () => void
    onSync: () => void
    onMaintain: () => void
}) {
    const { api } = useAppContext()
    const { t, locale } = useTranslation()
    const { view, memories, isLoading, error } = useEmployeeMemory(api, props.employee.id)

    const active = memories.filter((memory) => memory.status !== 'archived')

    return (
        <>
            <ListGroup title={t('employees.detail.memory')}>
                <div className="flex flex-wrap gap-2 px-3 py-3">
                    <Button variant="secondary" disabled={props.busy} onClick={props.onGenerate}>{t('employees.detail.generateMemory')}</Button>
                    <Button variant="secondary" disabled={props.busy} onClick={props.onSync}>{t('employees.detail.syncMemory')}</Button>
                    <Button variant="secondary" disabled={props.busy} onClick={props.onMaintain}>{t('employees.detail.maintain')}</Button>
                </div>
            </ListGroup>

            {isLoading ? (
                <LoadingState className="flex w-full justify-center py-10" />
            ) : error ? (
                <EmptyState variant="inline" title={t('employees.detail.memoryLoadFailed')} subtitle={error} />
            ) : (
                <>
                    <ListGroup title={t('employees.detail.memoryView')}>
                        {view ? (
                            <div className="px-4 py-3">
                                <p className="pb-2 text-caption text-[var(--social-fg-muted)]">
                                    {t('employees.detail.memoryViewAt', { when: new Date(view.generatedAt).toLocaleString(locale) })}
                                </p>
                                <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-xl bg-[var(--social-muted)] p-3 text-footnote leading-relaxed text-[var(--social-fg)]">
                                    {view.content}
                                </pre>
                            </div>
                        ) : (
                            <ListRow title={t('employees.detail.memoryViewEmpty')} />
                        )}
                    </ListGroup>

                    <ListGroup title={t('employees.detail.memories', { n: active.length })}>
                        {active.length === 0 ? (
                            <ListRow title={t('employees.detail.noMemories')} />
                        ) : active.map((memory) => (
                            <ListRow
                                key={memory.id}
                                wrap
                                title={memory.text}
                                subtitle={[
                                    t(`memoryPage.level.${memory.level}`),
                                    memory.pinned ? t('employees.detail.memoryPinned') : null,
                                    new Date(memory.updatedAt).toLocaleDateString(locale)
                                ].filter(Boolean).join(' · ')}
                            />
                        ))}
                    </ListGroup>
                </>
            )}
        </>
    )
}

/** One metric line: the label left, the numbers right. */
function MetricRow(props: { label: string; value: string }) {
    return <ListRow title={props.label} trailing={<span className="text-right text-[var(--social-fg-muted)]">{props.value}</span>} />
}

function metricRows(metrics: EmployeeMetrics, t: (key: string, params?: Record<string, string | number>) => string): Array<{ label: string; value: string }> {
    return [
        { label: t('employees.detail.metric.runs'), value: t('employees.detail.metric.runsValue', { ok: metrics.scheduledRuns.succeeded, total: metrics.scheduledRuns.total }) },
        { label: t('employees.detail.metric.loops'), value: t('employees.detail.metric.loopsValue', { ok: metrics.reviews.accepted, total: metrics.reviews.closed }) },
        { label: t('employees.detail.metric.decisions'), value: t('employees.detail.metric.decisionsValue', { auto: metrics.decisions.byPrecedent, total: metrics.decisions.answered }) },
        { label: t('employees.detail.metric.guard'), value: t('employees.detail.metric.guardValue', { warn: metrics.guard.warnings, alert: metrics.guard.alerts }) },
        { label: t('employees.detail.metric.issues'), value: t('employees.detail.metric.issuesValue', { opened: metrics.issues.opened, closed: metrics.issues.closed, open: metrics.issues.open }) },
        { label: t('employees.detail.metric.corrections'), value: t('employees.detail.metric.correctionsValue', { n: metrics.corrections.count }) }
    ]
}

/** The 1-5 chips, the comment and the submit of one unscored review. */
function ReviewScoreForm(props: { pending: boolean; onSubmit: (score: number, comment: string) => void }) {
    const { t } = useTranslation()
    const [score, setScore] = useState<number | null>(null)
    const [comment, setComment] = useState('')
    const needsComment = score !== null && score <= 2 && !comment.trim()
    return (
        <div className="flex flex-col gap-2 px-4 pb-3">
            <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((value) => (
                    <Chip key={value} selected={score === value} onClick={() => setScore(value)}>{String(value)}</Chip>
                ))}
            </div>
            <TextField
                value={comment}
                placeholder={t('employees.detail.reviewCommentPlaceholder')}
                onChange={(event) => setComment(event.target.value)}
            />
            <Button
                className="self-start"
                disabled={props.pending || score === null || needsComment}
                onClick={() => { if (score !== null) props.onSubmit(score, comment.trim()) }}
            >
                {t('employees.detail.reviewSubmit')}
            </Button>
        </div>
    )
}

/** 绩效: the last 7 days' numbers and the weekly reviews with their scores. */
function PerformanceSection(props: { employee: Employee; onError: (err: unknown) => void }) {
    const { api } = useAppContext()
    const { t, locale } = useTranslation()
    const { metrics, isLoading: metricsLoading, error: metricsError } = useEmployeeMetrics(api, props.employee.id)
    const { reviews, isLoading: reviewsLoading, error: reviewsError } = useEmployeeReviews(api, props.employee.id)
    const { generateReview, scoreReview } = useEmployeeActions(api)

    const day = (value: number) => new Date(value).toLocaleDateString(locale)

    return (
        <>
            <ListGroup title={t('employees.detail.metrics')}>
                {metricsLoading ? (
                    <LoadingState className="flex w-full justify-center py-6" />
                ) : metricsError || !metrics ? (
                    <ListRow title={t('employees.detail.metricsFailed')} subtitle={metricsError ?? undefined} />
                ) : (
                    metricRows(metrics, t).map((row) => <MetricRow key={row.label} label={row.label} value={row.value} />)
                )}
            </ListGroup>

            <ListGroup title={t('employees.detail.reviews', { n: reviews.length })}>
                <div className="px-3 py-3">
                    <Button
                        variant="secondary"
                        disabled={generateReview.isPending}
                        onClick={() => generateReview.mutate(props.employee.id, { onError: props.onError })}
                    >
                        {generateReview.isPending ? t('employees.detail.generatingReview') : t('employees.detail.generateReview')}
                    </Button>
                </div>
                {reviewsLoading ? (
                    <LoadingState className="flex w-full justify-center py-6" />
                ) : reviewsError ? (
                    <ListRow title={t('employees.detail.reviewsFailed')} subtitle={reviewsError} />
                ) : reviews.length === 0 ? (
                    <ListRow title={t('employees.detail.noReviews')} />
                ) : reviews.map((review) => (
                    <div key={review.id}>
                        <ListRow
                            wrap
                            title={t('employees.detail.reviewPeriod', { from: day(review.periodStart), to: day(review.periodEnd) })}
                            subtitle={review.score !== null
                                ? [t('employees.detail.reviewScored', { score: review.score }), review.comment].filter(Boolean).join(' · ')
                                : t('employees.detail.reviewUnscored')}
                            trailing={review.score !== null ? <Badge>{`${review.score} / 5`}</Badge> : null}
                        />
                        {review.lesson ? (
                            <p className="px-4 pb-2 text-footnote text-[var(--social-danger)]">
                                {t('employees.detail.reviewLesson')}: {review.lesson}
                            </p>
                        ) : null}
                        {review.score === null ? (
                            <ReviewScoreForm
                                pending={scoreReview.isPending}
                                onSubmit={(score, comment) => scoreReview.mutate(
                                    { id: props.employee.id, reviewId: review.id, score, ...(comment ? { comment } : {}) },
                                    { onError: props.onError }
                                )}
                            />
                        ) : null}
                    </div>
                ))}
            </ListGroup>
        </>
    )
}

/** 会话: every session spawned for this employee (the main one and the scheduled runs), newest first. */
function SessionsSection(props: { employee: Employee }) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { sessions, isLoading } = useSessions(api)

    const own = sessions
        .filter((session) => session.metadata?.employeeId === props.employee.id)
        .sort((a, b) => b.updatedAt - a.updatedAt)

    return (
        <ListGroup title={t('employees.detail.sessions', { n: own.length })}>
            {isLoading ? (
                <LoadingState className="flex w-full justify-center py-6" />
            ) : own.length === 0 ? (
                <ListRow title={t('employees.detail.noSessions')} />
            ) : own.map((session) => (
                <FeedRow
                    key={session.id}
                    title={getSessionTitle(session)}
                    aside={formatRelativeTime(session.updatedAt, t) ?? undefined}
                    status={(
                        <>
                            {session.id === props.employee.mainSessionId ? <Badge>{t('employees.detail.mainSession')}</Badge> : null}
                            {session.active ? <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--social-success,#34c759)]" aria-label={t('employees.detail.sessionActive')} /> : null}
                        </>
                    )}
                    subtitle={session.metadata?.path}
                    onClick={() => navigate({ to: '/sessions/$sessionId', params: { sessionId: session.id } })}
                />
            ))}
        </ListGroup>
    )
}

export default function EmployeeDetailPage() {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { employeeId } = useParams({ from: '/employees/$employeeId' })
    const { employee, openIssues, isLoading, error } = useEmployee(api, employeeId)
    const { machines } = useMachines(api, true)
    const { update, remove, wake, generateMemory, syncMemory, maintain } = useEmployeeActions(api)
    const [wakeText, setWakeText] = useState('')
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)
    const [section, setSection] = useState<Section>('overview')

    const goBack = () => navigate({ to: '/employees' })
    const isMobile = useIsMobileLayout()

    if (!employee) {
        return (
            <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
                {isMobile ? <SubPageHeader title={t('employees.title')} onBack={goBack} /> : <DesktopPaneHeader title={t('employees.title')} />}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {isLoading ? (
                        <LoadingState className="flex w-full justify-center py-16" />
                    ) : (
                        <EmptyState
                            variant="page"
                            title={error ? t('employees.loadFailed') : t('employees.detail.notFound')}
                            subtitle={error ?? undefined}
                            action={{ label: t('employees.detail.backToList'), onClick: goBack }}
                        />
                    )}
                </div>
            </div>
        )
    }

    const name = `${employee.emoji ? `${employee.emoji} ` : ''}${employee.name}`
    const machine = machines.find((item) => item.id === employee.machineId)
    const machineName = machine ? getMachineTitle(machine) : employee.machineId.slice(0, 8)

    const report = (text: string) => setNotice(text)
    const fail = (err: unknown) => setNotice(`${t('employees.detail.actionFailed')}: ${apiErrorText(err)}`)

    const handleWake = () => {
        setNotice(null)
        wake.mutate({ id: employee.id, ...(wakeText.trim() ? { text: wakeText.trim() } : {}) }, {
            onSuccess: (result) => {
                setWakeText('')
                report(t(`employees.detail.wake.${result.outcome}`))
                navigate({ to: '/sessions/$sessionId', params: { sessionId: result.sessionId } })
            },
            onError: fail
        })
    }
    const handleToggle = (active: boolean) => {
        setNotice(null)
        update.mutate({ id: employee.id, patch: { status: active ? 'active' : 'paused' } }, { onError: fail })
    }

    const memoryBusy = generateMemory.isPending || syncMemory.isPending || maintain.isPending

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
            {isMobile ? (
                <SubPageHeader title={name} subtitle={employee.directory} onBack={goBack} />
            ) : (
                <DesktopPaneHeader title={name} subtitle={employee.directory} />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content px-4 pb-10 pt-4">
                    <div className="flex flex-col gap-5">
                        <div className="flex flex-col gap-2">
                            <TextField
                                value={wakeText}
                                placeholder={t('employees.detail.wakePlaceholder')}
                                onChange={(event) => setWakeText(event.target.value)}
                            />
                            <div className="flex gap-2">
                                <Button className="flex-1 sm:flex-none" onClick={handleWake} disabled={wake.isPending || employee.status !== 'active'}>
                                    {wake.isPending ? t('employees.detail.waking') : t('employees.detail.wakeNow')}
                                </Button>
                                {employee.mainSessionId ? (
                                    <Button variant="secondary" onClick={() => navigate({ to: '/sessions/$sessionId', params: { sessionId: employee.mainSessionId! } })}>
                                        {t('employees.detail.openMainSession')}
                                    </Button>
                                ) : null}
                            </div>
                            {notice ? <p role="status" className="px-1 text-footnote text-[var(--social-fg-muted)]">{notice}</p> : null}
                        </div>

                        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('employees.title')}>
                            {SECTIONS.map((key) => (
                                <Chip key={key} role="tab" aria-selected={section === key} selected={section === key} onClick={() => setSection(key)}>
                                    {t(`employees.detail.section.${key}`)}
                                </Chip>
                            ))}
                        </div>

                        {section === 'overview' ? (
                            <OverviewSection
                                employee={employee}
                                openIssues={openIssues}
                                machineName={machineName}
                                updatePending={update.isPending}
                                onToggle={handleToggle}
                                onDelete={() => setDeleteOpen(true)}
                            />
                        ) : section === 'memory' ? (
                            <MemorySection
                                employee={employee}
                                busy={memoryBusy}
                                onGenerate={() => {
                                    setNotice(null)
                                    generateMemory.mutate(employee.id, { onSuccess: () => report(t('employees.detail.memoryGenerated')), onError: fail })
                                }}
                                onSync={() => {
                                    setNotice(null)
                                    syncMemory.mutate(employee.id, { onSuccess: (result) => report(t('employees.detail.memorySynced', { state: result.state })), onError: fail })
                                }}
                                onMaintain={() => {
                                    setNotice(null)
                                    maintain.mutate(employee.id, { onSuccess: () => report(t('employees.detail.maintained')), onError: fail })
                                }}
                            />
                        ) : section === 'performance' ? (
                            <PerformanceSection employee={employee} onError={fail} />
                        ) : (
                            <SessionsSection employee={employee} />
                        )}
                    </div>
                </div>
            </div>
            <ConfirmDialog
                isOpen={deleteOpen}
                title={t('employees.detail.deleteTitle', { name: employee.name })}
                description={t('employees.detail.deleteBody')}
                confirmLabel={t('employees.detail.delete')}
                confirmingLabel={t('employees.detail.delete')}
                isPending={remove.isPending}
                destructive
                onConfirm={async () => {
                    await remove.mutateAsync(employee.id)
                    goBack()
                }}
                onClose={() => setDeleteOpen(false)}
            />
        </div>
    )
}
