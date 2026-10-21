import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

type SpinnerProps = {
    /** xs 12 (inline status), sm 16 (buttons, rows), md 20, lg 24. */
    size?: 'xs' | 'sm' | 'md' | 'lg'
    className?: string
    label?: string | null
}

export function Spinner({
    size = 'md',
    className,
    label
}: SpinnerProps) {
    const { t } = useTranslation()
    const sizeClasses = {
        xs: 'h-3 w-3',
        sm: 'h-4 w-4',
        md: 'h-5 w-5',
        lg: 'h-6 w-6'
    }
    const effectiveLabel = label === undefined ? t('loading') : label
    const accessibilityProps = effectiveLabel === null
        ? { 'aria-hidden': true }
        : { role: 'status', 'aria-label': effectiveLabel }

    return (
        <svg
            className={cn(sizeClasses[size], 'animate-spin text-[var(--social-fg-muted)]', className)}
            viewBox="0 0 24 24"
            fill="none"
            {...accessibilityProps}
        >
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
        </svg>
    )
}
