import { useTranslation } from '@/lib/use-translation'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/mobile/ContextMenu'
import { ArchiveBoxIcon, ClipboardIcon, PencilIcon, TrashIcon } from '@/components/mobile/icons'

/**
 * Long-press (or right-click) on a task or group in the list: rename, copy the title, archive or bring back, delete.
 * Same menu look as a session's.
 */
export function TaskActionMenu(props: {
    isOpen: boolean
    anchorPoint: { x: number; y: number }
    archived: boolean
    onClose: () => void
    onRename: () => void
    onCopyTitle: () => void
    onArchive: (archived: boolean) => void
    onDelete: () => void
}) {
    const { t } = useTranslation()
    const run = (action: () => void) => () => {
        props.onClose()
        action()
    }
    return (
        <ContextMenu open={props.isOpen} anchorPoint={props.anchorPoint} onClose={props.onClose} label={t('session.more')}>
            <ContextMenuItem icon={<PencilIcon />} label={t('session.action.rename')} onSelect={run(props.onRename)} />
            <ContextMenuItem icon={<ClipboardIcon />} label={t('groups.action.copyTitle')} onSelect={run(props.onCopyTitle)} />
            <ContextMenuSeparator />
            <ContextMenuItem
                icon={<ArchiveBoxIcon />}
                label={props.archived ? t('groups.action.unarchive') : t('session.action.archive')}
                onSelect={run(() => props.onArchive(!props.archived))}
            />
            <ContextMenuItem icon={<TrashIcon />} label={t('session.action.delete')} destructive onSelect={run(props.onDelete)} />
        </ContextMenu>
    )
}
