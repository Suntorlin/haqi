import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { Switch } from '@/components/ui/Switch'
import { useTranslation } from '@/lib/use-translation'

/** Long-press on the "all tags" chip: choose which tags the filter bar shows. Session tags stay as they are. */
export function SessionTagManagerDialog(props: {
    isOpen: boolean
    onClose: () => void
    /** Every user tag in bar order, with the number of sessions (archived ones too) that carry it. */
    tags: { tag: string; count: number }[]
    hiddenTags: string[]
    onHiddenTagsChange: (hiddenTags: string[]) => void
}) {
    const { t } = useTranslation()
    const hidden = new Set(props.hiddenTags)

    const setShown = (tag: string, shown: boolean) => {
        props.onHiddenTagsChange(shown
            ? props.hiddenTags.filter((item) => item !== tag)
            : [...props.hiddenTags, tag])
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => !open && props.onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('dialog.tagManager.title')}</DialogTitle>
                    <DialogDescription>{t('dialog.tagManager.description')}</DialogDescription>
                </DialogHeader>
                <ListGroup className="mt-4 max-h-[60vh] overflow-y-auto">
                    {props.tags.map(({ tag, count }) => (
                        <ListRow
                            key={tag}
                            title={`#${tag}`}
                            subtitle={t('dialog.tagManager.count', { n: count })}
                            trailing={(
                                <Switch
                                    checked={!hidden.has(tag)}
                                    onCheckedChange={(shown) => setShown(tag, shown)}
                                    ariaLabel={t('dialog.tagManager.show', { tag })}
                                />
                            )}
                        />
                    ))}
                </ListGroup>
            </DialogContent>
        </Dialog>
    )
}
