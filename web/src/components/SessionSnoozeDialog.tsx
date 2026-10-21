import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/TextField'
import { FormField } from '@/components/ui/FormControls'
import { getNextSnoozeWake } from '@/lib/session-pins'
import { toDateTimeLocalValue } from '@/lib/session-snooze'
import { useTranslation } from '@/lib/use-translation'

/** Custom wake time for a snooze; the quick choices live in the session menu. */
export function SessionSnoozeDialog(props: {
    isOpen: boolean
    onClose: () => void
    onSnooze: (until: number) => Promise<void>
}) {
    const { t } = useTranslation()
    const { isOpen, onClose, onSnooze } = props
    const [now, setNow] = useState(() => Date.now())
    const [custom, setCustom] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, setPending] = useState(false)

    useEffect(() => {
        if (!isOpen) return
        const openedAt = Date.now()
        setNow(openedAt)
        setCustom(toDateTimeLocalValue(getNextSnoozeWake(new Date(openedAt))))
        setError(null)
    }, [isOpen])

    const apply = async (until: number) => {
        setPending(true)
        setError(null)
        try {
            await onSnooze(until)
            onClose()
        } catch {
            setError(t('dialog.snooze.failed'))
        } finally {
            setPending(false)
        }
    }

    const handleSubmit = (event: React.FormEvent) => {
        event.preventDefault()
        // datetime-local values carry no zone, so Date reads them as local time.
        const until = new Date(custom).getTime()
        if (!Number.isFinite(until) || until <= Date.now()) {
            setError(t('dialog.snooze.past'))
            return
        }
        void apply(until)
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{t('dialog.snooze.title')}</DialogTitle>
                </DialogHeader>
                <div className="mt-4 flex flex-col gap-4">
                    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
                        <FormField label={t('dialog.snooze.wakeAt')} htmlFor="session-snooze-custom">
                            <TextField
                                id="session-snooze-custom"
                                type="datetime-local"
                                value={custom}
                                min={toDateTimeLocalValue(now)}
                                onChange={(event) => {
                                    setCustom(event.target.value)
                                    setError(null)
                                }}
                                disabled={pending}
                            />
                        </FormField>
                        {error ? <div className="text-footnote text-[var(--social-danger)]">{error}</div> : null}
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                                {t('button.cancel')}
                            </Button>
                            <Button type="submit" disabled={pending || !custom}>
                                {t('dialog.snooze.confirm')}
                            </Button>
                        </div>
                    </form>
                </div>
            </DialogContent>
        </Dialog>
    )
}
