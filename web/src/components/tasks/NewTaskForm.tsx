import { useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import type { ApiClient } from '@/api/client'
import type { PermissionMode } from '@/types/api'
import { appendDictatedText, useDictation } from '@/hooks/useDictation'
import { useExperimentalSettings } from '@/hooks/queries/useExperimentalSettings'
import { useTranslation } from '@/lib/use-translation'
import { prepareTaskFile, TASK_FILE_LIMITS, type TaskFileUpload } from '@/lib/taskFiles'
import { cn } from '@/lib/utils'
import { DictationBar, MobileComposerAction } from '@/components/AssistantChat/MobileComposerParts'
import { SessionSettingChips, type SessionThinkEffort } from '@/components/AssistantChat/SessionSettingChips'
import { Spinner } from '@/components/Spinner'
import { AutoTextarea } from '@/components/ui/AutoTextarea'
import { IconButton } from '@/components/ui/IconButton'
import { SwitchChip } from '@/components/ui/SettingChip'
import { AlertCircleIcon, CloseIcon, PaperclipIcon } from '@/components/mobile/icons'

/** The task's default session settings: every session it starts (planner, lead, executors, reviewer) uses them. */
export type TaskSessionSettings = { model?: string; thinkEffort?: SessionThinkEffort; permissionMode?: PermissionMode }

export type NewTaskInput = { text: string; draft: boolean; files?: TaskFileUpload[]; settings?: TaskSessionSettings }

/** Today's defaults for task sessions: the hub starts them with medium thinking. */
const DEFAULT_THINK: SessionThinkEffort = 'medium'

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
 * drafting off the task starts as a plain discussion. The field is the session's prompt box: one framed box with the
 * files on top, the text, and a toolbar inside it (files and the drafting setting on the left, the mic or send on the
 * right). Screenshots can be pasted, and files dropped on the box. The model, thinking and permission chips are the
 * prompt box's own; what they say becomes the task's default for every session it starts.
 */
export function NewTaskForm(props: {
    api?: ApiClient | null
    onCreate: (input: NewTaskInput) => Promise<void>
}) {
    const { t } = useTranslation()
    const [text, setText] = useState('')
    const [draft, setDraft] = useState(true)
    const [files, setFiles] = useState<PickedFile[]>([])
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)
    const [dragging, setDragging] = useState(false)
    const { settings: system } = useExperimentalSettings(props.api ?? null, Boolean(props.api))
    const [model, setModel] = useState('auto')
    const [think, setThink] = useState<SessionThinkEffort>(DEFAULT_THINK)
    // Until the user picks one, permission follows the system switch "every session in YOLO".
    const [permission, setPermission] = useState<PermissionMode | null>(null)
    const permissionValue: PermissionMode = permission ?? (system.alwaysYolo ? 'bypassPermissions' : 'default')
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

    const onDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault()
        setDragging(false)
        const dropped = Array.from(event.dataTransfer?.files ?? [])
        if (dropped.length > 0 && !pending) addFiles(dropped)
    }

    const canSend = Boolean(text.trim()) && !pending && !reading && !tooLarge

    const submit = async () => {
        const trimmed = text.trim()
        if (!trimmed || pending || reading || tooLarge) return
        setPending(true)
        setError(null)
        try {
            const uploads = ready.map((file) => file.upload!)
            const settings: TaskSessionSettings = {
                ...(model !== 'auto' ? { model } : {}),
                thinkEffort: think,
                ...(permission ? { permissionMode: permission } : {})
            }
            await props.onCreate({ text: trimmed, draft, settings, ...(uploads.length > 0 ? { files: uploads } : {}) })
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
            className="flex flex-col gap-2"
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
            {/* The session's prompt box: same frame, file chips, text area and toolbar. */}
            <div
                data-dragging={dragging || undefined}
                onDragOver={(event) => {
                    if (!event.dataTransfer?.types.includes('Files')) return
                    event.preventDefault()
                    setDragging(true)
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                className="relative overflow-hidden rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)] shadow-[var(--shadow-card)] transition-colors focus-within:border-[var(--social-fg-subtle)] data-[dragging=true]:border-[var(--social-fg)] data-[dragging=true]:bg-[var(--social-muted)]"
            >
                {files.length > 0 ? (
                    <div className="flex flex-wrap gap-2 px-4 pt-3">
                        {files.map((file) => (
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
                <div className="flex items-start px-4 pt-3">
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
                        className="min-h-[44px] w-full flex-1 rounded-none border-0 bg-transparent p-0 text-body leading-[1.375rem] focus:border-0"
                    />
                </div>
                <div className="flex items-end gap-0.5 px-2 pb-2 pt-1">
                    <IconButton
                        size="sm"
                        label={t('tasks.files.add')}
                        disabled={pending || files.length >= TASK_FILE_LIMITS.count}
                        onClick={() => inputRef.current?.click()}
                        className="relative [&_svg]:stroke-[1.7]"
                    >
                        <PaperclipIcon className="h-[18px] w-[18px]" />
                    </IconButton>
                    {/* One line on a computer; on a phone the chips wrap instead of hiding off the edge. */}
                    <div className="ml-1 flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-1 [&>button]:text-footnote">
                        <SessionSettingChips
                            flavor="claude"
                            disabled={pending}
                            model={{ value: model, onChange: setModel }}
                            think={{ value: think, onChange: setThink }}
                            permission={{ value: permissionValue, onChange: setPermission }}
                        />
                        {/* A popup menu would open under the dialog; two values flip on tap, as in the prompt box. */}
                        <SwitchChip
                            title={draft ? t('tasks.newHint') : t('tasks.plainHint')}
                            valueLabel={draft ? t('tasks.mode.draft') : t('tasks.mode.plain')}
                            disabled={pending}
                            onToggle={() => setDraft((on) => !on)}
                        />
                    </div>
                    <div className={cn('ml-auto flex shrink-0 items-center pl-2')}>
                        <MobileComposerAction
                            hasDraft={Boolean(text.trim())}
                            canSend={canSend}
                            isSending={pending}
                            showStop={false}
                            abortDisabled
                            isAborting={false}
                            voiceEnabled={false}
                            voiceStatus="disconnected"
                            controlsDisabled={pending}
                            onSend={() => void submit()}
                            onAbort={() => {}}
                            onVoiceToggle={() => {}}
                            dictation={dictation ? { status: dictation.status, onStart: dictation.start, onFinish: dictation.finish } : null}
                        />
                    </div>
                </div>
            </div>
            {tooLarge ? <p className="px-1 text-footnote text-[var(--social-danger)]">{t('tasks.files.tooLargeTotal')}</p> : null}
            {error ? <p className="px-1 text-footnote text-[var(--social-danger)]">{error}</p> : null}
        </form>
    )
}
