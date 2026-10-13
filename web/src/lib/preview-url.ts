/** Error codes map to `preview.error.<code>` translations. */
export type PreviewUrlError = 'protocol' | 'invalid'

export function normalizePreviewUrlInput(raw: string): { value: string | null; error?: PreviewUrlError } {
    const trimmed = raw.trim()
    if (!trimmed) {
        return { value: null }
    }

    const candidates = trimmed.includes('://')
        ? [trimmed]
        : [`http://${trimmed}`, `https://${trimmed}`]

    for (const candidate of candidates) {
        try {
            const url = new URL(candidate)
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return { value: null, error: 'protocol' }
            }
            return { value: url.toString() }
        } catch {
        }
    }

    return { value: null, error: 'invalid' }
}
