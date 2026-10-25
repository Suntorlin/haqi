import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { describeSpec } from '@hapi/protocol/schedules'
import type { ScheduledTask, ScheduledTaskInput } from '@/types/api'
import { LoadingState } from '@/components/LoadingState'
import { PlusCircleIcon } from '@/components/mobile/icons'
import { MobilePageHeader, MobileTabBar } from '@/components/mobile/MobileTabBar'
import { PausedBadge, RunStatusBadge } from '@/components/scheduled/RunBadges'
import { ScheduleFormDialog } from '@/components/scheduled/ScheduleFormDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { IconButton } from '@/components/ui/IconButton'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { FeedRow } from '@/components/ui/FeedRow'
import { useScheduleActions } from '@/hooks/mutations/useScheduleActions'
import { useMachines } from '@/hooks/queries/useMachines'
import { useSchedules } from '@/hooks/queries/useSchedules'
import { useMinuteClock } from '@/hooks/useMinuteClock'
import { useAppContext } from '@/lib/app-context'
import { formatScheduleTime, formatUntil } from '@/lib/schedules'
import { useTranslation } from '@/lib/use-translation'

function useNextText(schedule: ScheduledTask, now: number): string | null {
    const { t, locale } = useTranslation()
    if (!schedule.enabled) return null
    if (schedule.nextRunAt) {
        return t('scheduled.list.next', {
            // Within a day the countdown says enough; later runs show the date.
            when: schedule.nextRunAt - now < 24 * 3600_000 ? formatUntil(schedule.nextRunAt, now, t) : formatScheduleTime(schedule.nextRunAt, locale, now)
        })
    }
    return schedule.spec.kind === 'manual' ? null : t('scheduled.list.noNext')
}

function ScheduleBadges(props: { schedule: ScheduledTask }) {
    return (
        <span className="flex shrink-0 items-center gap-1.5">
            {props.schedule.enabled ? null : <PausedBadge />}
            {props.schedule.lastRun ? <RunStatusBadge status={props.schedule.lastRun.status} /> : null}
        </span>
    )
}

function ScheduleRow(props: { schedule: ScheduledTask; now: number; onOpen: () => void }) {
    const { locale } = useTranslation()
    const { schedule } = props
    const label = describeSpec(schedule.spec, schedule.timezone, locale === 'zh-CN' ? 'zh' : 'en')
    const next = useNextText(schedule, props.now)
    return (
        <ListRow
            title={schedule.name}
            subtitle={[label, next].filter(Boolean).join(' · ')}
            trailing={<ScheduleBadges schedule={schedule} />}
            onClick={props.onOpen}
        />
    )
}

/** A row of the desktop list column: the selected task stays highlighted while its detail is open. */
function ScheduleFeedRow(props: { schedule: ScheduledTask; now: number; selected: boolean; onOpen: () => void }) {
    const { locale } = useTranslation()
    const { schedule } = props
    const label = describeSpec(schedule.spec, schedule.timezone, locale === 'zh-CN' ? 'zh' : 'en')
    const next = useNextText(schedule, props.now)
    return (
        <FeedRow
            onClick={props.onOpen}
            aria-current={props.selected ? 'page' : undefined}
            title={schedule.name}
            aside={<ScheduleBadges schedule={schedule} />}
            subtitle={[label, next].filter(Boolean).join(' · ')}
        />
    )
}

/**
 * Scheduled tasks: saved prompts the hub sends to a new session at set times.
 * - page: the phone's top-level page, with the tab bar.
 * - panel: the desktop list column beside the detail pane; the layout owns the create dialog.
 */
export default function ScheduledListPage(props: {
    variant?: 'page' | 'panel'
    selectedId?: string | null
    createOpen?: boolean
    onCreateOpenChange?: (open: boolean) => void
}) {
    const variant = props.variant ?? 'page'
    const { api } = useAppContext()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const now = useMinuteClock()
    const { schedules, isLoading, error } = useSchedules(api)
    const [ownCreateOpen, setOwnCreateOpen] = useState(false)
    const createOpen = props.createOpen ?? ownCreateOpen
    const setCreateOpen = props.onCreateOpenChange ?? setOwnCreateOpen
    const { machines } = useMachines(api, createOpen)
    const { create } = useScheduleActions(api)

    const handleCreate = async (input: ScheduledTaskInput) => {
        const schedule = await create.mutateAsync(input)
        setCreateOpen(false)
        navigate({ to: '/scheduled/$scheduleId', params: { scheduleId: schedule.id } })
    }
    const open = (id: string) => navigate({ to: '/scheduled/$scheduleId', params: { scheduleId: id } })

    const active = schedules.filter((schedule) => schedule.enabled).length
    const panel = variant === 'panel'

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
            <MobilePageHeader
                contentWidth={!panel}
                title={t('scheduled.title')}
                subtitle={schedules.length > 0 ? t('scheduled.list.summary', { n: schedules.length, active }) : undefined}
                actions={(
                    <IconButton className="text-[var(--social-fg)]" label={t('scheduled.new')} onClick={() => setCreateOpen(true)}>
                        <PlusCircleIcon className="h-[24px] w-[24px]" />
                    </IconButton>
                )}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className={panel ? 'pb-6 pt-1' : 'mx-auto w-full max-w-content px-4 pb-8 pt-3'}>
                    {isLoading ? (
                        <LoadingState className="flex w-full justify-center py-16" />
                    ) : error ? (
                        <EmptyState variant="page" title={t('scheduled.loadFailed')} subtitle={error} />
                    ) : schedules.length === 0 ? (
                        <EmptyState
                            variant="page"
                            title={t('scheduled.empty.title')}
                            subtitle={t('scheduled.empty.subtitle')}
                            action={panel ? undefined : { label: t('scheduled.new'), onClick: () => setCreateOpen(true) }}
                        />
                    ) : panel ? (
                        schedules.map((schedule) => (
                            <ScheduleFeedRow
                                key={schedule.id}
                                schedule={schedule}
                                now={now}
                                selected={props.selectedId === schedule.id}
                                onOpen={() => open(schedule.id)}
                            />
                        ))
                    ) : (
                        <ListGroup>
                            {schedules.map((schedule) => (
                                <ScheduleRow key={schedule.id} schedule={schedule} now={now} onOpen={() => open(schedule.id)} />
                            ))}
                        </ListGroup>
                    )}
                </div>
            </div>
            {panel ? null : <MobileTabBar active="scheduled" />}
            <ScheduleFormDialog
                open={createOpen}
                schedule={null}
                machines={machines}
                isPending={create.isPending}
                onClose={() => setCreateOpen(false)}
                onSubmit={handleCreate}
            />
        </div>
    )
}
