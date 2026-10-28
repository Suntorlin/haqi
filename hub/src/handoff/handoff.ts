import { createHash } from 'node:crypto'
import { posix } from 'node:path'

/**
 * A handoff report is copied word for word into the user's notes folder (an Obsidian vault or any folder of
 * markdown files) after its session ends, and listed in one index file. The agent decides the folder and the
 * one-line summary while it writes the report; the hub only copies, files and checks.
 */
export const HANDOFF = {
    /** A session quiet this long after a turn counts as ended. */
    idleMs: 10 * 60_000,
    /** Work this long after the report's last update makes the report possibly out of date. */
    staleMs: 30 * 60_000,
    sweepMs: 60 * 60_000,
    retryTickMs: 60_000,
    /** Waits before the 1st, 2nd and 3rd retry of a failed write. */
    retryMs: [60_000, 5 * 60_000, 30 * 60_000],
    /** Failed writes in a row that raise an alert. */
    alertAfter: 3,
    /** A report shorter than this has nothing worth copying. */
    minChars: 200,
    /** A project keeps to one folder when that folder took this share of its handoffs... */
    folderShare: 0.9,
    /** ...out of at least this many. */
    minHistory: 2,
    /** The hourly sweep looks at handoff reports updated within this window. */
    sweepWindowMs: 14 * 24 * 60 * 60_000,
    summaryChars: 300
} as const

export type HandoffMeta = { folder: string | null; summary: string | null; shortTitle: string | null }

/** Where the copies go: the notes root, the index file and the inbox folder, both relative to the root. */
export type NotesConfig = { root: string; index: string; inbox: string; timeZone: string; zoneLabel: string }

function text(value: unknown, max: number): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.replace(/\s+/g, ' ').trim()
    return trimmed ? trimmed.slice(0, max) : null
}

/** The `handoff` part of a report's metadata; null when the report is not a handoff. */
export function readHandoffMeta(metadata: unknown): HandoffMeta | null {
    if (!metadata || typeof metadata !== 'object') return null
    const raw = (metadata as { handoff?: unknown }).handoff
    if (!raw || typeof raw !== 'object') return raw === true ? { folder: null, summary: null, shortTitle: null } : null
    const handoff = raw as { folder?: unknown; summary?: unknown; short_title?: unknown; shortTitle?: unknown }
    return {
        folder: text(handoff.folder, 500),
        summary: text(handoff.summary, HANDOFF.summaryChars),
        shortTitle: text(handoff.short_title ?? handoff.shortTitle, 60)
    }
}

/** A folder relative to the notes root, with `/` separators; null when it is absolute or climbs out with `..`. */
export function normalizeFolder(folder: string): string | null {
    const parts = folder.replace(/\\/g, '/').split('/').map((part) => part.trim()).filter((part) => part && part !== '.')
    if (folder.trim().startsWith('/') || /^[a-zA-Z]:/.test(folder.trim())) return null
    if (parts.length === 0 || parts.some((part) => part === '..')) return null
    return parts.join('/')
}

/** A title made safe as a file name on macOS, Windows and in Obsidian links. */
export function safeFileName(title: string): string {
    const cleaned = title.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120).trim()
    return cleaned || '交接'
}

/** `<title> <date>.md`, without a second date when the title already has one. */
export function fileNameFor(title: string, date: string): string {
    const name = safeFileName(title)
    return `${/\d{4}-\d{2}-\d{2}/.test(name) ? name : `${name} ${date}`}.md`
}

export function dateParts(ms: number, timeZone: string): { date: string; time: string } {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(ms))
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00'
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

export function hashText(value: string): string {
    return createHash('sha256').update(value).digest('hex').slice(0, 32)
}

/** Report images live on the web report; the notes copy links to it instead of holding them. */
export function rewriteAssets(markdown: string, shareUrl: string | null): string {
    const target = shareUrl ? `见[网页报告](${shareUrl})` : '见网页报告'
    return markdown
        .replace(/!\[([^\]]*)\]\(\s*asset:\/\/[^)\s]+\s*\)/g, (_match, caption: string) => `（图${caption.trim() ? `：${caption.trim()}` : ''}，${target}）`)
        .replace(/\[([^\]]*)\]\(\s*asset:\/\/[^)\s]+\s*\)/g, (_match, label: string) => shareUrl ? `[${label}](${shareUrl})` : label)
}

export type CopyInput = {
    reportId: string
    sessionId: string | null
    project: string | null
    markdown: string
    shareUrl: string | null
    updatedAt: number
    stale: boolean
    inbox: boolean
    timeZone: string
    zoneLabel: string
}

/** The body of the notes copy: the report word for word, its images turned into links, with a warning on top when needed. */
export function renderBody(input: CopyInput): string {
    const when = dateParts(input.updatedAt, input.timeZone)
    const notes: string[] = []
    if (input.stale) notes.push(`> [!warning] 报告可能过时：报告最后更新于 ${when.date} ${when.time} ${input.zoneLabel}，之后会话又工作了 30 分钟以上。`)
    if (input.inbox) notes.push('> [!note] 待归档：报告没有给出可用的目录，先放在这里。')
    const body = rewriteAssets(input.markdown.trim(), input.shareUrl)
    return `${notes.length > 0 ? `${notes.join('\n\n')}\n\n` : ''}${body}\n`
}

/** The whole notes copy: front matter that ties it to its report, then the body. */
export function renderCopy(input: CopyInput): string {
    const when = dateParts(input.updatedAt, input.timeZone)
    const lines = [
        '---',
        `haqi_report: ${input.reportId}`,
        ...(input.sessionId ? [`haqi_session: ${input.sessionId}`] : []),
        ...(input.project ? [`project: ${JSON.stringify(input.project)}`] : []),
        `updated: ${when.date} ${when.time}`,
        ...(input.stale ? ['stale: true'] : []),
        '---',
        ''
    ]
    return `${lines.join('\n')}${renderBody(input)}`
}

/** The section added at the end of a copy the user edited by hand. */
export function appendSection(current: string, body: string, at: { date: string; time: string }, zoneLabel: string): string {
    return `${current.replace(/\s+$/, '')}\n\n## HAQI 更新 ${at.date} ${at.time} ${zoneLabel}\n\n${body}`
}

export type IndexLineInput = {
    date: string
    time: string
    zoneLabel: string
    linkPath: string
    shortTitle: string
    summary: string | null
    shareUrl: string | null
    stale: boolean
    inbox: boolean
}

/** One index line, in the shape the user already keeps: when, link, summary, web report. */
export function indexLine(input: IndexLineInput): string {
    const flags = [input.inbox ? '【待归档】' : '', input.stale ? '【报告可能过时】' : ''].join('')
    const summary = (input.summary ?? '（摘要待补）').replace(/[。.]\s*$/, '')
    const share = input.shareUrl ? `[网页报告](${input.shareUrl})（3 天内有效）` : ''
    return `- ${input.date} ${input.time} ${input.zoneLabel}：${flags}[[${input.linkPath}|${input.shortTitle.replace(/[|\]]/g, ' ')}]]：${summary}。${share}`.trimEnd()
}

function linksTo(line: string, linkPath: string): boolean {
    return line.includes(`[[${linkPath}|`) || line.includes(`[[${linkPath}]]`) || line.includes(`[[${linkPath}#`)
}

/** The index with the report's line replaced in place, or added at the top (after any front matter). */
export function upsertIndexLine(index: string, linkPaths: string[], line: string): string {
    const lines = index.split('\n')
    const at = lines.findIndex((existing) => linkPaths.some((path) => linksTo(existing, path)))
    if (at >= 0) {
        lines[at] = line
        return lines.join('\n')
    }
    let insertAt = 0
    if (lines[0] === '---') {
        const end = lines.indexOf('---', 1)
        if (end > 0) insertAt = end + 1
    }
    lines.splice(insertAt, 0, line)
    return lines.join('\n')
}

/** Folders the index already links into, most used first; `resolve` maps a link to a folder under the root, or null. */
export function indexFolders(index: string, resolve: (linkPath: string) => string | null): Array<{ folder: string; count: number }> {
    const counts = new Map<string, number>()
    for (const match of index.matchAll(/\[\[([^\]|#]+)/g)) {
        const folder = resolve(match[1]!.trim())
        if (folder) counts.set(folder, (counts.get(folder) ?? 0) + 1)
    }
    return [...counts.entries()].map(([folder, count]) => ({ folder, count })).sort((a, b) => b.count - a.count)
}

/** The project's one folder, when it keeps to one; null when its handoffs spread over several. */
export function folderFromHistory(counts: Array<{ folder: string; count: number }>): string | null {
    const total = counts.reduce((sum, entry) => sum + entry.count, 0)
    const top = counts[0]
    if (!top || total < HANDOFF.minHistory) return null
    return top.count / total >= HANDOFF.folderShare ? top.folder : null
}

/** The link path Obsidian resolves without doubt: from the root, no `.md`. */
export function linkPathOf(filePath: string): string {
    return filePath.replace(/\.md$/i, '')
}

export function folderOf(filePath: string): string {
    const dir = posix.dirname(filePath)
    return dir === '.' ? '' : dir
}

/** What the session is asked to fix before its report is copied; empty when nothing. */
export function nudgeText(input: { title: string; stale: boolean; folderProblem: string | null; summaryMissing: boolean; candidates: string[] }): string | null {
    const asks: string[] = []
    if (input.stale) asks.push('报告最后更新后，会话又工作了 30 分钟以上。请把新的结论、改动和验证结果更新进报告；内容仍然准确的话，只传 report_id 调一次 report_update 即可。')
    if (input.folderProblem) asks.push(`${input.folderProblem}请在 handoff.folder 里给一个笔记库里已有的目录（相对笔记根目录）。可选：${input.candidates.slice(0, 8).join('；') || '用 handoff_folders 查'}。`)
    if (input.summaryMissing) asks.push('请在 handoff.summary 里写一句总入口摘要：结论和关键数字、风险、待用户定的事。')
    if (asks.length === 0) return null
    return [
        `[HAQI 交接] 交接报告「${input.title}」会在会话结束后复制到笔记库。复制前请用 report_update 处理：`,
        ...asks.map((ask, index) => `${index + 1}. ${ask}`),
        '只更新报告，不要自己写笔记库，HAQI 会复制。'
    ].join('\n')
}
