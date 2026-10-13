import { useRef, useState } from 'react'
import { BottomSheet, SheetOption, SheetSection } from '@/components/mobile/BottomSheet'
import { ContextMenu, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { CheckIcon, ChevronDownIcon, SwapIcon } from '@/components/mobile/icons'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { cn } from '@/lib/utils'

export type Choice<T extends string> = { value: T; label: string; description?: string }

export type ChoiceGroup<T extends string> = {
    options: ReadonlyArray<Choice<T>>
    value: T
    onChange: (value: T) => void
}

// Borderless like the rest of the composer toolbar; the open chip keeps its hover fill.
const chipClass = 'flex h-8 min-w-0 max-w-[16rem] shrink-0 items-center gap-1 rounded-full pl-2.5 pr-2 text-[12.5px] text-[var(--social-fg-muted)] transition-colors hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)] aria-expanded:bg-[var(--social-muted)] aria-expanded:text-[var(--social-fg)] disabled:opacity-40'

/**
 * One conversation setting shown as its current value. Tapping opens only that setting: a small
 * menu next to the chip on desktop, a short drawer on phones. Picking applies it and closes.
 */
export function SettingChip<T extends string>(props: {
    title: string
    valueLabel: string
    group: ChoiceGroup<T>
    disabled?: boolean
}) {
    const isMobileLayout = useIsMobileLayout()
    const buttonRef = useRef<HTMLButtonElement | null>(null)
    const [open, setOpen] = useState(false)
    const [anchor, setAnchor] = useState({ x: 0, y: 0 })
    const { group } = props

    const openPicker = () => {
        const rect = buttonRef.current?.getBoundingClientRect()
        if (rect) setAnchor({ x: rect.left + rect.width / 2, y: rect.top - 4 })
        setOpen(true)
    }
    const choose = (value: T) => {
        setOpen(false)
        if (value !== group.value) group.onChange(value)
    }

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onClick={openPicker}
                disabled={props.disabled}
                aria-haspopup={isMobileLayout ? 'dialog' : 'menu'}
                aria-expanded={open}
                aria-label={`${props.title} ${props.valueLabel}`}
                title={props.title}
                className={chipClass}
            >
                <span className="truncate">{props.valueLabel}</span>
                <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
            </button>
            {isMobileLayout ? (
                <BottomSheet open={open} onOpenChange={setOpen} title={props.title}>
                    <SheetSection>
                        {group.options.map((option) => (
                            <SheetOption
                                key={option.value}
                                label={option.label}
                                description={option.description}
                                selected={option.value === group.value}
                                onSelect={() => choose(option.value)}
                            />
                        ))}
                    </SheetSection>
                    <div className="h-2" />
                </BottomSheet>
            ) : open ? (
                <ContextMenu open anchorPoint={anchor} onClose={() => setOpen(false)} label={props.title}>
                    {group.options.map((option) => (
                        <ContextMenuItem
                            key={option.value}
                            label={option.label}
                            description={option.description}
                            checked={option.value === group.value}
                            onSelect={() => choose(option.value)}
                            trailing={(
                                <CheckIcon className={cn('h-4 w-4 shrink-0', option.value === group.value ? 'text-[var(--social-fg)]' : 'text-transparent')} />
                            )}
                        />
                    ))}
                </ContextMenu>
            ) : null}
        </>
    )
}

/** On/off setting (plan mode) as a chip that fills when on. */
export function ToggleChip(props: { label: string; title?: string; pressed: boolean; disabled?: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={props.onToggle}
            disabled={props.disabled}
            aria-pressed={props.pressed}
            title={props.title}
            className={cn(
                'flex h-8 shrink-0 items-center rounded-full px-2.5 text-[12.5px] transition-colors disabled:opacity-40',
                props.pressed
                    ? 'bg-[var(--social-primary)] text-[var(--social-primary-fg)]'
                    : 'text-[var(--social-fg-muted)] hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)]'
            )}
        >
            {props.label}
        </button>
    )
}

/** Two-state setting shown as its current value; each tap flips to the other one. */
export function SwitchChip(props: { valueLabel: string; title: string; disabled?: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={props.onToggle}
            disabled={props.disabled}
            aria-label={`${props.title} ${props.valueLabel}`}
            title={props.title}
            className={chipClass}
        >
            <span className="truncate">{props.valueLabel}</span>
            <SwapIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
    )
}
