import { useEffect, useRef, useState } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

type SessionTagsDialogProps = {
    isOpen: boolean
    onClose: () => void
    tags: string[]
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
    const { isOpen, onClose, tags, onSave, isPending } = props
    const [value, setValue] = useState('')
    const [error, setError] = useState<string | null>(null)
    const inputRef = useRef<HTMLInputElement>(null)

    useEffect(() => {
        if (!isOpen) return
        setValue(tags.join(', '))
        setError(null)
        setTimeout(() => {
            inputRef.current?.focus()
            inputRef.current?.select()
        }, 100)
    }, [isOpen, tags])

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
                    <input
                        ref={inputRef}
                        type="text"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        placeholder={t('dialog.tags.placeholder')}
                        className="w-full px-3 py-2.5 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:ring-2 focus:ring-[var(--app-button)] focus:border-transparent"
                        disabled={isPending}
                    />
                    <div className="text-xs text-[var(--app-hint)]">{t('dialog.tags.hint')}</div>

                    {error ? (
                        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
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
