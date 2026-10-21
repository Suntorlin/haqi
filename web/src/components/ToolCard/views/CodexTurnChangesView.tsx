import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import { DiffView } from '@/components/DiffView'
import { isObject } from '@hapi/protocol'
import { HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { resolveDisplayPath } from '@/utils/path'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card } from '@/components/ui/card'

type ChangeFile = {
    path: string
    additions: number
    deletions: number
    unifiedDiff: string | null
}

type ChangeSummary = {
    status: string
    files: ChangeFile[]
    patchTotal: number
    patchSuccess: number
    patchFailed: number
    diffAvailable: boolean
    diffAdditions: number
    diffDeletions: number
}

type ParsedDiffSection = {
    path: string
    unifiedDiff: string
}

const MIN_LIST_WIDTH = 220
const MAX_LIST_WIDTH = 520
const MIN_DIFF_WIDTH = 360
const MOBILE_BREAKPOINT_QUERY = '(max-width: 767px)'
const TURN_CHANGES_DETAIL_QUERY_KEY = 'turnChangesToolId'
const TURN_CHANGES_FILE_QUERY_KEY = 'turnChangesFile'

function readTurnChangesFilePath(search: string, toolId: string): string | null {
    const params = new URLSearchParams(search)
    const detailToolId = params.get(TURN_CHANGES_DETAIL_QUERY_KEY)?.trim() ?? ''
    const filePath = params.get(TURN_CHANGES_FILE_QUERY_KEY)?.trim() ?? ''
    if (!detailToolId || detailToolId !== toolId || !filePath) {
        return null
    }
    return filePath
}

function writeTurnChangesFilePath(
    toolId: string,
    filePath: string | null,
    mode: 'push' | 'replace'
): void {
    if (typeof window === 'undefined') {
        return
    }

    const url = new URL(window.location.href)
    url.searchParams.set(TURN_CHANGES_DETAIL_QUERY_KEY, toolId)
    if (filePath) {
        url.searchParams.set(TURN_CHANGES_FILE_QUERY_KEY, filePath)
    } else {
        url.searchParams.delete(TURN_CHANGES_FILE_QUERY_KEY)
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    if (mode === 'replace') {
        window.history.replaceState(window.history.state, '', nextUrl)
        return
    }

    window.history.pushState(window.history.state, '', nextUrl)
}

function asNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function normalizePath(path: string): string {
    return path
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '')
        .replace(/^\/+/, '')
        .replace(/\/+/g, '/')
        .trim()
}

function parseDiffHeaderPath(line: string): string | null {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (!match) return null
    return match[2]?.trim() || null
}

function parsePlusPath(line: string): string | null {
    const rawPath = line.replace(/^\+\+\+\s+/, '').trim()
    if (!rawPath || rawPath === '/dev/null') return null
    if (rawPath.startsWith('b/')) return rawPath.slice(2)
    return rawPath
}

function splitUnifiedDiffByFile(unifiedDiff: string): ParsedDiffSection[] {
    const sections: ParsedDiffSection[] = []
    const lines = unifiedDiff.split('\n')

    let currentPath: string | null = null
    let currentLines: string[] = []

    const flush = () => {
        if (!currentPath || currentLines.length === 0) {
            currentPath = null
            currentLines = []
            return
        }

        sections.push({
            path: currentPath,
            unifiedDiff: currentLines.join('\n')
        })
        currentPath = null
        currentLines = []
    }

    for (const line of lines) {
        if (line.startsWith('diff --git ')) {
            flush()
            currentPath = parseDiffHeaderPath(line)
            currentLines = [line]
            continue
        }

        if (currentLines.length === 0) {
            if (!line.trim()) continue
            currentLines = [line]
        } else {
            currentLines.push(line)
        }

        if (line.startsWith('+++ ')) {
            currentPath = parsePlusPath(line) ?? currentPath
        }
    }

    flush()
    return sections
}

function pickMatchingUnifiedDiff(unifiedDiff: string, expectedPath: string): string {
    const sections = splitUnifiedDiffByFile(unifiedDiff)
    if (sections.length <= 1) return unifiedDiff

    const normalizedExpectedPath = normalizePath(expectedPath)
    const exact = sections.find((section) => normalizePath(section.path) === normalizedExpectedPath)
    if (exact) return exact.unifiedDiff

    const suffixMatches = sections.filter((section) => {
        const normalizedSectionPath = normalizePath(section.path)
        return normalizedExpectedPath.endsWith(`/${normalizedSectionPath}`)
            || normalizedSectionPath.endsWith(`/${normalizedExpectedPath}`)
    })

    if (suffixMatches.length === 1) {
        return suffixMatches[0].unifiedDiff
    }

    return unifiedDiff
}

function normalizeSummary(input: unknown): ChangeSummary | null {
    if (!isObject(input)) return null

    const filesRaw = Array.isArray(input.files) ? input.files : []
    const files: ChangeFile[] = filesRaw
        .map((entry) => {
            if (!isObject(entry)) return null
            const path = typeof entry.path === 'string' ? entry.path.trim() : ''
            if (!path) return null

            const unifiedDiff = typeof entry.unified_diff === 'string' ? entry.unified_diff : null
            return {
                path,
                additions: asNumber(entry.additions),
                deletions: asNumber(entry.deletions),
                unifiedDiff: unifiedDiff ? pickMatchingUnifiedDiff(unifiedDiff, path) : null
            }
        })
        .filter((entry): entry is ChangeFile => entry !== null)

    const patchApply = isObject(input.patch_apply) ? input.patch_apply : null
    const diffStats = isObject(input.diff_stats) ? input.diff_stats : null

    return {
        status: typeof input.status === 'string' ? input.status : 'completed',
        files,
        patchTotal: asNumber(patchApply?.total),
        patchSuccess: asNumber(patchApply?.success),
        patchFailed: asNumber(patchApply?.failed),
        diffAvailable: diffStats?.available === true,
        diffAdditions: asNumber(diffStats?.additions),
        diffDeletions: asNumber(diffStats?.deletions)
    }
}

function parseUnifiedDiff(unifiedDiff: string): { oldText: string; newText: string } {
    const lines = unifiedDiff.split('\n')
    const oldLines: string[] = []
    const newLines: string[] = []
    let inHunk = false

    for (const line of lines) {
        if (
            line.startsWith('diff --git')
            || line.startsWith('index ')
            || line.startsWith('---')
            || line.startsWith('+++')
            || line.startsWith('new file mode')
            || line.startsWith('deleted file mode')
        ) {
            continue
        }

        if (line.startsWith('@@')) {
            inHunk = true
            continue
        }

        if (!inHunk) continue

        if (line.startsWith('+')) {
            newLines.push(line.substring(1))
        } else if (line.startsWith('-')) {
            oldLines.push(line.substring(1))
        } else if (line.startsWith(' ')) {
            oldLines.push(line.substring(1))
            newLines.push(line.substring(1))
        } else if (line === '\\ No newline at end of file') {
            continue
        } else if (line === '') {
            oldLines.push('')
            newLines.push('')
        }
    }

    return {
        oldText: oldLines.join('\n'),
        newText: newLines.join('\n')
    }
}

function statusLabel(status: string, t: (key: string) => string): string {
    if (status === 'aborted') return t('tool.turnChanges.status.aborted')
    if (status === 'failed') return t('tool.turnChanges.status.failed')
    return t('tool.turnChanges.status.completed')
}

function isEditableTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
    return target.isContentEditable
}

export function CodexTurnChangesView(props: ToolViewProps) {
    const { t } = useTranslation()
    const summary = useMemo(() => normalizeSummary(props.block.tool.input), [props.block.tool.input])
    if (!summary) return null

    const files = useMemo(() => summary.files.map((file) => {
        const displayPath = resolveDisplayPath(file.path, props.metadata)
        const unifiedDiff = typeof file.unifiedDiff === 'string' && file.unifiedDiff.length > 0
            ? file.unifiedDiff
            : null

        return {
            ...file,
            displayPath,
            parsedDiff: unifiedDiff ? parseUnifiedDiff(unifiedDiff) : null
        }
    }), [props.metadata, summary.files])

    const [selectedPath, setSelectedPath] = useState<string | null>(() => files[0]?.path ?? null)
    const [mobileView, setMobileView] = useState<'list' | 'diff'>('list')
    const [isMobileViewport, setIsMobileViewport] = useState(() => (
        typeof window !== 'undefined' && window.matchMedia(MOBILE_BREAKPOINT_QUERY).matches
    ))
    const [listWidth, setListWidth] = useState(320)
    const [isResizing, setIsResizing] = useState(false)
    const desktopLayoutRef = useRef<HTMLDivElement | null>(null)
    const fileButtonRefs = useRef(new Map<string, HTMLButtonElement>())

    useEffect(() => {
        if (files.length === 0) {
            setSelectedPath(null)
            setMobileView('list')
            return
        }

        if (!selectedPath || !files.some((file) => file.path === selectedPath)) {
            setSelectedPath(files[0].path)
        }
    }, [files, selectedPath])

    const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null

    useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY)
        const handleChange = () => {
            setIsMobileViewport(mediaQuery.matches)
        }

        handleChange()
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange)
            return () => {
                mediaQuery.removeEventListener('change', handleChange)
            }
        }

        mediaQuery.addListener(handleChange)
        return () => {
            mediaQuery.removeListener(handleChange)
        }
    }, [])

    useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        if (!isMobileViewport) {
            const activeFilePath = readTurnChangesFilePath(window.location.search, props.block.id)
            if (activeFilePath) {
                writeTurnChangesFilePath(props.block.id, null, 'replace')
            }
            return
        }

        const syncFromHistory = () => {
            const activeFilePath = readTurnChangesFilePath(window.location.search, props.block.id)
            if (!activeFilePath) {
                setMobileView('list')
                return
            }
            if (!files.some((file) => file.path === activeFilePath)) {
                setMobileView('list')
                return
            }

            setSelectedPath(activeFilePath)
            setMobileView('diff')
        }

        syncFromHistory()
        window.addEventListener('popstate', syncFromHistory)
        return () => {
            window.removeEventListener('popstate', syncFromHistory)
        }
    }, [files, isMobileViewport, props.block.id])

    const selectFileWithOffset = useCallback((offset: number) => {
        if (files.length === 0) return
        const currentIndex = selectedFile ? files.findIndex((file) => file.path === selectedFile.path) : 0
        const nextIndex = Math.max(0, Math.min(files.length - 1, currentIndex + offset))
        const nextFile = files[nextIndex]
        if (!nextFile || nextFile.path === selectedFile?.path) return
        setSelectedPath(nextFile.path)
        requestAnimationFrame(() => {
            fileButtonRefs.current.get(nextFile.path)?.focus()
        })
    }, [files, selectedFile])

    const handleNavigationKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        if (isEditableTarget(event.target)) return

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            selectFileWithOffset(1)
            return
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault()
            selectFileWithOffset(-1)
        }
    }, [selectFileWithOffset])

    const openFileDetails = useCallback((path: string) => {
        setSelectedPath(path)

        if (!isMobileViewport) {
            setMobileView('diff')
            return
        }

        if (typeof window === 'undefined') {
            setMobileView('diff')
            return
        }

        const current = readTurnChangesFilePath(window.location.search, props.block.id)
        if (current !== path) {
            writeTurnChangesFilePath(props.block.id, path, 'push')
        }
        setMobileView('diff')
    }, [isMobileViewport, props.block.id])

    const handleBackToFileList = useCallback(() => {
        if (!isMobileViewport) {
            setMobileView('list')
            return
        }

        if (typeof window === 'undefined') {
            setMobileView('list')
            return
        }

        const current = readTurnChangesFilePath(window.location.search, props.block.id)
        if (current) {
            window.history.back()
            return
        }
        setMobileView('list')
    }, [isMobileViewport, props.block.id])

    const clampListWidth = useCallback((nextWidth: number) => {
        const container = desktopLayoutRef.current
        const containerWidth = container?.getBoundingClientRect().width ?? 0
        const maxFromContainer = containerWidth > 0
            ? Math.max(MIN_LIST_WIDTH, containerWidth - MIN_DIFF_WIDTH)
            : MAX_LIST_WIDTH
        const maxWidth = Math.min(MAX_LIST_WIDTH, maxFromContainer)
        return Math.max(MIN_LIST_WIDTH, Math.min(nextWidth, maxWidth))
    }, [])

    const handleResizeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) return
        event.preventDefault()

        const startX = event.clientX
        const startWidth = listWidth
        setIsResizing(true)

        const onMove = (moveEvent: PointerEvent) => {
            const delta = moveEvent.clientX - startX
            setListWidth(clampListWidth(startWidth + delta))
        }

        const onUp = () => {
            setIsResizing(false)
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
            window.removeEventListener('pointercancel', onUp)
        }

        window.addEventListener('pointermove', onMove)
        window.addEventListener('pointerup', onUp)
        window.addEventListener('pointercancel', onUp)
    }, [clampListWidth, listWidth])

    useEffect(() => {
        const onResize = () => setListWidth((current) => clampListWidth(current))
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [clampListWidth])

    const renderFileList = () => (
        <Card className="overflow-hidden">
            <div className="border-b border-[var(--social-border)] bg-[var(--social-hover)] px-2 py-1.5 text-xs font-semibold text-[var(--social-fg-muted)]">
                {t('tool.turnChanges.files', { n: files.length })}
            </div>
            {files.length === 0 ? (
                <EmptyState title={t('tool.turnChanges.empty')} />
            ) : (
                <div className="max-h-72 overflow-y-auto md:max-h-[28rem]">
                    {files.map((file) => {
                        const selected = selectedFile?.path === file.path
                        return (
                            <button
                                key={file.path}
                                type="button"
                                ref={(node) => {
                                    if (node) {
                                        fileButtonRefs.current.set(file.path, node)
                                    } else {
                                        fileButtonRefs.current.delete(file.path)
                                    }
                                }}
                                onClick={() => openFileDetails(file.path)}
                                className={`min-h-11 w-full border-b border-[var(--social-divider)] px-2 py-2 text-left transition-colors last:border-b-0 ${selected ? 'bg-[var(--social-hover)]' : 'hover:bg-[var(--social-hover)]'}`}
                            >
                                <div className="font-mono text-xs text-[var(--social-fg)] break-all">
                                    {file.displayPath}
                                </div>
                                <div className="mt-0.5 text-caption text-[var(--social-fg-muted)]">
                                    +{file.additions} / -{file.deletions}
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </Card>
    )

    const renderDiffPanel = (mobile: boolean) => (
        <Card className="overflow-hidden">
            {selectedFile ? (
                <>
                    <div className="border-b border-[var(--social-border)] bg-[var(--social-hover)] px-2 py-1.5">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 font-mono text-xs text-[var(--social-fg)] break-all">
                                {selectedFile.displayPath}
                            </div>
                            <div className="shrink-0 text-caption text-[var(--social-fg-muted)]">
                                +{selectedFile.additions} / -{selectedFile.deletions}
                            </div>
                        </div>
                    </div>
                    <div className="max-h-[65vh] overflow-auto p-2">
                        {selectedFile.parsedDiff ? (
                            <DiffView
                                oldString={selectedFile.parsedDiff.oldText}
                                newString={selectedFile.parsedDiff.newText}
                                filePath={selectedFile.displayPath}
                                variant="inline"
                            />
                        ) : (
                            <div className="text-xs text-[var(--social-fg-muted)]">
                                {t('tool.turnChanges.noSnapshot')}
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <EmptyState title={t('tool.turnChanges.noSelection')} />
            )}

            {mobile ? (
                <div className="border-t border-[var(--social-border)] px-2 py-2 md:hidden">
                    <Button variant="outline" size="sm" className={HIT_AREA_CLASS} onClick={handleBackToFileList}>
                        {t('tool.turnChanges.back')}
                    </Button>
                </div>
            ) : null}
        </Card>
    )

    const showTopSummary = !isMobileViewport || mobileView === 'list'

    return (
        <div className="flex flex-col gap-2" onKeyDown={handleNavigationKeyDown}>
            {showTopSummary ? (
                <div className="rounded-xl border border-[var(--social-border)] bg-[var(--social-hover)] px-2 py-1.5 text-xs text-[var(--social-fg-muted)]">
                    <div>{statusLabel(summary.status, t)}</div>
                    <div>{t('tool.turnChanges.fileCount', { n: summary.files.length })}</div>
                    <div>
                        {t('tool.turnChanges.patchSummary', {
                            total: summary.patchTotal,
                            success: summary.patchSuccess,
                            failed: summary.patchFailed
                        })}
                    </div>
                    <div>
                        {t('tool.turnChanges.diffSummary', {
                            value: summary.diffAvailable
                                ? `+${summary.diffAdditions} / -${summary.diffDeletions}`
                                : t('tool.turnChanges.diffUnavailable')
                        })}
                    </div>
                    {summary.files.length > 1 ? (
                        <div>{t('tool.turnChanges.shortcut')}</div>
                    ) : null}
                </div>
            ) : null}

            <div className="md:hidden">
                {mobileView === 'list' ? renderFileList() : renderDiffPanel(true)}
            </div>

            <div
                ref={desktopLayoutRef}
                className="hidden md:flex md:items-start"
            >
                <div
                    className="shrink-0 pr-2"
                    style={{ width: `${listWidth}px` }}
                >
                    {renderFileList()}
                </div>

                <div
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={t('tool.turnChanges.resize')}
                    onPointerDown={handleResizeStart}
                    className="flex w-3 shrink-0 cursor-col-resize touch-none select-none items-stretch justify-center"
                >
                    <div className={`w-px transition-colors ${isResizing ? 'bg-[var(--social-fg)]' : 'bg-[var(--social-border)] hover:bg-[var(--social-fg)]'}`} />
                </div>

                <div className="min-w-0 flex-1 pl-2">
                    {renderDiffPanel(false)}
                </div>
            </div>
        </div>
    )
}
