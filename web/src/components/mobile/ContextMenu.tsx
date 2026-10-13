import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

type Point = { x: number; y: number }

/** Surface + item classes, for the few menus that position themselves (submenus). */
export const CONTEXT_MENU_SURFACE = 'rounded-2xl border border-[var(--social-border)] bg-[var(--app-bg)] p-1.5 text-[var(--social-fg)] shadow-[0_12px_40px_rgba(0,0,0,0.14)]'

/**
 * The one context menu used by every list (long-press on phones, right-click on desktop):
 * opens at the pointer, stays inside the viewport, closes on outside tap or Escape.
 */
export function ContextMenu(props: {
    open: boolean
    anchorPoint: Point
    onClose: () => void
    label: string
    menuId?: string
    children: ReactNode
}) {
    const { open, anchorPoint, onClose } = props
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [position, setPosition] = useState<{ top: number; left: number; origin: string } | null>(null)
    const internalId = useId()

    const updatePosition = useCallback(() => {
        const menu = menuRef.current
        if (!menu) return
        const rect = menu.getBoundingClientRect()
        const padding = 8
        const gap = 8
        const spaceBelow = window.innerHeight - anchorPoint.y
        const openAbove = spaceBelow < rect.height + gap && anchorPoint.y > spaceBelow
        const top = Math.min(
            Math.max(openAbove ? anchorPoint.y - rect.height - gap : anchorPoint.y + gap, padding),
            window.innerHeight - rect.height - padding
        )
        const left = Math.min(Math.max(anchorPoint.x - rect.width / 2, padding), window.innerWidth - rect.width - padding)
        setPosition({ top, left, origin: openAbove ? 'bottom center' : 'top center' })
    }, [anchorPoint])

    useLayoutEffect(() => {
        if (open) updatePosition()
    }, [open, updatePosition])

    useEffect(() => {
        if (!open) {
            setPosition(null)
            return
        }
        const handlePointerDown = (event: PointerEvent) => {
            if (menuRef.current?.contains(event.target as Node)) return
            onClose()
        }
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose()
        }
        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('resize', updatePosition)
        window.addEventListener('scroll', updatePosition, true)
        const frame = window.requestAnimationFrame(() => {
            menuRef.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()
        })
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', updatePosition)
            window.removeEventListener('scroll', updatePosition, true)
            window.cancelAnimationFrame(frame)
        }
    }, [open, onClose, updatePosition])

    if (!open) return null

    return createPortal(
        <div
            ref={menuRef}
            id={props.menuId ?? `context-menu-${internalId}`}
            role="menu"
            aria-label={props.label}
            className={cn('animate-menu-pop fixed z-50 flex min-w-[208px] flex-col', CONTEXT_MENU_SURFACE)}
            style={position
                ? { top: position.top, left: position.left, transformOrigin: position.origin }
                : { top: -9999, left: -9999 }}
        >
            {props.children}
        </div>,
        document.body
    )
}

export function ContextMenuItem(props: {
    icon?: ReactNode
    label: ReactNode
    /** Optional muted second line, e.g. an account's remaining quota. */
    description?: ReactNode
    onSelect: () => void
    destructive?: boolean
    disabled?: boolean
    trailing?: ReactNode
    checked?: boolean
    hasPopup?: boolean
    expanded?: boolean
    onFocus?: () => void
}) {
    const checkable = props.checked !== undefined
    return (
        <button
            type="button"
            role={checkable ? 'menuitemcheckbox' : 'menuitem'}
            aria-checked={checkable ? props.checked : undefined}
            aria-haspopup={props.hasPopup ? 'menu' : undefined}
            aria-expanded={props.hasPopup ? props.expanded : undefined}
            disabled={props.disabled}
            onClick={props.onSelect}
            onFocus={props.onFocus}
            className={cn(
                'flex w-full items-center gap-3 min-h-11 rounded-xl px-3 py-2.5 text-left text-[15px] leading-tight transition-colors hover:bg-[var(--social-muted)] focus-visible:bg-[var(--social-muted)] focus-visible:outline-none disabled:opacity-40',
                props.destructive ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg)]'
            )}
        >
            {props.icon ? (
                <span className={cn('flex h-[18px] w-[18px] shrink-0 items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]', props.destructive ? '' : 'text-[var(--social-fg-muted)]')}>
                    {props.icon}
                </span>
            ) : null}
            {props.description ? (
                <span className="min-w-0 flex-1">
                    <span className="block truncate">{props.label}</span>
                    <span className="mt-1 block truncate text-[12px] text-[var(--social-fg-muted)]">{props.description}</span>
                </span>
            ) : (
                <span className="min-w-0 flex-1 truncate">{props.label}</span>
            )}
            {props.trailing}
        </button>
    )
}

export function ContextMenuSeparator() {
    return <div role="separator" className="mx-2 my-1 h-px bg-[var(--social-border)]" />
}
