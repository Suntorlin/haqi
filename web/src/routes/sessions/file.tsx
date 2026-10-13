import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useSearch } from '@tanstack/react-router'
import type { GitCommandResponse } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTheme } from '@/hooks/useTheme'
import { queryKeys } from '@/lib/query-keys'
import { langAlias, useShikiHighlighter } from '@/lib/shiki'
import { decodeBase64 } from '@/lib/utils'
import { isOutsideWorkspacePathCandidate } from '@/lib/pathLinks'
import { useTranslation } from '@/lib/use-translation'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'

const MAX_COPYABLE_FILE_BYTES = 1_000_000
const GitDiffViewer = lazy(() => import('@/components/GitDiffViewer'))
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon'
}


function decodePath(value: string): string {
    if (!value) return ''
    const decoded = decodeBase64(value)
    return decoded.ok ? decoded.text : value
}

function extensionFromPath(path: string): string | null {
    const normalized = path.replace(/\\/g, '/')
    const fileName = normalized.split('/').pop() ?? ''
    const dotIndex = fileName.lastIndexOf('.')
    if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
        return null
    }
    return fileName.slice(dotIndex + 1).toLowerCase()
}

function imageMimeFromPath(path: string): string | null {
    const extension = extensionFromPath(path)
    if (!extension) return null
    return IMAGE_MIME_BY_EXTENSION[extension] ?? null
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    return buffer
}

function FileContentSkeleton() {
    const { t } = useTranslation()
    const widths = ['w-full', 'w-11/12', 'w-5/6', 'w-3/4', 'w-2/3', 'w-4/5']

    return (
        <div role="status" aria-live="polite">
            <span className="sr-only">{t('file.loading')}</span>
            <div className="animate-pulse space-y-2 rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-3">
                {Array.from({ length: 12 }).map((_, index) => (
                    <div key={`file-skeleton-${index}`} className={`h-3 ${widths[index % widths.length]} rounded bg-[var(--app-subtle-bg)]`} />
                ))}
            </div>
        </div>
    )
}

function resolveLanguage(path: string): string | undefined {
    const parts = path.split('.')
    if (parts.length <= 1) return undefined
    const ext = parts[parts.length - 1]?.toLowerCase()
    if (!ext) return undefined
    return langAlias[ext] ?? ext
}

function resolveGitDiffLanguage(path: string): string {
    const language = resolveLanguage(path)
    if (!language) return 'plaintext'

    const diffLangAlias: Record<string, string> = {
        shellscript: 'bash',
        make: 'makefile',
        csharp: 'csharp'
    }

    return diffLangAlias[language] ?? language
}

function decodeFileContent(content: string | undefined): string {
    if (!content) return ''
    const decoded = decodeBase64(content)
    return decoded.ok ? decoded.text : ''
}

function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

function isBinaryContent(content: string): boolean {
    if (!content) return false
    if (content.includes('\0')) return true
    const nonPrintable = content.split('').filter((char) => {
        const code = char.charCodeAt(0)
        return code < 32 && code !== 9 && code !== 10 && code !== 13
    }).length
    return nonPrintable / content.length > 0.1
}

function extractCommandError(result: GitCommandResponse | undefined): string | null {
    if (!result) return null
    if (result.success) return null
    return result.error ?? result.stderr ?? 'Failed to load diff'
}

export default function FilePage() {
    const { api } = useAppContext()
    const { isDark } = useTheme()
    const { copied: pathCopied, copy: copyPath } = useCopyToClipboard()
    const { copied: contentCopied, copy: copyContent } = useCopyToClipboard()
    const goBack = useAppGoBack()
    const { t } = useTranslation()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/file' })
    const search = useSearch({ from: '/sessions/$sessionId/file' })
    const encodedPath = typeof search.path === 'string' ? search.path : ''
    const staged = search.staged

    const filePath = useMemo(() => decodePath(encodedPath), [encodedPath])
    const fileName = filePath.split('/').pop() || filePath || 'File'
    const outsideWorkspaceCandidate = useMemo(
        () => isOutsideWorkspacePathCandidate(filePath),
        [filePath]
    )

    const diffQuery = useQuery({
        queryKey: queryKeys.gitFileDiff(sessionId, filePath, staged),
        queryFn: async () => {
            if (!api || !sessionId || !filePath) {
                throw new Error('Missing session or path')
            }
            return await api.getGitDiffFile(sessionId, filePath, staged)
        },
        enabled: Boolean(api && sessionId && filePath && !outsideWorkspaceCandidate)
    })

    const fileQuery = useQuery({
        queryKey: queryKeys.sessionFile(sessionId, filePath),
        queryFn: async () => {
            if (!api || !sessionId || !filePath) {
                throw new Error('Missing session or path')
            }
            return await api.readSessionFile(sessionId, filePath)
        },
        enabled: Boolean(api && sessionId && filePath)
    })

    const diffContent = diffQuery.data?.success ? (diffQuery.data.stdout ?? '') : ''
    const diffError = extractCommandError(diffQuery.data)
    const diffSuccess = diffQuery.data?.success === true
    const diffFailed = diffQuery.data?.success === false

    const fileContentResult = fileQuery.data
    const decodedContentResult = fileContentResult?.success && fileContentResult.content
        ? decodeBase64(fileContentResult.content)
        : { text: '', ok: true }
    const decodedContent = decodedContentResult.text
    const binaryFile = fileContentResult?.success
        ? !decodedContentResult.ok || isBinaryContent(decodedContent)
        : false

    const language = useMemo(() => resolveLanguage(filePath), [filePath])
    const diffLanguage = useMemo(() => resolveGitDiffLanguage(filePath), [filePath])
    const imageMimeType = useMemo(() => imageMimeFromPath(filePath), [filePath])
    const highlighted = useShikiHighlighter(decodedContent, language)
    const contentSizeBytes = useMemo(
        () => (decodedContent ? getUtf8ByteLength(decodedContent) : 0),
        [decodedContent]
    )
    const canCopyContent = fileContentResult?.success === true
        && !binaryFile
        && decodedContent.length > 0
        && contentSizeBytes <= MAX_COPYABLE_FILE_BYTES

    const oldSnapshotQuery = useQuery({
        queryKey: ['git-file-snapshot', sessionId, filePath, staged, 'old'],
        queryFn: async () => {
            if (!api || !sessionId || !filePath) {
                throw new Error('Missing session or path')
            }
            return await api.readGitSnapshot(sessionId, filePath, staged ? 'head' : 'index')
        },
        enabled: Boolean(api && sessionId && filePath && diffContent && !outsideWorkspaceCandidate)
    })

    const stagedNewSnapshotQuery = useQuery({
        queryKey: ['git-file-snapshot', sessionId, filePath, staged, 'new'],
        queryFn: async () => {
            if (!api || !sessionId || !filePath) {
                throw new Error('Missing session or path')
            }
            return await api.readGitSnapshot(sessionId, filePath, 'index')
        },
        enabled: Boolean(api && sessionId && filePath && diffContent && staged === true && !outsideWorkspaceCandidate)
    })

    const oldDiffContent = useMemo(
        () => decodeFileContent(oldSnapshotQuery.data?.success ? oldSnapshotQuery.data.content : undefined),
        [oldSnapshotQuery.data]
    )
    const newDiffContent = useMemo(
        () => staged
            ? decodeFileContent(stagedNewSnapshotQuery.data?.success ? stagedNewSnapshotQuery.data.content : undefined)
            : decodedContent,
        [decodedContent, staged, stagedNewSnapshotQuery.data]
    )

    const [displayMode, setDisplayMode] = useState<'diff' | 'file'>('diff')
    const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)

    useEffect(() => {
        if (diffSuccess && !diffContent) {
            setDisplayMode('file')
            return
        }
        if (diffFailed) {
            setDisplayMode('file')
            return
        }
        if (diffError && !diffContent) {
            setDisplayMode('file')
        }
    }, [diffSuccess, diffFailed, diffContent, diffError])

    useEffect(() => {
        if (!imageMimeType || !fileContentResult?.success || fileContentResult.truncated || !fileContentResult.content) {
            setImagePreviewUrl((current) => {
                if (current) {
                    URL.revokeObjectURL(current)
                }
                return null
            })
            return
        }

        try {
            const bytes = base64ToBytes(fileContentResult.content)
            const nextUrl = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: imageMimeType }))
            setImagePreviewUrl((current) => {
                if (current) {
                    URL.revokeObjectURL(current)
                }
                return nextUrl
            })
        } catch {
            setImagePreviewUrl((current) => {
                if (current) {
                    URL.revokeObjectURL(current)
                }
                return null
            })
        }
    }, [fileContentResult, imageMimeType])

    useEffect(() => {
        if (!imagePreviewUrl) return
        return () => {
            URL.revokeObjectURL(imagePreviewUrl)
        }
    }, [imagePreviewUrl])

    const diffViewLoading = diffQuery.isLoading
        || oldSnapshotQuery.isLoading
        || (staged === true && stagedNewSnapshotQuery.isLoading)
        || (staged !== true && fileQuery.isLoading)
    const loading = diffViewLoading || (displayMode === 'file' && fileQuery.isLoading)
    const fileError = fileContentResult && !fileContentResult.success
        ? (fileContentResult.error ?? 'Failed to read file')
        : null
    const missingPath = !filePath
    const diffErrorMessage = outsideWorkspaceCandidate
        ? null
        : diffError ? t('file.diffUnavailable', { error: diffError }) : null

    return (
        <div className="flex h-full flex-col">
            <SubPageHeader title={fileName} subtitle={filePath || t('file.unknownPath')} onBack={goBack} />

            <div className="bg-[var(--app-bg)]">
                <div className="mx-auto w-full max-w-content px-3 py-2 flex items-center gap-2 border-b border-[var(--app-divider)]">
                    <FileIcon fileName={fileName} size={20} />
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-hint)]">{filePath}</span>
                    <button
                        type="button"
                        onClick={() => copyPath(filePath)}
                        className="shrink-0 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                        title={t('file.copyPath')}
                    >
                        {pathCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                    </button>
                </div>
            </div>

            {diffContent ? (
                <div className="bg-[var(--app-bg)]">
                    <div className="mx-auto w-full max-w-content px-3 py-2 flex items-center gap-2 border-b border-[var(--app-divider)]">
                        <button
                            type="button"
                            onClick={() => setDisplayMode('diff')}
                            className={`rounded px-3 py-1 text-xs font-semibold ${displayMode === 'diff' ? 'bg-[var(--app-button)] text-[var(--app-button-text)] opacity-80' : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'}`}
                        >
                            {t('file.mode.diff')}
                        </button>
                        <button
                            type="button"
                            onClick={() => setDisplayMode('file')}
                            className={`rounded px-3 py-1 text-xs font-semibold ${displayMode === 'file' ? 'bg-[var(--app-button)] text-[var(--app-button-text)] opacity-80' : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'}`}
                        >
                            {t('file.mode.file')}
                        </button>
                    </div>
                </div>
            ) : null}

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content p-4">
                    {diffErrorMessage ? (
                        <div className="mb-3 rounded-md bg-amber-500/10 p-2 text-xs text-[var(--app-hint)]">
                            {diffErrorMessage}
                        </div>
                    ) : null}
                    {missingPath ? (
                        <div className="text-sm text-[var(--app-hint)]">{t('file.noPath')}</div>
                    ) : loading ? (
                        <FileContentSkeleton />
                    ) : displayMode === 'diff' && diffContent ? (
                        <Suspense fallback={<FileContentSkeleton />}>
                            <GitDiffViewer
                                filePath={filePath}
                                language={diffLanguage}
                                oldContent={oldDiffContent}
                                newContent={newDiffContent}
                                diffContent={diffContent}
                                theme={isDark ? 'dark' : 'light'}
                            />
                        </Suspense>
                    ) : fileError ? (
                        <div className="text-sm text-[var(--app-hint)]">{fileError}</div>
                    ) : imageMimeType && (displayMode === 'file' || !diffContent) ? (
                        fileContentResult?.truncated ? (
                            <div className="text-sm text-[var(--app-hint)]">
                                Image preview unavailable because the file content is truncated.
                            </div>
                        ) : imagePreviewUrl ? (
                            <div className="overflow-hidden rounded-md border border-[var(--app-border)] bg-[var(--app-code-bg)] p-2">
                                <div className="max-h-[75vh] overflow-auto">
                                    <img
                                        src={imagePreviewUrl}
                                        alt={filePath || fileName}
                                        className="mx-auto max-h-[70vh] max-w-full object-contain"
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="text-sm text-[var(--app-hint)]">
                                Failed to render image preview.
                            </div>
                        )
                    ) : binaryFile ? (
                        <div className="text-sm text-[var(--app-hint)]">
                            This looks like a binary file. It cannot be displayed.
                        </div>
                    ) : displayMode === 'diff' && diffError ? (
                        <div className="text-sm text-[var(--app-hint)]">{diffError}</div>
                    ) : displayMode === 'file' ? (
                        decodedContent ? (
                            <div className="relative">
                                {canCopyContent ? (
                                    <button
                                        type="button"
                                        onClick={() => copyContent(decodedContent)}
                                        className="absolute right-2 top-2 z-10 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                                        title={t('file.copyContent')}
                                    >
                                        {contentCopied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                                    </button>
                                ) : null}
                                <pre className="shiki overflow-auto rounded-md bg-[var(--app-code-bg)] p-3 pr-8 text-xs font-mono">
                                    <code>{highlighted ?? decodedContent}</code>
                                </pre>
                            </div>
                        ) : (
                            <div className="text-sm text-[var(--app-hint)]">{t('file.empty')}</div>
                        )
                    ) : (
                        <div className="text-sm text-[var(--app-hint)]">{t('file.noChanges')}</div>
                    )}
                </div>
            </div>
        </div>
    )
}
