import { useTranslation } from '@/lib/use-translation'
import { ContextMenu, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { BulbIcon, NewSessionIcon } from '@/components/mobile/icons'

type ProjectActionMenuProps = {
    isOpen: boolean
    onClose: () => void
    anchorPoint: { x: number; y: number }
    isProjectOffline: boolean
    canCreateInProject: boolean
    onToggleProjectOffline: () => void
    onCreateInProject: () => void
    menuId?: string
}

export function ProjectActionMenu(props: ProjectActionMenuProps) {
    const { t } = useTranslation()
    const run = (action: () => void) => () => {
        props.onClose()
        action()
    }

    return (
        <ContextMenu open={props.isOpen} anchorPoint={props.anchorPoint} onClose={props.onClose} label={t('session.more')} menuId={props.menuId}>
            {props.canCreateInProject ? (
                <ContextMenuItem icon={<NewSessionIcon />} label={t('sessions.newInProject')} onSelect={run(props.onCreateInProject)} />
            ) : null}
            <ContextMenuItem
                icon={<BulbIcon />}
                label={props.isProjectOffline ? t('sessions.projectOffline.disable') : t('sessions.projectOffline.enable')}
                onSelect={run(props.onToggleProjectOffline)}
            />
        </ContextMenu>
    )
}
