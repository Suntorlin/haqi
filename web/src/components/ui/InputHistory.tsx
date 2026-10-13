import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDownIcon } from '@/components/mobile/icons'
import { CONTEXT_MENU_SURFACE, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { IconButton } from '@/components/ui/IconButton'
import { cn } from '@/lib/utils'

/**
 * Gives a text field a history dropdown (recent paths, preview URLs). Render the field with the
 * `trailing` slot it hands you (a chevron); the list opens under the field as a menu.
 */
export function InputHistory(props: {
    items: readonly string[]
    label: string
    disabled?: boolean
    /** Row text; defaults to the raw value. */
    format?: (value: string) => string
    onPick: (value: string) => void
    children: (slot: { trailing: ReactNode | undefined; open: boolean }) => ReactNode
}) {
    const ref = useRef<HTMLDivElement>(null)
    const [open, setOpen] = useState(false)
    const hasItems = props.items.length > 0

    useEffect(() => {
        if (!open) return
        const close = (event: PointerEvent) => {
            if (!ref.current?.contains(event.target as Node)) setOpen(false)
        }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
    }, [open])

    const trailing = hasItems ? (
        <IconButton
            size="sm"
            label={props.label}
            aria-expanded={open}
            disabled={props.disabled}
            onClick={() => setOpen((value) => !value)}
            className="text-[var(--social-fg-subtle)]"
        >
            <ChevronDownIcon className={cn('h-4 w-4 transition-transform duration-150', open && 'rotate-180')} />
        </IconButton>
    ) : undefined

    return (
        <div ref={ref} className="relative">
            {props.children({ trailing, open })}
            {open && hasItems ? (
                <div className={cn('absolute left-0 right-0 top-full z-10 mt-1 max-h-[260px] overflow-y-auto', CONTEXT_MENU_SURFACE)}>
                    {props.items.map((item) => (
                        <ContextMenuItem
                            key={item}
                            label={props.format ? props.format(item) : item}
                            onSelect={() => {
                                setOpen(false)
                                props.onPick(item)
                            }}
                        />
                    ))}
                </div>
            ) : null}
        </div>
    )
}
