import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FitText } from '@/components/ui/FitText'
import { buildPathProbeKey, getOrLoadPathProbeResult, type PathProbeResult, type PathProbeState } from '@/lib/filePathProbe'
import { encodeBase64 } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { isOutsideWorkspacePathCandidate, isYoloPermissionMode } from '@/lib/pathLinks'
import { TEXT_HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { useTranslation } from '@/lib/use-translation'

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

function classifyProbeFailure(error: string | undefined, t: (key: string) => string): PathProbeResult {
    const message = (error ?? '').trim()
    const normalized = message.toLowerCase()

    if (normalized.includes('outside-workspace paths require yolo')) {
        return { state: 'blocked', errorMessage: message || t('pathLink.needsYolo') }
    }

    if (
        normalized.includes('does not exist')
        || normalized.includes('no such file')
        || normalized.includes('not a regular file')
    ) {
        return { state: 'missing', errorMessage: message || t('pathLink.missing') }
    }

    return { state: 'error', errorMessage: message || t('pathLink.checkFailed') }
}

function renderPlainPath(path: string, className?: string, title?: string) {
    return (
        <span className={cn('font-mono text-[0.9em] text-[var(--social-fg)]', className)} title={title ?? path}>
            {path}
        </span>
    )
}

export function PathActionLink(props: {
    path: string
    className?: string
}) {
    const { path } = props
    const { t } = useTranslation()
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
            setProbeErrorMessage(t('pathLink.needsYolo'))
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
                    return classifyProbeFailure(result.error, t)
                })
                if (disposed) return

                setProbeState(outcome.state)
                setProbeErrorMessage(outcome.errorMessage ?? null)
            } catch (error) {
                if (disposed) return
                const message = error instanceof Error ? error.message : t('pathLink.checkFailed')
                setProbeState('error')
                setProbeErrorMessage(message)
            }
        })()

        return () => {
            disposed = true
        }
    }, [blockedOutsidePath, ctx, path, t])

    const openFilePage = useCallback(() => {
        if (!ctx) return
        if (blockedOutsidePath) {
            setErrorMessage(t('pathLink.needsYolo'))
            return
        }
        navigate({
            to: '/sessions/$sessionId/file',
            params: { sessionId: ctx.sessionId },
            search: { path: encodeBase64(path) }
        })
    }, [blockedOutsidePath, ctx, navigate, path, t])

    const handlePreview = useCallback(async () => {
        if (!ctx) return
        setErrorMessage(null)

        if (blockedOutsidePath) {
            setErrorMessage(t('pathLink.needsYolo'))
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
                throw new Error(result.error ?? t('file.imagePreviewFailed'))
            }
            if (result.truncated || (typeof result.size === 'number' && result.size > MAX_IMAGE_PREVIEW_BYTES)) {
                throw new Error(t('file.imageTooLarge'))
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
            setErrorMessage(error instanceof Error ? error.message : t('file.imagePreviewFailed'))
        } finally {
            setBusyAction(null)
        }
    }, [blockedOutsidePath, canPreviewImage, ctx, imageMimeType, openFilePage, path, t])

    const handleDownload = useCallback(async () => {
        if (!ctx) return
        setErrorMessage(null)

        if (blockedOutsidePath) {
            setErrorMessage(t('pathLink.needsYolo'))
            return
        }

        setBusyAction('download')
        try {
            const result = await ctx.api.readSessionFile(ctx.sessionId, path, { maxBytes: MAX_DOWNLOAD_BYTES })
            if (!result.success) {
                throw new Error(result.error ?? t('pathLink.downloadFailed'))
            }
            if (result.truncated || (typeof result.size === 'number' && result.size > MAX_DOWNLOAD_BYTES)) {
                throw new Error(t('pathLink.downloadTooLarge'))
            }

            const bytes = result.content ? base64ToBytes(result.content) : new Uint8Array()
            const blobType = imageMimeType ?? 'application/octet-stream'
            triggerFileDownload(new Blob([toArrayBuffer(bytes)], { type: blobType }), getPathFileName(path))
        } catch (error) {
            setErrorMessage(error instanceof Error ? error.message : t('pathLink.downloadFailed'))
        } finally {
            setBusyAction(null)
        }
    }, [blockedOutsidePath, ctx, imageMimeType, path, t])

    if (!ctx) {
        return renderPlainPath(path, props.className)
    }

    if (probeState === 'checking') {
        return (
            <span className={cn('inline-flex max-w-full items-center gap-1', props.className)}>
                {renderPlainPath(path)}
                <span className="text-caption text-[var(--social-fg-muted)]">...</span>
            </span>
        )
    }

    if (probeState === 'missing') {
        return renderPlainPath(path, props.className, probeErrorMessage ?? t('pathLink.missing'))
    }

    if (probeState === 'error') {
        return renderPlainPath(path, props.className, probeErrorMessage ?? t('pathLink.checkFailed'))
    }

    if (probeState === 'blocked') {
        return (
            <span className={cn('inline-flex max-w-full items-center gap-1', props.className)}>
                {renderPlainPath(path)}
                <span className="rounded-md bg-[var(--app-badge-warning-bg)] px-1 text-caption text-[var(--app-badge-warning-text)]" title={probeErrorMessage ?? t('pathLink.needsYolo')}>
                    YOLO
                </span>
            </span>
        )
    }

    return (
        <>
            <span className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-xl border border-[var(--social-divider)] bg-[var(--social-hover)] px-1.5 py-0.5 align-middle',
                props.className
            )}>
                <button
                    type="button"
                    onClick={openFilePage}
                    className={cn('min-w-0 max-w-[16rem] font-mono text-[0.8em] text-[var(--social-fg)] underline decoration-dotted hover:opacity-90', TEXT_HIT_AREA_CLASS)}
                >
                    <FitText kind="id" text={path} />
                </button>
                <button
                    type="button"
                    onClick={handlePreview}
                    disabled={busyAction !== null}
                    className={cn('shrink-0 rounded-md px-1 text-caption text-[var(--social-fg-muted)] hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)] disabled:opacity-50', TEXT_HIT_AREA_CLASS)}
                    title={canPreviewImage ? t('pathLink.previewImage') : t('pathLink.openFile')}
                >
                    {busyAction === 'preview' ? '…' : t('pathLink.preview')}
                </button>
                <button
                    type="button"
                    onClick={handleDownload}
                    disabled={busyAction !== null}
                    className={cn('shrink-0 rounded-md px-1 text-caption text-[var(--social-fg-muted)] hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)] disabled:opacity-50', TEXT_HIT_AREA_CLASS)}
                    title={t('pathLink.downloadFile')}
                >
                    {busyAction === 'download' ? '…' : t('pathLink.download')}
                </button>
                {blockedOutsidePath ? (
                    <span className="rounded-md bg-[var(--app-badge-warning-bg)] px-1 text-caption text-[var(--app-badge-warning-text)]" title={t('pathLink.needsYolo')}>
                        YOLO
                    </span>
                ) : null}
                {errorMessage ? (
                    <span className="text-caption text-[var(--social-danger)]" title={errorMessage}>
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
                        <div className="text-footnote text-[var(--social-fg-muted)]">{t('pathLink.previewUnavailable')}</div>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}
