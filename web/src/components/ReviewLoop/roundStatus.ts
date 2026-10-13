import type { ReviewRoundStatus } from '@/types/api'

export const roundStatusVariant: Record<ReviewRoundStatus, 'default' | 'info' | 'warning' | 'success'> = {
    instructed: 'default',
    executing: 'warning',
    executed: 'info',
    reviewed: 'success',
    user_pending: 'warning',
}

export function roundStatusLabel(status: ReviewRoundStatus): string {
    const text = status.replace('_', ' ')
    return text.charAt(0).toUpperCase() + text.slice(1)
}
