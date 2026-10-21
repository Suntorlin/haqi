import { useCallback, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearch } from '@tanstack/react-router'
import type { FileSearchItem, GitFileStatus } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { FolderIcon, GitBranchIcon, RefreshIcon, SearchIcon } from '@/components/mobile/icons'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useGitStatusFiles } from '@/hooks/queries/useGitStatusFiles'
import { useSession } from '@/hooks/queries/useSession'
import { useSessionFileSearch } from '@/hooks/queries/useSessionFileSearch'
import { encodeBase64 } from '@/lib/utils'
import { queryKeys } from '@/lib/query-keys'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from '@/lib/use-translation'
import { SubPageHeader, SubPageHeaderButton } from '@/components/mobile/SubPageHeader'
import { Badge } from '@/components/ui/badge'
import { TextField } from '@/components/ui/TextField'
import { SegmentedControl } from '@/components/ui/FormControls'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListRow } from '@/components/ui/ListRow'
import { cn } from '@/lib/utils'

function StatusBadge(props: { status: GitFileStatus['status'] }) {
    const { label, color } = useMemo(() => {
        switch (props.status) {
            case 'added':
                return { label: 'A', color: 'var(--app-git-staged-color)' }
            case 'deleted':
                return { label: 'D', color: 'var(--app-git-deleted-color)' }
            case 'renamed':
                return { label: 'R', color: 'var(--app-git-renamed-color)' }
            case 'untracked':
                return { label: '?', color: 'var(--app-git-untracked-color)' }
            case 'conflicted':
                return { label: 'U', color: 'var(--app-git-deleted-color)' }
            default:
                return { label: 'M', color: 'var(--app-git-unstaged-color)' }
        }
    }, [props.status])

    return (
        <span
            className="inline-flex items-center justify-center rounded-md border px-1.5 py-0.5 text-caption font-semibold"
            style={{ color, borderColor: color }}
        >
            {label}
        </span>
    )
}

function LineChanges(props: { added: number; removed: number }) {
    if (!props.added && !props.removed) return null

    return (
        <span className="flex items-center gap-1 text-caption font-mono">
            {props.added ? (
                <span className="text-[var(--app-diff-added-text)]">+{props.added}</span>
            ) : null}
            {props.removed ? (
                <span className="text-[var(--app-diff-removed-text)]">-{props.removed}</span>
            ) : null}
        </span>
    )
}

function GitFileRow(props: {
    file: GitFileStatus
    onOpen: () => void
    showDivider: boolean
}) {
    const subtitle = props.file.filePath || 'project root'

    return (
        <ListRow
            icon={<FileIcon fileName={props.file.fileName} size={22} />}
            title={props.file.fileName}
            subtitle={(
                <span className="flex min-w-0 items-center gap-1">
                    {props.file.repo ? (
                        <Badge className="shrink-0">{props.file.repo}</Badge>
                    ) : null}
                    <span className="truncate">{subtitle}</span>
                </span>
            )}
            trailing={(
                <span className="flex items-center gap-2">
                    <LineChanges added={props.file.linesAdded} removed={props.file.linesRemoved} />
                    <StatusBadge status={props.file.status} />
                </span>
            )}
            onClick={props.onOpen}
            chevron={false}
            className={cn('px-3', props.showDivider && 'border-b border-[var(--social-divider)]')}
        />
    )
}

function SearchResultRow(props: {
    file: FileSearchItem
    onOpen: () => void
    showDivider: boolean
}) {
    const subtitle = props.file.filePath || 'project root'
    const icon = props.file.fileType === 'file'
        ? <FileIcon fileName={props.file.fileName} size={22} />
        : <FolderIcon className="h-[22px] w-[22px] text-[var(--social-fg)]" />

    return (
        <ListRow
            icon={icon}
            title={props.file.fileName}
            subtitle={subtitle}
            onClick={props.onOpen}
            chevron={false}
            className={cn('px-3', props.showDivider && 'border-b border-[var(--social-divider)]')}
        />
    )
}

function FileListSkeleton(props: { label: string; rows?: number }) {
    const titleWidths = ['w-1/3', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5']
    const subtitleWidths = ['w-1/2', 'w-2/3', 'w-3/4', 'w-1/3']
    const rows = props.rows ?? 6

    return (
        <div className="p-3 animate-pulse space-y-3" role="status" aria-live="polite">
            <span className="sr-only">{props.label}</span>
            {Array.from({ length: rows }).map((_, index) => (
                <div key={`skeleton-row-${index}`} className="flex items-center gap-3">
                    <div className="h-6 w-6 rounded-md bg-[var(--social-hover)]" />
                    <div className="flex-1 space-y-2">
                        <div className={`h-3 ${titleWidths[index % titleWidths.length]} rounded-md bg-[var(--social-hover)]`} />
                        <div className={`h-2 ${subtitleWidths[index % subtitleWidths.length]} rounded-md bg-[var(--social-hover)]`} />
                    </div>
                </div>
            ))}
        </div>
    )
}

type GitFileGroup = {
    repo: string | null
    files: GitFileStatus[]
}

function groupGitFilesByRepo(files: GitFileStatus[], repoOrder: string[]): GitFileGroup[] {
    const groups = new Map<string, GitFileGroup>()

    for (const file of files) {
        const key = file.repo ?? ''
        const existing = groups.get(key)
        if (existing) {
            existing.files.push(file)
            continue
        }

        groups.set(key, {
            repo: file.repo ?? null,
            files: [file]
        })
    }

    const orderByRepo = new Map(repoOrder.map((name, index) => [name, index]))

    return Array.from(groups.values()).sort((a, b) => {
        const orderA = a.repo ? (orderByRepo.get(a.repo) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER
        const orderB = b.repo ? (orderByRepo.get(b.repo) ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER

        if (orderA !== orderB) {
            return orderA - orderB
        }
        return (a.repo ?? '').localeCompare(b.repo ?? '')
    })
}

function formatRepoGroupLabel(repo: string | null): string {
    return repo ?? 'project root'
}

export default function FilesPage() {
    const { api } = useAppContext()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const goBack = useAppGoBack()
    const { t } = useTranslation()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/files' })
    const search = useSearch({ from: '/sessions/$sessionId/files' })
    const { session } = useSession(api, sessionId)
    const [searchQuery, setSearchQuery] = useState('')

    const initialTab = search.tab === 'directories' ? 'directories' : 'changes'
    const [activeTab, setActiveTab] = useState<'changes' | 'directories'>(initialTab)

    const {
        status: gitStatus,
        error: gitError,
        isLoading: gitLoading,
        refetch: refetchGit
    } = useGitStatusFiles(api, sessionId)

    const shouldSearch = Boolean(searchQuery)

    const searchResults = useSessionFileSearch(api, sessionId, searchQuery, {
        enabled: shouldSearch
    })

    const handleOpenFile = useCallback((path: string, staged?: boolean) => {
        const fileSearch = staged === undefined
            ? (activeTab === 'directories'
                ? { path: encodeBase64(path), tab: 'directories' as const }
                : { path: encodeBase64(path) })
            : (activeTab === 'directories'
                ? { path: encodeBase64(path), staged, tab: 'directories' as const }
                : { path: encodeBase64(path), staged })
        navigate({
            to: '/sessions/$sessionId/file',
            params: { sessionId },
            search: fileSearch
        })
    }, [activeTab, navigate, sessionId])

    const repoSummaries = gitStatus?.repos ?? []
    const isAggregatedRepoView = repoSummaries.length > 0
    const repoOrder = useMemo(() => repoSummaries.map((repo) => repo.name), [repoSummaries])
    const stagedGroups = useMemo(
        () => groupGitFilesByRepo(gitStatus?.stagedFiles ?? [], repoOrder),
        [gitStatus?.stagedFiles, repoOrder]
    )
    const unstagedGroups = useMemo(
        () => groupGitFilesByRepo(gitStatus?.unstagedFiles ?? [], repoOrder),
        [gitStatus?.unstagedFiles, repoOrder]
    )
    const showRepoGroupHeaders = useMemo(
        () => isAggregatedRepoView || [...stagedGroups, ...unstagedGroups].some((group) => group.repo !== null),
        [isAggregatedRepoView, stagedGroups, unstagedGroups]
    )
    const branchLabel = isAggregatedRepoView
        ? t(repoSummaries.length === 1 ? 'files.repoCountOne' : 'files.repoCount', { n: repoSummaries.length })
        : (gitStatus?.branch ?? 'detached')
    const subtitle = session?.metadata?.path ?? sessionId
    const showGitErrorBanner = Boolean(gitError)
    const rootLabel = useMemo(() => {
        const base = session?.metadata?.path ?? sessionId
        const parts = base.split(/[/\\]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : base
    }, [session?.metadata?.path, sessionId])

    const handleRefresh = useCallback(() => {
        if (searchQuery) {
            void queryClient.invalidateQueries({
                queryKey: queryKeys.sessionFiles(sessionId, searchQuery)
            })
            return
        }

        if (activeTab === 'directories') {
            void queryClient.invalidateQueries({
                queryKey: ['session-directory', sessionId]
            })
            return
        }

        void refetchGit()
    }, [activeTab, queryClient, refetchGit, searchQuery, sessionId])

    const handleTabChange = useCallback((nextTab: 'changes' | 'directories') => {
        setActiveTab(nextTab)
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId },
            search: nextTab === 'changes' ? {} : { tab: nextTab },
            replace: true,
        })
    }, [navigate, sessionId])

    return (
        <div className="flex h-full flex-col">
            <SubPageHeader
                title={t('files.title')}
                subtitle={subtitle}
                onBack={goBack}
                actions={(
                    <SubPageHeaderButton label={t('files.refresh')} onClick={handleRefresh}>
                        <RefreshIcon className="h-[18px] w-[18px]" />
                    </SubPageHeaderButton>
                )}
            />

            <div className="bg-[var(--social-surface)]">
                <div className="mx-auto w-full max-w-content p-3 border-b border-[var(--social-border)]">
                    <TextField
                        variant="pill"
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder={t('files.search')}
                        leading={<SearchIcon className="h-4 w-4" />}
                        autoCapitalize="none"
                        autoCorrect="off"
                    />
                    <div className="mt-3">
                        <SegmentedControl
                            label={t('files.title')}
                            value={activeTab}
                            options={[
                                { value: 'changes', label: t('files.tab.changes') },
                                { value: 'directories', label: t('files.tab.directories') }
                            ]}
                            onChange={handleTabChange}
                        />
                    </div>
                </div>
            </div>

            {!gitLoading && gitStatus && !searchQuery && activeTab === 'changes' ? (
                <div className="bg-[var(--social-surface)]">
                    <div className="mx-auto w-full max-w-content px-3 py-2 border-b border-[var(--social-divider)]">
                        <div className="flex items-center gap-2 text-footnote">
                            <GitBranchIcon className="h-4 w-4 text-[var(--social-fg-muted)]" />
                            <span className="font-semibold">{branchLabel}</span>
                        </div>
                        <div className="text-caption text-[var(--social-fg-muted)]">
                            {t('files.changeSummary', { staged: gitStatus.totalStaged, unstaged: gitStatus.totalUnstaged })}
                        </div>
                        {isAggregatedRepoView ? (
                            <div className="mt-1 flex flex-wrap gap-1">
                                {repoSummaries.map((repo) => (
                                    <Badge key={`${repo.name}-${repo.branch ?? 'detached'}`}>
                                        {repo.branch ? `${repo.name} · ${repo.branch}` : repo.name}
                                    </Badge>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </div>
            ) : null}

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    {showGitErrorBanner && activeTab === 'changes' ? (
                        <div className="border-b border-[var(--social-divider)] bg-[var(--app-badge-warning-bg)] px-3 py-2 text-caption text-[var(--app-badge-warning-text)]">
                            {gitError}
                        </div>
                    ) : null}
                    {shouldSearch ? (
                        searchResults.isLoading ? (
                            <FileListSkeleton label={t('files.loading')} />
                        ) : searchResults.error ? (
                            <div className="p-6 text-footnote text-[var(--social-fg-muted)]">{searchResults.error}</div>
                        ) : searchResults.files.length === 0 ? (
                            <EmptyState title={searchQuery ? t('files.empty.search') : t('files.empty.project')} />
                        ) : (
                            <div className="border-t border-[var(--social-divider)]">
                                {searchResults.files.map((file, index) => (
                                    <SearchResultRow
                                        key={`${file.fullPath}-${index}`}
                                        file={file}
                                        onOpen={() => handleOpenFile(file.fullPath)}
                                        showDivider={index < searchResults.files.length - 1}
                                    />
                                ))}
                            </div>
                        )
                    ) : activeTab === 'directories' ? (
                        <DirectoryTree
                            api={api}
                            sessionId={sessionId}
                            rootLabel={rootLabel}
                            onOpenFile={(path) => handleOpenFile(path)}
                        />
                    ) : gitLoading ? (
                        <FileListSkeleton label={t('files.loadingGit')} />
                    ) : (
                        <div>
                            {gitStatus?.stagedFiles.length ? (
                                <div>
                                    <div className="border-b border-[var(--social-divider)] bg-[var(--social-surface)] px-3 py-2 text-caption font-semibold text-[var(--app-git-staged-color)]">
                                        {t('files.staged', { n: gitStatus.stagedFiles.length })}
                                    </div>
                                    {stagedGroups.map((group, groupIndex) => (
                                        <div key={`staged-group-${group.repo ?? 'root'}-${groupIndex}`}>
                                            {showRepoGroupHeaders ? (
                                                <div className="border-b border-[var(--social-divider)] bg-[var(--social-hover)] px-3 py-1.5 text-caption font-semibold text-[var(--social-fg-muted)]">
                                                    {formatRepoGroupLabel(group.repo)} ({group.files.length})
                                                </div>
                                            ) : null}
                                            {group.files.map((file, fileIndex) => {
                                                const isLastInStagedSection = groupIndex === stagedGroups.length - 1
                                                    && fileIndex === group.files.length - 1
                                                return (
                                                    <GitFileRow
                                                        key={`staged-${file.fullPath}-${fileIndex}`}
                                                        file={file}
                                                        onOpen={() => handleOpenFile(file.fullPath, file.isStaged)}
                                                        showDivider={!isLastInStagedSection || gitStatus.unstagedFiles.length > 0}
                                                    />
                                                )
                                            })}
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {gitStatus?.unstagedFiles.length ? (
                                <div>
                                    <div className="border-b border-[var(--social-divider)] bg-[var(--social-surface)] px-3 py-2 text-caption font-semibold text-[var(--app-git-unstaged-color)]">
                                        {t('files.unstaged', { n: gitStatus.unstagedFiles.length })}
                                    </div>
                                    {unstagedGroups.map((group, groupIndex) => (
                                        <div key={`unstaged-group-${group.repo ?? 'root'}-${groupIndex}`}>
                                            {showRepoGroupHeaders ? (
                                                <div className="border-b border-[var(--social-divider)] bg-[var(--social-hover)] px-3 py-1.5 text-caption font-semibold text-[var(--social-fg-muted)]">
                                                    {formatRepoGroupLabel(group.repo)} ({group.files.length})
                                                </div>
                                            ) : null}
                                            {group.files.map((file, fileIndex) => {
                                                const isLastInUnstagedSection = groupIndex === unstagedGroups.length - 1
                                                    && fileIndex === group.files.length - 1
                                                return (
                                                    <GitFileRow
                                                        key={`unstaged-${file.fullPath}-${fileIndex}`}
                                                        file={file}
                                                        onOpen={() => handleOpenFile(file.fullPath, file.isStaged)}
                                                        showDivider={!isLastInUnstagedSection}
                                                    />
                                                )
                                            })}
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {!gitStatus ? (
                                <div className="p-6 text-footnote text-[var(--social-fg-muted)]">
                                    {t('files.gitUnavailable')}
                                </div>
                            ) : null}

                            {gitStatus && gitStatus.stagedFiles.length === 0 && gitStatus.unstagedFiles.length === 0 ? (
                                <EmptyState title={t('files.noChanges')} />
                            ) : null}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
