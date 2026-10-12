import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { LazyRainbowText } from '@/components/LazyRainbowText'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { Reasoning, ReasoningGroup } from '@/components/assistant-ui/reasoning'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { AgentAvatar } from '@/components/mobile/SessionAvatar'
import { formatChatTimestamp } from '@/components/mobile/chatTimeline'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { useTranslation } from '@/lib/use-translation'

export function ChatTimeSeparator(props: { at: number }) {
    const { t, locale } = useTranslation()
    return (
        <div className="flex justify-center py-1" role="separator">
            <span className="rounded-md bg-[var(--social-pill-bg)] px-2 py-0.5 text-[11.5px] leading-[18px] text-[var(--app-hint)]">
                {formatChatTimestamp(props.at, locale, t('mobile.time.yesterday'))}
            </span>
        </div>
    )
}

function useTimeSeparatorAt(messageId: string): number | undefined {
    const ctx = useHappyChatContext()
    return ctx.timeSeparators?.get(messageId)
}

function SocialBubbleText() {
    const isEmpty = useAssistantState(({ part }) => part.type === 'text' && part.text.trim().length === 0)
    if (isEmpty) return null
    return (
        <div className="social-bubble-peer w-fit min-w-0 max-w-full rounded-[18px] rounded-tl-[6px] px-3.5 py-2.5 shadow-[0_1px_0.5px_rgba(0,0,0,0.06)]">
            <MarkdownText />
        </div>
    )
}

const SOCIAL_PART_COMPONENTS = {
    Text: SocialBubbleText,
    Reasoning: Reasoning,
    ReasoningGroup: ReasoningGroup,
    tools: { Fallback: HappyToolMessage }
} as const

/** Agent turn: round avatar on the left, every text part in its own white bubble (WeChat). */
export function SocialAssistantMessage() {
    const ctx = useHappyChatContext()
    const messageId = useAssistantState(({ message }) => message.id)
    const isCliOutput = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const cliText = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        if (custom?.kind !== 'cli-output') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    const separatorAt = useTimeSeparatorAt(messageId)

    return (
        <MessagePrimitive.Root className="flex min-w-0 max-w-full flex-col gap-2" data-happy-message-id={messageId}>
            {separatorAt !== undefined ? <ChatTimeSeparator at={separatorAt} /> : null}
            <div className="flex min-w-0 items-start gap-2">
                <AgentAvatar flavor={ctx.metadata?.flavor} size={32} className="mt-0.5" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 overflow-x-hidden pr-1">
                    {isCliOutput ? (
                        <CliOutputBlock text={cliText} />
                    ) : (
                        <MessagePrimitive.Content components={SOCIAL_PART_COMPONENTS} />
                    )}
                </div>
            </div>
        </MessagePrimitive.Root>
    )
}

/** Own message: green bubble on the right; failed sends show the retry mark on the left like WeChat. */
export function SocialUserMessage() {
    const ctx = useHappyChatContext()
    const messageId = useAssistantState(({ message }) => message.id)
    const role = useAssistantState(({ message }) => message.role)
    const text = useAssistantState(({ message }) => {
        if (message.role !== 'user') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    const status = useAssistantState(({ message }) => {
        if (message.role !== 'user') return undefined
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.status
    })
    const localId = useAssistantState(({ message }) => {
        if (message.role !== 'user') return null
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.localId ?? null
    })
    const attachments = useAssistantState(({ message }) => {
        if (message.role !== 'user') return undefined
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.attachments
    })
    const isCliOutput = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const separatorAt = useTimeSeparatorAt(messageId)

    if (role !== 'user') return null
    const canRetry = status === 'failed' && typeof localId === 'string' && Boolean(ctx.onRetryMessage)
    const onRetry = canRetry ? () => ctx.onRetryMessage!(localId) : undefined
    const hasAttachments = Boolean(attachments && attachments.length > 0)

    return (
        <MessagePrimitive.Root className="flex min-w-0 max-w-full flex-col gap-2" data-happy-message-id={messageId}>
            {separatorAt !== undefined ? <ChatTimeSeparator at={separatorAt} /> : null}
            {isCliOutput ? (
                <div className="ml-auto w-full max-w-[88%]">
                    <CliOutputBlock text={text} />
                </div>
            ) : (
                <div className="flex min-w-0 items-end justify-end gap-1.5 pl-10">
                    {status ? (
                        <div className="shrink-0 pb-1.5">
                            <MessageStatusIndicator status={status} onRetry={onRetry} />
                        </div>
                    ) : null}
                    <div className="social-bubble-self min-w-0 max-w-full rounded-[18px] rounded-br-[6px] px-3.5 py-2 text-[15px] leading-[1.55] shadow-[0_1px_0.5px_rgba(0,0,0,0.08)] break-words [overflow-wrap:anywhere]">
                        {text.length > 0 ? <LazyRainbowText text={text} /> : null}
                        {hasAttachments && attachments ? <MessageAttachments attachments={attachments} /> : null}
                    </div>
                </div>
            )}
        </MessagePrimitive.Root>
    )
}
