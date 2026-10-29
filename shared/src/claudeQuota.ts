/**
 * Claude Code answers a turn that the account's quota refuses with a synthetic assistant message (model
 * `<synthetic>`), such as "You've hit your weekly limit · resets Oct 31 at 4pm". A warning ("Approaching usage
 * limit") is not a refusal and does not match.
 */
const QUOTA_REFUSAL = /^(?:You['’]ve hit your\b.*\blimit\b|Claude AI usage limit reached|(?:5-hour|weekly|session|Opus|Sonnet) limit reached)/i

export function isClaudeQuotaRefusal(text: string): boolean {
    return QUOTA_REFUSAL.test(text.trim())
}

/** The refusal text of a synthetic assistant message (`{ model, content }`), or null. */
export function claudeQuotaRefusal(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null
    const { model, content } = message as { model?: unknown; content?: unknown }
    if (model !== '<synthetic>') return null
    const text = typeof content === 'string'
        ? content
        : Array.isArray(content)
            ? content.map((block) => (block && typeof block === 'object' && (block as { type?: unknown }).type === 'text' ? String((block as { text?: unknown }).text ?? '') : '')).join('')
            : ''
    return isClaudeQuotaRefusal(text) ? text.trim() : null
}
