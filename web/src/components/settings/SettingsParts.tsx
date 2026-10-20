import { useId, useRef, useState, type ReactNode } from 'react'
import { BottomSheet, SheetOption, SheetSection } from '@/components/mobile/BottomSheet'
import { ContextMenu, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { CheckIcon, ChevronDownIcon } from '@/components/mobile/icons'
import { FieldHint } from '@/components/ui/FormControls'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { Switch } from '@/components/ui/Switch'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { cn } from '@/lib/utils'

const BLOCK_TITLE_CLASS = 'px-4 text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]'

/** Collapsible top-level group of the settings page: header row + stacked blocks. */
export function SettingsGroup(props: {
    title: string
    description: string
    isExpanded: boolean
    onToggle: () => void
    children: ReactNode
}) {
    const contentId = useId()
    return (
        <section className="border-b border-[var(--social-divider)]">
            <button
                type="button"
                onClick={props.onToggle}
                aria-expanded={props.isExpanded}
                aria-controls={contentId}
                className="social-pressable mx-2 flex min-h-[64px] w-[calc(100%-1rem)] items-center gap-3 rounded-2xl px-2 py-3 text-left"
            >
                <span className="min-w-0 flex-1">
                    <span className="block text-headline font-semibold text-[var(--social-fg)]">{props.title}</span>
                    <span className="mt-0.5 block text-footnote text-[var(--social-fg-muted)]">{props.description}</span>
                </span>
                <ChevronDownIcon
                    className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', props.isExpanded && 'rotate-180')}
                />
            </button>
            {props.isExpanded ? (
                <div id={contentId} className="flex flex-col gap-6 px-4 pb-6 pt-2">
                    {props.children}
                </div>
            ) : null}
        </section>
    )
}

/** Grouped rows (ListRow children) under a small caps title, with an optional muted hint below. */
export function SettingsBlock(props: { title?: ReactNode; hint?: ReactNode; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-1.5">
            <ListGroup title={props.title}>{props.children}</ListGroup>
            {props.hint ? <div className="px-3"><FieldHint>{props.hint}</FieldHint></div> : null}
        </div>
    )
}

/** Free-form block (inputs, cards, buttons) under the same small caps title as SettingsBlock. */
export function SettingsPanel(props: { title?: ReactNode; description?: ReactNode; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-3">
            {props.title ? <h3 className={BLOCK_TITLE_CLASS}>{props.title}</h3> : null}
            {props.description ? <p className="px-4 text-footnote leading-snug text-[var(--social-fg-muted)]">{props.description}</p> : null}
            {props.children}
        </section>
    )
}

/** Bordered card inside a SettingsPanel (usage per provider, credential profile, ...). */
export function SettingsCard(props: { title?: ReactNode; trailing?: ReactNode; children: ReactNode; className?: string }) {
    return (
        <div className={cn('flex flex-col gap-2 rounded-2xl border border-[var(--social-border)] p-4', props.className)}>
            {props.title ? (
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 text-body font-semibold text-[var(--social-fg)]">{props.title}</div>
                    {props.trailing ? <div className="shrink-0 text-footnote text-[var(--social-fg-muted)]">{props.trailing}</div> : null}
                </div>
            ) : null}
            {props.children}
        </div>
    )
}

/** Label on the left, value on the right inside a card. */
export function SettingsStat(props: { label: ReactNode; value: ReactNode; strong?: boolean }) {
    return (
        <div className="flex items-baseline justify-between gap-3 text-body">
            <span className="min-w-0 text-footnote text-[var(--social-fg-muted)]">{props.label}</span>
            <span className={cn('shrink-0 text-[var(--social-fg)]', props.strong && 'font-semibold')}>{props.value}</span>
        </div>
    )
}

/** Inline error / success message. */
export function SettingsNotice(props: { tone: 'error' | 'success'; children: ReactNode }) {
    return (
        <div
            role={props.tone === 'error' ? 'alert' : 'status'}
            className={cn(
                'rounded-xl px-3.5 py-2.5 text-footnote',
                props.tone === 'error'
                    ? 'bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
                    : 'bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)]'
            )}
        >
            {props.children}
        </div>
    )
}

/** Row with a trailing switch. The switch carries a 44px hit area; the row keeps its 52px rhythm. */
export function SettingsSwitchRow(props: {
    title: ReactNode
    subtitle?: ReactNode
    label: string
    checked: boolean
    disabled?: boolean
    onCheckedChange: (checked: boolean) => void
}) {
    return (
        <ListRow
            wrap
            title={props.title}
            subtitle={props.subtitle}
            trailing={
                <Switch
                    checked={props.checked}
                    disabled={props.disabled}
                    onCheckedChange={props.onCheckedChange}
                    ariaLabel={props.label}
                    className="-my-3 items-center px-1 py-3"
                />
            }
        />
    )
}

/** Read-only row: title on the left, value (text or link) on the right. */
export function SettingsValueRow(props: { title: ReactNode; value: ReactNode }) {
    return <ListRow title={props.title} trailing={props.value} />
}

export type SettingsChoice<T extends string> = { value: T; label: string; description?: string }

/**
 * Row that shows the current value and opens only its own picker: a bottom sheet on phones, a small
 * menu next to the row on desktop (same pattern as the composer's SettingChip).
 */
export function SettingsSelectRow<T extends string>(props: {
    title: string
    subtitle?: ReactNode
    valueLabel: string
    options: ReadonlyArray<SettingsChoice<T>>
    value: T
    onChange: (value: T) => void
    disabled?: boolean
}) {
    const isMobileLayout = useIsMobileLayout()
    const rowRef = useRef<(HTMLButtonElement & HTMLDivElement) | null>(null)
    const [open, setOpen] = useState(false)
    const [anchor, setAnchor] = useState({ x: 0, y: 0 })

    const openPicker = () => {
        const rect = rowRef.current?.getBoundingClientRect()
        if (rect) setAnchor({ x: Math.max(rect.right - 120, rect.left), y: rect.bottom - 8 })
        setOpen(true)
    }
    const choose = (value: T) => {
        setOpen(false)
        props.onChange(value)
    }

    return (
        <div>
            <ListRow
                ref={rowRef}
                wrap
                title={props.title}
                subtitle={props.subtitle}
                trailing={<span className="block max-w-[10rem] whitespace-normal text-right leading-snug">{props.valueLabel}</span>}
                disabled={props.disabled}
                aria-haspopup={isMobileLayout ? 'dialog' : 'menu'}
                aria-expanded={open}
                onClick={openPicker}
            />
            {isMobileLayout ? (
                <BottomSheet open={open && !props.disabled} onOpenChange={setOpen} title={props.title}>
                    <SheetSection>
                        {props.options.map((option) => (
                            <SheetOption
                                key={option.value}
                                label={option.label}
                                description={option.description}
                                selected={option.value === props.value}
                                onSelect={() => choose(option.value)}
                            />
                        ))}
                    </SheetSection>
                    <div className="h-2" />
                </BottomSheet>
            ) : open && !props.disabled ? (
                <ContextMenu open anchorPoint={anchor} onClose={() => setOpen(false)} label={props.title}>
                    {props.options.map((option) => (
                        <ContextMenuItem
                            key={option.value}
                            label={option.label}
                            description={option.description}
                            checked={option.value === props.value}
                            onSelect={() => choose(option.value)}
                            trailing={(
                                <CheckIcon className={cn('h-4 w-4 shrink-0', option.value === props.value ? 'text-[var(--social-fg)]' : 'text-transparent')} />
                            )}
                        />
                    ))}
                </ContextMenu>
            ) : null}
        </div>
    )
}
