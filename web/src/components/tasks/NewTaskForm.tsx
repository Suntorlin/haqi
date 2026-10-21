import { useState } from 'react'
import { useTranslation } from '@/lib/use-translation'
import { AutoTextarea } from '@/components/ui/AutoTextarea'
import { Button } from '@/components/ui/button'
import { ChoiceChips } from '@/components/ui/FormControls'

const LAST_TASK_TAG_KEY = 'hapi:lastTaskTag:v1'

function loadLastTag(): string | null {
    try {
        return window.localStorage.getItem(LAST_TASK_TAG_KEY)
    } catch {
        return null
    }
}

function saveLastTag(tag: string): void {
    try {
        window.localStorage.setItem(LAST_TASK_TAG_KEY, tag)
    } catch {
        // Private mode: the next form starts from the first tag.
    }
}

/**
 * A new task: what should be done, in as many lines as it takes, and the tag it goes under. "Start drafting" creates
 * the task group; HAQI then drafts the goal and the acceptance criteria on the group's task card.
 */
export function NewTaskForm(props: {
    tags: string[]
    onCreate: (input: { text: string; tag: string }) => Promise<void>
    onCancel: () => void
}) {
    const { t } = useTranslation()
    const [text, setText] = useState('')
    const [picked, setPicked] = useState<string | null>(loadLastTag)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // The tag picked last, while it still exists; else the first tag.
    const tag = picked && props.tags.includes(picked) ? picked : (props.tags[0] ?? null)

    const submit = async () => {
        const trimmed = text.trim()
        if (!trimmed || !tag || pending) return
        setPending(true)
        setError(null)
        try {
            saveLastTag(tag)
            await props.onCreate({ text: trimmed, tag })
            setText('')
        } catch (failure) {
            setError(failure instanceof Error ? failure.message : String(failure))
        } finally {
            setPending(false)
        }
    }

    return (
        <form
            className="flex flex-col gap-3"
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
            {props.tags.length > 0 ? (
                <div className="space-y-1.5">
                    <div className="text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{t('tasks.pickTag')}</div>
                    <ChoiceChips
                        label={t('tasks.pickTag')}
                        value={tag ?? ''}
                        options={props.tags.map((item) => ({ value: item, label: `#${item}` }))}
                        onChange={setPicked}
                    />
                </div>
            ) : (
                <p className="text-footnote text-[var(--social-fg-muted)]">{t('tasks.needTag')}</p>
            )}
            <p className="text-footnote text-[var(--social-fg-muted)]">{t('tasks.newHint')}</p>
            {error ? <p className="text-footnote text-[var(--social-danger)]">{error}</p> : null}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={props.onCancel}>{t('button.cancel')}</Button>
                <Button type="submit" disabled={pending || !text.trim() || !tag}>
                    {pending ? t('tasks.starting') : t('tasks.start')}
                </Button>
            </div>
        </form>
    )
}
