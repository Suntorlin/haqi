import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

export function SyncingBanner({ isSyncing }: { isSyncing: boolean }) {
    const { t } = useTranslation()
    const isOnline = useOnlineStatus()

    // Don't show syncing banner when offline (OfflineBanner takes precedence)
    if (!isSyncing || !isOnline) {
        return null
    }

    return (
        <div className="fixed top-0 left-0 right-0 bg-[var(--social-muted)] text-[var(--social-fg)] text-center py-2 text-sm font-medium z-50 flex items-center justify-center gap-2 border-b border-[var(--social-divider)]">
            <Spinner size="sm" label={null} className="text-[var(--social-fg)]" />
            {t('syncing.title')}
        </div>
    )
}
