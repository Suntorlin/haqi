/** A published HAQI report: https://<host>/share/r/<token> (the link report_create returns). */
const REPORT_LINK = /https?:\/\/[^\s"'<>)\]\\]+\/share\/r\/[A-Za-z0-9_-]+/g

const MAX_REPORT_LINKS = 3

type PartLike = {
    type: string
    text?: string
    result?: unknown
}

function stringify(value: unknown): string {
    if (typeof value === 'string') return value
    if (value === undefined || value === null) return ''
    try {
        return JSON.stringify(value)
    } catch {
        return ''
    }
}

/**
 * Report links found in one agent turn: in its text and in tool results (report_create answers with
 * the share link). Distinct, in order of appearance, capped so the footer stays one line.
 */
export function extractReportLinks(parts: readonly PartLike[]): string[] {
    const found: string[] = []
    for (const part of parts) {
        const source = part.type === 'text' ? part.text ?? '' : part.type === 'tool-call' ? stringify(part.result) : ''
        for (const match of source.matchAll(REPORT_LINK)) {
            if (!found.includes(match[0])) found.push(match[0])
        }
    }
    return found.slice(0, MAX_REPORT_LINKS)
}
