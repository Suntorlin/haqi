import type { ReviewRoundStatus } from '@/types/api'

export const roundStatusVariant: Record<ReviewRoundStatus, 'default' | 'info' | 'warning' | 'success'> = {
    instructed: 'default',
    executing: 'warning',
    executed: 'info',
    reviewed: 'success',
    user_pending: 'warning',
}

export function roundStatusLabel(status: ReviewRoundStatus, t: (key: string) => string): string {
    return t(`loops.round.status.${status}`)
}
