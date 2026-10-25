import { useCallback, useMemo, useState } from 'react'
import type { ApiClient } from '@/api/client'
import { FileIcon } from '@/components/FileIcon'
import { DisclosureIcon, DownloadIcon, FolderIcon } from '@/components/mobile/icons'
import { FitText } from '@/components/ui/FitText'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/Spinner'
import { useSessionDirectory } from '@/hooks/queries/useSessionDirectory'
import { useTranslation } from '@/lib/use-translation'

function DirectorySkeleton(props: { depth: number; rows?: number }) {
    const rows = props.rows ?? 4
    const indent = 12 + props.depth * 14

    return (
        <div className="animate-pulse">
            {Array.from({ length: rows }).map((_, index) => (
                <div
                    key={`dir-skel-${props.depth}-${index}`}
                    className="flex items-center gap-3 px-3 py-2"
                    style={{ paddingLeft: indent }}
                >
                    <div className="h-5 w-5 rounded-md bg-[var(--social-hover)]" />
                    <div className="h-3 w-40 rounded-md bg-[var(--social-hover)]" />
                </div>
            ))}
        </div>
    )
}

function DirectoryErrorRow(props: { depth: number; message: string }) {
    const indent = 12 + props.depth * 14
    return (
        <div
            className="px-3 py-2 text-xs text-[var(--social-fg-muted)] bg-[var(--app-badge-warning-bg)]"
            style={{ paddingLeft: indent }}
        >
            {props.message}
        </div>
    )
}

function DirectoryNode(props: {
    api: ApiClient | null
    sessionId: string
    path: string
    label: string
    depth: number
    onOpenFile: (path: string) => void
    onDownloadFile: (path: string) => void
    isDownloading: (path: string) => boolean
    expanded: Set<string>
    onToggle: (path: string) => void
}) {
    const { t } = useTranslation()
    const isExpanded = props.expanded.has(props.path)
    const { entries, error, isLoading } = useSessionDirectory(props.api, props.sessionId, props.path, {
        enabled: isExpanded
    })

    const directories = useMemo(() => entries.filter((entry) => entry.type === 'directory'), [entries])
    const files = useMemo(() => entries.filter((entry) => entry.type === 'file'), [entries])
    const childDepth = props.depth + 1

    const indent = 12 + props.depth * 14
    const childIndent = 12 + childDepth * 14

    return (
        <div>
            <button
                type="button"
                onClick={() => props.onToggle(props.path)}
                className="flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--social-hover)] transition-colors"
                style={{ paddingLeft: indent }}
            >
                <DisclosureIcon open={isExpanded} className="h-4 w-4 text-[var(--social-fg-muted)]" />
                <FolderIcon className="h-[22px] w-[22px] text-[var(--social-fg)]" />
                <div className="min-w-0 flex-1">
                    <FitText kind="id" text={props.label} className="font-semibold" />
                </div>
            </button>

            {isExpanded ? (
                isLoading ? (
                    <DirectorySkeleton depth={childDepth} />
                ) : error ? (
                    <DirectoryErrorRow depth={childDepth} message={error} />
                ) : (
                    <div>
                        {directories.map((entry) => {
                            const childPath = props.path ? `${props.path}/${entry.name}` : entry.name
                            return (
                                <DirectoryNode
                                    key={childPath}
                                    api={props.api}
                                    sessionId={props.sessionId}
                                    path={childPath}
                                    label={entry.name}
                                    depth={childDepth}
                                    onOpenFile={props.onOpenFile}
                                    onDownloadFile={props.onDownloadFile}
                                    isDownloading={props.isDownloading}
                                    expanded={props.expanded}
                                    onToggle={props.onToggle}
                                />
                            )
                        })}

                        {files.map((entry) => {
                            const filePath = props.path ? `${props.path}/${entry.name}` : entry.name
                            return (
                                <div
                                    key={filePath}
                                    className="flex items-center hover:bg-[var(--social-hover)] transition-colors"
                                >
                                    <button
                                        type="button"
                                        onClick={() => props.onOpenFile(filePath)}
                                        className="flex min-h-11 min-w-0 flex-1 items-center gap-3 py-2 pl-3 text-left"
                                        style={{ paddingLeft: childIndent }}
                                    >
                                        <span className="h-4 w-4" />
                                        <FileIcon fileName={entry.name} size={22} />
                                        <div className="min-w-0 flex-1">
                                            <FitText kind="id" text={entry.name} className="font-semibold" />
                                        </div>
                                    </button>
                                    <IconButton
                                        label={`${t('file.download')} ${entry.name}`}
                                        onClick={() => props.onDownloadFile(filePath)}
                                        disabled={props.isDownloading(filePath)}
                                        className="mr-1"
                                    >
                                        {props.isDownloading(filePath)
                                            ? <Spinner size="sm" label={null} />
                                            : <DownloadIcon className="h-4 w-4" />}
                                    </IconButton>
                                </div>
                            )
                        })}

                        {directories.length === 0 && files.length === 0 ? (
                            <div
                                className="px-3 py-2 text-footnote text-[var(--social-fg-muted)]"
                                style={{ paddingLeft: childIndent }}
                            >
                                {t('files.emptyDirectory')}
                            </div>
                        ) : null}
                    </div>
                )
            ) : null}
        </div>
    )
}

export function DirectoryTree(props: {
    api: ApiClient | null
    sessionId: string
    rootLabel: string
    onOpenFile: (path: string) => void
    onDownloadFile: (path: string) => void
    isDownloading: (path: string) => boolean
}) {
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))

    const handleToggle = useCallback((path: string) => {
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(path)) {
                next.delete(path)
            } else {
                next.add(path)
            }
            return next
        })
    }, [])

    return (
        <div className="border-t border-[var(--social-divider)]">
            <DirectoryNode
                api={props.api}
                sessionId={props.sessionId}
                path=""
                label={props.rootLabel}
                depth={0}
                onOpenFile={props.onOpenFile}
                onDownloadFile={props.onDownloadFile}
                isDownloading={props.isDownloading}
                expanded={expanded}
                onToggle={handleToggle}
            />
        </div>
    )
}

