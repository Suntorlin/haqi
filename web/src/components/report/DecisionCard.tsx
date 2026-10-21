import { useState } from 'react'
import { Orb } from '@/components/mobile/SessionAvatar'
import { CheckIcon, ChevronDownIcon } from '@/components/mobile/icons'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { CheckRing } from './indicators'
import type { CheckItem, Decision, DecisionOption } from './types'

function OptionBlock(props: { option: DecisionOption; selected: boolean; onSelect: () => void }) {
    const { t } = useTranslation()
    const { option } = props
    return (
        <button
            type="button"
            onClick={props.onSelect}
            aria-pressed={props.selected}
            className={cn(
                'flex w-full items-start gap-3 rounded-xl border bg-[var(--social-surface)] px-3.5 py-3 text-left transition-colors',
                props.selected ? 'border-[var(--social-fg)]' : 'border-[var(--social-border)]'
            )}
        >
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                    <span className="text-body font-semibold text-[var(--social-fg)]">{option.label}</span>
                    {option.recommended ? <Badge className="h-5 px-2">{t('report.option.recommended')}</Badge> : null}
                </span>
                {option.good ? <span className="mt-1 block text-footnote leading-relaxed text-[var(--social-fg-muted)]">{t('report.option.good', { text: option.good })}</span> : null}
                {option.cost ? <span className={cn('block text-footnote leading-relaxed text-[var(--social-fg-muted)]', !option.good && 'mt-1')}>{t('report.option.cost', { text: option.cost })}</span> : null}
            </span>
            <span
                className={cn(
                    'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2',
                    props.selected ? 'border-[var(--social-fg)] bg-[var(--social-fg)] text-[var(--social-surface)]' : 'border-[var(--social-border)]'
                )}
            >
                {props.selected ? <CheckIcon className="h-3 w-3" /> : null}
            </span>
        </button>
    )
}

/**
 * Full decision card: question, context, basis facts, options, one primary answer button.
 * Selection state lives inside — key the card by `decision.id` so a new decision resets it.
 */
export function DecisionCard(props: {
    decision: Decision
    onAnswer: (option: DecisionOption) => void
    onAsk?: () => void
    /** Show the goal line (orb + name + waited) above the question. */
    showSource?: boolean
}) {
    const { t } = useTranslation()
    const { decision } = props
    const [picked, setPicked] = useState(() => Math.max(0, decision.options.findIndex((option) => option.recommended)))
    const choice = decision.options[picked]
    const source = decision.source
    return (
        <div className="rounded-2xl bg-[var(--social-muted)] p-4">
            {props.showSource && source ? (
                <div className="flex items-center gap-2">
                    <Orb seed={source.seed} size={20} />
                    <span className="flex-1 text-footnote text-[var(--social-fg-muted)]">{source.name}</span>
                    {source.meta ? <span className="text-caption text-[var(--social-fg-subtle)]">{source.meta}</span> : null}
                </div>
            ) : null}
            <div className={cn('text-headline font-semibold leading-snug text-[var(--social-fg)]', props.showSource && source && 'mt-2.5')}>
                {decision.question}
            </div>
            {decision.context ? <div className="mt-1 text-footnote leading-relaxed text-[var(--social-fg-muted)]">{decision.context}</div> : null}
            {decision.basis && decision.basis.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1">
                    {decision.basis.map((fact) => (
                        <li key={fact} className="flex items-center gap-2 text-footnote text-[var(--social-fg)]">
                            <span className="h-1 w-1 shrink-0 rounded-full bg-[var(--social-fg-subtle)]" />
                            {fact}
                        </li>
                    ))}
                </ul>
            ) : null}
            <div className="mt-3 flex flex-col gap-2">
                {decision.options.map((option, index) => (
                    <OptionBlock key={option.label} option={option} selected={index === picked} onSelect={() => setPicked(index)} />
                ))}
            </div>
            <div className="mt-3 flex gap-2">
                <Button className="flex-1" onClick={() => props.onAnswer(choice)}>{t('report.decision.pick', { label: choice.label })}</Button>
                {props.onAsk ? <Button variant="ghost" onClick={props.onAsk}>{t('report.decision.ask')}</Button> : null}
            </div>
        </div>
    )
}

/** A decision you have not opened yet: one line, tap to expand. */
export function DecisionPeek(props: { decision: Decision; onOpen: () => void }) {
    const source = props.decision.source
    return (
        <button type="button" onClick={props.onOpen} className="flex min-h-[44px] w-full items-center gap-3 rounded-2xl bg-[var(--social-muted)] px-4 py-3 text-left">
            {source ? <Orb seed={source.seed} size={20} /> : null}
            <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-semibold text-[var(--social-fg)]">{props.decision.question}</span>
                {source ? (
                    <span className="block truncate text-caption text-[var(--social-fg-muted)]">
                        {source.name}
                        {source.meta ? ` · ${source.meta}` : ''}
                    </span>
                ) : null}
            </span>
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-[var(--social-fg-subtle)]" />
        </button>
    )
}

/** Replaces an answered card for a beat: "好，按「…」办". */
export function DecisionConfirmation(props: { label: string }) {
    const { t } = useTranslation()
    return <div className="rounded-2xl bg-[var(--social-muted)] p-4 text-body text-[var(--social-fg)]">{t('report.decision.confirmed', { label: props.label })}</div>
}

/** Grouped list of acceptance checks; live rows can open a detail sheet. */
export function Checklist(props: { items: CheckItem[] }) {
    const { t } = useTranslation()
    return (
        <div className="divide-y divide-[var(--social-divider)] overflow-hidden rounded-2xl border border-[var(--social-border)]">
            {props.items.map((item) => {
                const content = (
                    <>
                        <CheckRing state={item.state} />
                        <span className="min-w-0 flex-1">
                            <span className={cn('block text-body leading-snug', item.onClick && 'line-clamp-2', item.state === 'done' ? 'text-[var(--social-fg-muted)]' : 'text-[var(--social-fg)]')}>
                                {item.title}
                            </span>
                            {item.subtitle ? <span className="mt-0.5 block text-footnote leading-snug text-[var(--social-fg-muted)]">{item.subtitle}</span> : null}
                        </span>
                        {item.waiting ? (
                            <Badge variant="warning">{t('report.check.waiting')}</Badge>
                        ) : item.trailing ? (
                            <span className="text-footnote tabular-nums text-[var(--social-fg-subtle)]">{item.trailing}</span>
                        ) : null}
                    </>
                )
                if (item.onClick) {
                    return (
                        <button
                            key={item.title}
                            type="button"
                            onClick={item.onClick}
                            className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-[var(--social-hover)]"
                        >
                            {content}
                        </button>
                    )
                }
                return (
                    <div key={item.title} className="flex min-h-[52px] items-center gap-3 px-4 py-3">
                        {content}
                    </div>
                )
            })}
        </div>
    )
}
