import type { MemoryEvent, MemoryItem, MemoryLevel, MemoryLink } from '@/types/api'

/** Labels and small helpers shared by the memory list, the edit sheet and the graph. */

export type Level = MemoryLevel

/** The `t` from `useTranslation()`, passed in by the components. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

export function levelLabel(level: Level, t: Translate): string {
    return t(`memoryPage.level.${level}`)
}

/** Source -> i18n key. `import` shows the file name, which is the same in every language. */
const SOURCE_KEY: Record<string, string> = {
    propose: 'memoryPage.source.propose',
    claude_auto: 'memoryPage.source.claudeAuto',
    user_message: 'memoryPage.source.userMessage',
    user_edit: 'memoryPage.source.userEdit'
}

/**
 * The hub stores some source labels as Chinese text. Match those forms and show them in the
 * user's language; the quote and the file name inside them are data and stay as they are.
 */
function storedSourceLabel(label: string, t: Translate): string {
    const said = /^你说：「([\s\S]*)」$/.exec(label)
    if (said) return t('memoryPage.source.youSaid', { quote: said[1] })
    const file = /^Claude 自带记忆 · (.+)$/.exec(label)
    if (file) return t('memoryPage.source.claudeAutoFile', { file: file[1] })
    const session = /^会话 · (.+)$/.exec(label)
    if (session) return t('memoryPage.source.sessionTitled', { title: session[1] })
    if (label === '会话') return t('memoryPage.source.session')
    if (label === 'Claude 自带记忆') return t('memoryPage.source.claudeAuto')
    if (label === '你的消息') return t('memoryPage.source.userMessage')
    if (label === '你') return t('memoryPage.source.userEdit')
    return label
}

export function sourceLabel(memory: Pick<MemoryItem, 'source' | 'sourceLabel'>, t: Translate): string {
    if (memory.sourceLabel) return storedSourceLabel(memory.sourceLabel, t)
    if (memory.source === 'import') return 'MEMORY.md'
    const key = SOURCE_KEY[memory.source]
    return key ? t(key) : memory.source
}

/** Without `t` (graph layout) the global scope has no label; the graph draws it with `t`. */
export function scopeLabel(scope: string, t?: Translate): string {
    return scope || (t ? t('memoryPage.scope.global') : '')
}

/** Global first, then projects alphabetically. */
export function scopesInOrder(memories: MemoryItem[]): string[] {
    const projects = Array.from(new Set(memories.map((m) => m.scope).filter(Boolean))).sort()
    return memories.some((m) => m.scope === '') ? ['', ...projects] : projects
}

/** Memories one level down that back `id` (links point from the backing memory to the one it backs). */
export function evidenceOf(id: string, links: MemoryLink[]): string[] {
    return links.filter((link) => link.toId === id).map((link) => link.fromId)
}

export function supportsOf(id: string, links: MemoryLink[]): string[] {
    return links.filter((link) => link.fromId === id).map((link) => link.toId)
}

/** A short node label for the graph: the sentence head, cut at the first clause. */
export function shortLabel(text: string): string {
    const head = text.split(/[，。；;,.:：]/)[0]?.trim() || text
    return head.length > 8 ? `${head.slice(0, 7)}…` : head
}

export function formatWhen(timestamp: number, t: Translate, now = Date.now()): string {
    const minutes = Math.floor((now - timestamp) / 60_000)
    if (minutes < 1) return t('memoryPage.when.justNow')
    if (minutes < 60) return t('memoryPage.when.minutesAgo', { count: minutes })
    const date = new Date(timestamp)
    const today = new Date(now)
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    if (date.toDateString() === today.toDateString()) return t('memoryPage.when.today', { time })
    const yesterday = new Date(now - 24 * 3600 * 1000)
    if (date.toDateString() === yesterday.toDateString()) return t('memoryPage.when.yesterday', { time })
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Event actions that get a row in "Recent", each with its label. */
const ACTIONS = ['added', 'pending', 'candidate', 'promoted', 'expired', 'merged', 'reinforced', 'edited', 'confirmed', 'dismissed', 'deleted'] as const

export function hasActionLabel(action: string): boolean {
    return (ACTIONS as readonly string[]).includes(action)
}

export function actionLabel(action: string, t: Translate): string {
    return hasActionLabel(action) ? t(`memoryPage.action.${action}`, { days: TRIAL.windowDays }) : action
}

export const TRIAL = { windowDays: 30, promote: 3 } as const

/** "Mentioned 1/3 times in 30 days · 29 days left" for a memory on trial. */
export function trialLabel(state: { recent: number; lastAt: number } | undefined, t: Translate, now = Date.now()): string {
    if (!state) return t('memoryPage.status.candidate')
    const left = Math.max(0, Math.ceil((state.lastAt + TRIAL.windowDays * 24 * 3600 * 1000 - now) / (24 * 3600 * 1000)))
    return t('memoryPage.trial.progress', { days: TRIAL.windowDays, recent: state.recent, promote: TRIAL.promote, left })
}

/** Recent events worth a row: one per memory, newest first, skipping the ones still waiting or on trial. */
export function recentRows(events: MemoryEvent[], memories: MemoryItem[], limit = 12): Array<{ event: MemoryEvent; memory: MemoryItem | null }> {
    const byId = new Map(memories.map((m) => [m.id, m]))
    const seen = new Set<string>()
    const rows: Array<{ event: MemoryEvent; memory: MemoryItem | null }> = []
    for (const event of events) {
        if (!hasActionLabel(event.action) || event.action === 'pending' || event.action === 'candidate') continue
        const key = event.memoryId ?? event.id
        if (seen.has(key)) continue
        seen.add(key)
        const memory = event.memoryId ? byId.get(event.memoryId) ?? null : null
        if (memory?.status === 'pending' || memory?.status === 'candidate') continue
        rows.push({ event, memory })
        if (rows.length >= limit) break
    }
    return rows
}
