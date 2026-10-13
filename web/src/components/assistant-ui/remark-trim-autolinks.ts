// GFM autolinks run until whitespace, so "https://x.com/a（已验证）" swallows the CJK text after the URL.
const CJK_CHAR_REGEX = /[⺀-鿿가-힯豈-﫿＀-￯]/

/** URL part of an autolinked token, cut at the first CJK character or full-width punctuation. */
export function trimAutolinkUrl(text: string): string {
    const match = CJK_CHAR_REGEX.exec(text)
    return match ? text.slice(0, match.index) : text
}

type MdNode = {
    type: string
    value?: string
    url?: string
    children?: MdNode[]
    position?: { start: { offset?: number } }
}

function trimChildren(node: MdNode, source: string): void {
    const children = node.children
    if (!children) return

    for (let index = 0; index < children.length; index += 1) {
        const child = children[index]
        if (!child) continue
        const textChild = child.children?.[0]
        const startOffset = child.position?.start.offset
        const isLiteralAutolink = child.type === 'link'
            && child.children?.length === 1
            && textChild?.type === 'text'
            && typeof textChild.value === 'string'
            && startOffset !== undefined
            // "[label](url)" and "<url>" are explicit; only bare URLs are trimmed.
            && source[startOffset] !== '['
            && source[startOffset] !== '<'

        if (isLiteralAutolink && textChild?.value) {
            const trimmed = trimAutolinkUrl(textChild.value)
            if (trimmed !== textChild.value && trimmed.length > 0) {
                const rest = textChild.value.slice(trimmed.length)
                const urlRest = child.url && child.url.endsWith(rest) ? child.url.slice(0, child.url.length - rest.length) : child.url
                child.url = urlRest
                textChild.value = trimmed
                children.splice(index + 1, 0, { type: 'text', value: rest })
                continue
            }
        }
        trimChildren(child, source)
    }
}

/** Keeps trailing Chinese text out of bare-URL links. Runs after remark-gfm. */
export function remarkTrimAutolinks() {
    return (tree: MdNode, file: { value?: unknown }) => {
        const source = typeof file.value === 'string' ? file.value : ''
        trimChildren(tree, source)
    }
}
