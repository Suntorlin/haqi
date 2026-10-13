import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

export function ActionButtons(props: {
    isPending: boolean
    canCreate: boolean
    isDisabled: boolean
    onCancel: () => void
}) {
    const { t } = useTranslation()

    return (
        <div className="flex justify-center gap-3 pt-1">
            <Button
                type="button"
                variant="secondary"
                onClick={props.onCancel}
                disabled={props.isDisabled}
            >
                {t('button.cancel')}
            </Button>
            <Button
                type="submit"
                disabled={!props.canCreate}
                aria-busy={props.isPending}
                className="gap-2"
            >
                {props.isPending ? (
                    <>
                        <Spinner size="sm" label={null} className="text-[var(--app-button-text)]" />
                        {t('newSession.creating')}
                    </>
                ) : (
                    t('newSession.create')
                )}
            </Button>
        </div>
    )
}
