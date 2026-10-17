import { createHash } from 'node:crypto'
import { basename } from 'node:path'

import { readSettings, writeSettings, type Settings } from '../config/settings'
import type { Store, StoredMemory, StoredMemoryEvent, StoredMemoryLink } from '../store'
import { listClaudeMemoryFiles, listMemoryMdBullets } from './harvest'
import { askJev, JevError, resolveJevApiKey } from './jev'
import { buildQuestions, decide, parseVerdict, type JevVerdict, type MemoryLevel } from './judge'
import { mostSimilar } from './similarity'

export type MemoryMode = 'off' | 'record'
export type MemorySource = 'propose' | 'claude_auto' | 'import' | 'user_message'

export type MemoryCaptureSettings = { mode: MemoryMode; projects: string[] }

export type ProposeInput = {
    namespace: string
    text: string
    said: boolean
    source: MemorySource
    sourceLabel: string | null
    sessionId: string | null
    /** Repository the candidate came from; null = no project (global candidates only). */
    project: string | null
    sourceRef?: string | null
}

export type ProposeResult = {
    action: 'added' | 'pending' | 'reinforced' | 'skipped' | 'rejected' | 'duplicate' | 'off' | 'not-enabled'
    memoryId: string | null
    message: string
}

export type StoredJev = JevVerdict & { project: string | null; costUsd: number; latencyMs: number; model: string }

const DEFAULT_PROJECTS = ['haqi']
const MAX_TEXT = 400
const LEVEL_LABEL: Record<MemoryLevel, string> = { fact: '事实', experience: '经验', principle: '原则' }

/** Values that look like credentials; caught before anything leaves the machine. */
const SECRET_PATTERNS = [
    /\bsk-[A-Za-z0-9_-]{16,}/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}/,
    /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /(password|passwd|secret|token|api[_-]?key|密码|口令)\s*[:=：是为]\s*\S{6,}/i
]

function normalize(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
}

function textHash(text: string): string {
    return createHash('sha256').update(text.toLowerCase()).digest('hex').slice(0, 16)
}

function startOfToday(): number {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}

export class MemoryService {
    private harvesting = false

    constructor(
        private readonly store: Store,
        private readonly options: {
            /** Resolved lazily: the hub configuration is created after the engine in some tests. */
            paths: () => { dataDir: string; settingsFile: string }
            onChange: (namespace: string) => void
            fetchFn?: typeof fetch
        }
    ) {}

    async getSettings(): Promise<MemoryCaptureSettings & { jevApiKey: string | null }> {
        const settings: Settings = (await readSettings(this.options.paths().settingsFile)) ?? {}
        const capture = settings.memoryCapture ?? {}
        return {
            mode: capture.mode === 'off' ? 'off' : 'record',
            projects: capture.projects ?? DEFAULT_PROJECTS,
            jevApiKey: capture.jevApiKey ?? null
        }
    }

    async updateSettings(patch: Partial<MemoryCaptureSettings>): Promise<MemoryCaptureSettings> {
        const settings: Settings = (await readSettings(this.options.paths().settingsFile)) ?? {}
        const current = settings.memoryCapture ?? {}
        settings.memoryCapture = {
            ...current,
            ...(patch.mode ? { mode: patch.mode } : {}),
            ...(patch.projects ? { projects: Array.from(new Set(patch.projects.map((p) => p.trim()).filter(Boolean))) } : {})
        }
        await writeSettings(this.options.paths().settingsFile, settings)
        const next = await this.getSettings()
        return { mode: next.mode, projects: next.projects }
    }

    async jevStatus(): Promise<{ ready: boolean }> {
        const settings = await this.getSettings()
        return { ready: Boolean(resolveJevApiKey(settings.jevApiKey)) }
    }

    /** One candidate: dedupe, local secret check, Jev's calls, the rule, then store and log. */
    async propose(input: ProposeInput): Promise<ProposeResult> {
        const settings = await this.getSettings()
        if (settings.mode === 'off') return { action: 'off', memoryId: null, message: '记忆采集已关闭。' }
        if (input.project && !settings.projects.includes(input.project)) {
            return { action: 'not-enabled', memoryId: null, message: `项目 ${input.project} 没开记忆采集。` }
        }

        const text = normalize(input.text)
        if (text.length < 4) return { action: 'skipped', memoryId: null, message: '没记：内容太短。' }
        const hash = textHash(text)
        if (this.store.memories.hasEventHash(input.namespace, hash)) {
            return { action: 'duplicate', memoryId: null, message: '这条已经记过。' }
        }
        const base = {
            namespace: input.namespace,
            source: input.source,
            sourceLabel: input.sourceLabel,
            sourceRef: input.sourceRef ?? null,
            hash,
            sessionId: input.sessionId
        }

        if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) {
            this.log({ ...base, memoryId: null, action: 'rejected', text: '（含密钥，原文没有保存）', reason: '含密钥', jev: null, costUsd: 0, latencyMs: 0 })
            return { action: 'rejected', memoryId: null, message: '没记：内容里像是有密钥，原文没有保存，也没有发出去。' }
        }

        const pool = this.store.memories.list(input.namespace).filter((m) => m.scope === '' || m.scope === input.project)
        const similar = mostSimilar(text, pool, 8)
        const apiKey = resolveJevApiKey(settings.jevApiKey)
        let verdict: JevVerdict | null = null
        let jevMeta = { costUsd: 0, latencyMs: 0, model: '' }
        let jevProblem: string | null = apiKey ? null : '没有 Jev 的 key'
        if (apiKey) {
            try {
                const result = await askJev({
                    apiKey,
                    state: { candidate: text, said_by_user: input.said, project: input.project ?? 'none' },
                    questions: buildQuestions({ hasProject: Boolean(input.project), similar: similar.map((m) => ({ id: m.id, text: m.text })) }),
                    fetchFn: this.options.fetchFn
                })
                verdict = parseVerdict(result.answers, { hasProject: Boolean(input.project) })
                jevMeta = { costUsd: result.costUsd, latencyMs: result.latencyMs, model: result.model }
            } catch (error) {
                jevProblem = error instanceof JevError ? error.message : 'Jev 请求失败'
            }
        }

        if (!verdict) {
            // Nothing judged: keep it for the user, with a neutral guess.
            const memory = this.store.memories.insert({
                namespace: input.namespace, text, level: input.said ? 'principle' : 'experience', scope: input.said ? '' : input.project ?? '',
                status: 'pending', reason: `Jev 没判断：${jevProblem}`, source: input.source, sourceLabel: input.sourceLabel, sessionId: input.sessionId,
                said: input.said, support: 1, jev: null, overridden: null, replaces: null
            })
            this.log({ ...base, memoryId: memory.id, action: 'pending', text, reason: memory.reason, jev: null, costUsd: 0, latencyMs: 0 })
            return { action: 'pending', memoryId: memory.id, message: `已放进“等你确认”：Jev 没判断（${jevProblem}）。` }
        }

        const jev: StoredJev = { ...verdict, project: input.project, ...jevMeta }
        const matched = verdict.match.id ? pool.find((m) => m.id === verdict.match.id) ?? null : null
        const decision = decide({ verdict, said: input.said, matchedLevel: matched?.level ?? null })

        if (decision.kind === 'reject') {
            this.log({ ...base, memoryId: null, action: 'rejected', text: '（含密钥，原文没有保存）', reason: decision.reason, jev, ...jevMeta })
            return { action: 'rejected', memoryId: null, message: '没记：Jev 认为内容里有密钥。' }
        }
        if (decision.kind === 'skip') {
            this.log({ ...base, memoryId: null, action: 'skipped', text, reason: decision.reason, jev, ...jevMeta })
            return { action: 'skipped', memoryId: null, message: `没记：${decision.reason}。` }
        }
        if (decision.kind === 'reinforce' && matched) {
            this.store.memories.update(matched.id, input.namespace, { support: matched.support + 1 })
            this.log({ ...base, memoryId: matched.id, action: 'reinforced', text, reason: null, jev, ...jevMeta })
            return { action: 'reinforced', memoryId: matched.id, message: `和已有的一条是同一件事，已加强（支撑 ${matched.support + 1}）。` }
        }
        if (decision.kind !== 'add') return { action: 'skipped', memoryId: null, message: '没记。' }

        const scope = decision.scope === 'project' && input.project ? input.project : ''
        const memory = this.store.memories.insert({
            namespace: input.namespace, text, level: decision.level, scope, status: decision.status, reason: decision.reason,
            source: input.source, sourceLabel: input.sourceLabel, sessionId: input.sessionId, said: input.said, support: 1,
            jev, overridden: null, replaces: null
        })
        if (decision.link) {
            const [from, to] = decision.link.direction === 'supports-matched' ? [memory.id, decision.link.matchedId] : [decision.link.matchedId, memory.id]
            this.store.memories.link(input.namespace, from, to)
        }
        this.log({ ...base, memoryId: memory.id, action: decision.status === 'active' ? 'added' : 'pending', text, reason: decision.reason, jev, ...jevMeta })
        const where = `${LEVEL_LABEL[decision.level]} · ${scope || '全局'}`
        return decision.status === 'active'
            ? { action: 'added', memoryId: memory.id, message: `已记下：${where}。` }
            : { action: 'pending', memoryId: memory.id, message: `已放进“等你确认”（${where}）：${decision.reason}。` }
    }

    edit(namespace: string, id: string, patch: { text?: string; level?: MemoryLevel; scope?: string }): StoredMemory | null {
        const current = this.store.memories.get(id, namespace)
        if (!current) return null
        const jev = current.jev as StoredJev | null
        const text = patch.text !== undefined ? normalize(patch.text) : current.text
        const level = patch.level ?? current.level
        const scope = patch.scope ?? current.scope
        const overridden: { level?: string; scope?: string } = {}
        if (jev && level !== jev.level.choice) overridden.level = level
        const jevScope = jev ? (jev.scope.choice === 'project' && jev.project ? jev.project : '') : scope
        if (jev && scope !== jevScope) overridden.scope = scope
        const updated = this.store.memories.update(id, namespace, {
            text, level, scope,
            overridden: Object.keys(overridden).length > 0 ? overridden : null,
            bumpVersion: text !== current.text
        })
        if (updated && (text !== current.text || level !== current.level || scope !== current.scope)) {
            this.log({
                namespace, memoryId: id, action: 'edited', text, reason: `从 ${LEVEL_LABEL[current.level]} · ${current.scope || '全局'} 改成 ${LEVEL_LABEL[level]} · ${scope || '全局'}`,
                source: 'user_edit', sourceLabel: '你', sourceRef: null, hash: null, sessionId: null, jev: null, costUsd: 0, latencyMs: 0
            })
        }
        return updated
    }

    confirm(namespace: string, id: string): StoredMemory | null {
        const current = this.store.memories.get(id, namespace)
        if (!current) return null
        if (current.replaces) this.store.memories.update(current.replaces, namespace, { status: 'archived' })
        const updated = this.store.memories.update(id, namespace, { status: 'active', reason: null })
        this.log({ namespace, memoryId: id, action: 'confirmed', text: current.text, reason: null, source: 'user_edit', sourceLabel: '你', sourceRef: null, hash: null, sessionId: null, jev: null, costUsd: 0, latencyMs: 0 })
        return updated
    }

    dismiss(namespace: string, id: string): boolean {
        const current = this.store.memories.get(id, namespace)
        if (!current) return false
        this.store.memories.update(id, namespace, { status: 'archived' })
        this.log({ namespace, memoryId: id, action: 'dismissed', text: current.text, reason: '你选了不记', source: 'user_edit', sourceLabel: '你', sourceRef: null, hash: null, sessionId: null, jev: null, costUsd: 0, latencyMs: 0 })
        return true
    }

    remove(namespace: string, id: string): boolean {
        const current = this.store.memories.get(id, namespace)
        if (!current) return false
        this.log({ namespace, memoryId: id, action: 'deleted', text: current.text, reason: null, source: 'user_edit', sourceLabel: '你', sourceRef: null, hash: null, sessionId: null, jev: null, costUsd: 0, latencyMs: 0 })
        return this.store.memories.delete(id, namespace)
    }

    /** Everything the memory page shows, in one payload. */
    async snapshot(namespace: string): Promise<{
        memories: StoredMemory[]
        links: StoredMemoryLink[]
        recent: StoredMemoryEvent[]
        stats: { addedToday: number; skippedToday: number; skippedReasons: Record<string, number>; judged: number; corrected: number; costTodayUsd: number }
        settings: MemoryCaptureSettings & { jevReady: boolean; knownProjects: string[] }
    }> {
        const memories = this.store.memories.list(namespace)
        const today = this.store.memories.eventsSince(namespace, startOfToday())
        const month = this.store.memories.eventsSince(namespace, Date.now() - 30 * 24 * 3600 * 1000)
        const skippedReasons: Record<string, number> = {}
        for (const event of today) {
            if (event.action === 'skipped' || event.action === 'rejected') skippedReasons[event.reason ?? '其他'] = (skippedReasons[event.reason ?? '其他'] ?? 0) + 1
        }
        const settings = await this.getSettings()
        const knownProjects = Array.from(new Set([...settings.projects, ...memories.map((m) => m.scope).filter(Boolean)])).sort()
        return {
            memories,
            links: this.store.memories.links(namespace),
            recent: this.store.memories.events(namespace, 80),
            stats: {
                addedToday: today.filter((e) => e.action === 'added' || e.action === 'pending').length,
                skippedToday: today.filter((e) => e.action === 'skipped' || e.action === 'rejected').length,
                skippedReasons,
                judged: month.filter((e) => e.jev !== null).length,
                corrected: month.filter((e) => e.action === 'edited' || e.action === 'dismissed').length,
                costTodayUsd: today.reduce((sum, e) => sum + e.costUsd, 0)
            },
            settings: { mode: settings.mode, projects: settings.projects, jevReady: Boolean(resolveJevApiKey(settings.jevApiKey)), knownProjects }
        }
    }

    /** Claude Code's own memory files of the enabled projects, judged one by one; unchanged text is skipped. */
    async harvestClaude(namespace = 'default'): Promise<{ checked: number; proposed: number }> {
        if (this.harvesting) return { checked: 0, proposed: 0 }
        this.harvesting = true
        try {
            const settings = await this.getSettings()
            if (settings.mode === 'off') return { checked: 0, proposed: 0 }
            const files = listClaudeMemoryFiles(this.options.paths().dataDir).filter((f) => f.project && settings.projects.includes(f.project))
            let proposed = 0
            for (const file of files) {
                if (this.store.memories.hasEventHash(namespace, textHash(normalize(file.text)))) continue
                await this.propose({
                    namespace,
                    text: file.text,
                    said: file.kind === 'feedback' || file.kind === 'user',
                    source: 'claude_auto',
                    sourceLabel: `Claude 自带记忆 · ${basename(file.path)}`,
                    sessionId: null,
                    project: file.project,
                    sourceRef: file.path
                })
                proposed += 1
            }
            return { checked: files.length, proposed }
        } finally {
            this.harvesting = false
        }
    }

    /** Bullets of the hand-written global MEMORY.md, as things the user said. */
    async importMemoryMd(namespace = 'default'): Promise<{ found: number; proposed: number }> {
        const bullets = listMemoryMdBullets(this.options.paths().dataDir)
        let proposed = 0
        for (const bullet of bullets) {
            const result = await this.propose({ namespace, text: bullet.text, said: true, source: 'import', sourceLabel: 'MEMORY.md', sessionId: null, project: null })
            if (result.action !== 'duplicate') proposed += 1
        }
        return { found: bullets.length, proposed }
    }

    private log(event: Parameters<Store['memories']['addEvent']>[0]): void {
        this.store.memories.addEvent(event)
        this.options.onChange(event.namespace)
    }
}
