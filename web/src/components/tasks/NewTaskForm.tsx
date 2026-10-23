import { useRef, useState, type ClipboardEvent } from 'react'
import type { ApiClient } from '@/api/client'
import { appendDictatedText, useDictation } from '@/hooks/useDictation'
import { useTranslation } from '@/lib/use-translation'
import { prepareTaskFile, TASK_FILE_LIMITS, type TaskFileUpload } from '@/lib/taskFiles'
import { DictationBar, DictationButton } from '@/components/AssistantChat/MobileComposerParts'
import { Spinner } from '@/components/Spinner'
import { AutoTextarea } from '@/components/ui/AutoTextarea'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { InfoTip } from '@/components/ui/InfoTip'
import { Switch } from '@/components/ui/Switch'
import { AlertCircleIcon, CloseIcon, PaperclipIcon } from '@/components/mobile/icons'

export type NewTaskInput = { text: string; draft: boolean; files?: TaskFileUpload[] }

type PickedFile = {
    id: string
    name: string
    size: number
    upload?: TaskFileUpload
    error?: string
}

/**
 * A new task is one field: what should be done, in as many lines as it takes, plus reference files and images if
 * there are any. HAQI's lead picks the repository and the tag, and drafts the goal and the acceptance criteria; with
 * drafting off the task starts as a plain discussion. The field works like the session composer: the same file
 * chips, pasted screenshots and the mic for dictation.
 */
export function NewTaskForm(props: {
    api?: ApiClient | null
    onCreate: (input: NewTaskInput) => Promise<void>
    onCancel: () => void
}) {
    const { t } = useTranslation()
    const [text, setText] = useState('')
    const [draft, setDraft] = useState(true)
    const [files, setFiles] = useState<PickedFile[]>([])
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const dictation = useDictation({
        api: props.api,
        onText: (dictated) => setText((previous) => appendDictatedText(previous, dictated).slice(0, 2000))
    })

    const reading = files.some((file) => !file.upload && !file.error)
    const ready = files.filter((file) => file.upload)
    const tooLarge = ready.reduce((sum, file) => sum + file.size, 0) > TASK_FILE_LIMITS.totalBytes

    const addFiles = (picked: File[]) => {
        const room = TASK_FILE_LIMITS.count - files.length
        if (picked.length > room) setError(t('tasks.files.tooMany', { n: TASK_FILE_LIMITS.count }))
        else setError(null)
        for (const raw of picked.slice(0, Math.max(0, room))) {
            const id = crypto.randomUUID()
            setFiles((previous) => [...previous, { id, name: raw.name, size: raw.size }])
            void prepareTaskFile(raw).then(({ file, upload }) => {
                const size = file.size
                const failure = size > TASK_FILE_LIMITS.bytes ? t('tasks.files.tooLarge') : undefined
                setFiles((previous) => previous.map((item) => item.id !== id ? item : {
                    ...item,
                    name: upload.filename,
                    size,
                    ...(failure ? { error: failure } : { upload })
                }))
            }, () => {
                setFiles((previous) => previous.map((item) => item.id === id ? { ...item, error: t('tasks.files.readFailed') } : item))
            })
        }
    }

    const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
        const images = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'))
        if (images.length === 0) return
        event.preventDefault()
        addFiles(images)
    }

    const submit = async () => {
        const trimmed = text.trim()
        if (!trimmed || pending || reading || tooLarge) return
        setPending(true)
        setError(null)
        try {
            const uploads = ready.map((file) => file.upload!)
            await props.onCreate({ text: trimmed, draft, ...(uploads.length > 0 ? { files: uploads } : {}) })
            setText('')
            setFiles([])
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
            setPending(false)
        }
    }

    return (
        <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
                event.preventDefault()
                void submit()
            }}
        >
            <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                    const picked = Array.from(event.target.files ?? [])
                    event.target.value = ''
                    if (picked.length > 0) addFiles(picked)
                }}
            />
            {files.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                    {files.map((file) => (
                        // Same chip as the session composer's attachments.
                        <div
                            key={file.id}
                            title={file.error}
                            className="flex max-w-full items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--social-surface)] py-1 pl-3.5 pr-1 text-footnote text-[var(--social-fg)]"
                        >
                            {!file.upload && !file.error ? <Spinner size="sm" label={null} className="text-[var(--social-fg-subtle)]" /> : null}
                            {file.error ? <span className="text-[var(--social-danger)]"><AlertCircleIcon className="h-4 w-4" /></span> : null}
                            <span className="max-w-[180px] truncate">{file.name}</span>
                            <IconButton
                                size="xs"
                                label={t('composer.attachment.remove')}
                                disabled={pending}
                                className="ml-auto"
                                onClick={() => setFiles((previous) => previous.filter((item) => item.id !== file.id))}
                            >
                                <CloseIcon className="h-3.5 w-3.5" />
                            </IconButton>
                        </div>
                    ))}
                </div>
            ) : null}
            {dictation ? (
                <DictationBar
                    status={dictation.status}
                    elapsedMs={dictation.elapsedMs}
                    error={dictation.error}
                    onCancel={dictation.cancel}
                    onFinish={dictation.finish}
                    onDismissError={dictation.clearError}
                />
            ) : null}
            {/* Same row as the session composer: files on the left, the field with the mic inside it. */}
            <div className="flex items-end gap-2">
                <IconButton
                    variant="muted"
                    label={t('tasks.files.add')}
                    disabled={pending || files.length >= TASK_FILE_LIMITS.count}
                    onClick={() => inputRef.current?.click()}
                >
                    <PaperclipIcon className="h-[18px] w-[18px]" />
                </IconButton>
                <div className="flex min-h-11 min-w-0 flex-1 items-end rounded-[22px] border border-[var(--social-border)] bg-[var(--social-surface)] py-[10px] pl-4 pr-2 transition-colors focus-within:border-[var(--social-fg-subtle)]">
                    <AutoTextarea
                        autoFocus
                        minRows={3}
                        maxRows={10}
                        value={text}
                        maxLength={2000}
                        readOnly={pending}
                        aria-label={t('tasks.new')}
                        placeholder={t('tasks.newPlaceholder')}
                        onChange={(event) => setText(event.target.value)}
                        onPaste={onPaste}
                        onSubmitKey={() => void submit()}
                        className="min-h-0 flex-1 rounded-none border-0 bg-transparent p-0 leading-[1.375rem] focus:border-0"
                    />
                    {dictation ? (
                        <DictationButton
                            status={dictation.status}
                            onStart={dictation.start}
                            onFinish={dictation.finish}
                            disabled={pending}
                            className="-mb-1 ml-1 shrink-0"
                        />
                    ) : null}
                </div>
            </div>
            <div className="flex min-h-11 items-center gap-3">
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-body text-[var(--social-fg)]">
                    {t('tasks.draftToggle')}
                    <InfoTip text={draft ? t('tasks.newHint') : t('tasks.plainHint')} />
                </span>
                <Switch checked={draft} onCheckedChange={setDraft} ariaLabel={t('tasks.draftToggle')} />
            </div>
            {tooLarge ? <p className="text-footnote text-[var(--social-danger)]">{t('tasks.files.tooLargeTotal')}</p> : null}
            {error ? <p className="text-footnote text-[var(--social-danger)]">{error}</p> : null}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={props.onCancel}>{t('button.cancel')}</Button>
                <Button type="submit" disabled={pending || reading || tooLarge || !text.trim()}>
                    {pending ? t('tasks.starting') : draft ? t('tasks.start') : t('tasks.startPlain')}
                </Button>
            </div>
        </form>
    )
}
