import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { LazyRainbowText } from '@/components/LazyRainbowText'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { Reasoning } from '@/components/assistant-ui/reasoning'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { Orb } from '@/components/mobile/SessionAvatar'
import { formatChatTimestamp, formatElapsed, getLatestProgressText } from '@/components/mobile/chatTimeline'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export function ChatTimeSeparator(props: { at: number }) {
    const { t, locale } = useTranslation()
    return (
        <div className="flex justify-center py-1" role="separator">
            <span className="text-[11.5px] leading-[18px] text-[var(--social-fg-subtle)]">
                {formatChatTimestamp(props.at, locale, t('mobile.time.yesterday'))}
            </span>
        </div>
    )
}

function useTimeSeparatorAt(messageId: string): number | undefined {
    const ctx = useHappyChatContext()
    return ctx.timeSeparators?.get(messageId)
}

function useNow(intervalMs: number): number {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
        return () => window.clearInterval(timer)
    }, [intervalMs])
    return now
}

type MessagePartLike = {
    type: string
    text?: string
    result?: unknown
    artifact?: unknown
}

function asToolCallBlock(value: unknown): ToolCallBlock | null {
    if (!value || typeof value !== 'object') return null
    const block = value as Partial<ToolCallBlock>
    if (block.kind !== 'tool-call' || !block.tool || !Array.isArray(block.children)) return null
    return block as ToolCallBlock
}

function hasPendingPermission(block: ChatBlock): boolean {
    if (block.kind !== 'tool-call') return false
    if (block.tool.permission?.status === 'pending') return true
    return block.children.some(hasPendingPermission)
}

type TurnLayout = {
    /** Final reply: trailing text after the last tool call (falls back to the last text). */
    answerIndices: number[]
    /** Everything else, in order: earlier text, reasoning and tool calls. */
    processIndices: number[]
    /** Tool calls waiting for the user's approval; always visible. */
    pendingIndices: number[]
    steps: number
    /** Latest agent text, only while it is still recent (at most one tool call after it). */
    latestText: string | null
    current:
        | { kind: 'tool'; block: ToolCallBlock }
        | { kind: 'between-steps'; lastBlock: ToolCallBlock }
        | { kind: 'reasoning' }
        | { kind: 'text' }
        | null
}

function hasText(part: MessagePartLike): boolean {
    return part.type === 'text' && typeof part.text === 'string' && part.text.trim().length > 0
}

/** Splits one merged agent turn into "final reply" vs "process" (WeChat-simple, details on demand). */
function computeTurnLayout(parts: readonly MessagePartLike[]): TurnLayout {
    let lastToolIndex = -1
    let previousToolIndex = -1
    let lastTextIndex = -1
    let steps = 0
    parts.forEach((part, index) => {
        if (part.type === 'tool-call') {
            previousToolIndex = lastToolIndex
            lastToolIndex = index
            steps += 1
        }
        if (hasText(part)) lastTextIndex = index
    })

    let answerIndices = parts
        .map((part, index) => (index > lastToolIndex && hasText(part) ? index : -1))
        .filter((index) => index >= 0)
    if (answerIndices.length === 0 && lastTextIndex >= 0) {
        answerIndices = [lastTextIndex]
    }

    const pendingIndices: number[] = []
    parts.forEach((part, index) => {
        if (part.type !== 'tool-call') return
        const block = asToolCallBlock(part.artifact)
        if (block && hasPendingPermission(block)) pendingIndices.push(index)
    })

    const hidden = new Set([...answerIndices, ...pendingIndices])
    const processIndices = parts
        .map((part, index) => (!hidden.has(index) && (part.type !== 'text' || hasText(part)) ? index : -1))
        .filter((index) => index >= 0)

    const lastPart = parts[parts.length - 1]
    let current: TurnLayout['current'] = null
    if (lastPart?.type === 'tool-call') {
        const block = asToolCallBlock(lastPart.artifact)
        if (block) {
            current = lastPart.result === undefined ? { kind: 'tool', block } : { kind: 'between-steps', lastBlock: block }
        }
    } else if (lastPart?.type === 'reasoning') {
        current = { kind: 'reasoning' }
    } else if (lastPart?.type === 'text') {
        current = { kind: 'text' }
    }

    const latestText = lastTextIndex >= 0 && lastTextIndex > previousToolIndex
        ? parts[lastTextIndex].text ?? null
        : null

    return { answerIndices, processIndices, pendingIndices, steps, latestText, current }
}

function ProcessReasoning() {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    return (
        <div className="min-w-0">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="flex items-center gap-1.5 py-0.5 text-[12.5px] text-[var(--social-fg-muted)]"
            >
                <ChevronIcon className={cn('h-3 w-3 transition-transform', open ? 'rotate-90' : '')} />
                {t('mobile.turn.reasoning')}
            </button>
            {open ? (
                <div className="mt-1 pl-4">
                    <Reasoning />
                </div>
            ) : null}
        </div>
    )
}

function ProcessText() {
    return (
        <div className="min-w-0 max-w-full">
            <MarkdownText />
        </div>
    )
}

const ANSWER_COMPONENTS = { Text: MarkdownText } as const

/** Long turns render only their latest steps first; earlier ones load on demand. */
const PROCESS_PAGE_SIZE = 20

function getChatViewport(element: HTMLElement | null): HTMLElement | null {
    return element?.closest<HTMLElement>('.social-chat') ?? null
}

const PROCESS_COMPONENTS = {
    Text: ProcessText,
    Reasoning: ProcessReasoning,
    tools: { Fallback: HappyToolMessage }
} as const

function ChevronIcon(props: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={props.className} aria-hidden="true">
            <polyline points="9 6 15 12 9 18" />
        </svg>
    )
}

/** While the agent works: one quiet card with the current step and its latest words. */
function LiveStatusCard(props: { layout: TurnLayout; startAt: number; partial: boolean }) {
    const { t } = useTranslation()
    const ctx = useHappyChatContext()
    const now = useNow(1000)
    const { layout } = props

    const describe = (block: ToolCallBlock) => getToolPresentation({
        toolName: block.tool.name,
        input: block.tool.input,
        result: block.tool.result,
        childrenCount: block.children.length,
        description: block.tool.description,
        metadata: ctx.metadata
    })
    const runningTool = layout.current?.kind === 'tool' ? describe(layout.current.block) : null
    const finishedTool = layout.current?.kind === 'between-steps' ? describe(layout.current.lastBlock) : null
    let title: string
    if (layout.pendingIndices.length > 0) {
        title = t('mobile.turn.waitingApproval')
    } else if (runningTool) {
        title = runningTool.title
    } else if (layout.current?.kind === 'reasoning' || finishedTool) {
        title = t('mobile.turn.thinking')
    } else if (layout.current?.kind === 'text') {
        title = t('mobile.turn.replying')
    } else {
        title = t('mobile.turn.working')
    }
    const toolDetail = runningTool?.subtitle ?? (finishedTool ? `✓ ${finishedTool.title}` : null)

    const progress = layout.latestText ? getLatestProgressText(layout.latestText) : null
    // When the turn's start is not loaded yet, counts are lower bounds and the timer would lie.
    const meta = [
        layout.steps > 0 ? t('mobile.turn.step', { n: props.partial ? `${layout.steps}+` : layout.steps }) : null,
        props.partial ? null : formatElapsed(now - props.startAt, t)
    ].filter(Boolean).join(' · ')

    return (
        <div className="social-card w-full min-w-0 rounded-[20px] rounded-tl-md px-4 py-3" role="status" aria-live="polite">
            <div className="flex min-w-0 items-center gap-2.5">
                <span className="social-spinner shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-[var(--social-fg)]">{title}</span>
            </div>
            {progress ? (
                <p className="mt-1.5 line-clamp-3 pl-[24px] text-[14px] leading-relaxed text-[var(--social-fg-muted)]">{progress}</p>
            ) : toolDetail ? (
                <p className="mt-1.5 truncate pl-[24px] font-mono text-[12.5px] text-[var(--social-fg-muted)]">{toolDetail}</p>
            ) : null}
            <div className="mt-1.5 pl-[24px] text-[12px] tabular-nums text-[var(--social-fg-subtle)]">{meta}</div>
        </div>
    )
}

/** After the agent finishes: only the conclusion; long-press (or the footer) reveals the process. */
export function SocialAssistantMessage() {
    const { t } = useTranslation()
    const ctx = useHappyChatContext()
    const { haptic } = usePlatform()
    const { copied, copy } = useCopyToClipboard()
    const messageId = useAssistantState(({ message }) => message.id)
    const createdAt = useAssistantState(({ message }) => message.createdAt)
    const content = useAssistantState(({ message }) => message.content) as readonly MessagePartLike[]
    const isRunning = useAssistantState(({ message }) => message.status?.type === 'running')
    const isCliOutput = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const separatorAt = useTimeSeparatorAt(messageId)
    const layout = useMemo(() => computeTurnLayout(content), [content])
    const [expanded, setExpanded] = useState(false)
    const [processLimit, setProcessLimit] = useState(PROCESS_PAGE_SIZE)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const footerRef = useRef<HTMLButtonElement | null>(null)
    const processRef = useRef<HTMLDivElement | null>(null)
    const collapsingRef = useRef(false)

    const expandProcess = () => {
        ctx.holdAutoScroll?.()
        flushSync(() => setExpanded(true))
        const viewport = getChatViewport(rootRef.current)
        const footer = footerRef.current
        if (!viewport || !footer) return
        // When the footer sits low on screen, glide up so the start of the process is visible.
        const box = viewport.getBoundingClientRect()
        const footerTop = footer.getBoundingClientRect().top
        if (footerTop > box.top + box.height * 0.55) {
            viewport.scrollTo({ top: viewport.scrollTop + footerTop - (box.top + box.height * 0.3), behavior: 'smooth' })
        }
    }

    // Fold the process away in place: the spot the user tapped stays put, content above slides down
    // into view and the shrinking process keeps the space filled (no jump, no blank area).
    const collapseProcess = (anchor: 'footer' | 'end') => {
        const viewport = getChatViewport(rootRef.current)
        const process = processRef.current
        const footer = footerRef.current
        if (!viewport || !process || !footer || collapsingRef.current) {
            if (!collapsingRef.current) setExpanded(false)
            return
        }
        collapsingRef.current = true
        const startHeight = process.offsetHeight
        const duration = Math.min(420, Math.max(240, startHeight * 0.28))
        ctx.holdAutoScroll?.(duration + 300)
        const anchorY = () => anchor === 'footer'
            ? footer.getBoundingClientRect().top
            : process.getBoundingClientRect().bottom
        const startAnchorY = anchorY()
        process.style.animation = 'none'
        process.style.overflow = 'hidden'
        process.style.height = `${startHeight}px`
        const startedAt = performance.now()
        const step = (now: number) => {
            const progress = Math.min(1, (now - startedAt) / duration)
            const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2
            process.style.height = `${startHeight * (1 - eased)}px`
            viewport.scrollTop += anchorY() - startAnchorY
            if (progress < 1) {
                requestAnimationFrame(step)
                return
            }
            const footerTop = footer.getBoundingClientRect().top
            flushSync(() => {
                setExpanded(false)
                setProcessLimit(PROCESS_PAGE_SIZE)
            })
            viewport.scrollTop += footer.getBoundingClientRect().top - footerTop
            collapsingRef.current = false
        }
        requestAnimationFrame(step)
    }

    const toggleProcess = () => {
        if (expanded) {
            collapseProcess('footer')
        } else {
            expandProcess()
        }
    }

    // Reveal earlier steps above the visible ones without moving what is on screen.
    const showEarlierSteps = () => {
        const viewport = getChatViewport(rootRef.current)
        const firstVisible = processRef.current?.querySelector<HTMLElement>('.social-process-item')
        const before = firstVisible?.getBoundingClientRect().top ?? null
        ctx.holdAutoScroll?.()
        flushSync(() => setProcessLimit((limit) => limit + PROCESS_PAGE_SIZE * 2))
        if (viewport && firstVisible && before !== null) {
            viewport.scrollTop += firstVisible.getBoundingClientRect().top - before
        }
    }

    const longPressHandlers = useLongPress({
        onLongPress: () => {
            haptic.impact('medium')
            toggleProcess()
        },
        threshold: 450
    })

    const stats = ctx.runStats?.get(messageId)
    const startAt = stats?.startAt ?? createdAt?.getTime() ?? Date.now()
    const hasProcess = layout.processIndices.length > 0
    const visibleProcessIndices = layout.processIndices.slice(-processLimit)
    const hiddenProcessCount = layout.processIndices.length - visibleProcessIndices.length
    const answerText = layout.answerIndices
        .map((index) => content[index]?.text ?? '')
        .join('\n\n')
        .trim()
    const partial = stats?.partial ?? false
    const footer = [
        layout.steps > 0 ? t('mobile.turn.steps', { n: partial ? `${layout.steps}+` : layout.steps }) : t('mobile.turn.reasoning'),
        stats && !partial ? t('mobile.turn.took', { d: formatElapsed(stats.endAt - stats.startAt, t) }) : null
    ].filter(Boolean).join(' · ')

    return (
        <MessagePrimitive.Root ref={rootRef} className="flex min-w-0 max-w-full flex-col gap-2" data-happy-message-id={messageId}>
            {separatorAt !== undefined ? <ChatTimeSeparator at={separatorAt} /> : null}
            <div className="flex min-w-0 items-start gap-2.5">
                <Orb seed={ctx.sessionId} size={28} muted={ctx.disabled} className="mt-1" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5 overflow-x-hidden pr-1">
                    {isCliOutput ? (
                        <CliOutputBlock text={content.find((part) => part.type === 'text')?.text ?? ''} />
                    ) : isRunning ? (
                        <LiveStatusCard layout={layout} startAt={startAt} partial={stats?.partial ?? false} />
                    ) : (
                        <>
                            {layout.answerIndices.length > 0 ? (
                                <div
                                    {...longPressHandlers}
                                    className="social-card w-fit min-w-0 max-w-full select-none rounded-[20px] rounded-tl-md px-4 py-3 [&>*+*]:mt-3"
                                    style={{ WebkitTouchCallout: 'none' }}
                                >
                                    {layout.answerIndices.map((index) => (
                                        <MessagePrimitive.PartByIndex key={index} index={index} components={ANSWER_COMPONENTS} />
                                    ))}
                                </div>
                            ) : (
                                <div
                                    {...longPressHandlers}
                                    className="social-card w-fit select-none rounded-[20px] rounded-tl-md px-4 py-2.5 text-[14px] text-[var(--social-fg-muted)]"
                                    style={{ WebkitTouchCallout: 'none' }}
                                >
                                    {layout.steps > 0 ? t('mobile.turn.done', { n: layout.steps }) : t('mobile.turn.noReply')}
                                </div>
                            )}

                            {hasProcess ? (
                                <button
                                    ref={footerRef}
                                    type="button"
                                    onClick={toggleProcess}
                                    aria-expanded={expanded}
                                    className="flex w-fit items-center gap-1 px-1 text-[12px] text-[var(--social-fg-subtle)] [-webkit-tap-highlight-color:transparent]"
                                >
                                    {footer}
                                    <ChevronIcon className={cn('h-3 w-3 transition-transform', expanded ? '-rotate-90' : 'rotate-90')} />
                                </button>
                            ) : null}

                            {expanded ? (
                                <div ref={processRef} className="social-process animate-process-in ml-1 flex min-w-0 flex-col gap-2 py-1 pl-3.5">
                                    {hiddenProcessCount > 0 ? (
                                        <button
                                            type="button"
                                            onClick={showEarlierSteps}
                                            className="w-fit rounded-full bg-[var(--social-muted)] px-3 py-1 text-[12px] text-[var(--social-fg-muted)]"
                                        >
                                            {t('mobile.turn.showEarlier', { n: hiddenProcessCount })}
                                        </button>
                                    ) : null}
                                    {visibleProcessIndices.map((index) => (
                                        <div key={index} className="social-process-item min-w-0">
                                            <MessagePrimitive.PartByIndex index={index} components={PROCESS_COMPONENTS} />
                                        </div>
                                    ))}
                                    <div className="flex gap-4 pt-1 text-[12px] text-[var(--social-fg-muted)]">
                                        {answerText ? (
                                            <button type="button" onClick={() => void copy(answerText)}>
                                                {copied ? t('mobile.turn.copied') : t('mobile.turn.copy')}
                                            </button>
                                        ) : null}
                                        <button type="button" onClick={() => collapseProcess('end')}>
                                            {t('mobile.turn.hideProcess')}
                                        </button>
                                    </div>
                                </div>
                            ) : null}
                        </>
                    )}

                    {layout.pendingIndices.map((index) => (
                        <MessagePrimitive.PartByIndex key={index} index={index} components={PROCESS_COMPONENTS} />
                    ))}
                </div>
            </div>
        </MessagePrimitive.Root>
    )
}

/** Own message: dark pill on the right; failed sends show the retry mark on the left. */
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
                <div className="flex min-w-0 items-end justify-end gap-1.5 pl-12">
                    {status ? (
                        <div className="shrink-0 pb-1.5">
                            <MessageStatusIndicator status={status} onRetry={onRetry} />
                        </div>
                    ) : null}
                    <div className="social-bubble-self min-w-0 max-w-full rounded-[20px] rounded-br-md px-4 py-2.5 text-[15px] leading-[1.55] break-words [overflow-wrap:anywhere]">
                        {text.length > 0 ? <LazyRainbowText text={text} /> : null}
                        {hasAttachments && attachments ? <MessageAttachments attachments={attachments} /> : null}
                    </div>
                </div>
            )}
        </MessagePrimitive.Root>
    )
}
