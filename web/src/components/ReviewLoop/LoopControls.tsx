import { useState } from 'react'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { cn } from '@/lib/utils'
import type { ReviewLoopStatus } from '@/types/api'

type LoopControlsProps = {
    status: ReviewLoopStatus
    onContinue: (instruction?: string) => void
    onPause: () => void
    onCancel: () => void
    isPending: boolean
}

function StatusIndicator({ status }: { status: ReviewLoopStatus }) {
    if (status === 'executing') {
        return <Badge variant="warning" dot live>Executing...</Badge>
    }

    if (status === 'reviewing') {
        return <Badge variant="info" dot live>Reviewing...</Badge>
    }

    // Terminal states: accepted, aborted, canceled — show nothing
    return null
}

export function LoopControls({ status, onContinue, onPause, onCancel, isPending }: LoopControlsProps) {
    const [instruction, setInstruction] = useState('')
    const [showCancelConfirm, setShowCancelConfirm] = useState(false)

    const cancelDialog = (
        <ConfirmDialog
            isOpen={showCancelConfirm}
            onClose={() => setShowCancelConfirm(false)}
            title="Cancel Review Loop"
            description="Are you sure you want to cancel this review loop? This action cannot be undone."
            confirmLabel="Cancel Loop"
            confirmingLabel="Canceling..."
            onConfirm={async () => {
                onCancel()
            }}
            isPending={isPending}
            destructive
        />
    )

    // Active states: show pause + cancel buttons
    if (status === 'executing' || status === 'reviewing') {
        return (
            <div className="flex flex-col items-start gap-3">
                <StatusIndicator status={status} />
                <div className="flex flex-wrap items-center gap-2">
                    <Button type="button" variant="secondary" onClick={onPause} disabled={isPending}>
                        {isPending ? 'Pausing...' : 'Pause'}
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        className="text-[var(--social-danger)]"
                        onClick={() => setShowCancelConfirm(true)}
                        disabled={isPending}
                    >
                        Cancel
                    </Button>
                </div>

                {cancelDialog}
            </div>
        )
    }

    // Paused or waiting_user: show instruction input + continue/cancel
    if (status === 'paused' || status === 'waiting_user') {
        const handleContinue = () => {
            onContinue(instruction.trim() || undefined)
            setInstruction('')
        }

        const handleKeyDown = (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                handleContinue()
            }
        }

        return (
            <>
                <div className="flex min-w-0 flex-col gap-3">
                    <div className="text-[15px] font-semibold text-[var(--social-fg)]">
                        {status === 'paused' ? 'Paused — Add Instructions' : 'Action Required'}
                    </div>

                    {status === 'paused' && (
                        <div className="rounded-xl bg-[var(--app-badge-warning-bg)] px-3 py-2 text-[13px] text-[var(--app-badge-warning-text)]">
                            Loop paused. Add your instructions for the reviewer below, then continue.
                        </div>
                    )}

                    <label className="flex min-w-0 flex-col gap-1.5">
                        <span className="px-1 text-[13px] text-[var(--social-fg-muted)]">
                            {status === 'paused' ? 'Instructions for reviewer:' : 'Additional instruction (optional):'}
                        </span>
                        <textarea
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="..."
                            className={cn(DIALOG_INPUT_CLASS, 'min-w-0 resize-none')}
                            rows={3}
                            disabled={isPending}
                            autoFocus={status === 'paused'}
                        />
                    </label>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="text-[var(--social-danger)]"
                            onClick={() => setShowCancelConfirm(true)}
                            disabled={isPending}
                        >
                            Cancel
                        </Button>
                        <Button type="button" onClick={handleContinue} disabled={isPending}>
                            {isPending ? 'Sending...' : 'Continue'}
                        </Button>
                    </div>
                </div>

                {cancelDialog}
            </>
        )
    }

    return null
}
