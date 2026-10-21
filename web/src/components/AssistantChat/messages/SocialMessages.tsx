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
import { formatChatTimestamp, formatElapsed, getLatestProgressText } from '@/components/mobile/chatTimeline'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { HIT_AREA_24_CLASS, HIT_AREA_28_CLASS, TEXT_HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { extractReportLinks } from '@/components/AssistantChat/reportLinks'
import { FileIcon } from '@/components/mobile/icons'
import { useOpenInPreview } from '@/lib/preview-link'
import { setFollowingRunningTurn } from '@/lib/message-window-store'
import { useChatZoom, ZoomMorphText } from '@/components/AssistantChat/chatZoom'
import { replyZoomVersions, userZoomVersions, ZOOM_ALL, ZOOM_BRIEF, ZOOM_REPLY } from '@/components/AssistantChat/chatZoomText'

export function ChatTimeSeparator(props: { at: number }) {
    const { t, locale } = useTranslation()
    return (
        <div className="flex justify-center py-1" role="separator">
            <span className="text-caption leading-[1.125rem] text-[var(--social-fg-subtle)]">
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
    /** Reply: trailing text after the last tool call (falls back to the last text), plus any longer text said mid-turn. */
    answerIndices: number[]
    /** Everything else, in order: earlier text, reasoning and tool calls. */
    processIndices: number[]
    /** While the turn runs: every step so far, in order, the reply being written included. */
    liveIndices: number[]
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

const NARRATION_MAX_LENGTH = 120

/** A short one-line status ("Let me check the logs.") belongs to the process; longer text is said to the user. */
function isNarration(text: string): boolean {
    const trimmed = text.trim()
    return !trimmed.includes('\n') && trimmed.length <= NARRATION_MAX_LENGTH
}

/** Splits one merged agent turn into "final reply" vs "process" (WeChat-simple, details on demand). */
export function computeTurnLayout(parts: readonly MessagePartLike[]): TurnLayout {
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

    const trailingTextIndices = parts
        .map((part, index) => (index > lastToolIndex && hasText(part) ? index : -1))
        .filter((index) => index >= 0)
    const replyIndices = new Set(trailingTextIndices.length > 0 || lastTextIndex < 0 ? trailingTextIndices : [lastTextIndex])
    // An answer written mid-turn (the agent replied, then kept working) must not fold away with the steps.
    const answerIndices = parts
        .map((part, index) => (hasText(part) && (replyIndices.has(index) || !isNarration(part.text ?? '')) ? index : -1))
        .filter((index) => index >= 0)

    const pendingIndices: number[] = []
    parts.forEach((part, index) => {
        if (part.type !== 'tool-call') return
        const block = asToolCallBlock(part.artifact)
        if (block && hasPendingPermission(block)) pendingIndices.push(index)
    })

    const isShown = (part: MessagePartLike) => part.type !== 'text' || hasText(part)
    const hidden = new Set([...answerIndices, ...pendingIndices])
    const processIndices = parts
        .map((part, index) => (!hidden.has(index) && isShown(part) ? index : -1))
        .filter((index) => index >= 0)
    const pending = new Set(pendingIndices)
    const liveIndices = parts
        .map((part, index) => (!pending.has(index) && isShown(part) ? index : -1))
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

    return { answerIndices, processIndices, liveIndices, pendingIndices, steps, latestText, current }
}

function ProcessReasoning() {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    return (
        <div className="min-w-0">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className={cn('flex items-center gap-1.5 py-0.5 text-footnote text-[var(--social-fg-muted)]', TEXT_HIT_AREA_CLASS)}
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

/**
 * While the agent works: one quiet card with the current step and its latest words. The step count
 * opens the steps done so far, as the footer of a finished turn does.
 */
function LiveStatusCard(props: {
    layout: TurnLayout
    startAt: number
    partial: boolean
    expanded: boolean
    onToggle?: () => void
    toggleRef?: React.Ref<HTMLButtonElement>
    pressProps?: React.HTMLAttributes<HTMLDivElement>
    pressClass?: string
}) {
    const { t } = useTranslation()
    const ctx = useHappyChatContext()
    const now = useNow(1000)
    const { layout } = props

    const describe = (block: ToolCallBlock) => getToolPresentation({
        t,
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
        <div {...props.pressProps} className={cn('social-card w-full min-w-0 rounded-2xl rounded-tl-md px-4 py-3', props.pressClass)}>
            <div className="flex min-w-0 items-center gap-2.5">
                <span className="social-spinner shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-body font-semibold text-[var(--social-fg)]">{title}</span>
            </div>
            {progress ? (
                <p className="mt-1.5 line-clamp-3 pl-[24px] text-body leading-relaxed text-[var(--social-fg-muted)]">{progress}</p>
            ) : toolDetail ? (
                <p className="mt-1.5 truncate pl-[24px] font-mono text-footnote text-[var(--social-fg-muted)]">{toolDetail}</p>
            ) : null}
            {props.onToggle ? (
                <button
                    ref={props.toggleRef}
                    type="button"
                    onClick={props.onToggle}
                    aria-expanded={props.expanded}
                    className={cn('ml-[24px] mt-1.5 flex w-fit items-center gap-1 text-caption tabular-nums text-[var(--social-fg-subtle)] transition-colors hover:text-[var(--social-fg-muted)] [-webkit-tap-highlight-color:transparent]', TEXT_HIT_AREA_CLASS)}
                >
                    {meta}
                    <ChevronIcon className={cn('h-3 w-3 transition-transform', props.expanded ? '-rotate-90' : 'rotate-90')} />
                </button>
            ) : (
                <div className="mt-1.5 pl-[24px] text-caption tabular-nums text-[var(--social-fg-subtle)]">{meta}</div>
            )}
        </div>
    )
}

/**
 * After the agent finishes: only the conclusion; the footer reveals the process.
 * Phones also long-press the conclusion; desktop keeps the text selectable and copies on hover.
 */
export function SocialAssistantMessage() {
    const { t } = useTranslation()
    const ctx = useHappyChatContext()
    const isMobileLayout = useIsMobileLayout()
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
    // While running, the process is every step so far; afterwards, everything except the reply.
    const shownProcessIndices = isRunning ? layout.liveIndices : layout.processIndices
    const reportLinks = useMemo(() => extractReportLinks(content), [content])
    const openInPreview = useOpenInPreview()
    const openReport = (url: string) => {
        // Built-in preview (side panel / preview page); fall back to a new tab when it is off or fails.
        if (!openInPreview) {
            window.open(url, '_blank', 'noreferrer')
            return
        }
        void openInPreview(url).then((opened) => {
            if (!opened) window.open(url, '_blank', 'noreferrer')
        })
    }
    const [expanded, setExpanded] = useState(false)
    // First step of the open list. It stays put while open, so a running turn's new steps only add at the end.
    const [processStart, setProcessStart] = useState<number | null>(null)
    // Zooming the chat to "all" opens every finished turn's steps; leaving it closes them again.
    // Set during render, so the steps open in the same commit the chat holds its anchor for.
    const zoom = useChatZoom()
    const zoomSnap = zoom?.snap ?? ZOOM_REPLY
    const [syncedZoomSnap, setSyncedZoomSnap] = useState(zoomSnap)
    if (zoomSnap !== syncedZoomSnap) {
        setSyncedZoomSnap(zoomSnap)
        if (!isRunning) {
            setExpanded(zoomSnap === ZOOM_ALL)
            setProcessStart(null)
        }
    }
    const rootRef = useRef<HTMLDivElement | null>(null)
    const footerRef = useRef<HTMLButtonElement | null>(null)
    const processRef = useRef<HTMLDivElement | null>(null)
    const collapsingRef = useRef(false)

    const expandProcess = () => {
        ctx.holdAutoScroll?.()
        flushSync(() => {
            setProcessStart(Math.max(0, shownProcessIndices.length - PROCESS_PAGE_SIZE))
            setExpanded(true)
        })
        const viewport = getChatViewport(rootRef.current)
        const footer = footerRef.current
        if (!viewport || !footer) return
        if (isRunning) {
            // A running turn opens at its latest steps; from the bottom the view keeps following new ones.
            viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
            return
        }
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
                setProcessStart(null)
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
        flushSync(() => setProcessStart((start) => Math.max(0, (start ?? shownProcessIndices.length) - PROCESS_PAGE_SIZE * 2)))
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
    // Phones: the card is a long-press target (no text selection or callout). Desktop: plain selectable text.
    const pressProps = isMobileLayout
        ? { ...longPressHandlers, style: { WebkitTouchCallout: 'none' as const } }
        : {}
    const pressClass = isMobileLayout ? 'select-none' : ''

    const stats = ctx.runStats?.get(messageId)
    const startAt = stats?.startAt ?? createdAt?.getTime() ?? Date.now()
    const hasProcess = shownProcessIndices.length > 0
    const firstShownProcess = Math.min(
        processStart ?? Math.max(0, shownProcessIndices.length - PROCESS_PAGE_SIZE),
        shownProcessIndices.length
    )
    const visibleProcessIndices = shownProcessIndices.slice(firstShownProcess)
    const hiddenProcessCount = firstShownProcess

    // With its steps open, a running turn keeps showing new steps even when the view is not at the bottom.
    const sessionId = ctx.sessionId
    useEffect(() => {
        if (!isRunning || !expanded || !sessionId) return
        setFollowingRunningTurn(sessionId, true)
        return () => setFollowingRunningTurn(sessionId, false)
    }, [expanded, isRunning, sessionId])
    const answerText = layout.answerIndices
        .map((index) => content[index]?.text ?? '')
        .join('\n\n')
        .trim()
    const zoomOn = zoom !== null
    const zoomVersions = useMemo(() => (zoomOn && answerText ? replyZoomVersions(answerText) : null), [zoomOn, answerText])
    // Brief level: the conclusion in place of the reply. Prose replies morph word by word on the way;
    // replies with code or tables switch at the brief level instead.
    const canZoomMorph = Boolean(zoomVersions?.brief && zoomVersions.brief !== zoomVersions.full)
    const showZoomMorph = Boolean(zoom?.briefRange && canZoomMorph && (zoomVersions?.simple || zoomSnap === ZOOM_BRIEF))
    const partial = stats?.partial ?? false
    const footer = [
        layout.steps > 0 ? t('mobile.turn.steps', { n: partial ? `${layout.steps}+` : layout.steps }) : t('mobile.turn.reasoning'),
        stats && !partial ? t('mobile.turn.took', { d: formatElapsed(stats.endAt - stats.startAt, t) }) : null
    ].filter(Boolean).join(' · ')

    const processList = expanded ? (
        <div ref={processRef} className="social-process animate-process-in ml-1 flex min-w-0 flex-col gap-2 py-1 pl-3.5">
            {hiddenProcessCount > 0 ? (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={showEarlierSteps}
                    className={cn('h-7 w-fit px-3 text-caption', HIT_AREA_28_CLASS)}
                >
                    {t('mobile.turn.showEarlier', { n: hiddenProcessCount })}
                </Button>
            ) : null}
            {visibleProcessIndices.map((index) => (
                <div key={index} className="social-process-item min-w-0">
                    <MessagePrimitive.PartByIndex index={index} components={PROCESS_COMPONENTS} />
                </div>
            ))}
            <div className="flex gap-4 pt-1 text-caption text-[var(--social-fg-muted)]">
                {answerText && !isRunning ? (
                    <button type="button" onClick={() => void copy(answerText)} className={TEXT_HIT_AREA_CLASS}>
                        {copied ? t('mobile.turn.copied') : t('mobile.turn.copy')}
                    </button>
                ) : null}
                <button type="button" onClick={() => collapseProcess('end')} className={TEXT_HIT_AREA_CLASS}>
                    {t('mobile.turn.hideProcess')}
                </button>
            </div>
        </div>
    ) : null

    return (
        <MessagePrimitive.Root ref={rootRef} className="group/turn flex min-w-0 max-w-full flex-col gap-2" data-happy-message-id={messageId} data-sz-item="">
            {separatorAt !== undefined ? <ChatTimeSeparator at={separatorAt} /> : null}
            {/* One-to-one chat: no avatar beside replies, the header already shows who this is. */}
            <div className="flex min-w-0 flex-col gap-1.5 overflow-x-hidden">
                {isCliOutput ? (
                    <CliOutputBlock text={content.find((part) => part.type === 'text')?.text ?? ''} />
                ) : isRunning ? (
                    <>
                        <LiveStatusCard
                            layout={layout}
                            startAt={startAt}
                            partial={partial}
                            expanded={expanded}
                            onToggle={hasProcess ? toggleProcess : undefined}
                            toggleRef={footerRef}
                            pressProps={hasProcess ? pressProps : undefined}
                            pressClass={hasProcess ? pressClass : undefined}
                        />
                        {processList}
                    </>
                ) : (
                    <>
                        {layout.answerIndices.length > 0 ? (
                            <div
                                {...pressProps}
                                className={cn(
                                    'social-card min-w-0 max-w-full rounded-2xl rounded-tl-md px-4 py-3 [&>*+*]:mt-3',
                                    // Words keep the width they were measured at while they move: a brief-width card would
                                    // squeeze the longer text into a column. Only long replies morph, so the full row fits them.
                                    showZoomMorph ? 'w-full' : 'w-fit',
                                    pressClass
                                )}
                            >
                                {showZoomMorph && zoom && zoomVersions ? (
                                    <ZoomMorphText controller={zoom.controller} brief={zoomVersions.brief} full={zoomVersions.full} />
                                ) : layout.answerIndices.map((index) => (
                                    <MessagePrimitive.PartByIndex key={index} index={index} components={ANSWER_COMPONENTS} />
                                ))}
                            </div>
                        ) : (
                            <div
                                {...pressProps}
                                className={cn('social-card w-fit rounded-2xl rounded-tl-md px-4 py-2.5 text-body text-[var(--social-fg-muted)]', pressClass)}
                            >
                                {layout.steps > 0 ? t('mobile.turn.done', { n: layout.steps }) : t('mobile.turn.noReply')}
                            </div>
                        )}

                        {zoomSnap !== ZOOM_BRIEF && (hasProcess || reportLinks.length > 0 || (!isMobileLayout && answerText)) ? (
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1 text-caption text-[var(--social-fg-subtle)]">
                                {hasProcess ? (
                                    <button
                                        ref={footerRef}
                                        type="button"
                                        onClick={toggleProcess}
                                        aria-expanded={expanded}
                                        className={cn('flex w-fit items-center gap-1 transition-colors hover:text-[var(--social-fg-muted)] [-webkit-tap-highlight-color:transparent]', TEXT_HIT_AREA_CLASS)}
                                    >
                                        {footer}
                                        <ChevronIcon className={cn('h-3 w-3 transition-transform', expanded ? '-rotate-90' : 'rotate-90')} />
                                    </button>
                                ) : null}
                                {reportLinks.map((url, index) => (
                                    <button
                                        key={url}
                                        type="button"
                                        title={url}
                                        onClick={() => openReport(url)}
                                        className={cn('flex h-6 items-center gap-1 rounded-full border border-[var(--social-border)] px-2.5 text-[var(--social-fg-muted)] transition-colors hover:bg-[var(--social-hover)] hover:text-[var(--social-fg)] [-webkit-tap-highlight-color:transparent]', HIT_AREA_24_CLASS)}
                                    >
                                        <FileIcon className="h-3 w-3" />
                                        {reportLinks.length > 1 ? t('mobile.turn.reportN', { n: index + 1 }) : t('mobile.turn.report')}
                                    </button>
                                ))}
                                {!isMobileLayout && answerText && !expanded ? (
                                    <button
                                        type="button"
                                        onClick={() => void copy(answerText)}
                                        className={cn('opacity-0 transition-opacity hover:text-[var(--social-fg-muted)] focus-visible:opacity-100 group-hover/turn:opacity-100', TEXT_HIT_AREA_CLASS)}
                                    >
                                        {copied ? t('mobile.turn.copied') : t('mobile.turn.copy')}
                                    </button>
                                ) : null}
                            </div>
                        ) : null}

                        {processList}
                    </>
                )}

                {layout.pendingIndices.map((index) => (
                    <MessagePrimitive.PartByIndex key={index} index={index} components={PROCESS_COMPONENTS} />
                ))}
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
    const zoom = useChatZoom()
    const zoomOn = zoom !== null
    const zoomVersions = useMemo(() => (zoomOn && text ? userZoomVersions(text) : null), [zoomOn, text])
    const showZoomMorph = Boolean(zoom?.briefRange && zoomVersions?.brief && zoomVersions.brief !== zoomVersions.full)

    if (role !== 'user') return null
    const canRetry = status === 'failed' && typeof localId === 'string' && Boolean(ctx.onRetryMessage)
    const onRetry = canRetry ? () => ctx.onRetryMessage!(localId) : undefined
    const hasAttachments = Boolean(attachments && attachments.length > 0)

    return (
        <MessagePrimitive.Root className="flex min-w-0 max-w-full flex-col gap-2" data-happy-message-id={messageId} data-sz-item="">
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
                    <div className={cn(
                        'social-bubble-self min-w-0 max-w-full rounded-2xl rounded-br-md px-4 py-2.5 text-body leading-[1.55] break-words [overflow-wrap:anywhere]',
                        // Same reason as the reply card: moving words keep their measured width.
                        showZoomMorph ? 'w-full' : ''
                    )}>
                        {showZoomMorph && zoom && zoomVersions ? (
                            <ZoomMorphText controller={zoom.controller} brief={zoomVersions.brief} full={zoomVersions.full} />
                        ) : text.length > 0 ? <LazyRainbowText text={text} /> : null}
                        {hasAttachments && attachments ? <MessageAttachments attachments={attachments} /> : null}
                    </div>
                </div>
            )}
        </MessagePrimitive.Root>
    )
}
