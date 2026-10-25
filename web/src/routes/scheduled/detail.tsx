import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { describeSpec } from '@hapi/protocol/schedules'
import type { ScheduledRun, ScheduledTask, ScheduledTaskInput } from '@/types/api'
import { LoadingState } from '@/components/LoadingState'
import { getMachineTitle } from '@/components/NewSession/MachineSelector'
import { ChevronRightIcon, ExternalLinkIcon } from '@/components/mobile/icons'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { DesktopPaneHeader } from '@/components/mobile/DesktopPaneHeader'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'
import { RunStatusBadge, RunTriggerBadge } from '@/components/scheduled/RunBadges'
import { ScheduleFormDialog } from '@/components/scheduled/ScheduleFormDialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { Switch } from '@/components/ui/Switch'
import { useScheduleActions } from '@/hooks/mutations/useScheduleActions'
import { useMachines } from '@/hooks/queries/useMachines'
import { useClaudeAccountPool, useSchedule } from '@/hooks/queries/useSchedules'
import { useMinuteClock } from '@/hooks/useMinuteClock'
import { useAppContext } from '@/lib/app-context'
import { apiErrorText, formatDuration, formatScheduleTime, formatUntil } from '@/lib/schedules'
import { useTranslation } from '@/lib/use-translation'

/** A label on the left, its value on the right; long values (paths) wrap under the label. */
function InfoRow(props: { label: string; value: ReactNode; long?: boolean }) {
    if (props.long) {
        return <ListRow wrap title={props.label} subtitle={<span className="break-all">{props.value}</span>} />
    }
    return <ListRow title={props.label} trailing={<span className="block max-w-[55vw] truncate text-right sm:max-w-sm">{props.value}</span>} />
}

function linkLabel(url: string): string {
    try {
        const parsed = new URL(url)
        return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`
    } catch {
        return url
    }
}

function RunRow(props: { run: ScheduledRun; accountEmail: string | null; onOpenSession: (sessionId: string) => void }) {
    const { t, locale } = useTranslation()
    const { run } = props
    const meta = [
        formatScheduleTime(run.startedAt, locale),
        run.finishedAt ? formatDuration(run.finishedAt - run.startedAt, t) : null,
        run.trigger === 'catchup' && run.scheduledFor ? t('scheduled.run.plannedFor', { when: formatScheduleTime(run.scheduledFor, locale) }) : null
    ].filter(Boolean).join(' · ')
    const notes = [
        props.accountEmail ? t('scheduled.run.account', { email: props.accountEmail }) : null,
        run.attempts > 1 ? t('scheduled.run.switchedAccount', { n: run.attempts }) : null
    ].filter(Boolean).join(' · ')
    const body = (
        <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
                <RunStatusBadge status={run.status} />
                <RunTriggerBadge trigger={run.trigger} />
                <span className="text-footnote text-[var(--social-fg-muted)]">{meta}</span>
            </div>
            {run.failure ? (
                <div className="mt-1.5 text-footnote font-semibold text-[var(--social-danger)]">{t(`scheduled.run.failure.${run.failure}`)}</div>
            ) : null}
            {run.summary ? (
                <div className="mt-1 whitespace-pre-wrap break-words text-body leading-snug text-[var(--social-fg)]">{run.summary}</div>
            ) : null}
            {notes ? <div className="mt-1 text-caption text-[var(--social-fg-subtle)]">{notes}</div> : null}
        </div>
    )
    const sessionId = run.sessionId
    return (
        <div>
            {sessionId ? (
                <button
                    type="button"
                    onClick={() => props.onOpenSession(sessionId)}
                    className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--social-hover)] active:bg-[var(--social-muted)] [-webkit-tap-highlight-color:transparent]"
                >
                    {body}
                    <ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--social-fg-subtle)]" />
                </button>
            ) : (
                <div className="flex min-h-[52px] items-center px-4 py-3">{body}</div>
            )}
            {run.links.length > 0 ? (
                <div className="-mt-1 flex flex-col px-4 pb-2">
                    {run.links.map((link) => (
                        <a
                            key={link}
                            href={link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-11 min-w-0 items-center gap-1.5 text-footnote text-[var(--social-fg)] underline-offset-2 hover:underline"
                        >
                            <ExternalLinkIcon className="h-4 w-4 shrink-0 text-[var(--social-fg-muted)]" />
                            <span className="truncate">{linkLabel(link)}</span>
                        </a>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

function nextRunText(schedule: ScheduledTask, now: number, locale: string, t: (key: string, params?: Record<string, string | number>) => string): string {
    if (!schedule.enabled) return t('scheduled.paused')
    if (schedule.spec.kind === 'manual') return t('scheduled.detail.manualOnly')
    if (!schedule.nextRunAt) return t('scheduled.list.noNext')
    return t('scheduled.detail.nextAt', { when: formatScheduleTime(schedule.nextRunAt, locale, now), until: formatUntil(schedule.nextRunAt, now, t) })
}

export default function ScheduledDetailPage() {
    const { api } = useAppContext()
    const { t, locale } = useTranslation()
    const navigate = useNavigate()
    const now = useMinuteClock()
    const { scheduleId } = useParams({ from: '/scheduled/$scheduleId' })
    const { schedule, runs, isLoading, error } = useSchedule(api, scheduleId)
    const { machines } = useMachines(api, true)
    const pool = useClaudeAccountPool(api, schedule?.machineId ?? null, schedule?.agent === 'claude')
    const { update, remove, runNow } = useScheduleActions(api)
    const [editOpen, setEditOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [promptOpen, setPromptOpen] = useState(false)
    const [actionError, setActionError] = useState<string | null>(null)

    const goBack = () => navigate({ to: '/scheduled' })
    const isMobile = useIsMobileLayout()

    if (!schedule) {
        return (
            <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
                {isMobile ? <SubPageHeader title={t('scheduled.title')} onBack={goBack} /> : <DesktopPaneHeader title={t('scheduled.title')} />}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {isLoading ? (
                        <LoadingState className="flex w-full justify-center py-16" />
                    ) : (
                        <EmptyState
                            variant="page"
                            title={error ? t('scheduled.loadFailed') : t('scheduled.detail.notFound')}
                            subtitle={error ?? undefined}
                            action={{ label: t('scheduled.detail.backToList'), onClick: goBack }}
                        />
                    )}
                </div>
            </div>
        )
    }

    const lang = locale === 'zh-CN' ? 'zh' : 'en'
    const label = describeSpec(schedule.spec, schedule.timezone, lang)
    const machine = machines.find((item) => item.id === schedule.machineId)
    const machineName = machine ? getMachineTitle(machine) : t('scheduled.form.machineOffline', { id: schedule.machineId.slice(0, 8) })
    const emailOf = (accountId: string | null) => accountId ? pool?.profiles.find((profile) => profile.id === accountId)?.email ?? accountId : null
    const permission = !schedule.permissionMode || schedule.permissionMode === 'default'
        ? t('permissionMode.default')
        : schedule.permissionMode === 'bypassPermissions' ? t('scheduled.permission.bypassPermissions') : t(`permissionMode.${schedule.permissionMode}`)

    const handleRun = () => {
        setActionError(null)
        runNow.mutate(schedule.id, { onError: (err) => setActionError(t('scheduled.detail.runFailed', { error: apiErrorText(err) })) })
    }
    const handleToggle = (enabled: boolean) => {
        setActionError(null)
        update.mutate({ id: schedule.id, patch: { enabled } }, { onError: (err) => setActionError(t('scheduled.form.saveFailed', { error: apiErrorText(err) })) })
    }
    const handleEdit = async (input: ScheduledTaskInput) => {
        await update.mutateAsync({ id: schedule.id, patch: input })
        setEditOpen(false)
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
            {isMobile ? (
                <SubPageHeader title={schedule.name} subtitle={label} onBack={goBack} />
            ) : (
                <DesktopPaneHeader title={schedule.name} subtitle={label} />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
                {/* Wide desktop panes put the run history beside the settings, so it shows without scrolling. */}
                <div className="mx-auto w-full max-w-content px-4 pb-10 pt-4 xl:grid xl:max-w-[1240px] xl:grid-cols-2 xl:items-start xl:gap-6 xl:px-6">
                    <div className="flex flex-col gap-5">
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                                <Button className="flex-1 sm:flex-none" onClick={handleRun} disabled={runNow.isPending}>
                                    {runNow.isPending ? t('scheduled.detail.starting') : t('scheduled.detail.runNow')}
                                </Button>
                                <Button variant="secondary" onClick={() => setEditOpen(true)}>{t('scheduled.detail.edit')}</Button>
                            </div>
                            {actionError ? <p role="alert" className="px-1 text-footnote text-[var(--social-danger)]">{actionError}</p> : null}
                        </div>

                        <ListGroup>
                            <ListRow
                                title={t('scheduled.detail.enabled')}
                                subtitle={nextRunText(schedule, now, locale, t)}
                                trailing={(
                                    <Switch
                                        checked={schedule.enabled}
                                        disabled={update.isPending}
                                        onCheckedChange={handleToggle}
                                        ariaLabel={t('scheduled.detail.enabled')}
                                    />
                                )}
                            />
                        </ListGroup>

                        <ListGroup title={t('scheduled.detail.settings')}>
                            <InfoRow label={t('scheduled.detail.schedule')} value={schedule.spec.kind === 'manual' ? label : `${label} · ${schedule.timezone}`} />
                            <InfoRow label={t('newSession.machine')} value={machineName} />
                            <InfoRow label={t('scheduled.form.directory')} value={schedule.directory} long />
                            <InfoRow label={t('newSession.agent')} value={<span className="capitalize">{schedule.agent}</span>} />
                            <InfoRow label={t('scheduled.form.model')} value={schedule.model ?? t('scheduled.detail.defaultValue')} />
                            {schedule.agent === 'claude' ? (
                                <InfoRow label={t('scheduled.form.account')} value={emailOf(schedule.accountId) ?? t('scheduled.form.accountDefault')} />
                            ) : null}
                            <InfoRow label={t('misc.permissionMode')} value={permission} />
                            <InfoRow label={t('scheduled.detail.worktree')} value={schedule.worktree ? t('scheduled.detail.yes') : t('scheduled.detail.no')} />
                            <InfoRow label={t('scheduled.detail.timeout')} value={t('scheduled.time.minutes', { n: schedule.maxMinutes })} />
                        </ListGroup>

                        <ListGroup title={t('scheduled.detail.instructions')}>
                            {schedule.promptFile ? <InfoRow label={t('scheduled.form.promptFile')} value={schedule.promptFile} long /> : null}
                            {schedule.prompt ? (
                                <div className="flex flex-col gap-1 px-4 py-3">
                                    <div className={promptOpen ? 'whitespace-pre-wrap break-words text-body text-[var(--social-fg)]' : 'line-clamp-3 whitespace-pre-wrap break-words text-body text-[var(--social-fg)]'}>
                                        {schedule.prompt}
                                    </div>
                                    <Button variant="ghost" size="xs" className="-ml-3 self-start" onClick={() => setPromptOpen((open) => !open)}>
                                        {promptOpen ? t('scheduled.detail.collapse') : t('scheduled.detail.expand')}
                                    </Button>
                                </div>
                            ) : null}
                        </ListGroup>

                        <div className="hidden xl:block">
                            <ListGroup>
                                <ListRow title={t('scheduled.detail.delete')} destructive chevron={false} onClick={() => setDeleteOpen(true)} />
                            </ListGroup>
                        </div>
                    </div>
                    <div className="mt-5 flex flex-col gap-5 xl:mt-0">
                        <ListGroup title={t('scheduled.detail.history')}>
                            {runs.length === 0 ? (
                                <EmptyState title={t('scheduled.detail.noRuns')} />
                            ) : runs.map((run) => (
                                <RunRow
                                    key={run.id}
                                    run={run}
                                    accountEmail={schedule.agent === 'claude' ? emailOf(run.accountId) : null}
                                    onOpenSession={(sessionId) => navigate({ to: '/sessions/$sessionId', params: { sessionId } })}
                                />
                            ))}
                        </ListGroup>
                        <div className="xl:hidden">
                            <ListGroup>
                                <ListRow title={t('scheduled.detail.delete')} destructive chevron={false} onClick={() => setDeleteOpen(true)} />
                            </ListGroup>
                        </div>
                    </div>
                </div>
            </div>

            <ScheduleFormDialog
                open={editOpen}
                schedule={schedule}
                machines={machines}
                isPending={update.isPending}
                onClose={() => setEditOpen(false)}
                onSubmit={handleEdit}
            />
            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('scheduled.delete.title', { name: schedule.name })}
                description={t('scheduled.delete.description')}
                confirmLabel={t('scheduled.delete.confirm')}
                confirmingLabel={t('scheduled.delete.confirming')}
                isPending={remove.isPending}
                destructive
                onConfirm={async () => {
                    await remove.mutateAsync(schedule.id)
                    goBack()
                }}
            />
        </div>
    )
}
