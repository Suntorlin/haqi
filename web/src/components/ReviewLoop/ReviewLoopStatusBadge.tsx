import { Badge } from '@/components/ui/badge'
import { useTranslation } from '@/lib/use-translation'
import type { ReviewLoopStatus } from '@/types/api'

type BadgeVariant = 'default' | 'info' | 'warning' | 'success' | 'destructive'

const statusConfig: Record<ReviewLoopStatus, {
    variant: BadgeVariant
    live?: boolean
}> = {
    executing: { variant: 'warning', live: true },
    reviewing: { variant: 'info', live: true },
    waiting_user: { variant: 'warning', live: true },
    paused: { variant: 'warning' },
    accepted: { variant: 'success' },
    aborted: { variant: 'destructive' },
    canceled: { variant: 'default' },
}

export function ReviewLoopStatusBadge({ status }: { status: ReviewLoopStatus }) {
    const { t } = useTranslation()
    const config = statusConfig[status]
    return (
        <Badge variant={config.variant} dot live={config.live}>
            {t(`loops.status.${status}`)}
        </Badge>
    )
}
