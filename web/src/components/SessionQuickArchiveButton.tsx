import { useState } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function TrashIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
            aria-hidden="true"
        >
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
        </svg>
    )
}

function CheckIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
            aria-hidden="true"
        >
            <path d="m5 13 4 4L19 7" />
        </svg>
    )
}

export function SessionQuickArchiveButton(props: {
    enabled: boolean
    visible: boolean
    isPending: boolean
    compact: boolean
    onArchive: () => Promise<void>
}) {
    const { enabled, visible, isPending, compact, onArchive } = props
    const { t } = useTranslation()
    const [confirming, setConfirming] = useState(false)

    if (!enabled || !visible) {
        return null
    }

    const handleClick = () => {
        if (isPending) {
            return
        }
        if (!confirming) {
            setConfirming(true)
            return
        }

        void onArchive()
            .catch((error) => {
                console.error('Failed to archive session', error)
            })
    }

    return (
        <IconButton
            size="sm"
            onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                handleClick()
            }}
            onMouseLeave={() => {
                if (!isPending) {
                    setConfirming(false)
                }
            }}
            onBlur={() => {
                if (!isPending) {
                    setConfirming(false)
                }
            }}
            disabled={isPending}
            className={cn(
                'absolute z-10 border',
                confirming
                    ? 'border-[var(--social-danger)] bg-[var(--social-danger)] text-[var(--social-on-accent)] hover:bg-[var(--social-danger)] hover:text-[var(--social-on-accent)]'
                    : 'border-[var(--social-divider)] bg-[var(--social-surface)] text-[var(--social-danger)] hover:bg-[var(--social-muted)] hover:text-[var(--social-danger)]',
                compact ? 'right-2.5 top-1 h-7 w-7' : 'right-3 top-2 h-8 w-8'
            )}
            label={confirming ? t('session.action.confirmArchive') : t('session.action.archive')}
        >
            {isPending ? (
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
            ) : confirming ? (
                <CheckIcon className="h-4 w-4" />
            ) : (
                <TrashIcon className="h-4 w-4" />
            )}
        </IconButton>
    )
}
