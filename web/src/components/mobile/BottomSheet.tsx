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
                        'animate-sheet-up fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[20px] bg-[var(--social-sheet-bg)] pb-[env(safe-area-inset-bottom)] text-[var(--app-fg)] shadow-2xl outline-none',
                        props.className
                    )}
                >
                    <div className="flex shrink-0 justify-center pb-1 pt-2">
                        <span className="h-1 w-9 rounded-full bg-[var(--app-hint)] opacity-40" aria-hidden="true" />
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
                <div className="px-3 pb-1.5 text-[12px] font-medium text-[var(--app-hint)]">
                    {props.title}
                </div>
            ) : null}
            <div className="overflow-hidden rounded-xl bg-[var(--social-cell-bg)]">
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
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--app-subtle-bg)] text-[var(--app-fg)]">
                    {props.icon}
                </span>
            ) : null}
            <span className={cn('min-w-0 shrink-0 text-[15px]', props.destructive ? 'text-[var(--social-badge)]' : '')}>
                {props.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-[14px] text-[var(--app-hint)]">
                {props.value}
            </span>
            {props.chevron ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[var(--app-hint)] opacity-60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            ) : null}
        </>
    )

    const className = 'flex min-h-[48px] w-full items-center gap-3 px-3 py-2 text-left [&+&]:border-t [&+&]:border-[var(--app-divider)]'

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
