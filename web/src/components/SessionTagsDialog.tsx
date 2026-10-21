import { useEffect, useRef, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'
import { TextField } from '@/components/ui/TextField'
import { Chip } from '@/components/ui/Chip'

type SessionTagsDialogProps = {
    isOpen: boolean
    onClose: () => void
    tags: string[]
    availableTags?: string[]
    onSave: (tags: string[]) => Promise<void>
    isPending: boolean
}

function normalizeTags(value: string): string[] {
    return Array.from(new Set(value
        .split(',')
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)))
}

export function SessionTagsDialog(props: SessionTagsDialogProps) {
    const { t } = useTranslation()
    const { isOpen, onClose, tags, availableTags = [], onSave, isPending } = props
    const [value, setValue] = useState('')
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    // Callers pass a fresh `tags` array on every render; read it through a ref so a parent
    // re-render (SSE updates, pending flags) cannot reset what the user is typing.
    const tagsRef = useRef(tags)
    tagsRef.current = tags

    useEffect(() => {
        if (!isOpen) return
        setValue(tagsRef.current.join(', '))
        setError(null)
        const timer = setTimeout(() => {
            inputRef.current?.focus()
            inputRef.current?.select()
        }, 100)
        return () => clearTimeout(timer)
    }, [isOpen])

    const quickSelectTags = Array.from(new Set([...availableTags, ...tags]))
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))

    const toggleTag = (tag: string) => {
        const selectedTags = normalizeTags(value)
        const nextTags = selectedTags.includes(tag)
            ? selectedTags.filter((selectedTag) => selectedTag !== tag)
            : [...selectedTags, tag]
        setValue(nextTags.join(', '))
        setError(null)
        inputRef.current?.focus()
    }

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault()
        const nextTags = normalizeTags(value)
        if (nextTags.length > 20 || nextTags.some((tag) => tag.length > 40)) {
            setError(t('dialog.tags.error'))
            return
        }

        setError(null)
        try {
            await onSave(nextTags)
            onClose()
        } catch {
            setError(t('dialog.tags.error'))
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('dialog.tags.title')}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
                    <TextField
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder={t('dialog.tags.placeholder')}
                        disabled={isPending}
                    />
                    {quickSelectTags.length ? (
                        <div className="flex flex-col gap-2">
                            <div className="text-caption font-semibold text-[var(--social-fg-muted)]">
                                {t('dialog.tags.existing')}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {quickSelectTags.map((tag) => {
                                    const isSelected = normalizeTags(value).includes(tag)
                                    return (
                                        <Chip
                                            key={tag}
                                            selected={isSelected}
                                            onClick={() => toggleTag(tag)}
                                            disabled={isPending}
                                        >
                                            #{tag}
                                        </Chip>
                                    )
                                })}
                            </div>
                        </div>
                    ) : null}
                    <div className="text-caption text-[var(--social-fg-subtle)]">{t('dialog.tags.hint')}</div>

                    {error ? (
                        <div className="text-footnote text-[var(--social-danger)]">
                            {error}
                        </div>
                    ) : null}

                    <div className="flex gap-2 justify-end">
                        <Button type="button" variant="secondary" onClick={onClose} disabled={isPending}>
                            {t('button.cancel')}
                        </Button>
                        <Button type="submit" disabled={isPending}>
                            {isPending ? t('dialog.tags.saving') : t('button.save')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
