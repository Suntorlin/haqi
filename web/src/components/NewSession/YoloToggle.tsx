import { SheetSwitchRow } from '@/components/mobile/BottomSheet'
import { FormField } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'

export function YoloToggle(props: {
    yoloMode: boolean
    isDisabled: boolean
    onToggle: (value: boolean) => void
}) {
    const { t } = useTranslation()

    return (
        <FormField label={t('newSession.yolo')}>
            <div className="overflow-hidden rounded-2xl border border-[var(--social-border)]">
                <SheetSwitchRow
                    label={t('newSession.yolo.title')}
                    description={t('newSession.yolo.desc')}
                    checked={props.yoloMode}
                    disabled={props.isDisabled}
                    onCheckedChange={props.onToggle}
                />
            </div>
        </FormField>
    )
}
