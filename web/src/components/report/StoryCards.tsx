import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { FitText } from '@/components/ui/FitText'
import { Orb } from '@/components/mobile/SessionAvatar'
import { CloseIcon } from '@/components/mobile/icons'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

export type Story = { id: string; label: string; seed?: string; content: ReactNode }

/**
 * The report as a few cards, one idea each, the way stories read on a phone: segments on top show where
 * you are; tap the card or swipe to go on, the left edge or a swipe back to return, arrow keys on a desk.
 * Taps on a control inside a card (a button, a pin) stay with that control.
 */
export function StoryCards(props: { title: string; seed: string; stories: Story[]; onClose?: () => void }) {
    const { t } = useTranslation()
    const [index, setIndex] = useState(0)
    const start = useRef<{ x: number; y: number } | null>(null)
    const count = props.stories.length
    const go = useCallback((step: number) => setIndex((i) => Math.min(count - 1, Math.max(0, i + step))), [count])
    useEffect(() => {
        const key = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1) }
        document.addEventListener('keydown', key)
        return () => document.removeEventListener('keydown', key)
    }, [go])
    const story = props.stories[index]
    const interactive = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('button, a, input, textarea, [role="radio"]'))
    return (
        <div className="flex h-full flex-col bg-[var(--social-surface)]">
            <div className="flex gap-1 px-4 pt-3" aria-hidden="true">
                {props.stories.map((s, i) => (
                    <span key={s.id} className={cn('h-0.5 flex-1 rounded-full transition-colors duration-200', i <= index ? 'bg-[var(--social-fg)]' : 'bg-[var(--social-border)]')} />
                ))}
            </div>
            <div className="flex items-center gap-3 px-4 py-2">
                <Orb seed={story.seed ?? props.seed} size={28} />
                <div className="min-w-0 flex-1 leading-tight">
                    <FitText kind="title" lines={1} text={props.title} className="text-footnote font-semibold text-[var(--social-fg)]" />
                    <div className="text-caption tabular-nums text-[var(--social-fg-muted)]">{story.label} · {index + 1}/{count}</div>
                </div>
                {props.onClose ? (
                    <IconButton label={t('report.story.close')} size="sm" onClick={props.onClose}>
                        <CloseIcon className="h-5 w-5" />
                    </IconButton>
                ) : null}
            </div>
            <div
                className="relative min-h-0 flex-1 cursor-pointer select-none overflow-y-auto px-4 pb-4"
                onPointerDown={(e) => { start.current = { x: e.clientX, y: e.clientY } }}
                onPointerUp={(e) => {
                    const s = start.current
                    start.current = null
                    if (!s || interactive(e.target)) return
                    const dx = e.clientX - s.x
                    const dy = e.clientY - s.y
                    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? 1 : -1); return }
                    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
                        const box = e.currentTarget.getBoundingClientRect()
                        go(e.clientX - box.left < box.width * 0.3 ? -1 : 1)
                    }
                }}
                aria-live="polite"
            >
                <div key={story.id} className="pt-2 motion-safe:[animation:fade-in_200ms_ease-out]">
                    {story.content}
                </div>
            </div>
            <div className="flex items-center justify-between px-4 pb-4 text-caption text-[var(--social-fg-subtle)]">
                <span>{index > 0 ? t('report.story.back') : ''}</span>
                <span>{index < count - 1 ? t('report.story.next') : t('report.story.end')}</span>
            </div>
        </div>
    )
}
