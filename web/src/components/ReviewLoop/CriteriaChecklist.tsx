import { CheckIcon, CloseIcon } from '@/components/mobile/icons'
import type { CriteriaItem } from '@/types/api'

const statusIcon: Record<CriteriaItem['status'], { icon: React.ReactNode; className: string }> = {
    met: {
        icon: <CheckIcon className="h-3.5 w-3.5" />,
        className: 'bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)]'
    },
    not_met: {
        icon: <CloseIcon className="h-3.5 w-3.5" />,
        className: 'bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
    },
    unclear: {
        icon: <span className="text-caption font-semibold leading-none">?</span>,
        className: 'bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]'
    },
}

export function CriteriaChecklist({ criteria }: { criteria: CriteriaItem[] }) {
    if (criteria.length === 0) return null

    return (
        <ul className="flex min-w-0 flex-col gap-2.5">
            {criteria.map((item, i) => {
                const { icon, className } = statusIcon[item.status]
                return (
                    <li key={i} className="flex min-w-0 items-start gap-3">
                        <span
                            className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${className}`}
                            role="img"
                            aria-label={item.status.replace('_', ' ')}
                        >
                            {icon}
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block break-words text-body text-[var(--social-fg)]">{item.criteria}</span>
                            {item.note ? (
                                <span className="mt-0.5 block break-words text-footnote text-[var(--social-fg-muted)]">{item.note}</span>
                            ) : null}
                        </span>
                    </li>
                )
            })}
        </ul>
    )
}
