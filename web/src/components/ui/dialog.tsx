import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root

/** True inside a dialog: a sheet opened from it (a setting picker) stacks above the dialog instead of under it. */
export const InsideDialogContext = React.createContext(false)

/** Menus are portalled to the body; a tap on one is not a tap outside the dialog. */
function isInMenu(target: EventTarget | null): boolean {
    return target instanceof Element && Boolean(target.closest('[role="menu"], [data-context-submenu]'))
}
export const DialogTrigger = DialogPrimitive.Trigger

export const DialogContent = React.forwardRef<
    HTMLDivElement,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, onPointerDownOutside, onInteractOutside, ...props }, ref) => (
    <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-[var(--scrim)]" />
        <DialogPrimitive.Content
            ref={ref}
            className={cn(
                'app-dialog-content fixed left-1/2 top-1/2 z-[80] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-[var(--social-muted)] p-4 shadow-[var(--shadow-float)]',
                className
            )}
            onPointerDownOutside={(event) => {
                if (isInMenu(event.target)) event.preventDefault()
                onPointerDownOutside?.(event)
            }}
            onInteractOutside={(event) => {
                if (isInMenu(event.target)) event.preventDefault()
                onInteractOutside?.(event)
            }}
            {...props}
        >
            <InsideDialogContext.Provider value>{children}</InsideDialogContext.Provider>
        </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
))
DialogContent.displayName = 'DialogContent'

export const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
    <div className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)} {...props} />
)

export const DialogTitle = React.forwardRef<
    HTMLHeadingElement,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Title
        ref={ref}
        className={cn('text-base font-semibold leading-none tracking-tight', className)}
        {...props}
    />
))
DialogTitle.displayName = 'DialogTitle'

export const DialogDescription = React.forwardRef<
    HTMLParagraphElement,
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
    <DialogPrimitive.Description
        ref={ref}
        className={cn('text-footnote text-[var(--social-fg-muted)]', className)}
        {...props}
    />
))
DialogDescription.displayName = 'DialogDescription'
