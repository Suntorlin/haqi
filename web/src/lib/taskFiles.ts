import { isImageMimeType } from '@/lib/fileAttachments'
import { compressImageForUpload } from '@/lib/imageUploadCompression'
import {
    imageUploadCompressionTargetSizeToBytes,
    readImageUploadCompressionSettings
} from '@/lib/imageUploadCompressionSettings'

/** Same limits as the hub: each session the task starts gets a copy, so they stay small. */
export const TASK_FILE_LIMITS = { count: 8, bytes: 10 * 1024 * 1024, totalBytes: 20 * 1024 * 1024 } as const

export type TaskFileUpload = { filename: string; mimeType: string; content: string }

/** Shrinks an image the way the chat composer does (per the user's setting), then reads the bytes as base64. */
export async function prepareTaskFile(file: File): Promise<{ file: File; upload: TaskFileUpload }> {
    let ready = file
    const settings = readImageUploadCompressionSettings()
    if (isImageMimeType(file.type) && settings.enabled) {
        ready = await compressImageForUpload(file, TASK_FILE_LIMITS.bytes, {
            level: settings.level,
            targetBytes: imageUploadCompressionTargetSizeToBytes(settings.targetSize)
        }).catch(() => file)
    }
    const dataUrl = await readAsDataUrl(ready)
    return {
        file: ready,
        upload: {
            filename: ready.name || file.name || 'file',
            mimeType: ready.type || file.type || 'application/octet-stream',
            content: dataUrl.slice(dataUrl.indexOf(',') + 1)
        }
    }
}

export function readAsDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
        reader.readAsDataURL(file)
    })
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
