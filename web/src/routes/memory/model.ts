import type { MemoryEvent, MemoryItem, MemoryLevel, MemoryLink } from '@/types/api'

/** Labels and small helpers shared by the memory list, the edit sheet and the graph. */

export type Level = MemoryLevel

export const LEVEL_LABEL: Record<Level, string> = { fact: '事实', experience: '经验', principle: '原则' }

export const SOURCE_LABEL: Record<string, string> = {
    propose: '会话提交',
    import: 'MEMORY.md',
    claude_auto: 'Claude 自带记忆',
    user_message: '你的消息',
    user_edit: '你',
    decision: '你在任务里的选择'
}

export function sourceLabel(memory: Pick<MemoryItem, 'source' | 'sourceLabel'>): string {
    return memory.sourceLabel ?? SOURCE_LABEL[memory.source] ?? memory.source
}

export function scopeLabel(scope: string): string {
    return scope || '全局'
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

export function formatWhen(timestamp: number, now = Date.now()): string {
    const minutes = Math.floor((now - timestamp) / 60_000)
    if (minutes < 1) return '刚刚'
    if (minutes < 60) return `${minutes} 分钟前`
    const date = new Date(timestamp)
    const today = new Date(now)
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
    if (date.toDateString() === today.toDateString()) return `今天 ${time}`
    const yesterday = new Date(now - 24 * 3600 * 1000)
    if (date.toDateString() === yesterday.toDateString()) return `昨天 ${time}`
    return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export const ACTION_LABEL: Record<string, string> = {
    added: '新记下',
    pending: '等你审批',
    candidate: '观察中',
    promoted: '被提到够多次，交给你审批',
    expired: '30 天没再出现，不记了',
    merged: '合并了重复',
    reinforced: '被加强',
    edited: '你改过',
    confirmed: '你通过了',
    dismissed: '你选了不记',
    deleted: '你删了'
}

export const TRIAL = { windowDays: 30, promote: 3 } as const

/** "30 天内被提到 1/3 次 · 还剩 29 天" for a memory on trial. */
export function trialLabel(state: { recent: number; lastAt: number } | undefined, now = Date.now()): string {
    if (!state) return '观察中'
    const left = Math.max(0, Math.ceil((state.lastAt + TRIAL.windowDays * 24 * 3600 * 1000 - now) / (24 * 3600 * 1000)))
    return `${TRIAL.windowDays} 天内被提到 ${state.recent}/${TRIAL.promote} 次 · 还剩 ${left} 天`
}

/** Recent events worth a row: one per memory, newest first, skipping the ones still waiting or on trial. */
export function recentRows(events: MemoryEvent[], memories: MemoryItem[], limit = 12): Array<{ event: MemoryEvent; memory: MemoryItem | null }> {
    const byId = new Map(memories.map((m) => [m.id, m]))
    const seen = new Set<string>()
    const rows: Array<{ event: MemoryEvent; memory: MemoryItem | null }> = []
    for (const event of events) {
        if (!ACTION_LABEL[event.action] || event.action === 'pending' || event.action === 'candidate') continue
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
