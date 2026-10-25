import type { ScheduledRun, ScheduledRunStatus } from '@/types/api'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { useTranslation } from '@/lib/use-translation'

const STATUS_VARIANT: Record<ScheduledRunStatus, NonNullable<BadgeProps['variant']>> = {
    running: 'info',
    waiting: 'warning',
    done: 'success',
    failed: 'destructive',
    skipped: 'default'
}

/** State of one run: running, waiting for you, done, failed, skipped. */
export function RunStatusBadge(props: { status: ScheduledRunStatus }) {
    const { t } = useTranslation()
    const live = props.status === 'running'
    return (
        <Badge variant={STATUS_VARIANT[props.status]} dot={live} live={live}>
            {t(`scheduled.run.status.${props.status}`)}
        </Badge>
    )
}

/** Late (catch-up) and Run-now runs get a tag; on-time runs need none. */
export function RunTriggerBadge(props: { trigger: ScheduledRun['trigger'] }) {
    const { t } = useTranslation()
    if (props.trigger === 'schedule') return null
    return <Badge>{t(`scheduled.run.trigger.${props.trigger}`)}</Badge>
}

/** A paused task, in place of its next run. */
export function PausedBadge() {
    const { t } = useTranslation()
    return <Badge>{t('scheduled.paused')}</Badge>
}
