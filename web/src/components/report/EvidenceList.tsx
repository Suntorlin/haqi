import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ChevronDownIcon, ExternalLinkIcon, FileIcon, TerminalIcon } from '@/components/mobile/icons'
import { cn } from '@/lib/utils'
import type { EvidenceItem } from './types'

const KIND_ICON = { shot: FileIcon, command: TerminalIcon, link: ExternalLinkIcon }

function EvidenceRow(props: { item: EvidenceItem }) {
    const { item } = props
    const [open, setOpen] = useState(false)
    const Icon = KIND_ICON[item.kind]
    return (
        <div>
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="flex min-h-[60px] w-full items-center gap-3 px-4 text-left transition-colors active:bg-[var(--social-hover)]"
            >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--social-muted)] text-[var(--social-fg-muted)]">
                    <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1 leading-snug">
                    <span className="block truncate text-body text-[var(--social-fg)]">{item.title}</span>
                    <span className="block truncate text-footnote text-[var(--social-fg-muted)]">
                        <span className="font-mono">{item.meta}</span>
                        {item.when ? <span className="text-[var(--social-fg-subtle)]"> · {item.when}</span> : null}
                    </span>
                </span>
                {item.status ? <Badge variant={item.status.tone}>{item.status.label}</Badge> : null}
                <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform duration-200', open && 'rotate-180')} />
            </button>
            <div className={cn('grid transition-[grid-template-rows] duration-200 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
                <div className="min-h-0 overflow-hidden">
                    <div className="px-4 pb-4 pl-[60px]">
                        {item.kind === 'command' && item.lines ? (
                            <pre className="m-0 whitespace-pre-wrap rounded-xl bg-[var(--app-code-bg)] px-3 py-2.5 font-mono text-footnote leading-relaxed text-[var(--social-fg-muted)]">
                                {item.lines.map((line) => (
                                    <span key={line} className={cn('block', line.startsWith('✗') && 'text-[var(--social-danger)]')}>{line}</span>
                                ))}
                            </pre>
                        ) : null}
                        {item.kind === 'shot' && item.image ? (
                            <img src={item.image} alt={item.title} className="w-full max-w-sm rounded-xl border border-[var(--social-border)]" />
                        ) : null}
                        {item.kind === 'link' ? (
                            <div className="flex flex-col gap-1.5">
                                {item.quote ? <p className="m-0 border-l-2 border-[var(--social-border)] pl-3 text-body text-[var(--social-fg)]">{item.quote}</p> : null}
                                {item.source ? <span className="text-footnote text-[var(--social-fg-subtle)]">{item.source}</span> : null}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    )
}

/** Proof behind the report, one folded row each: screenshot, command output or quoted link. */
export function EvidenceList(props: { items: EvidenceItem[] }) {
    return (
        <div className="divide-y divide-[var(--social-divider)] overflow-hidden rounded-2xl border border-[var(--social-border)]">
            {props.items.map((item) => (
                <EvidenceRow key={item.id} item={item} />
            ))}
        </div>
    )
}
