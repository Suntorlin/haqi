import type { ReactNode, SelectHTMLAttributes } from 'react'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { useTranslation } from '@/lib/use-translation'
import { Chip } from '@/components/ui/Chip'
import { cn } from '@/lib/utils'

const CAPTION_CLASS = 'px-1 text-[12px] font-semibold text-[var(--social-fg-muted)]'

/** Caption above a form control (same look as sheet section titles), with an optional hint below. */
export function FormField(props: {
    label: ReactNode
    htmlFor?: string
    optional?: boolean
    hint?: ReactNode
    children: ReactNode
}) {
    const { t } = useTranslation()
    const caption = (
        <>
            {props.label}
            {props.optional ? (
                <span className="font-normal text-[var(--social-fg-subtle)]">{` · ${t('form.optional')}`}</span>
            ) : null}
        </>
    )

    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            {props.htmlFor ? (
                <label htmlFor={props.htmlFor} className={CAPTION_CLASS}>{caption}</label>
            ) : (
                <div className={CAPTION_CLASS}>{caption}</div>
            )}
            {props.children}
            {props.hint ? <FieldHint>{props.hint}</FieldHint> : null}
        </div>
    )
}

/** Small muted line under a control. */
export function FieldHint(props: { children: ReactNode }) {
    return <p className="px-1 text-[12px] leading-snug text-[var(--social-fg-subtle)]">{props.children}</p>
}

/** Native select dressed like the text inputs; phones keep the system picker. */
export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
    const { className, ...rest } = props
    return (
        <div className="relative min-w-0">
            <select
                {...rest}
                className={cn(DIALOG_INPUT_CLASS, 'cursor-pointer appearance-none truncate pr-10 disabled:cursor-not-allowed disabled:opacity-50', className)}
            />
            <svg
                viewBox="0 0 24 24"
                className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--social-fg-subtle)]"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <polyline points="6 9 12 15 18 9" />
            </svg>
        </div>
    )
}

type Choice<T extends string> = { value: T; label: ReactNode }

/** Single choice as pill chips (same pills as tag filters); wraps on narrow screens. */
export function ChoiceChips<T extends string>(props: {
    label: string
    value: T
    options: ReadonlyArray<Choice<T>>
    disabled?: boolean
    /** Extra classes for every chip, e.g. `capitalize` (buttons do not inherit text-transform). */
    optionClassName?: string
    onChange: (value: T) => void
}) {
    return (
        <div role="radiogroup" aria-label={props.label} className="flex flex-wrap gap-1.5">
            {props.options.map((option) => {
                const selected = option.value === props.value
                return (
                    <Chip
                        key={option.value}
                        role="radio"
                        aria-checked={selected}
                        aria-pressed={undefined}
                        selected={selected}
                        disabled={props.disabled}
                        onClick={() => props.onChange(option.value)}
                        className={props.optionClassName}
                    >
                        {option.label}
                    </Chip>
                )
            })}
        </div>
    )
}

/**
 * iOS-style segmented control for two or three options. Framed by default; pass framed={false}
 * inside a SheetSection, which already draws the frame.
 */
export function SegmentedControl<T extends string>(props: {
    label: string
    value: T
    options: ReadonlyArray<Choice<T>>
    disabled?: boolean
    framed?: boolean
    onChange: (value: T) => void
}) {
    const track = (
        <div role="radiogroup" aria-label={props.label} className="flex gap-1 bg-[var(--social-muted)] p-1">
            {props.options.map((option) => {
                const selected = option.value === props.value
                return (
                    <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={props.disabled}
                        onClick={() => props.onChange(option.value)}
                        className={cn(
                            'min-h-11 min-w-0 flex-1 truncate rounded-xl px-2 py-2 text-[15px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                            selected
                                ? 'bg-[var(--social-surface)] font-semibold text-[var(--social-fg)] shadow-[var(--shadow-raised)]'
                                : 'text-[var(--social-fg-muted)] hover:text-[var(--social-fg)]'
                        )}
                    >
                        {option.label}
                    </button>
                )
            })}
        </div>
    )

    if (props.framed === false) {
        return track
    }
    return <div className="overflow-hidden rounded-2xl border border-[var(--social-border)]">{track}</div>
}

/** Pill shortcut that fills a field (recent paths, preview URLs). */
export function SuggestionChip(props: { label: string; title?: string; disabled?: boolean; onClick: () => void }) {
    return (
        <Chip onClick={props.onClick} disabled={props.disabled} title={props.title ?? props.label}>
            {props.label}
        </Chip>
    )
}
