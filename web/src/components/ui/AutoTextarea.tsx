import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { cn } from '@/lib/utils'

/**
 * A multi-line text field that grows with its text up to `maxRows`, then scrolls. Enter makes a new line; the
 * caller submits with a button (or `onSubmitKey` for Cmd/Ctrl+Enter). Same look as the dialog text fields.
 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & {
    minRows?: number
    maxRows?: number
    /** Cmd/Ctrl+Enter. */
    onSubmitKey?: () => void
}>(function AutoTextarea({ minRows = 2, maxRows = 8, onSubmitKey, className, onKeyDown, ...props }, ref) {
    const inner = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(ref, () => inner.current!)

    useLayoutEffect(() => {
        const el = inner.current
        if (!el) return
        const style = getComputedStyle(el)
        const line = Number.parseFloat(style.lineHeight) || 22
        const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
        const border = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth)
        el.style.height = 'auto'
        const min = line * minRows + padding + border
        const max = line * maxRows + padding + border
        el.style.height = `${Math.min(max, Math.max(min, el.scrollHeight + border))}px`
        el.style.overflowY = el.scrollHeight + border > max ? 'auto' : 'hidden'
    }, [props.value, minRows, maxRows])

    return (
        <textarea
            ref={inner}
            rows={minRows}
            {...props}
            onKeyDown={(event) => {
                if (onSubmitKey && event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    onSubmitKey()
                    return
                }
                onKeyDown?.(event)
            }}
            className={cn(DIALOG_INPUT_CLASS, 'block resize-none leading-snug', className)}
        />
    )
})
