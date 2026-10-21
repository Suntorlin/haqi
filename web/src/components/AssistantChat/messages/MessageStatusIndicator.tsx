import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import { TEXT_HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import type { MessageStatus } from '@/types/api'
import { AlertCircleIcon } from '@/components/mobile/icons'

export function MessageStatusIndicator(props: {
    status?: MessageStatus
    onRetry?: () => void
}) {
    const { t } = useTranslation()
    if (props.status !== 'failed') {
        return null
    }

    return (
        <span className="inline-flex items-center gap-1">
            <span className="text-[var(--social-danger)]">
                <AlertCircleIcon className="h-[14px] w-[14px]" />
            </span>
            {props.onRetry ? (
                <button
                    type="button"
                    onClick={props.onRetry}
                    className={cn('text-xs text-[var(--social-fg)] underline', TEXT_HIT_AREA_CLASS)}
                >
                    {t('button.retry')}
                </button>
            ) : null}
        </span>
    )
}
