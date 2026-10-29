import type { StoredEmployee, StoredEmployeeIssue, StoredMemory } from '../store'

/**
 * MEMORY.md: the readable view of an employee's memories. The hub renders it from the database, and reads the user's
 * edits back by diffing the current file against the snapshot saved at the last generation (employee_memory_views).
 * Without that snapshot "the user deleted this line" and "this line never existed" look the same.
 */

const PIN_MARK = '📌'
const HEADER_NOTE = `<!-- HAQI 生成。可以直接改：改内容=更新，删整行=归档，行首加 ${PIN_MARK}=钉住。 -->`

export type MemoryViewSection = 'issues' | 'principle' | 'experience' | 'fact'

const SECTION_TITLES: Record<MemoryViewSection, string> = {
    issues: '遗留问题',
    principle: '原则',
    experience: '经验',
    fact: '事实'
}

export type MemoryViewEntry = {
    kind: 'memory' | 'issue'
    id: string
    /** The line's text without the bullet, pin mark, issue prefix and id comment. */
    body: string
    pinned: boolean
    section: MemoryViewSection
}

export type ParsedMemoryView = {
    entries: MemoryViewEntry[]
    /** Bullet lines without an id comment: lines the user wrote by hand. */
    added: Array<{ body: string; section: MemoryViewSection }>
}

export function renderMemoryView(
    employee: Pick<StoredEmployee, 'name'>,
    memories: StoredMemory[],
    issues: StoredEmployeeIssue[],
    timezone: string
): string {
    const lines: string[] = [`# ${employee.name} 的长期记忆`, HEADER_NOTE, '']
    lines.push(`## ${SECTION_TITLES.issues}`)
    for (const issue of issues) {
        lines.push(`- [${dayInZone(issue.firstSeen, timezone)} · ${issue.seenCount} 次] ${issue.text} <!-- i:${issue.id} -->`)
    }
    lines.push('')
    for (const section of ['principle', 'experience', 'fact'] as const) {
        lines.push(`## ${SECTION_TITLES[section]}`)
        for (const memory of memories.filter((m) => m.level === section && m.status === 'active')) {
            lines.push(`- ${memory.pinned ? `${PIN_MARK} ` : ''}${memory.text} <!-- m:${memory.id} -->`)
        }
        lines.push('')
    }
    return `${lines.join('\n').replace(/\n+$/, '')}\n`
}

export function parseMemoryView(content: string): ParsedMemoryView {
    const entries: MemoryViewEntry[] = []
    const added: ParsedMemoryView['added'] = []
    let section: MemoryViewSection = 'fact'
    for (const raw of content.split('\n')) {
        const heading = raw.match(/^##\s+(.+?)\s*$/)
        if (heading) {
            const found = (Object.entries(SECTION_TITLES) as Array<[MemoryViewSection, string]>).find(([, title]) => title === heading[1])
            if (found) section = found[0]
            continue
        }
        const bullet = raw.match(/^-\s+(.*)$/)
        if (!bullet) continue
        const line = bullet[1]
        const marker = line.match(/^(.*?)\s*<!--\s*([mi]):([\w-]+)\s*-->\s*$/)
        if (!marker) {
            const body = stripPin(line).body.trim()
            if (body) added.push({ body, section })
            continue
        }
        const { pinned, body } = stripPin(marker[1])
        entries.push({
            kind: marker[2] === 'i' ? 'issue' : 'memory',
            id: marker[3],
            body: (marker[2] === 'i' ? stripIssuePrefix(body) : body).trim(),
            pinned,
            section
        })
    }
    return { entries, added }
}

export type MemoryViewDiff = {
    /** Memory lines whose text or pin changed in the file. */
    updated: Array<{ id: string; text: string; pinned: boolean }>
    /** Memory lines the user deleted: archive those memories. */
    removedMemoryIds: string[]
    /** Issue lines the user deleted: close those issues. */
    removedIssueIds: string[]
    /** Lines the user wrote by hand: new memories (or issues, in that section). */
    added: Array<{ body: string; section: MemoryViewSection }>
}

/** What the user changed: the current file against the snapshot saved at the last generation. */
export function diffMemoryView(snapshot: string, current: string): MemoryViewDiff {
    const before = parseMemoryView(snapshot)
    const after = parseMemoryView(current)
    const afterById = new Map(after.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]))
    const diff: MemoryViewDiff = { updated: [], removedMemoryIds: [], removedIssueIds: [], added: after.added }
    for (const entry of before.entries) {
        const now = afterById.get(`${entry.kind}:${entry.id}`)
        if (!now) {
            if (entry.kind === 'memory') diff.removedMemoryIds.push(entry.id)
            else diff.removedIssueIds.push(entry.id)
            continue
        }
        if (entry.kind === 'memory' && (now.body !== entry.body || now.pinned !== entry.pinned)) {
            diff.updated.push({ id: entry.id, text: now.body, pinned: now.pinned })
        }
    }
    return diff
}

/** Lines that are in one text and not the other, for the human-readable CHANGES.md entry. */
export function changedLines(before: string, current: string): { added: string[]; removed: string[] } {
    const a = new Set(before.split('\n').filter((line) => line.startsWith('- ')))
    const b = new Set(current.split('\n').filter((line) => line.startsWith('- ')))
    return {
        added: [...b].filter((line) => !a.has(line)),
        removed: [...a].filter((line) => !b.has(line))
    }
}

export function dayInZone(timestamp: number, timezone: string): string {
    try {
        return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, dateStyle: 'short' }).format(timestamp)
    } catch {
        return new Date(timestamp).toISOString().slice(0, 10)
    }
}

export function timeInZone(timestamp: number, timezone: string): string {
    try {
        return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, timeStyle: 'short' }).format(timestamp)
    } catch {
        return new Date(timestamp).toISOString().slice(11, 16)
    }
}

/** Day of week (0 = Sunday … 6 = Saturday) in the zone; the weekly review check. */
export function weekdayInZone(timestamp: number, timezone: string): number {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    try {
        const name = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(timestamp)
        const index = names.indexOf(name)
        return index >= 0 ? index : new Date(timestamp).getUTCDay()
    } catch {
        return new Date(timestamp).getUTCDay()
    }
}

/** Hour of day (0-23) in the zone; the nightly window check. */
export function hourInZone(timestamp: number, timezone: string): number {
    try {
        const hour = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' }).format(timestamp)
        return Number.parseInt(hour, 10)
    } catch {
        return new Date(timestamp).getUTCHours()
    }
}

function stripPin(text: string): { pinned: boolean; body: string } {
    const trimmed = text.trim()
    if (trimmed.startsWith(PIN_MARK)) return { pinned: true, body: trimmed.slice(PIN_MARK.length).trim() }
    return { pinned: false, body: trimmed }
}

function stripIssuePrefix(text: string): string {
    return text.replace(/^\[[^\]]*\]\s*/, '')
}
