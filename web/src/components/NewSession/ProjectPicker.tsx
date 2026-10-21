import { useMemo, useState } from 'react'
import { CheckIcon, FolderIcon, PlusIcon } from '@/components/mobile/icons'
import { getProjectName } from '@/components/mobile/SessionAvatar'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { useTranslation } from '@/lib/use-translation'
import { DirectorySection, shortenHomePath, type DirectorySectionProps } from './DirectorySection'
import { Section } from './Section'

const MAX_RECENT_ROWS = 4

/**
 * Step one: pick the project. Recent projects are rows (one tap, the last used is already chosen);
 * "Another folder" reveals the path field with its suggestions. With no history the field is shown
 * straight away.
 */
export function ProjectPicker(props: DirectorySectionProps) {
    const { t } = useTranslation()
    const rows = useMemo(() => Array.from(new Set(props.recentPaths)).slice(0, MAX_RECENT_ROWS), [props.recentPaths])
    const [customOpen, setCustomOpen] = useState(false)
    const directory = props.directory.trim()
    // A path that is not one of the rows (typed, preset from a link) always shows the field.
    const showField = rows.length === 0 || customOpen || (directory.length > 0 && !rows.includes(directory))

    return (
        <Section title={t('newSession.project')}>
            {rows.length > 0 ? (
                <ListGroup>
                    {rows.map((path) => (
                        <ListRow
                            key={path}
                            icon={<FolderIcon className="h-[18px] w-[18px]" />}
                            title={getProjectName(path)}
                            subtitle={shortenHomePath(path)}
                            trailing={path === directory ? <CheckIcon className="h-[18px] w-[18px] text-[var(--social-fg)]" /> : undefined}
                            chevron={false}
                            disabled={props.isDisabled}
                            onClick={() => {
                                setCustomOpen(false)
                                props.onPathClick(path)
                            }}
                        />
                    ))}
                    {showField ? null : (
                        <ListRow
                            icon={<PlusIcon className="h-[18px] w-[18px]" />}
                            title={t('newSession.otherFolder')}
                            chevron={false}
                            disabled={props.isDisabled}
                            onClick={() => {
                                // Start from a blank field: a second, pre-filled path next to the checked row is confusing.
                                setCustomOpen(true)
                                props.onDirectoryChange('')
                            }}
                        />
                    )}
                </ListGroup>
            ) : null}
            {showField ? <DirectorySection {...props} hideLabel autoFocus={customOpen} /> : null}
        </Section>
    )
}
