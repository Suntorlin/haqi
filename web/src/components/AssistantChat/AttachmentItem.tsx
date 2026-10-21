import { AttachmentPrimitive, useThreadComposerAttachment } from '@assistant-ui/react'
import { Spinner } from '@/components/Spinner'
import { IconButton } from '@/components/ui/IconButton'
import { AlertCircleIcon, CloseIcon } from '@/components/mobile/icons'
import { useTranslation } from '@/lib/use-translation'

export function AttachmentItem() {
    const { t } = useTranslation()
    const { name, status } = useThreadComposerAttachment()
    const isUploading = status.type === 'running'
    const isError = status.type === 'incomplete'

    return (
        <AttachmentPrimitive.Root className="flex items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--social-surface)] py-1 pl-3.5 pr-1 text-footnote text-[var(--social-fg)]">
            {isUploading ? <Spinner size="sm" label={null} className="text-[var(--social-fg-subtle)]" /> : null}
            {isError ? (
                <span className="text-[var(--social-danger)]">
                    <AlertCircleIcon className="h-4 w-4" />
                </span>
            ) : null}
            <span className="max-w-[180px] truncate">{name}</span>
            <AttachmentPrimitive.Remove asChild>
                <IconButton size="xs" label={t('composer.attachment.remove')} className="ml-auto">
                    <CloseIcon className="h-3.5 w-3.5" />
                </IconButton>
            </AttachmentPrimitive.Remove>
        </AttachmentPrimitive.Root>
    )
}
