import { useState } from 'react'
import { IconButton } from '@/components/ui/IconButton'
import { ArchiveBoxIcon, CheckIcon } from '@/components/mobile/icons'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

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
                <Spinner size="sm" label={null} className="text-current" />
            ) : confirming ? (
                <CheckIcon className="h-4 w-4" />
            ) : (
                <ArchiveBoxIcon className="h-4 w-4" />
            )}
        </IconButton>
    )
}
