import { useState } from 'react'
import { useTranslation } from '@/lib/use-translation'
import { AutoTextarea } from '@/components/ui/AutoTextarea'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/Switch'

export type NewTaskInput = { text: string; draft: boolean }

/**
 * A new task is one field: what should be done, in as many lines as it takes. HAQI's lead picks the repository and
 * the tag, and drafts the goal and the acceptance criteria; with drafting off the task starts as a plain discussion.
 */
export function NewTaskForm(props: {
    onCreate: (input: NewTaskInput) => Promise<void>
    onCancel: () => void
}) {
    const { t } = useTranslation()
    const [text, setText] = useState('')
    const [draft, setDraft] = useState(true)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const submit = async () => {
        const trimmed = text.trim()
        if (!trimmed || pending) return
        setPending(true)
        setError(null)
        try {
            await props.onCreate({ text: trimmed, draft })
            setText('')
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
                onSubmitKey={() => void submit()}
            />
            <label className="flex min-h-11 items-center gap-3">
                <span className="min-w-0 flex-1">
                    <span className="block text-body text-[var(--social-fg)]">{t('tasks.draftToggle')}</span>
                    <span className="block text-footnote text-[var(--social-fg-muted)]">{draft ? t('tasks.newHint') : t('tasks.plainHint')}</span>
                </span>
                <Switch checked={draft} onCheckedChange={setDraft} ariaLabel={t('tasks.draftToggle')} />
            </label>
            {error ? <p className="text-footnote text-[var(--social-danger)]">{error}</p> : null}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={props.onCancel}>{t('button.cancel')}</Button>
                <Button type="submit" disabled={pending || !text.trim()}>
                    {pending ? t('tasks.starting') : draft ? t('tasks.start') : t('tasks.startPlain')}
                </Button>
            </div>
        </form>
    )
}
