import { AttachmentPrimitive, useThreadComposerAttachment } from '@assistant-ui/react'
import { Spinner } from '@/components/Spinner'
import { IconButton } from '@/components/ui/IconButton'
import { HIT_AREA_24_CLASS } from '@/components/AssistantChat/hitArea'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

function ErrorIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11" r="0.75" fill="currentColor" />
        </svg>
    )
}

function RemoveIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <line x1="3" y1="3" x2="9" y2="9" />
            <line x1="9" y1="3" x2="3" y2="9" />
        </svg>
    )
}

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
                    <ErrorIcon />
                </span>
            ) : null}
            <span className="max-w-[180px] truncate">{name}</span>
            <AttachmentPrimitive.Remove asChild>
                <IconButton size="sm" label={t('composer.attachment.remove')} className={cn('ml-auto h-6 w-6', HIT_AREA_24_CLASS)}>
                    <RemoveIcon />
                </IconButton>
            </AttachmentPrimitive.Remove>
        </AttachmentPrimitive.Root>
    )
}
