import type { ReactNode, Ref } from 'react'
import { Orb } from '@/components/mobile/SessionAvatar'
import { ChevronRightIcon, MicIcon, SendArrowIcon } from '@/components/mobile/icons'
import { TextField } from '@/components/ui/TextField'
import { useTranslation } from '@/lib/use-translation'
import type { LatestMessage } from './types'

/**
 * Bottom bar: the latest message (one only — history lives behind `allChatsHref`)
 * plus a pill input to talk to the lead.
 */
export function LeadComposer(props: {
    latest: LatestMessage
    draft: string
    onDraft: (value: string) => void
    onSend: () => void
    /** Link to the full conversation list; omit to hide the link. */
    allChatsHref?: string
    inputRef?: Ref<HTMLInputElement>
    /** Trailing control when the draft is empty (defaults to a mic glyph). */
    idleTrailing?: ReactNode
}) {
    const { t } = useTranslation()
    const { latest } = props
    return (
        <div className="social-bar shrink-0 border-t border-[var(--social-border)] px-3 pb-[calc(var(--safe-bottom)+8px)] pt-2.5">
            <div className="flex items-start gap-2.5 px-1 pb-2.5">
                <Orb seed={latest.from === 'lead' ? 'lead' : 'me'} size={24} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-caption text-[var(--social-fg-subtle)]">
                            {latest.from === 'lead' ? t('report.composer.lead') : t('report.composer.me')} · {latest.when}
                        </span>
                        {props.allChatsHref ? (
                            <a href={props.allChatsHref} className="relative -my-1 flex items-center gap-0.5 text-caption text-[var(--social-fg-muted)] after:absolute after:-inset-3 after:content-['']">
                                {t('report.composer.allChats')}
                                <ChevronRightIcon className="h-3 w-3" />
                            </a>
                        ) : null}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-body leading-snug text-[var(--social-fg)]">{latest.text}</div>
                </div>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); props.onSend() }}>
                <TextField
                    ref={props.inputRef}
                    variant="pill"
                    placeholder={t('report.composer.placeholder')}
                    value={props.draft}
                    onChange={(event) => props.onDraft(event.target.value)}
                    trailing={props.draft.trim() ? (
                        <button type="submit" aria-label={t('report.composer.send')} className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--social-primary)] text-[var(--social-primary-fg)]">
                            <SendArrowIcon className="h-4 w-4" />
                        </button>
                    ) : (props.idleTrailing ?? <MicIcon className="h-5 w-5 text-[var(--social-fg-muted)]" />)}
                />
            </form>
        </div>
    )
}
