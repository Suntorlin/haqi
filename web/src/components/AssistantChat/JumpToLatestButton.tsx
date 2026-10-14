import { ChevronDownIcon } from '@/components/mobile/icons'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

/**
 * Floating "back to the latest" control. Quiet by default: a small round chevron at the corner.
 * With unread messages it becomes a pill carrying the count. Fades in, no bounce.
 * `raised` lifts it above a composer that overlaps the thread (classic layout).
 */
// Already `absolute`, so only the pseudo-element is needed to grow the touch target to 44px.
const HIT_AREA = "after:absolute after:-inset-1 after:content-['']"

export function JumpToLatestButton(props: { count: number; show: boolean; onClick: () => void; raised?: boolean }) {
    const { t } = useTranslation()
    if (!props.show) {
        return null
    }

    const position = props.raised ? 'bottom-20' : 'bottom-3'

    if (props.count > 0) {
        return (
            <Button
                size="sm"
                variant="outline"
                onClick={props.onClick}
                className={cn('animate-fade-in absolute left-1/2 z-10 -translate-x-1/2 bg-[var(--social-surface)]', position, HIT_AREA)}
            >
                {t('misc.newMessage', { n: props.count })}
                <ChevronDownIcon className="h-4 w-4" />
            </Button>
        )
    }

    return (
        <IconButton
            size="sm"
            label={t('misc.jumpToLatest')}
            onClick={props.onClick}
            className={cn('animate-fade-in absolute right-4 z-10 border border-[var(--social-border)] bg-[var(--social-surface)]', position, HIT_AREA)}
        >
            <ChevronDownIcon className="h-4 w-4" />
        </IconButton>
    )
}
