import { cn } from '@/lib/utils'

function SelectionMark(props: { checked: boolean; mode: 'single' | 'multi' }) {
    const mark = props.mode === 'multi'
        ? (props.checked ? '☑' : '☐')
        : (props.checked ? '●' : '○')
    return (
        <span className="mt-0.5 w-4 shrink-0 text-center text-[var(--social-fg-muted)]">
            {mark}
        </span>
    )
}

/** One answer option of an agent question: selection mark, bold title, optional muted description. */
export function OptionRow(props: {
    checked: boolean
    /** `single` draws a radio mark (default), `multi` a checkbox mark. */
    mode?: 'single' | 'multi'
    disabled: boolean
    title: string
    description?: string | null
    onClick: () => void
}) {
    return (
        <button
            type="button"
            className={cn(
                'flex min-h-11 w-full items-start gap-2 rounded-xl px-3 py-2 text-left text-body transition-colors hover:bg-[var(--social-hover)] disabled:pointer-events-none disabled:opacity-50',
                props.checked ? 'bg-[var(--social-hover)]' : null
            )}
            disabled={props.disabled}
            onClick={props.onClick}
        >
            <SelectionMark checked={props.checked} mode={props.mode ?? 'single'} />
            <span className="min-w-0 flex-1">
                <div className="font-semibold text-[var(--social-fg)] break-words">{props.title}</div>
                {props.description ? (
                    <div className="mt-0.5 text-footnote text-[var(--social-fg-muted)] break-words">
                        {props.description}
                    </div>
                ) : null}
            </span>
        </button>
    )
}
