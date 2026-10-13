import { useAssistantState } from '@assistant-ui/react'
import { getEventPresentation, formatUnixTimestamp } from '@/chat/presentation'
import type { AgentEvent } from '@/chat/types'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { ChatTimeSeparator } from '@/components/AssistantChat/messages/SocialMessages'
import { useTranslation } from '@/lib/use-translation'

const PROMINENT_EVENT_TYPES = new Set(['rate-limit', 'limit-reached', 'api-error'])

function isProminentEvent(event: AgentEvent | undefined): event is AgentEvent {
    return event != null && PROMINENT_EVENT_TYPES.has(event.type)
}

function ProminentEventCard({ event, text }: { event: AgentEvent; text: string }) {
    const { t } = useTranslation()
    const isError = event.type === 'api-error'
    const borderClass = isError
        ? 'border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)]'
        : 'border-[var(--app-badge-warning-border)] bg-[var(--app-badge-warning-bg)]'
    const textClass = isError
        ? 'text-[var(--app-badge-error-text)]'
        : 'text-[var(--app-badge-warning-text)]'

    const resetsAt = 'resetsAt' in event && typeof event.resetsAt === 'number' && event.resetsAt > 0
        ? event.resetsAt
        : 'endsAt' in event && typeof event.endsAt === 'number' && event.endsAt > 0
            ? event.endsAt
            : null

    return (
        <div className={`mx-auto max-w-[88%] rounded-2xl border px-3 py-2 sm:max-w-[84%] lg:max-w-[76%] ${borderClass}`}>
            <div className={`flex items-center gap-2 text-xs font-semibold ${textClass}`}>
                <span className="shrink-0">⚠️</span>
                <span>{text}</span>
            </div>
            {resetsAt ? (
                <div className={`mt-1 text-[12px] opacity-75 ${textClass}`}>
                    {t('event.resetsAt', { time: formatUnixTimestamp(resetsAt) })}
                </div>
            ) : null}
        </div>
    )
}

export function HappySystemMessage() {
    const { t } = useTranslation()
    const ctx = useOptionalHappyChatContext()
    const isSocial = ctx?.layout === 'social'
    const messageId = useAssistantState(({ message }) => message.id)
    const role = useAssistantState(({ message }) => message.role)
    const text = useAssistantState(({ message }) => {
        if (message.role !== 'system') return ''
        return message.content[0]?.type === 'text' ? message.content[0].text : ''
    })
    const event = useAssistantState(({ message }) => {
        if (message.role !== 'system') return undefined
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'event' ? custom.event : undefined
    })

    if (role !== 'system') return null

    const presentation = event ? getEventPresentation(event, t) : null

    if (isProminentEvent(event)) {
        return (
            <div className="py-1.5" data-happy-message-id={messageId}>
                <ProminentEventCard event={event} text={presentation?.text ?? text} />
            </div>
        )
    }

    const icon = presentation?.icon ?? null
    // Events carry an English label in the thread; show the translated presentation instead.
    const label = presentation?.text ?? text

    if (isSocial) {
        const separatorAt = ctx?.timeSeparators?.get(messageId)
        return (
            <div className="flex flex-col gap-2" data-happy-message-id={messageId}>
                {separatorAt !== undefined ? <ChatTimeSeparator at={separatorAt} /> : null}
                <div className="flex justify-center">
                    <span className="inline-flex max-w-[85%] items-center gap-1 rounded-full bg-[var(--social-muted)] px-3 py-1 text-center text-[12px] leading-snug text-[var(--social-fg-muted)]">
                        {icon ? <span aria-hidden="true">{icon}</span> : null}
                        <span>{label}</span>
                    </span>
                </div>
            </div>
        )
    }

    return (
        <div className="py-1" data-happy-message-id={messageId}>
            <div className="mx-auto w-fit max-w-[88%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80 sm:max-w-[84%] lg:max-w-[76%]">
                <span className="inline-flex items-center gap-1">
                    {icon ? <span aria-hidden="true">{icon}</span> : null}
                    <span>{label}</span>
                </span>
            </div>
        </div>
    )
}
