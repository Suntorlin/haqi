import { useCallback, useState } from 'react'
import { createDownloadKeyPair, decryptFileDownload } from '@hapi/protocol/fileTransfer'
import { ApiError, type ApiClient } from '@/api/client'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

function saveBytes(bytes: Uint8Array<ArrayBuffer>, fileName: string): void {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }))
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.rel = 'noopener'
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Safari reads the blob after click() returns.
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * Downloads a session file end-to-end encrypted: the hub encrypts it to a
 * one-time key made here, and the browser decrypts it before saving.
 */
export function useSessionFileDownload(api: ApiClient | null, sessionId: string) {
    const { addToast } = useToast()
    const { t } = useTranslation()
    const [pendingPaths, setPendingPaths] = useState<ReadonlySet<string>>(() => new Set())

    const download = useCallback(async (path: string) => {
        if (!api) return
        setPendingPaths((prev) => new Set(prev).add(path))
        try {
            if (!globalThis.crypto?.subtle) {
                throw new Error(t('file.download.insecure'))
            }
            const keys = await createDownloadKeyPair()
            const envelope = await api.downloadSessionFile(sessionId, path, keys.publicKey)
            const bytes = await decryptFileDownload(keys.privateKey, envelope, path)
            saveBytes(bytes, path.split('/').pop() || 'download')
        } catch (error) {
            const message = error instanceof ApiError
                ? (error.code ?? error.message)
                : error instanceof Error ? error.message : String(error)
            addToast({ title: t('file.download.failed'), body: message, sessionId: '', url: '' })
        } finally {
            setPendingPaths((prev) => {
                const next = new Set(prev)
                next.delete(path)
                return next
            })
        }
    }, [api, sessionId, addToast, t])

    return { download, isDownloading: (path: string) => pendingPaths.has(path) }
}
