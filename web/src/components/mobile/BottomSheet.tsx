import type { ReactNode } from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { IconButton } from '@/components/ui/IconButton'
import { SwitchTrack } from '@/components/ui/Switch'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

/**
 * Secondary panel shared by both layouts: an iOS-style bottom sheet with a grabber on phones,
 * a panel sliding in from the right edge on desktop (WeChat "chat info"). Content scrolls.
 */
export function BottomSheet(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    title: string
    hideTitle?: boolean
    children: ReactNode
    className?: string
    /** Desktop only: open as a floating card hanging under this point instead of the side panel. */
    popoverAnchor?: { right: number; bottom: number } | null
    /** Keep focus off the first field on open, so a search box does not pop up the phone keyboard. */
    noAutoFocus?: boolean
}) {
    const isMobileLayout = useIsMobileLayout()
    const { t } = useTranslation()

    if (!isMobileLayout && props.popoverAnchor) {
        const { right, bottom } = props.popoverAnchor
        return (
            <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
                <DialogPrimitive.Portal>
                    <DialogPrimitive.Overlay className="fixed inset-0 z-[70]" />
                    <DialogPrimitive.Content
                        aria-describedby={undefined}
                        className={cn(
                            'social-float-card animate-menu-pop fixed z-[70] flex w-[360px] max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-3xl text-[var(--social-fg)] outline-none',
                            props.className
                        )}
                        style={{
                            top: bottom + 8,
                            right: Math.max(8, window.innerWidth - right),
                            maxHeight: `min(560px, calc(100dvh - ${bottom + 8 + 12}px))`,
                            transformOrigin: 'top right'
                        }}
                    >
                        <DialogPrimitive.Title className="sr-only">{props.title}</DialogPrimitive.Title>
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1 pt-4">
                            {props.children}
                        </div>
                    </DialogPrimitive.Content>
                </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
        )
    }

    if (!isMobileLayout) {
        return (
            <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
                <DialogPrimitive.Portal>
                    <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-[70] bg-[var(--scrim-soft)]" />
                    <DialogPrimitive.Content
                        aria-describedby={undefined}
                        className={cn(
                            'animate-panel-in fixed inset-y-0 right-0 z-[70] flex w-[400px] max-w-[92vw] flex-col border-l border-[var(--social-border)] bg-[var(--social-surface)] text-[var(--social-fg)] shadow-[var(--shadow-panel)] outline-none',
                            props.className
                        )}
                    >
                        <div className="flex h-14 shrink-0 items-center gap-2 pl-5 pr-3">
                            <DialogPrimitive.Title
                                className={props.hideTitle ? 'sr-only' : 'min-w-0 flex-1 truncate text-[15px] font-semibold'}
                            >
                                {props.title}
                            </DialogPrimitive.Title>
                            <DialogPrimitive.Close asChild>
                                <IconButton size="sm" label={t('button.close')} className="ml-auto">
                                    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                                        <line x1="18" y1="6" x2="6" y2="18" />
                                        <line x1="6" y1="6" x2="18" y2="18" />
                                    </svg>
                                </IconButton>
                            </DialogPrimitive.Close>
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
                            {props.children}
                        </div>
                    </DialogPrimitive.Content>
                </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
        )
    }

    return (
        <DialogPrimitive.Root open={props.open} onOpenChange={props.onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="animate-fade-in fixed inset-0 z-[70] bg-[var(--scrim)]" />
                <DialogPrimitive.Content
                    aria-describedby={undefined}
                    onOpenAutoFocus={props.noAutoFocus ? (event) => event.preventDefault() : undefined}
                    className={cn(
                        'animate-sheet-up fixed inset-x-0 bottom-0 z-[70] mx-auto flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border-t border-[var(--social-border)] bg-[var(--social-surface)] pb-[env(safe-area-inset-bottom)] text-[var(--social-fg)] shadow-[var(--shadow-sheet)] outline-none',
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

/** Muted (or error) line of text between sheet sections: loading, empty and error states. */
export function SheetNote(props: { children: ReactNode; tone?: 'error' }) {
    return (
        <div className={cn('px-5 pb-3 text-[13px] leading-relaxed', props.tone === 'error' ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg-muted)]')}>
            {props.children}
        </div>
    )
}

/** Inset grouped list section (iOS Settings / WeChat 聊天信息 style). */
export function SheetSection(props: { title?: string; children: ReactNode; className?: string }) {
    return (
        <section className={cn('px-4 pb-3', props.className)}>
            {props.title ? (
                <div className="px-1 pb-2 text-[12px] font-semibold text-[var(--social-fg-muted)]">
                    {props.title}
                </div>
            ) : null}
            <div className="overflow-hidden rounded-2xl border border-[var(--social-border)]">
                {props.children}
            </div>
        </section>
    )
}

/** Leading icon slot shared by every sheet row, so rows with and without switches line up. */
function SheetRowIcon(props: { children: ReactNode; destructive?: boolean }) {
    return (
        <span
            className={cn(
                'flex h-7 w-7 shrink-0 items-center justify-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]',
                props.destructive ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg-muted)]'
            )}
        >
            {props.children}
        </span>
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
            {props.icon ? <SheetRowIcon destructive={props.destructive}>{props.icon}</SheetRowIcon> : null}
            <span className={cn('min-w-0 shrink-0 text-[15px]', props.destructive ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg)]')}>
                {props.label}
            </span>
            <span className="min-w-0 flex-1 truncate text-right text-[13px] text-[var(--social-fg-muted)]">
                {props.value}
            </span>
            {props.chevron ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-[var(--social-fg-subtle)]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6" />
                </svg>
            ) : null}
        </>
    )

    const className = 'flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left [&+&]:border-t [&+&]:border-[var(--social-border)]'

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
            className="social-pressable flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-50 [&+&]:border-t [&+&]:border-[var(--social-border)]"
        >
            <span className="min-w-0 flex-1">
                <span className={cn('block text-[15px]', props.selected ? 'font-semibold text-[var(--social-fg)]' : 'text-[var(--social-fg)]')}>
                    {props.label}
                </span>
                {props.description ? (
                    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--social-fg-muted)]">{props.description}</span>
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
    icon?: ReactNode
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
            className="social-pressable flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-50 [&+&]:border-t [&+&]:border-[var(--social-border)]"
        >
            {props.icon ? <SheetRowIcon>{props.icon}</SheetRowIcon> : null}
            <span className="min-w-0 flex-1">
                <span className="block text-[15px] text-[var(--social-fg)]">{props.label}</span>
                {props.description ? (
                    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--social-fg-muted)]">{props.description}</span>
                ) : null}
            </span>
            <SwitchTrack checked={props.checked} />
        </button>
    )
}
