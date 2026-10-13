import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDownIcon } from '@/components/mobile/icons'
import { CONTEXT_MENU_SURFACE, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/utils'

/**
 * Wraps a text input with a chevron that opens its history (recent paths, preview URLs) as a
 * dropdown under the field. Give the input right padding (`pr-11`) so text clears the chevron.
 */
export function InputHistory(props: {
    items: readonly string[]
    label: string
    disabled?: boolean
    /** Row text; defaults to the raw value. The full value stays in the tooltip. */
    format?: (value: string) => string
    /** Hide the dropdown while something else (autocomplete) is showing under the field. */
    suppressed?: boolean
    onPick: (value: string) => void
    children: ReactNode
}) {
    const ref = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)

    useEffect(() => {
        if (!open) return
        const close = (event: PointerEvent) => {
            if (!ref.current?.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
    }, [open])

    return (
        <div ref={ref} className="relative">
            {props.children}
            {props.items.length > 0 ? (
                <IconButton
                    size="sm"
                    label={props.label}
                    aria-expanded={open}
                    disabled={props.disabled}
                    onClick={() => setOpen((value) => !value)}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2"
                >
                    <ChevronDownIcon className={cn('h-4 w-4 transition-transform duration-150', open && 'rotate-180')} />
                </IconButton>
            ) : null}
            {open && !props.suppressed ? (
                <div className={cn('absolute left-0 right-0 top-full z-10 mt-1 max-h-[220px] overflow-y-auto', CONTEXT_MENU_SURFACE)}>
                    {props.items.map((item) => (
                        <ContextMenuItem
                            key={item}
                            label={props.format ? props.format(item) : item}
                            onSelect={() => {
                                props.onPick(item)
                                setOpen(false)
                            }}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    )
}
