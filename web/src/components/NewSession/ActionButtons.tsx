import { Button } from '@/components/ui/button'
import { FitText } from '@/components/ui/FitText'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from '@/lib/use-translation'

/** The one primary action, pinned to the bottom of the page: "Start in <project>". */
export function ActionButtons(props: {
    isPending: boolean
    canCreate: boolean
    projectName?: string
}) {
    const { t } = useTranslation()

    return (
        <div className="social-bar sticky bottom-0 z-10 mt-auto -mx-4 border-t border-[var(--social-border)] px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <Button
                type="submit"
                size="lg"
                disabled={!props.canCreate}
                aria-busy={props.isPending}
                className="w-full"
            >
                {props.isPending ? (
                    <>
                        <Spinner size="sm" label={null} className="text-[var(--social-primary-fg)]" />
                        {t('newSession.creating')}
                    </>
                ) : props.projectName ? (
                    <FitText kind="label" lines={1} text={t('newSession.startIn', { name: props.projectName })} />
                ) : (
                    t('newSession.create')
                )}
            </Button>
        </div>
    )
}
