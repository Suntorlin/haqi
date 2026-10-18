import { createHash } from 'node:crypto'
import { basename } from 'node:path'

import { readSettings, writeSettings, type Settings } from '../config/settings'
import type { Store, StoredMemory, StoredMemoryEvent, StoredMemoryLink } from '../store'
import { cosine, embedTexts, EmbedError } from './embed'
import { listClaudeMemoryFiles, listMemoryMdBullets, projectNameFor } from './harvest'
import { askJev, JevError, resolveJevApiKey } from './jev'
import { buildQuestions, decide, matchQuestion, parseVerdict, THRESHOLDS, TRIAL, type JevVerdict, type MemoryLevel } from './judge'
import { mostSimilar, similarity } from './similarity'

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
    action: 'added' | 'pending' | 'candidate' | 'reinforced' | 'skipped' | 'rejected' | 'duplicate' | 'off' | 'not-enabled'
    memoryId: string | null
    message: string
}

export type KnownProject = { name: string; path: string | null; sessions: number }

export type StoredJev = JevVerdict & { project: string | null; costUsd: number; latencyMs: number; model: string }

export type MaintainResult = { moved: number; embedded: number; merged: number; promoted: number; expired: number; offered: number; costUsd: number }

export type SearchHit = { memory: StoredMemory; score: number }

/** How far a memory on trial is: mentions inside the window, and when it last came up. */
export type TrialState = { recent: number; lastAt: number }

const DEFAULT_PROJECTS = ['haqi']
const MAX_TEXT = 400
const LEVEL_LABEL: Record<MemoryLevel, string> = { fact: '事实', experience: '经验', principle: '原则' }
const DAY_MS = 24 * 3600 * 1000
/** Cosine floors: a neighbour worth showing Jev when capturing, one worth asking about when cleaning up, a related one, a search hit. */
const VECTOR_FLOOR = { similar: 0.45, duplicate: 0.6, related: 0.5, search: 0.3 } as const
const STATUS_RANK: Record<StoredMemory['status'], number> = { active: 3, pending: 2, candidate: 1, archived: 0 }

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

function trialMessage(): string {
    return `先观察：${TRIAL.windowDays} 天内被提到 ${TRIAL.promote} 次就生效，${TRIAL.windowDays} 天没再出现就不记。`
}

export class MemoryService {
    private harvesting = false
    private maintaining = false

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
        const apiKey = resolveJevApiKey(settings.jevApiKey)
        const vector = apiKey ? await this.embedOne(apiKey, text) : null
        const similar = this.neighbours(input.namespace, text, vector, pool)
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
            const status = input.said ? 'pending' : 'candidate'
            const memory = this.store.memories.insert({
                namespace: input.namespace, text, level: input.said ? 'principle' : 'experience', scope: input.said ? '' : input.project ?? '',
                status, reason: `Jev 没判断：${jevProblem}`, source: input.source, sourceLabel: input.sourceLabel, sessionId: input.sessionId,
                said: input.said, support: 1, jev: null, overridden: null, replaces: null
            })
            this.saveVector(input.namespace, memory, vector)
            this.log({ ...base, memoryId: memory.id, action: status, text, reason: memory.reason, jev: null, costUsd: 0, latencyMs: 0 })
            return status === 'pending'
                ? { action: 'pending', memoryId: memory.id, message: `已放进“等你确认”：Jev 没判断（${jevProblem}）。` }
                : { action: 'candidate', memoryId: memory.id, message: `Jev 没判断（${jevProblem}）。${trialMessage()}` }
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
            const promoted = matched.status === 'candidate' && this.promoteIfDue(input.namespace, matched.id)
            if (promoted) this.options.onChange(input.namespace)
            return { action: 'reinforced', memoryId: matched.id, message: `和已有的一条是同一件事，已加强（被提到 ${matched.support + 1} 次${promoted ? '，观察期满，已生效' : ''}）。` }
        }
        if (decision.kind !== 'add') return { action: 'skipped', memoryId: null, message: '没记。' }

        const scope = decision.scope === 'project' && input.project ? input.project : ''
        const memory = this.store.memories.insert({
            namespace: input.namespace, text, level: decision.level, scope, status: decision.status, reason: decision.reason,
            source: input.source, sourceLabel: input.sourceLabel, sessionId: input.sessionId, said: input.said, support: 1,
            jev, overridden: null, replaces: null
        })
        this.saveVector(input.namespace, memory, vector)
        if (decision.link) {
            const [from, to] = decision.link.direction === 'supports-matched' ? [memory.id, decision.link.matchedId] : [decision.link.matchedId, memory.id]
            this.store.memories.link(input.namespace, from, to)
        }
        const action = decision.status === 'active' ? 'added' : decision.status
        this.log({ ...base, memoryId: memory.id, action, text, reason: decision.reason, jev, ...jevMeta })
        const where = `${LEVEL_LABEL[decision.level]} · ${scope || '全局'}`
        if (decision.status === 'active') return { action: 'added', memoryId: memory.id, message: `已记下：${where}。` }
        if (decision.status === 'pending') return { action: 'pending', memoryId: memory.id, message: `已放进“等你确认”（${where}）：${decision.reason}。` }
        return { action: 'candidate', memoryId: memory.id, message: `已记下（${where}），${decision.reason}。${trialMessage()}` }
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
        trial: Record<string, TrialState>
        stats: { addedToday: number; skippedToday: number; skippedReasons: Record<string, number>; judged: number; corrected: number; costTodayUsd: number }
        settings: MemoryCaptureSettings & { jevReady: boolean; knownProjects: KnownProject[] }
    }> {
        const memories = this.store.memories.list(namespace)
        const mentions = this.store.memories.mentions(namespace, Date.now() - TRIAL.windowDays * DAY_MS)
        const trial: Record<string, TrialState> = {}
        for (const memory of memories) {
            if (memory.status === 'candidate') trial[memory.id] = mentions.get(memory.id) ?? { recent: 0, lastAt: memory.createdAt }
        }
        const today = this.store.memories.eventsSince(namespace, startOfToday())
        const month = this.store.memories.eventsSince(namespace, Date.now() - 30 * 24 * 3600 * 1000)
        const skippedReasons: Record<string, number> = {}
        for (const event of today) {
            if (event.action === 'skipped' || event.action === 'rejected') skippedReasons[event.reason ?? '其他'] = (skippedReasons[event.reason ?? '其他'] ?? 0) + 1
        }
        const settings = await this.getSettings()
        const knownProjects = this.knownProjects(namespace, [...settings.projects, ...memories.map((m) => m.scope).filter(Boolean)])
        return {
            memories,
            links: this.store.memories.links(namespace),
            recent: this.store.memories.events(namespace, 80),
            trial,
            stats: {
                addedToday: today.filter((e) => e.action === 'added' || e.action === 'pending' || e.action === 'candidate').length,
                skippedToday: today.filter((e) => e.action === 'skipped' || e.action === 'rejected').length,
                skippedReasons,
                judged: month.filter((e) => e.jev !== null).length,
                corrected: month.filter((e) => e.action === 'edited' || e.action === 'dismissed').length,
                costTodayUsd: today.reduce((sum, e) => sum + e.costUsd, 0)
            },
            settings: { mode: settings.mode, projects: settings.projects, jevReady: Boolean(resolveJevApiKey(settings.jevApiKey)), knownProjects }
        }
    }

    /** Every project the user has sessions in (busiest first), plus enabled or already-used ones. */
    private knownProjects(namespace: string, extra: string[]): KnownProject[] {
        const stats = new Map<string, { path: string | null; sessions: number }>()
        for (const session of this.store.sessions.getSessionsByNamespace(namespace)) {
            const path = (session.metadata as { path?: unknown } | null)?.path
            if (typeof path !== 'string' || path.startsWith('/tmp/') || path.startsWith('/private/')) continue
            const name = projectNameFor(path)
            if (!name) continue
            const entry = stats.get(name) ?? { path, sessions: 0 }
            entry.sessions += 1
            stats.set(name, entry)
        }
        for (const name of extra) if (!stats.has(name)) stats.set(name, { path: null, sessions: 0 })
        return [...stats].map(([name, s]) => ({ name, ...s })).sort((a, b) => b.sessions - a.sessions || a.name.localeCompare(b.name))
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

    /** Memories close to `query` in meaning (or containing it word for word), best first. */
    async search(namespace: string, query: string, limit = 8): Promise<SearchHit[]> {
        const needle = query.trim()
        if (!needle) return []
        const memories = this.store.memories.list(namespace)
        const apiKey = resolveJevApiKey((await this.getSettings()).jevApiKey)
        const vector = apiKey ? await this.embedOne(apiKey, needle) : null
        const vectors = new Map(this.store.memories.vectors(namespace).map((v) => [v.memoryId, v.vector]))
        const lower = needle.toLowerCase()
        return memories
            .map((memory) => {
                const stored = vectors.get(memory.id)
                const semantic = vector && stored ? cosine(vector, stored) : 0
                const literal = memory.text.toLowerCase().includes(lower) ? 1 : similarity(needle, memory.text)
                return { memory, score: Math.max(semantic, literal) }
            })
            .filter((hit) => hit.score >= VECTOR_FLOOR.search)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
    }

    /**
     * Housekeeping, run after every harvest: only principles wait for the user; every memory gets a vector;
     * duplicates Jev confirms are merged; trials are promoted or let go; busy experiences are offered as principles.
     */
    async maintain(namespace = 'default'): Promise<MaintainResult> {
        const result: MaintainResult = { moved: 0, embedded: 0, merged: 0, promoted: 0, expired: 0, offered: 0, costUsd: 0 }
        if (this.maintaining) return result
        this.maintaining = true
        try {
            for (const memory of this.store.memories.list(namespace)) {
                const next = this.waitingStatus(memory)
                if (!next) continue
                this.store.memories.update(memory.id, namespace, next)
                result.moved += 1
            }

            const apiKey = resolveJevApiKey((await this.getSettings()).jevApiKey)
            if (apiKey) {
                const fresh = await this.embedMissing(namespace, apiKey, result)
                await this.mergeDuplicates(namespace, apiKey, fresh, result)
            }

            const now = Date.now()
            const mentions = this.store.memories.mentions(namespace, now - TRIAL.windowDays * DAY_MS)
            for (const memory of this.store.memories.list(namespace)) {
                if (memory.status === 'candidate') {
                    const state = mentions.get(memory.id) ?? { recent: 0, lastAt: memory.createdAt }
                    if (this.promoteIfDue(namespace, memory.id, state)) result.promoted += 1
                    else if (state.lastAt < now - TRIAL.windowDays * DAY_MS) {
                        this.store.memories.update(memory.id, namespace, { status: 'archived', reason: `${TRIAL.windowDays} 天没再被提到，没转正` })
                        this.quietLog(namespace, memory.id, 'expired', memory.text, `${TRIAL.windowDays} 天没再被提到，被提到 ${memory.support} 次，没转正`)
                        result.expired += 1
                    }
                } else if (memory.status === 'active' && memory.level === 'experience' && memory.support >= TRIAL.principleAt && !this.store.memories.hasReplacement(namespace, memory.id)) {
                    const offer = this.store.memories.insert({
                        namespace, text: memory.text, level: 'principle', scope: memory.scope, status: 'pending',
                        reason: `这条经验被提到 ${memory.support} 次，要不要升为原则？`, source: memory.source, sourceLabel: memory.sourceLabel,
                        sessionId: memory.sessionId, said: memory.said, support: memory.support, jev: memory.jev, overridden: null, replaces: memory.id
                    })
                    this.quietLog(namespace, offer.id, 'pending', offer.text, offer.reason)
                    result.offered += 1
                }
            }
            if (Object.entries(result).some(([key, value]) => key !== 'costUsd' && value > 0)) this.options.onChange(namespace)
            return result
        } finally {
            this.maintaining = false
        }
    }

    /** The current rule applied to a memory still waiting for the user: facts and experiences go on trial; some principles the user said become active. */
    private waitingStatus(memory: StoredMemory): { status: StoredMemory['status']; reason?: null; scope?: string } | null {
        if (memory.status !== 'pending' || memory.replaces) return null
        if (memory.level !== 'principle') return { status: 'candidate' }
        const jev = memory.jev as StoredJev | null
        if (!jev || memory.overridden) return null
        const decision = decide({ verdict: jev, said: memory.said })
        if (decision.kind !== 'add' || decision.status !== 'active') return null
        return { status: 'active', reason: null, scope: decision.scope === 'project' && jev.project ? jev.project : '' }
    }

    /** A memory on trial becomes active once it came up often enough inside the window. */
    private promoteIfDue(namespace: string, id: string, state?: TrialState): boolean {
        const current = state ?? this.store.memories.mentions(namespace, Date.now() - TRIAL.windowDays * DAY_MS).get(id)
        if (!current || current.recent < TRIAL.promote) return false
        const memory = this.store.memories.update(id, namespace, { status: 'active', reason: null })
        if (memory) this.quietLog(namespace, id, 'promoted', memory.text, `${TRIAL.windowDays} 天内被提到 ${current.recent} 次，已生效`)
        return Boolean(memory)
    }

    private async embedOne(apiKey: string, text: string): Promise<number[] | null> {
        try {
            return (await embedTexts({ apiKey, texts: [text], fetchFn: this.options.fetchFn })).vectors[0] ?? null
        } catch (error) {
            if (!(error instanceof EmbedError)) throw error
            return null
        }
    }

    private saveVector(namespace: string, memory: StoredMemory, vector: number[] | null): void {
        if (vector) this.store.memories.setVector(namespace, { memoryId: memory.id, model: 'openai/text-embedding-3-small', textHash: textHash(memory.text), vector })
    }

    /** Closest memories to show Jev as "the same as one of these?": by meaning when vectors exist, by characters otherwise. */
    private neighbours(namespace: string, text: string, vector: number[] | null, pool: StoredMemory[], limit = 8): StoredMemory[] {
        const lexical = mostSimilar(text, pool, limit)
        if (!vector) return lexical
        const vectors = new Map(this.store.memories.vectors(namespace).map((v) => [v.memoryId, v.vector]))
        const semantic = pool
            .map((memory) => ({ memory, score: vectors.has(memory.id) ? cosine(vector, vectors.get(memory.id)!) : 0 }))
            .filter((entry) => entry.score >= VECTOR_FLOOR.similar)
            .sort((a, b) => b.score - a.score)
            .map((entry) => entry.memory)
        const seen = new Set<string>()
        return [...semantic, ...lexical].filter((m) => !seen.has(m.id) && Boolean(seen.add(m.id))).slice(0, limit)
    }

    /** Vectors for memories without one, or whose text changed since; returns the ids that got a new vector. */
    private async embedMissing(namespace: string, apiKey: string, result: MaintainResult): Promise<Set<string>> {
        const stored = new Map(this.store.memories.vectors(namespace).map((v) => [v.memoryId, v.textHash]))
        const todo = this.store.memories.list(namespace).filter((m) => stored.get(m.id) !== textHash(m.text))
        const fresh = new Set<string>()
        for (let i = 0; i < todo.length; i += 64) {
            const batch = todo.slice(i, i + 64)
            try {
                const embedded = await embedTexts({ apiKey, texts: batch.map((m) => m.text), fetchFn: this.options.fetchFn })
                batch.forEach((memory, index) => {
                    this.saveVector(namespace, memory, embedded.vectors[index] ?? null)
                    fresh.add(memory.id)
                })
                result.costUsd += embedded.costUsd
                result.embedded += batch.length
            } catch (error) {
                if (!(error instanceof EmbedError)) throw error
                console.warn(`[MemoryService] Embedding failed: ${error.message}`)
                break
            }
        }
        return fresh
    }

    /**
     * For each memory with a new vector: neighbours at the same level whose scopes overlap and that read close,
     * then Jev picks the one that is the same memory, if any. The weaker of the two is merged into the stronger.
     */
    private async mergeDuplicates(namespace: string, apiKey: string, fresh: Set<string>, result: MaintainResult): Promise<void> {
        const vectors = new Map(this.store.memories.vectors(namespace).map((v) => [v.memoryId, v.vector]))
        const gone = new Set<string>()
        const all = this.store.memories.list(namespace)
        for (const memory of all) {
            if (!fresh.has(memory.id) || gone.has(memory.id)) continue
            const own = vectors.get(memory.id)
            if (!own) continue
            const close = all
                .filter((other) => other.id !== memory.id && !gone.has(other.id) && other.level === memory.level
                    && (other.scope === memory.scope || other.scope === '' || memory.scope === '') && vectors.has(other.id))
                .map((other) => ({ other, score: cosine(own, vectors.get(other.id)!) }))
                .filter((entry) => entry.score >= VECTOR_FLOOR.duplicate)
                .sort((a, b) => b.score - a.score)
                .slice(0, 6)
                .map((entry) => entry.other)
            if (close.length === 0) continue
            let found: { choice: string; confidence: number } | null = null
            try {
                const answer = await askJev({
                    apiKey,
                    state: { candidate: memory.text },
                    questions: { match: matchQuestion(close.map((m) => ({ id: m.id, text: m.text }))) },
                    fetchFn: this.options.fetchFn
                })
                result.costUsd += answer.costUsd
                const raw = answer.answers.match
                found = raw && raw.type === 'choice' ? { choice: raw.choice, confidence: raw.confidence } : null
            } catch (error) {
                if (!(error instanceof JevError)) throw error
                console.warn(`[MemoryService] Duplicate check failed: ${error.message}`)
                return
            }
            const match = found
            const twin = match && match.confidence >= THRESHOLDS.match ? close.find((m) => m.id === match.choice) : undefined
            if (!match || !twin) continue
            const [keep, drop] = this.stronger(memory, twin)
            this.absorb(namespace, keep, drop, `并入了一条说同一件事的记忆（Jev ${match.confidence.toFixed(2)}）`)
            gone.add(drop.id)
            result.merged += 1
        }
    }

    /** `drop` is archived into `keep`: mentions add up, its links move over, and a global one keeps the pair global. */
    private absorb(namespace: string, keep: StoredMemory, drop: StoredMemory, reason: string): void {
        this.store.memories.update(keep.id, namespace, { support: keep.support + drop.support, scope: keep.scope && drop.scope ? keep.scope : '' })
        this.store.memories.update(drop.id, namespace, { status: 'archived', reason: '和另一条是同一件事，已并入' })
        for (const link of this.store.memories.links(namespace)) {
            if (link.fromId === drop.id && link.toId !== keep.id) this.store.memories.link(namespace, keep.id, link.toId)
            if (link.toId === drop.id && link.fromId !== keep.id) this.store.memories.link(namespace, link.fromId, keep.id)
        }
        this.quietLog(namespace, keep.id, 'merged', drop.text, reason)
    }

    /** The user merges one memory into another from the edit sheet. */
    merge(namespace: string, dropId: string, keepId: string): StoredMemory | null {
        const drop = this.store.memories.get(dropId, namespace)
        const keep = this.store.memories.get(keepId, namespace)
        if (!drop || !keep || drop.id === keep.id || drop.status === 'archived' || keep.status === 'archived') return null
        this.absorb(namespace, keep, drop, '你把一条说同一件事的记忆并了进来')
        this.options.onChange(namespace)
        return this.store.memories.get(keepId, namespace)
    }

    /** Memories that read close to `id`, for merging by hand. */
    related(namespace: string, id: string, limit = 5): SearchHit[] {
        const vectors = new Map(this.store.memories.vectors(namespace).map((v) => [v.memoryId, v.vector]))
        const own = vectors.get(id)
        if (!own) return []
        return this.store.memories.list(namespace)
            .filter((m) => m.id !== id && vectors.has(m.id))
            .map((memory) => ({ memory, score: cosine(own, vectors.get(memory.id)!) }))
            .filter((hit) => hit.score >= VECTOR_FLOOR.related)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
    }

    /** Which of two duplicates stays: the more settled status, then what the user said, then more mentions, then the older. */
    private stronger(a: StoredMemory, b: StoredMemory): [StoredMemory, StoredMemory] {
        const key = (m: StoredMemory) => [STATUS_RANK[m.status], m.said ? 1 : 0, m.support, -m.createdAt]
        const [ka, kb] = [key(a), key(b)]
        for (let i = 0; i < ka.length; i++) {
            if (ka[i] !== kb[i]) return ka[i]! > kb[i]! ? [a, b] : [b, a]
        }
        return [a, b]
    }

    private quietLog(namespace: string, memoryId: string, action: string, text: string, reason: string | null): void {
        this.store.memories.addEvent({ namespace, memoryId, action, text, reason, source: 'system', sourceLabel: '整理', sourceRef: null, hash: null, sessionId: null, jev: null, costUsd: 0, latencyMs: 0 })
    }

    private log(event: Parameters<Store['memories']['addEvent']>[0]): void {
        this.store.memories.addEvent(event)
        this.options.onChange(event.namespace)
    }
}
