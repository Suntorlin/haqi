import type { ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

/** iOS-style bottom sheet with a grabber; content scrolls when taller than the viewport. */
export function BottomSheet(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    hideTitle?: boolean
    children: ReactNode
    className?: string
}) {
    return (
        <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-[70] bg-black/40" />
                <DialogPrimitive.Content
                    aria-describedby={undefined}
                    className={cn(
                        'animate-sheet-up fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[24px] border-t border-[var(--social-border)] bg-[var(--app-bg)] pb-[env(safe-area-inset-bottom)] text-[var(--social-fg)] shadow-[0_-8px_40px_rgba(0,0,0,0.12)] outline-none',
                        props.className
                    )}
                >
                    <div className="flex shrink-0 justify-center pb-1 pt-2">
                        <span className="h-1 w-9 rounded-full bg-[var(--social-border)]" aria-hidden="true" />
                    </div>
                    <DialogPrimitive.Title
                        className={props.hideTitle ? 'sr-only' : 'px-4 pb-2 text-center text-[15px] font-semibold'}
                    >
                        {props.title}
                    </DialogPrimitive.Title>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                        {props.children}
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    )
}

/** Inset grouped list section (iOS Settings / WeChat 聊天信息 style). */
export function SheetSection(props: { title?: string; children: ReactNode; className?: string }) {
    return (
        <section className={cn('px-4 pb-3', props.className)}>
            {props.title ? (
                <div className="px-1 pb-2 text-[12px] font-medium text-[var(--social-fg-muted)]">
                    {props.title}
                </div>
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-[var(--social-border)]">
                {props.children}
            </div>
        </section>
    )
}

export function SheetRow(props: {
    label: ReactNode
    value?: ReactNode
    icon?: ReactNode
    onClick?: () => void
    destructive?: boolean
    disabled?: boolean
    chevron?: boolean
}) {
    const content = (
        <>
            {props.icon ? (
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--social-fg-muted)]">
                    {props.icon}
                </span>
            ) : null}
            <span className={cn('min-w-0 shrink-0 text-[15px]', props.destructive ? 'text-[var(--social-badge)]' : 'text-[var(--social-fg)]')}>
                {props.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-[14px] text-[var(--social-fg-muted)]">
                {props.value}
            </span>
            {props.chevron ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[var(--social-fg-subtle)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            ) : null}
        </>
    )

    const className = 'flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left [&+&]:border-t [&+&]:border-[var(--social-border)]'

    if (props.onClick) {
        return (
            <button
                type="button"
                onClick={props.onClick}
                disabled={props.disabled}
                className={cn(className, 'social-pressable disabled:opacity-50')}
            >
                {content}
            </button>
        )
    }

    return <div className={className}>{content}</div>
}

function CheckIcon() {
    return (
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="5 12.5 10 17.5 19 7" />
        </svg>
    )
}

/** Single-choice row: tapping applies the value right away and moves the check mark. */
export function SheetOption(props: {
    label: ReactNode
    description?: ReactNode
    selected: boolean
    disabled?: boolean
    onSelect: () => void
}) {
    return (
        <button
            type="button"
            role="menuitemradio"
            aria-checked={props.selected}
            disabled={props.disabled}
            onClick={props.onSelect}
            className="social-pressable flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-50 [&+&]:border-t [&+&]:border-[var(--social-border)]"
        >
            <span className="min-w-0 flex-1">
                <span className={cn('block text-[15px]', props.selected ? 'font-medium text-[var(--social-fg)]' : 'text-[var(--social-fg)]')}>
                    {props.label}
                </span>
                {props.description ? (
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--social-fg-muted)]">{props.description}</span>
                ) : null}
            </span>
            <span className={cn('shrink-0 text-[var(--social-fg)] transition-opacity', props.selected ? 'opacity-100' : 'opacity-0')}>
                <CheckIcon />
            </span>
        </button>
    )
}

/** On/off row with a monochrome switch; the whole row is the hit target. */
export function SheetSwitchRow(props: {
    label: ReactNode
    description?: ReactNode
    checked: boolean
    disabled?: boolean
    onCheckedChange: (checked: boolean) => void
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={props.checked}
            disabled={props.disabled}
            onClick={() => props.onCheckedChange(!props.checked)}
            className="social-pressable flex min-h-[48px] w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-50 [&+&]:border-t [&+&]:border-[var(--social-border)]"
        >
            <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-[var(--social-fg)]">{props.label}</span>
                {props.description ? (
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-[var(--social-fg-muted)]">{props.description}</span>
                ) : null}
            </span>
            <span
                className={cn(
                    'relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full transition-colors',
                    props.checked ? 'bg-[var(--social-primary)]' : 'bg-[var(--social-border)]'
                )}
                aria-hidden="true"
            >
                <span
                    className={cn(
                        'h-[22px] w-[22px] rounded-full bg-[var(--app-bg)] shadow-sm transition-transform',
                        props.checked ? 'translate-x-[20px]' : 'translate-x-[2px]'
                    )}
                />
            </span>
        </button>
    )
}
