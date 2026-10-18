/** Chat zoom levels: pinch out for an overview, pinch in for the details. */
export const ZOOM_BRIEF = 0
export const ZOOM_REPLY = 1
export const ZOOM_ALL = 2
export const ZOOM_LEVEL_COUNT = 3

/** The conclusion stops after the first sentence that reaches this length. */
const BRIEF_MIN_LENGTH = 8
const BRIEF_MAX_LENGTH = 90
/** A lead-in such as "进度：" or "Summary:" says nothing on its own. */
const LEAD_IN_MAX_LENGTH = 20
const USER_BRIEF_MAX_LENGTH = 28

const FENCE = /^\s*(```|~~~)/
const TABLE_ROW = /^\s*\|/
const HEADING = /^\s*#{1,6}\s+/
const QUOTE = /^\s*>\s?/
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s+/
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/

/** Markdown inline syntax removed, so the words compare one to one between levels. */
export function stripInline(line: string): string {
    return line
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/(\*\*|__)(.+?)\1/g, '$2')
        .replace(/(^|[^\w*])[*_]([^*_\s][^*_]*?)[*_](?=[^\w*]|$)/g, '$1$2')
        .replace(/<[^>]+>/g, '')
        .trim()
}

/** The zoom text reads `*`, `[` and `\` as markup; plain text must escape them. */
function escapeZoomText(text: string): string {
    return text.replace(/[\\*[]/g, (ch) => `\\${ch}`)
}

type ProseLine = { text: string; marker: string; heading: boolean }

/** Prose lines of a reply in reading order; `simple` is false when it has blocks prose can't show (code, tables, images). */
function readProse(markdown: string): { lines: ProseLine[]; simple: boolean } {
    const lines: ProseLine[] = []
    let simple = true
    let inFence = false
    for (const raw of markdown.split('\n')) {
        if (FENCE.test(raw)) {
            inFence = !inFence
            simple = false
            continue
        }
        if (inFence) continue
        if (TABLE_ROW.test(raw) || /!\[[^\]]*\]\(/.test(raw)) {
            simple = false
            continue
        }
        if (RULE.test(raw) || raw.trim().length === 0) continue
        const heading = HEADING.test(raw)
        let line = raw.replace(HEADING, '').replace(QUOTE, '')
        const marker = line.match(LIST_MARKER)?.[0].trim() ?? ''
        line = line.replace(LIST_MARKER, '')
        const text = stripInline(line)
        if (text.length > 0) lines.push({ text, marker, heading })
    }
    return { lines, simple }
}

function firstSentences(text: string): string {
    let end = 0
    while (end < text.length) {
        const match = /[。！？!?]|\.(?=\s|$)/.exec(text.slice(end))
        if (!match) return text
        end += match.index + match[0].length
        if (end >= BRIEF_MIN_LENGTH) break
    }
    return text.slice(0, end).trim()
}

function clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

/** One-sentence conclusion of an agent reply: the first sentence that says something. */
export function extractConclusion(markdown: string): string {
    const { lines } = readProse(markdown)
    const saysSomething = (l: ProseLine) => !l.heading && !(/[:：]$/.test(l.text) && l.text.length <= LEAD_IN_MAX_LENGTH)
    const line = lines.find(saysSomething) ?? lines[0]
    if (!line) return ''
    return clip(firstSentences(line.text), BRIEF_MAX_LENGTH)
}

/**
 * Brief and full versions of an agent reply for the word morph.
 * `simple` replies morph word by word; others (code, tables) switch between the two.
 */
export function replyZoomVersions(markdown: string): { brief: string; full: string; simple: boolean } {
    const { lines, simple } = readProse(markdown)
    const full = lines.map((l) => (l.marker ? `${l.marker} ${l.text}` : l.text)).join('\n')
    return { brief: escapeZoomText(extractConclusion(markdown)), full: escapeZoomText(full), simple }
}

/** Brief and full versions of a user message: its first line, clipped. */
export function userZoomVersions(text: string): { brief: string; full: string } {
    const trimmed = text.trim()
    const firstLine = trimmed.split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
    const brief = clip(firstLine, USER_BRIEF_MAX_LENGTH)
    const full = trimmed.split('\n').filter((l) => l.trim().length > 0).join('\n')
    return { brief: escapeZoomText(brief), full: escapeZoomText(full) }
}
