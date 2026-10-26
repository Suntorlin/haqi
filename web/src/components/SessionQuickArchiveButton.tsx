import { IconButton } from '@/components/ui/IconButton'
import { ArchiveBoxIcon } from '@/components/mobile/icons'
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

    if (!enabled || !visible) {
        return null
    }

    return (
        <IconButton
            size="sm"
            onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                if (isPending) {
                    return
                }
                void onArchive()
                    .catch((error) => {
                        console.error('Failed to archive session', error)
                    })
            }}
            disabled={isPending}
            className={cn(
                'absolute z-10 border border-[var(--social-divider)] bg-[var(--social-surface)] text-[var(--social-danger)] hover:bg-[var(--social-muted)] hover:text-[var(--social-danger)]',
                compact ? 'right-2.5 top-1 h-7 w-7' : 'right-3 top-2 h-8 w-8'
            )}
            label={t('session.action.archive')}
        >
            {isPending ? (
                <Spinner size="sm" label={null} className="text-current" />
            ) : (
                <ArchiveBoxIcon className="h-4 w-4" />
            )}
        </IconButton>
    )
}
