import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { buildPathProbeKey, getOrLoadPathProbeResult, type PathProbeResult, type PathProbeState } from '@/lib/filePathProbe'
import { encodeBase64 } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { isOutsideWorkspacePathCandidate, isYoloPermissionMode } from '@/lib/pathLinks'

const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
type ProbeState = 'checking' | PathProbeState

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

function getPathFileName(path: string): string {
    const normalized = path.replace(/\\/g, '/')
    const segments = normalized.split('/').filter(Boolean)
    const fallback = 'download'
    return segments[segments.length - 1] ?? fallback
}

function sanitizeDownloadFileName(fileName: string): string {
    const sanitized = fileName
        .replace(/[\r\n]/g, '_')
        .replace(/[\\/]/g, '_')
        .replace(/["]/g, '_')
        .trim()
    return sanitized || 'download'
}

function extensionFromPath(path: string): string | null {
    const fileName = getPathFileName(path)
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

function triggerFileDownload(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob)
    try {
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = sanitizeDownloadFileName(fileName)
        anchor.rel = 'noreferrer'
        anchor.style.display = 'none'
        document.body.append(anchor)
        anchor.click()
        anchor.remove()
    } finally {
        URL.revokeObjectURL(objectUrl)
    }
}

function classifyProbeFailure(error: string | undefined): PathProbeResult {
    const message = (error ?? '').trim()
    const normalized = message.toLowerCase()

    if (normalized.includes('outside-workspace paths require yolo')) {
        return { state: 'blocked', errorMessage: message || 'Outside-workspace paths need YOLO mode.' }
    }

    if (
        normalized.includes('does not exist')
        || normalized.includes('no such file')
        || normalized.includes('not a regular file')
    ) {
        return { state: 'missing', errorMessage: message || 'Path does not exist.' }
    }

    return { state: 'error', errorMessage: message || 'Path check failed.' }
}

function renderPlainPath(path: string, className?: string, title?: string) {
    return (
        <span className={cn('font-mono text-[0.9em] text-[var(--app-link)]', className)} title={title ?? path}>
            {path}
        </span>
    )
}

export function PathActionLink(props: {
    path: string
    className?: string
}) {
    const { path } = props
    const ctx = useOptionalHappyChatContext()
    const navigate = useNavigate()
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
    const [previewOpen, setPreviewOpen] = useState(false)
    const [busyAction, setBusyAction] = useState<'preview' | 'download' | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [probeState, setProbeState] = useState<ProbeState>('checking')
    const [probeErrorMessage, setProbeErrorMessage] = useState<string | null>(null)

    useEffect(() => {
        return () => {
            if (previewImageUrl) {
                URL.revokeObjectURL(previewImageUrl)
            }
        }
    }, [previewImageUrl])

    const outsideWorkspaceCandidate = useMemo(
        () => isOutsideWorkspacePathCandidate(path),
        [path]
    )
    const yoloModeEnabled = useMemo(
        () => isYoloPermissionMode(ctx?.permissionMode),
        [ctx?.permissionMode]
    )
    const blockedOutsidePath = outsideWorkspaceCandidate && !yoloModeEnabled
    const imageMimeType = useMemo(() => imageMimeFromPath(path), [path])
    const canPreviewImage = Boolean(imageMimeType)

    useEffect(() => {
        if (!ctx) {
            setProbeState('available')
            setProbeErrorMessage(null)
            return
        }

        if (blockedOutsidePath) {
            setProbeState('blocked')
            setProbeErrorMessage('Outside-workspace paths need YOLO mode.')
            return
        }

        const cacheKey = buildPathProbeKey(ctx.sessionId, ctx.permissionMode, path)

        let disposed = false
        setProbeState('checking')
        setProbeErrorMessage(null)

        void (async () => {
            try {
                const outcome = await getOrLoadPathProbeResult(cacheKey, async () => {
                    const result = await ctx.api.readSessionFile(ctx.sessionId, path, { maxBytes: 0 })
                    if (result.success) {
                        return { state: 'available' as const }
                    }
                    return classifyProbeFailure(result.error)
                })
                if (disposed) return

                setProbeState(outcome.state)
                setProbeErrorMessage(outcome.errorMessage ?? null)
            } catch (error) {
                if (disposed) return
                const message = error instanceof Error ? error.message : 'Path check failed.'
                setProbeState('error')
                setProbeErrorMessage(message)
            }
        })()

        return () => {
            disposed = true
        }
    }, [blockedOutsidePath, ctx, path])

    const openFilePage = useCallback(() => {
        if (!ctx) return
        if (blockedOutsidePath) {
            setErrorMessage('Outside-workspace paths need YOLO mode.')
            return
        }
        navigate({
            to: '/sessions/$sessionId/file',
            params: { sessionId: ctx.sessionId },
            search: { path: encodeBase64(path) }
        })
    }, [blockedOutsidePath, ctx, navigate, path])

    const handlePreview = useCallback(async () => {
        if (!ctx) return
        setErrorMessage(null)

        if (blockedOutsidePath) {
            setErrorMessage('Outside-workspace paths need YOLO mode.')
            return
        }

        if (!canPreviewImage || !imageMimeType) {
            openFilePage()
            return
        }

        setBusyAction('preview')
        try {
            const result = await ctx.api.readSessionFile(ctx.sessionId, path, { maxBytes: MAX_IMAGE_PREVIEW_BYTES })
            if (!result.success || !result.content) {
                throw new Error(result.error ?? 'Failed to preview image')
            }
            if (result.truncated || (typeof result.size === 'number' && result.size > MAX_IMAGE_PREVIEW_BYTES)) {
                throw new Error('Image preview is limited to 8 MB.')
            }

            const bytes = base64ToBytes(result.content)
            const nextUrl = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: imageMimeType }))
            setPreviewImageUrl((current) => {
                if (current) {
                    URL.revokeObjectURL(current)
                }
                return nextUrl
            })
            setPreviewOpen(true)
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Failed to preview image')
        } finally {
            setBusyAction(null)
        }
    }, [blockedOutsidePath, canPreviewImage, ctx, imageMimeType, openFilePage, path])

    const handleDownload = useCallback(async () => {
        if (!ctx) return
        setErrorMessage(null)

        if (blockedOutsidePath) {
            setErrorMessage('Outside-workspace paths need YOLO mode.')
            return
        }

        setBusyAction('download')
        try {
            const result = await ctx.api.readSessionFile(ctx.sessionId, path, { maxBytes: MAX_DOWNLOAD_BYTES })
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to download file')
            }
            if (result.truncated || (typeof result.size === 'number' && result.size > MAX_DOWNLOAD_BYTES)) {
                throw new Error('Download is limited to files <= 25 MB.')
            }

            const bytes = result.content ? base64ToBytes(result.content) : new Uint8Array()
            const blobType = imageMimeType ?? 'application/octet-stream'
            triggerFileDownload(new Blob([toArrayBuffer(bytes)], { type: blobType }), getPathFileName(path))
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : 'Failed to download file')
        } finally {
            setBusyAction(null)
        }
    }, [blockedOutsidePath, ctx, imageMimeType, path])

    if (!ctx) {
        return renderPlainPath(path, props.className)
    }

    if (probeState === 'checking') {
        return (
            <span className={cn('inline-flex max-w-full items-center gap-1', props.className)}>
                {renderPlainPath(path)}
                <span className="text-[12px] text-[var(--app-hint)]">...</span>
            </span>
        )
    }

    if (probeState === 'missing') {
        return renderPlainPath(path, props.className, probeErrorMessage ?? 'Path does not exist.')
    }

    if (probeState === 'error') {
        return renderPlainPath(path, props.className, probeErrorMessage ?? 'Path check failed.')
    }

    if (probeState === 'blocked') {
        return (
            <span className={cn('inline-flex max-w-full items-center gap-1', props.className)}>
                {renderPlainPath(path)}
                <span className="rounded bg-[var(--app-badge-warning-bg)] px-1 text-[12px] text-[var(--app-badge-warning-text)]" title={probeErrorMessage ?? 'Outside-workspace paths require YOLO mode'}>
                    YOLO
                </span>
            </span>
        )
    }

    return (
        <>
            <span className={cn(
                'inline-flex max-w-full items-center gap-1 rounded border border-[var(--app-divider)] bg-[var(--app-subtle-bg)] px-1.5 py-0.5 align-middle',
                props.className
            )}>
                <button
                    type="button"
                    onClick={openFilePage}
                    className="max-w-[16rem] truncate font-mono text-[0.8em] text-[var(--app-link)] underline decoration-dotted hover:opacity-90"
                    title={path}
                >
                    {path}
                </button>
                <button
                    type="button"
                    onClick={handlePreview}
                    disabled={busyAction !== null}
                    className="shrink-0 rounded px-1 text-[12px] text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                    title={canPreviewImage ? 'Preview image' : 'Open file preview'}
                >
                    {busyAction === 'preview' ? '...' : '预览'}
                </button>
                <button
                    type="button"
                    onClick={handleDownload}
                    disabled={busyAction !== null}
                    className="shrink-0 rounded px-1 text-[12px] text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                    title="Download file"
                >
                    {busyAction === 'download' ? '...' : '下载'}
                </button>
                {blockedOutsidePath ? (
                    <span className="rounded bg-[var(--app-badge-warning-bg)] px-1 text-[12px] text-[var(--app-badge-warning-text)]" title="Outside-workspace paths require YOLO mode">
                        YOLO
                    </span>
                ) : null}
                {errorMessage ? (
                    <span className="max-w-[8rem] truncate text-[12px] text-[var(--social-danger)]" title={errorMessage}>
                        !
                    </span>
                ) : null}
            </span>

            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>{getPathFileName(path)}</DialogTitle>
                    </DialogHeader>
                    {previewImageUrl ? (
                        <div className="max-h-[75vh] overflow-auto">
                            <img src={previewImageUrl} alt={path} className="mx-auto max-h-[70vh] max-w-full object-contain" />
                        </div>
                    ) : (
                        <div className="text-[13px] text-[var(--app-hint)]">Preview unavailable.</div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}
