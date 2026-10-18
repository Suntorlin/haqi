import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { LeveledText, LeveledTextView, type ScrollAnchor, type SemanticZoomController } from '@/vendor/semantic-zoom'
import { cn } from '@/lib/utils'
import { ZOOM_ALL, ZOOM_BRIEF, ZOOM_REPLY } from '@/components/AssistantChat/chatZoomText'
import { useTranslation } from '@/lib/use-translation'

/**
 * Chat zoom: pinch out for one line per message, pinch in for every step.
 * Messages read this to pick what they show; the thread owns the controller.
 */
export type ChatZoomState = {
    controller: SemanticZoomController
    /** A pinch or a level animation is running. */
    busy: boolean
    /** The level the layout follows: the committed one at rest, the nearest one while busy. */
    snap: number
    /** The zoom is between brief and reply, so messages show the word morph instead of Markdown. */
    briefRange: boolean
}

const ChatZoomContext = createContext<ChatZoomState | null>(null)

export const ChatZoomProvider = ChatZoomContext.Provider

export function useChatZoom(): ChatZoomState | null {
    return useContext(ChatZoomContext)
}

function readZoom(controller: SemanticZoomController): Omit<ChatZoomState, 'controller'> {
    const busy = controller.isGesturing || controller.isAnimating
    return {
        busy,
        snap: busy ? Math.round(controller.value) : controller.level,
        briefRange: busy ? controller.value < ZOOM_REPLY : controller.level === ZOOM_BRIEF
    }
}

/**
 * Follows the controller and keeps the message under the fingers still when messages swap
 * between Markdown and the word morph (that swap happens in React, outside the zoom's frame).
 */
export function useChatZoomState(
    controller: SemanticZoomController,
    anchor: ScrollAnchor | null,
    holdAutoScroll: (durationMs?: number) => void
): ChatZoomState {
    const [state, setState] = useState(() => readZoom(controller))
    const stateRef = useRef(state)
    const anchorRef = useRef(anchor)
    anchorRef.current = anchor
    const lastPinnedRef = useRef<Element | null>(null)
    const heldBySwapRef = useRef(false)

    useEffect(() => {
        const update = () => {
            const next = readZoom(controller)
            if (next.busy) holdAutoScroll(600)
            const scrollAnchor = anchorRef.current
            if (scrollAnchor?.anchorElement) lastPinnedRef.current = scrollAnchor.anchorElement
            const prev = stateRef.current
            if (prev.busy === next.busy && prev.snap === next.snap && prev.briefRange === next.briefRange) return
            if (scrollAnchor && !scrollAnchor.anchorElement) {
                const last = lastPinnedRef.current
                if (last?.isConnected) {
                    scrollAnchor.pinElement(last)
                } else {
                    scrollAnchor.captureLeadingAnchor()
                }
                heldBySwapRef.current = true
            }
            stateRef.current = next
            setState(next)
        }
        const offFrame = controller.addFrameListener(update)
        const offGesture = controller.subscribeGesture(update)
        const offLevel = controller.subscribe(update)
        return () => {
            offFrame()
            offGesture()
            offLevel()
        }
    }, [controller, holdAutoScroll])

    // Runs after every message has re-rendered for the new state, before the browser paints.
    useLayoutEffect(() => {
        const scrollAnchor = anchorRef.current
        if (!scrollAnchor) return
        scrollAnchor.correct()
        if (heldBySwapRef.current) {
            heldBySwapRef.current = false
            scrollAnchor.releaseAnchor()
        }
    }, [state])

    return useMemo(() => ({ controller, ...state }), [controller, state])
}

const MORPH_TEXT_STYLE = {
    fontSize: 'calc(0.9375rem * var(--app-font-scale, 1))',
    lineHeight: 1.625,
    '--sz-paragraph-gap': '0.55em'
} as React.CSSProperties

/** Words that slide between the brief and the full version as the chat zooms. */
export function ZoomMorphText(props: { controller: SemanticZoomController; brief: string; full: string }) {
    const text = useMemo(() => LeveledText.fromVersions([props.brief, props.full]), [props.brief, props.full])
    return (
        <LeveledTextView
            text={text}
            controller={props.controller}
            clip
            className="break-words [overflow-wrap:anywhere]"
            style={MORPH_TEXT_STYLE}
        />
    )
}

const noSubscription = () => () => {}

/** The committed chat zoom level, for controls outside the chat (the header); the reply level without a controller. */
export function useChatZoomLevel(controller: SemanticZoomController | null | undefined): number {
    return useSyncExternalStore(
        controller ? controller.subscribe : noSubscription,
        () => controller?.level ?? ZOOM_REPLY,
        () => controller?.level ?? ZOOM_REPLY
    )
}

/** Moves the chat to `level`, holding the message in the middle of the screen still (not the half-hidden one at the top). */
export function setChatZoomLevel(
    controller: SemanticZoomController,
    level: number,
    viewport: HTMLElement | null = document.querySelector<HTMLElement>('.social-chat')
): void {
    if (!viewport) {
        void controller.setLevel(level)
        return
    }
    const box = viewport.getBoundingClientRect()
    controller.anchorAt(box.left + box.width / 2, box.top + box.height / 2)
    void controller.animateToLevel(level, { anchor: false })
}

/**
 * Shows which level a pinch is heading for, only while the chat zooms; at rest the header's
 * view settings hold the switch, so nothing floats over the messages.
 */
export function ChatZoomBar() {
    const zoom = useChatZoom()
    const { t } = useTranslation()
    if (!zoom?.busy) return null
    const options = [
        { value: ZOOM_BRIEF, label: t('chat.zoom.brief') },
        { value: ZOOM_REPLY, label: t('chat.zoom.reply') },
        { value: ZOOM_ALL, label: t('chat.zoom.all') }
    ]
    return (
        <div className="pointer-events-none absolute inset-x-0 top-2 z-10 flex justify-center px-4" aria-hidden="true">
            <div className="flex gap-0.5 rounded-full border border-[var(--social-border)] bg-[var(--social-surface)] p-0.5">
                {options.map((option) => (
                    <span
                        key={option.value}
                        className={cn(
                            'flex h-7 items-center rounded-full px-3 text-[13px] transition-colors',
                            option.value === zoom.snap
                                ? 'bg-[var(--social-muted)] font-semibold text-[var(--social-fg)]'
                                : 'text-[var(--social-fg-muted)]'
                        )}
                    >
                        {option.label}
                    </span>
                ))}
            </div>
        </div>
    )
}
