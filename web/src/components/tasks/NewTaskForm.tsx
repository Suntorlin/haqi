import { useState } from 'react'
import { useTranslation } from '@/lib/use-translation'
import { AutoTextarea } from '@/components/ui/AutoTextarea'
import { Button } from '@/components/ui/button'
import { ChoiceChips } from '@/components/ui/FormControls'
import { Switch } from '@/components/ui/Switch'

/** A repository a task can run in: a directory on a machine that is online. */
export type TaskPlace = { machineId: string; directory: string; label: string }

export type NewTaskInput = { text: string; draft: boolean; machineId?: string; directory?: string }

/**
 * A new task: what should be done, in as many lines as it takes, and the repository (the newest one is picked).
 * HAQI then drafts the goal and the acceptance criteria and picks a tag; with "Skip drafting" the task starts as a
 * plain discussion.
 */
export function NewTaskForm(props: {
    places: TaskPlace[]
    onCreate: (input: NewTaskInput) => Promise<void>
    onCancel: () => void
}) {
    const { t } = useTranslation()
    const [text, setText] = useState('')
    const [placeKey, setPlaceKey] = useState<string | null>(null)
    const [draft, setDraft] = useState(true)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const keyOf = (place: TaskPlace) => `${place.machineId}:${place.directory}`
    const place = props.places.find((item) => keyOf(item) === placeKey) ?? props.places[0] ?? null

    const submit = async () => {
        const trimmed = text.trim()
        if (!trimmed || pending) return
        setPending(true)
        setError(null)
        try {
            await props.onCreate({ text: trimmed, draft, ...(place ? { machineId: place.machineId, directory: place.directory } : {}) })
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
            {draft && props.places.length > 0 ? (
                <div className="space-y-1.5">
                    <div className="text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{t('tasks.repo')}</div>
                    <ChoiceChips
                        label={t('tasks.repo')}
                        value={place ? keyOf(place) : ''}
                        options={props.places.map((item) => ({ value: keyOf(item), label: item.label }))}
                        onChange={setPlaceKey}
                    />
                </div>
            ) : null}
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
