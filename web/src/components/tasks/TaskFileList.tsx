import { useEffect, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { TaskView } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { isImageMimeType } from '@/lib/fileAttachments'
import { formatFileSize } from '@/lib/taskFiles'
import { FileIcon } from '@/components/FileIcon'
import { FitText } from '@/components/ui/FitText'

type Loaded = { filename: string; mimeType: string; content: string }

function toBlobUrl(file: Loaded): string {
    const bytes = Uint8Array.from(atob(file.content), (char) => char.charCodeAt(0))
    return URL.createObjectURL(new Blob([bytes], { type: file.mimeType }))
}

/** The files the user attached when creating the task. Images show a thumbnail; a tap opens the file. */
export function TaskFileList(props: { api: ApiClient | null; task: TaskView }) {
    const { t } = useTranslation()
    const { api, task } = props
    const [loaded, setLoaded] = useState<Record<number, Loaded>>({})
    const [error, setError] = useState<string | null>(null)

    // Image thumbnails load once per task; other files load on tap.
    useEffect(() => {
        if (!api) return
        let cancelled = false
        task.files.forEach((file, index) => {
            if (!isImageMimeType(file.mimeType)) return
            void api.getTaskFile(task.id, index).then((content) => {
                if (!cancelled) setLoaded((previous) => ({ ...previous, [index]: content }))
            }, () => {})
        })
        return () => { cancelled = true }
    }, [api, task.id, task.files.length])

    const open = async (index: number) => {
        if (!api) return
        setError(null)
        try {
            const file = loaded[index] ?? await api.getTaskFile(task.id, index)
            const url = toBlobUrl(file)
            const link = document.createElement('a')
            link.href = url
            link.target = '_blank'
            link.rel = 'noopener'
            if (!isImageMimeType(file.mimeType) && file.mimeType !== 'application/pdf') link.download = file.filename
            link.click()
            setTimeout(() => URL.revokeObjectURL(url), 60_000)
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
        }
    }

    if (task.files.length === 0) return null
    return (
        <div className="mx-4">
            <div className="flex flex-wrap gap-2">
                {task.files.map((file, index) => {
                    const image = loaded[index] && isImageMimeType(file.mimeType) ? loaded[index] : null
                    return (
                        <button
                            key={`${index}-${file.name}`}
                            type="button"
                            onClick={() => void open(index)}
                            aria-label={t('tasks.files.open', { name: file.name })}
                            className="flex min-w-0 max-w-full items-center gap-2 rounded-xl border border-[var(--social-border)] bg-[var(--social-surface)] px-2.5 py-2 text-left"
                        >
                            {image ? (
                                <img src={`data:${image.mimeType};base64,${image.content}`} alt={file.name} className="h-10 w-10 shrink-0 rounded-md object-cover" />
                            ) : (
                                <span className="shrink-0"><FileIcon fileName={file.name} size={24} /></span>
                            )}
                            <span className="min-w-0 max-w-[180px]">
                                <FitText kind="id" text={file.name} className="text-footnote text-[var(--social-fg)]" />
                                <FitText kind="value" text={formatFileSize(file.size)} className="text-caption text-[var(--social-fg-subtle)]" />
                            </span>
                        </button>
                    )
                })}
            </div>
            {error ? <p className="pt-2 text-footnote text-[var(--social-danger)]">{error}</p> : null}
        </div>
    )
}
