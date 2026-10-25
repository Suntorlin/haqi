import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Text that fits its space by what it is, not by cutting the end off:
 * - `value`   key-value value (email, path, model): wraps, never cut.
 * - `title`   list title: up to `lines` lines (default 2).
 * - `label`   narrow caption: the longest of `candidates` (long -> short) that fits in `lines`.
 * - `id`      identifier (path, email, id): one line, cut in the middle so both ends stay.
 * - `preview` a peek at longer text the user opens elsewhere: clamped to `lines` (default 1).
 * The full text is always the hover title. Cutting by hand (`truncate`, `line-clamp`) is for this
 * file only; see web/DESIGN.md "Text that does not fit".
 */
export type FitTextKind = 'value' | 'title' | 'label' | 'id' | 'preview'

const CLAMP: Record<number, string> = { 1: 'line-clamp-1', 2: 'line-clamp-2', 3: 'line-clamp-3' }

export function FitText(props: {
    kind: FitTextKind
    text: string
    /** label: other forms of `text`, from long to short. */
    candidates?: ReadonlyArray<string | null | undefined>
    lines?: 1 | 2 | 3
    className?: string
}) {
    const ref = useRef<HTMLSpanElement>(null)
    const forms = props.kind === 'label' ? uniqueForms([props.text, ...(props.candidates ?? [])]) : [props.text]
    const formsKey = forms.join('\u0000')
    const lines = props.lines ?? (props.kind === 'preview' ? 1 : props.kind === 'value' ? undefined : props.kind === 'id' ? 1 : 2)
    const [shown, setShown] = useState(props.text)
    const [clipped, setClipped] = useState(false)

    useLayoutEffect(() => {
        const el = ref.current
        if (!el) return
        const fit = () => {
            // Measure with the full text in place: in a container sized by its content (a chip with
            // a max width) the shown short form would make the space look smaller than it is.
            const node = el.firstChild
            const rendered = node?.nodeType === Node.TEXT_NODE ? node.nodeValue : null
            if (node && rendered !== null) node.nodeValue = props.text
            let next = props.text
            if (props.kind === 'id') next = middleCut(el, props.text)
            else if (props.kind === 'label') next = forms.find((form) => fitsIn(el, form, lines ?? 2)) ?? forms[forms.length - 1] ?? props.text
            const cut = next !== props.text || (lines !== undefined && !fitsIn(el, next, lines))
            if (node && rendered !== null) node.nodeValue = rendered
            setShown(next)
            // Clamped title / preview: the hover title then carries the full text.
            setClipped(cut)
        }
        fit()
        if (typeof ResizeObserver === 'undefined') return
        // The element and its container: a container that grows frees room the element cannot see.
        const watched = [el, el.parentElement].filter((node): node is HTMLElement => Boolean(node))
        const widths = new Map(watched.map((node) => [node, node.clientWidth]))
        const observer = new ResizeObserver(() => {
            if (watched.every((node) => widths.get(node) === node.clientWidth)) return
            for (const node of watched) widths.set(node, node.clientWidth)
            fit()
        })
        for (const node of watched) observer.observe(node)
        void document.fonts?.ready.then(fit)
        return () => observer.disconnect()
    }, [formsKey, props.kind, props.text, lines]) // formsKey stands for forms

    return (
        <span
            ref={ref}
            data-fit={props.kind}
            title={clipped ? props.text : undefined}
            className={cn(
                'block min-w-0 break-words',
                props.kind === 'id' ? 'overflow-hidden whitespace-nowrap' : 'whitespace-normal',
                lines && props.kind !== 'id' ? CLAMP[lines] : undefined,
                props.className
            )}
        >
            {shown}
        </span>
    )
}

function uniqueForms(values: ReadonlyArray<string | null | undefined>): string[] {
    const out: string[] = []
    for (const value of values) {
        const form = value?.trim()
        if (form && !out.includes(form)) out.push(form)
    }
    return out
}

/** Lays `text` out in a hidden copy of `el` (same font, same width) and checks it stays within `lines`. */
function fitsIn(el: HTMLElement, text: string, lines: number): boolean {
    const width = el.clientWidth
    if (width === 0) return true
    const probe = el.cloneNode(false) as HTMLElement
    const style = getComputedStyle(el)
    Object.assign(probe.style, {
        position: 'absolute', visibility: 'hidden', pointerEvents: 'none', left: '0', top: '0',
        width: `${width}px`, height: 'auto', maxHeight: 'none', whiteSpace: lines === 1 ? 'nowrap' : 'normal',
        overflow: 'visible', display: 'block', webkitLineClamp: 'none'
    })
    probe.textContent = text
    ;(el.parentElement ?? document.body).appendChild(probe)
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3
    const fits = lines === 1 ? probe.scrollWidth <= width + 1 : probe.scrollHeight <= lineHeight * lines + 1
    probe.remove()
    return fits
}

/** One line; when too long keeps the start and the end: `someone…@example.com`, `~/dev/…/fish`. */
function middleCut(el: HTMLElement, text: string): string {
    if (fitsIn(el, text, 1)) return text
    const chars = Array.from(text)
    let low = 0
    let high = chars.length - 1
    let best = `${chars[0] ?? ''}…`
    while (low <= high) {
        const keep = Math.floor((low + high) / 2)
        const head = Math.ceil(keep / 2)
        const candidate = `${chars.slice(0, head).join('')}…${chars.slice(chars.length - (keep - head)).join('')}`
        if (fitsIn(el, candidate, 1)) {
            best = candidate
            low = keep + 1
        } else {
            high = keep - 1
        }
    }
    return best
}

/**
 * Heading or caption that may be any node, in `lines` lines (default 1). A string fits as a label
 * (the longest of `candidates` that fits); any other node is clamped.
 */
export function FitLine(props: { text: ReactNode; candidates?: ReadonlyArray<string | null | undefined>; lines?: 1 | 2; className?: string }) {
    const lines = props.lines ?? 1
    return typeof props.text === 'string'
        ? <FitText kind="label" lines={lines} text={props.text} candidates={props.candidates} className={props.className} />
        : <span data-fit="line" className={cn('block min-w-0 break-words', CLAMP[lines], props.className)}>{props.text}</span>
}
