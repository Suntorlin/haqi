import { Badge } from '@/components/ui/badge'
import type { ReviewLoopStatus } from '@/types/api'

type BadgeVariant = 'default' | 'info' | 'warning' | 'success' | 'destructive'

const statusConfig: Record<ReviewLoopStatus, {
    label: string
    variant: BadgeVariant
    live?: boolean
}> = {
    executing: { label: 'Executing', variant: 'warning', live: true },
    reviewing: { label: 'Reviewing', variant: 'info', live: true },
    waiting_user: { label: 'Waiting', variant: 'warning', live: true },
    paused: { label: 'Paused', variant: 'warning' },
    accepted: { label: 'Accepted', variant: 'success' },
    aborted: { label: 'Aborted', variant: 'destructive' },
    canceled: { label: 'Canceled', variant: 'default' },
}

export function ReviewLoopStatusBadge({ status }: { status: ReviewLoopStatus }) {
    const config = statusConfig[status]
    return (
        <Badge variant={config.variant} dot live={config.live}>
            {config.label}
        </Badge>
    )
}
