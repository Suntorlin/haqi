import { createHash } from 'node:crypto'
import { basename } from 'node:path'

import { readSettings, writeSettings, type Settings } from '../config/settings'
import type { Store, StoredMemory, StoredMemoryEvent, StoredMemoryLink } from '../store'
import { cosine, embedTexts, EmbedError } from './embed'
import { listClaudeMemoryFiles, listMemoryMdBullets, projectNameFor } from './harvest'
import { ChatError } from './chat'
import { askJev, JevError, resolveJevApiKey, yesProbability } from './jev'
import { extractRules, ExtractError, gate, GATE, userText } from './extract'
import { buildQuestions, decide, parseVerdict, REVIEW, sameQuestions, THRESHOLDS, TRIAL, type JevVerdict, type MemoryLevel, type Origin } from './judge'
import { rewriteMerged } from './rewrite'
import { mostSimilar, similarity } from './similarity'

export type MemoryMode = 'off' | 'record'
export type MemorySource = 'propose' | 'claude_auto' | 'import' | 'user_message'

export type MemoryCaptureSettings = { mode: MemoryMode; projects: string[] }

export type ProposeInput = {
    namespace: string
    text: string
    /** What the caller claims; only the source decides whether the user said it (see originOf). */
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

export type ReadMessagesResult = { read: number; passed: number; proposed: number; costUsd: number }

export type MemoryNotice = { title: string; body: string; url: string }

export type SearchHit = { memory: StoredMemory; score: number }

/** A memory that may be the same as another: closeness by meaning, and Jev's yes (null when Jev was not asked). */
export type RelatedHit = SearchHit & { same: number | null }

/** Kept on a merge event: the kept memory as it was, the archived ones, and the links the merge added. */
export type MergeDetail = {
    keep: Pick<StoredMemory, 'id' | 'text' | 'level' | 'scope' | 'status' | 'reason' | 'support' | 'said'>
    drops: Array<Pick<StoredMemory, 'id' | 'text' | 'status' | 'reason'>>
    links: Array<[string, string]>
}

export type MergePreview = {
    keepId: string
    text: string
    /** False when the text could not be written again and is the kept memory's own. */
    rewritten: boolean
    level: MemoryLevel
    scope: string
    status: StoredMemory['status']
    support: number
    costUsd: number
}

/** How far a memory on trial is: mentions inside the window, and when it last came up. */
export type TrialState = { recent: number; lastAt: number }

const DEFAULT_PROJECTS = ['haqi']
const MAX_TEXT = 400
const LEVEL_LABEL: Record<MemoryLevel, string> = { fact: '事实', experience: '经验', principle: '原则' }
const DAY_MS = 24 * 3600 * 1000
/** Cosine floors: a neighbour worth showing Jev when capturing, one worth asking about when cleaning up, a related one, a search hit. */
const VECTOR_FLOOR = { similar: 0.45, duplicate: 0.55, related: 0.5, search: 0.3 } as const
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
    return `先观察：${TRIAL.windowDays} 天内被提到 ${TRIAL.promote} 次就交给你审批，${TRIAL.windowDays} 天没再出现就不记。`
}

/** Only what the user wrote or typed counts as theirs; whatever an agent passes on is the agent's. */
function originOf(source: MemorySource): Origin {
    if (source === 'import') return 'written'
    if (source === 'user_message') return 'said'
    return 'agent'
}

const MESSAGE_PAGE = 200
const GATE_PARALLEL = 6
const QUOTE_CHARS = 160

export class MemoryService {
    private harvesting = false
    private maintaining = false
    private reading = false

    constructor(
        private readonly store: Store,
        private readonly options: {
            /** Resolved lazily: the hub configuration is created after the engine in some tests. */
            paths: () => { dataDir: string; settingsFile: string }
            onChange: (namespace: string) => void
            /** Tells the user that memories wait for approval (a push notification). */
            notify?: (namespace: string, notice: MemoryNotice) => Promise<void>
            fetchFn?: typeof fetch
        }
    ) {}

    async getSettings(): Promise<MemoryCaptureSettings & { jevApiKey: string | null; userCursor: number | null }> {
        const settings: Settings = (await readSettings(this.options.paths().settingsFile)) ?? {}
        const capture = settings.memoryCapture ?? {}
        return {
            mode: capture.mode === 'off' ? 'off' : 'record',
            projects: capture.projects ?? DEFAULT_PROJECTS,
            jevApiKey: capture.jevApiKey ?? null,
            userCursor: capture.userCursor ?? null
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

        const origin = originOf(input.source)
        const said = origin !== 'agent'
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
                    state: { candidate: text, said_by_user: said, project: input.project ?? 'none' },
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
            // Nothing judged: what the user wrote or said waits for them, an agent's note is watched.
            const status = said ? 'pending' : 'candidate'
            const memory = this.store.memories.insert({
                namespace: input.namespace, text, level: said ? 'principle' : 'experience', scope: said ? '' : input.project ?? '',
                status, reason: `Jev 没判断：${jevProblem}`, source: input.source, sourceLabel: input.sourceLabel, sessionId: input.sessionId,
                said, support: 1, jev: null, overridden: null, replaces: null
            })
            this.saveVector(input.namespace, memory, vector)
            this.log({ ...base, memoryId: memory.id, action: status, text, reason: memory.reason, jev: null, costUsd: 0, latencyMs: 0 })
            return status === 'pending'
                ? { action: 'pending', memoryId: memory.id, message: `已放进“等你确认”：Jev 没判断（${jevProblem}）。` }
                : { action: 'candidate', memoryId: memory.id, message: `Jev 没判断（${jevProblem}）。${trialMessage()}` }
        }

        const jev: StoredJev = { ...verdict, project: input.project, ...jevMeta }
        const matched = verdict.match.id ? pool.find((m) => m.id === verdict.match.id) ?? null : null
        const decision = decide({ verdict, origin, matchedLevel: matched?.level ?? null })

        if (decision.kind === 'reject') {
            this.log({ ...base, memoryId: null, action: 'rejected', text: '（含密钥，原文没有保存）', reason: decision.reason, jev, ...jevMeta })
            return { action: 'rejected', memoryId: null, message: '没记：Jev 认为内容里有密钥。' }
        }
        if (decision.kind === 'skip') {
            this.log({ ...base, memoryId: null, action: 'skipped', text, reason: decision.reason, jev, ...jevMeta })
            return { action: 'skipped', memoryId: null, message: `没记：${decision.reason}。` }
        }
        if (decision.kind === 'reinforce' && matched) {
            // The user saying what an agent noted is the evidence it was waiting for: it goes up for approval.
            const lifted = said && matched.status === 'candidate'
            this.store.memories.update(matched.id, input.namespace, {
                support: matched.support + 1,
                ...(said ? { said: true } : {}),
                ...(lifted ? { status: 'pending', reason: '你说过（之前 agent 也记过）' } : {})
            })
            this.log({ ...base, memoryId: matched.id, action: 'reinforced', text, reason: null, jev, ...jevMeta })
            const promoted = !lifted && matched.status === 'candidate' && this.promoteIfDue(input.namespace, matched.id)
            if (promoted || lifted) this.options.onChange(input.namespace)
            const tail = lifted ? '，你说过，交给你审批' : promoted ? '，被提到够多次，交给你审批' : ''
            return { action: 'reinforced', memoryId: matched.id, message: `和已有的一条是同一件事，已加强（被提到 ${matched.support + 1} 次${tail}）。` }
        }
        if (decision.kind !== 'add') return { action: 'skipped', memoryId: null, message: '没记。' }

        const scope = decision.scope === 'project' && input.project ? input.project : ''
        const memory = this.store.memories.insert({
            namespace: input.namespace, text, level: decision.level, scope, status: decision.status, reason: decision.reason,
            source: input.source, sourceLabel: input.sourceLabel, sessionId: input.sessionId, said, support: 1,
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
        if (decision.status === 'pending') return { action: 'pending', memoryId: memory.id, message: `已放进“等你审批”（${where}）：${decision.reason}。` }
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

    /** Approves every memory waiting for approval, or the given ones. */
    confirmAll(namespace: string, ids?: string[]): number {
        const wanted = ids ? new Set(ids) : null
        let confirmed = 0
        for (const memory of this.store.memories.list(namespace)) {
            if (memory.status !== 'pending' || (wanted && !wanted.has(memory.id))) continue
            if (this.confirm(namespace, memory.id)) confirmed += 1
        }
        return confirmed
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
        merges: ReturnType<MemoryService['undoableMerges']>
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
            merges: this.undoableMerges(namespace),
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
                    // The file's type is the agent's own label, not evidence that the user said it.
                    said: false,
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

    /**
     * The user's own messages since the last read (the past TRIAL.windowDays days the first time): local rules drop what
     * the user did not write, Jev keeps messages that state a lasting rule, and the rules found go in with the user's words.
     */
    async readUserMessages(namespace = 'default'): Promise<ReadMessagesResult> {
        const result: ReadMessagesResult = { read: 0, passed: 0, proposed: 0, costUsd: 0 }
        if (this.reading) return result
        this.reading = true
        try {
            const settings = await this.getSettings()
            const apiKey = resolveJevApiKey(settings.jevApiKey)
            if (settings.mode === 'off' || !apiKey) return result
            let cursor = settings.userCursor ?? Date.now() - TRIAL.windowDays * DAY_MS
            for (;;) {
                const turns = this.store.memories.userTurns(namespace, cursor, MESSAGE_PAGE)
                if (turns.length === 0) break
                const items = turns.map((turn) => {
                    const text = messageText(turn.content)
                    const path = (parseJson(turn.sessionMetadata) as { path?: unknown } | null)?.path
                    const project = typeof path === 'string' ? projectNameFor(path) : null
                    const usable = text !== null && (!project || settings.projects.includes(project))
                    return { turn, text, project, usable }
                })
                const gated: Array<{ yes: number } | null> = new Array(items.length).fill(null)
                let failed = -1
                for (let i = 0; i < items.length && failed < 0; i += GATE_PARALLEL) {
                    await Promise.all(items.slice(i, i + GATE_PARALLEL).map(async (item, offset) => {
                        if (!item.usable) return
                        try {
                            const answer = await gate({ apiKey, message: item.text!, before: item.turn.before, fetchFn: this.options.fetchFn })
                            gated[i + offset] = { yes: answer.yes }
                            result.costUsd += answer.costUsd
                        } catch (error) {
                            if (!(error instanceof JevError)) throw error
                            failed = failed < 0 ? i + offset : Math.min(failed, i + offset)
                        }
                    }))
                }
                const done = failed < 0 ? items : items.slice(0, failed)
                for (const [index, item] of done.entries()) {
                    if (!item.usable) continue
                    result.read += 1
                    if ((gated[index]?.yes ?? 0) < GATE) continue
                    result.passed += 1
                    let rules: Awaited<ReturnType<typeof extractRules>>['rules'] = []
                    try {
                        const extracted = await extractRules({ apiKey, message: item.text!, before: item.turn.before, fetchFn: this.options.fetchFn })
                        rules = extracted.rules
                        result.costUsd += extracted.costUsd
                    } catch (error) {
                        if (!(error instanceof ExtractError)) throw error
                        console.warn(`[MemoryService] Extract failed: ${error.message}`)
                        failed = index
                        break
                    }
                    for (const rule of rules) {
                        const quote = rule.quote.length > QUOTE_CHARS ? `${rule.quote.slice(0, QUOTE_CHARS)}…` : rule.quote
                        await this.propose({
                            namespace, text: rule.text, said: true, source: 'user_message', sourceLabel: `你说：「${quote}」`,
                            sessionId: item.turn.sessionId, project: item.project, sourceRef: item.turn.messageId
                        })
                        result.proposed += 1
                    }
                }
                const last = failed < 0 ? turns[turns.length - 1] : failed > 0 ? turns[failed - 1] : null
                if (last) {
                    cursor = last.createdAt
                    await this.saveCapture({ userCursor: cursor })
                }
                if (failed >= 0 || turns.length < MESSAGE_PAGE) break
            }
            if (result.read > 0) {
                this.store.memories.addEvent({
                    namespace, memoryId: null, action: 'scanned', text: `读了你的 ${result.read} 条消息，${result.passed} 条讲了长期规则，提取 ${result.proposed} 条`,
                    reason: null, source: 'user_message', sourceLabel: '你的消息', sourceRef: null, hash: null, sessionId: null, jev: null,
                    costUsd: result.costUsd, latencyMs: 0
                })
            }
            return result
        } finally {
            this.reading = false
        }
    }

    /** Bullets of the hand-written global MEMORY.md, as things the user wrote. */
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
     * duplicates Jev is sure about are merged and written again; trials are promoted or let go; busy experiences are offered as principles.
     */
    async maintain(namespace = 'default'): Promise<MaintainResult> {
        const result: MaintainResult = { moved: 0, embedded: 0, merged: 0, promoted: 0, expired: 0, offered: 0, costUsd: 0 }
        if (this.maintaining) return result
        this.maintaining = true
        try {
            const approved = this.store.memories.approved(namespace)
            const backed = this.store.memories.backedByUser(namespace)
            for (const memory of this.store.memories.list(namespace)) {
                const next = this.underRule(memory, approved, backed)
                if (!next) continue
                this.store.memories.update(memory.id, namespace, next)
                result.moved += 1
            }

            const apiKey = resolveJevApiKey((await this.getSettings()).jevApiKey)
            if (apiKey) {
                await this.embedMissing(namespace, apiKey, result)
                await this.sweepDuplicates(namespace, apiKey, result)
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
            await this.notifyIfDue(namespace)
            return result
        } finally {
            this.maintaining = false
        }
    }

    /**
     * The current rule applied to what is already stored: an agent's label is not the user's word (only a message of
     * theirs backing it is), and nothing becomes active without the user except what they wrote.
     */
    private underRule(memory: StoredMemory, approved: Set<string>, backed: Set<string>): { status?: StoredMemory['status']; reason?: string | null; said?: boolean } | null {
        const origin = originOf(memory.source as MemorySource)
        const said = origin === 'agent' ? backed.has(memory.id) : memory.said
        const patch: { status?: StoredMemory['status']; reason?: string | null; said?: boolean } = {}
        if (said !== memory.said) patch.said = said
        const byUser = approved.has(memory.id) || origin === 'written' || memory.source === 'user_edit'
        if (memory.status === 'active' && !byUser) {
            Object.assign(patch, said ? { status: 'pending', reason: '你说过' } : { status: 'candidate', reason: 'agent 记的，等它再被提到' })
        } else if (memory.status === 'pending' && !said && !memory.replaces) {
            Object.assign(patch, { status: 'candidate', reason: 'agent 记的，等它再被提到' })
        }
        return Object.keys(patch).length > 0 ? patch : null
    }

    /** One notice when REVIEW.batch memories wait for approval; again only when another batch piles up, or a day later with more. */
    private async notifyIfDue(namespace: string): Promise<void> {
        const settings: Settings = (await readSettings(this.options.paths().settingsFile)) ?? {}
        const capture = settings.memoryCapture ?? {}
        const waiting = this.store.memories.list(namespace).filter((m) => m.status === 'pending').length
        const told = capture.reviewNotifiedCount ?? 0
        if (waiting < REVIEW.batch) {
            if (told > 0) await this.saveCapture({ reviewNotifiedCount: 0 })
            return
        }
        const quiet = Date.now() - (capture.reviewNotifiedAt ?? 0) < REVIEW.quietHours * 3600 * 1000
        if (told > 0 && waiting < told + REVIEW.batch && (quiet || waiting <= told)) return
        await this.saveCapture({ reviewNotifiedAt: Date.now(), reviewNotifiedCount: waiting })
        if (!this.options.notify) return
        try {
            await this.options.notify(namespace, { title: '记忆等你审批', body: `攒了 ${waiting} 条记忆，点开一次看完。`, url: '/memory' })
        } catch (error) {
            console.warn(`[MemoryService] Review notice failed: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    private async saveCapture(patch: Partial<NonNullable<Settings['memoryCapture']>>): Promise<void> {
        const settings: Settings = (await readSettings(this.options.paths().settingsFile)) ?? {}
        settings.memoryCapture = { ...(settings.memoryCapture ?? {}), ...patch }
        await writeSettings(this.options.paths().settingsFile, settings)
    }

    /** A watched memory goes up for approval once it came up often enough inside the window. */
    private promoteIfDue(namespace: string, id: string, state?: TrialState): boolean {
        const current = state ?? this.store.memories.mentions(namespace, Date.now() - TRIAL.windowDays * DAY_MS).get(id)
        if (!current || current.recent < TRIAL.promote) return false
        const reason = `${TRIAL.windowDays} 天内被提到 ${current.recent} 次，等你审批`
        const memory = this.store.memories.update(id, namespace, { status: 'pending', reason })
        if (memory) this.quietLog(namespace, id, 'promoted', memory.text, reason)
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

    /** Vectors for memories without one, or whose text changed since. */
    private async embedMissing(namespace: string, apiKey: string, result: MaintainResult): Promise<void> {
        const stored = new Map(this.store.memories.vectors(namespace).map((v) => [v.memoryId, v.textHash]))
        const todo = this.store.memories.list(namespace).filter((m) => stored.get(m.id) !== textHash(m.text))
        for (let i = 0; i < todo.length; i += 64) {
            const batch = todo.slice(i, i + 64)
            try {
                const embedded = await embedTexts({ apiKey, texts: batch.map((m) => m.text), fetchFn: this.options.fetchFn })
                batch.forEach((memory, index) => this.saveVector(namespace, memory, embedded.vectors[index] ?? null))
                result.costUsd += embedded.costUsd
                result.embedded += batch.length
            } catch (error) {
                if (!(error instanceof EmbedError)) throw error
                console.warn(`[MemoryService] Embedding failed: ${error.message}`)
                break
            }
        }
    }

    /**
     * Every memory against its close neighbours, at any level and scope (the same rule is often noted once as a fact
     * and once as a principle, or in two projects): Jev answers "the same memory?" for each neighbour, and the sure
     * ones are merged into one, written again. A neighbourhood Jev has already seen unchanged is not asked again.
     */
    private async sweepDuplicates(namespace: string, apiKey: string, result: MaintainResult): Promise<void> {
        const vectors = new Map(this.store.memories.vectors(namespace).map((v) => [v.memoryId, v]))
        const all = this.store.memories.list(namespace)
        const gone = new Set<string>()
        const todo = all.flatMap((memory) => {
            const own = vectors.get(memory.id)
            if (!own || own.textHash !== textHash(memory.text)) return []
            const close = all
                .filter((other) => mayMerge(memory, other) && vectors.has(other.id))
                .map((other) => ({ other, score: cosine(own.vector, vectors.get(other.id)!.vector) }))
                .filter((entry) => entry.score >= VECTOR_FLOOR.duplicate)
                .sort((a, b) => b.score - a.score)
                .slice(0, 6)
                .map((entry) => entry.other)
            if (close.length === 0) return []
            const seen = textHash([memory, ...close].map((m) => `${m.id}:${textHash(m.text)}`).join('|'))
            return own.checked === seen ? [] : [{ memory, close, seen }]
        })
        for (let i = 0; i < todo.length; i += GATE_PARALLEL) {
            const batch = todo.slice(i, i + GATE_PARALLEL)
            const answers = await Promise.all(batch.map(async (item) => {
                try {
                    return await this.sameAs(apiKey, item.memory, item.close)
                } catch (error) {
                    if (!(error instanceof JevError)) throw error
                    console.warn(`[MemoryService] Duplicate check failed: ${error.message}`)
                    return null
                }
            }))
            for (const [index, item] of batch.entries()) {
                const answer = answers[index]
                if (!answer) continue
                result.costUsd += answer.costUsd
                this.store.memories.setChecked(namespace, item.memory.id, item.seen)
                if (gone.has(item.memory.id)) continue
                const twins = answer.same.filter((s) => s.yes >= THRESHOLDS.match && !gone.has(s.memory.id))
                if (twins.length === 0) continue
                const group = [this.store.memories.get(item.memory.id, namespace)!, ...twins.map((s) => this.store.memories.get(s.memory.id, namespace)!)]
                const sure = Math.min(...twins.map((s) => s.yes))
                const merged = await this.combine(namespace, group, { apiKey, by: 'jev', reason: `Jev 认为 ${group.length} 条说的是同一件事（把握 ${sure.toFixed(2)}）` })
                result.costUsd += merged.costUsd
                for (const memory of group) if (memory.id !== merged.memory.id) gone.add(memory.id)
                result.merged += group.length - 1
            }
        }
    }

    /** Jev's yes for "the same memory as `memory`?", one per entry. */
    private async sameAs(apiKey: string, memory: StoredMemory, entries: StoredMemory[]): Promise<{ same: Array<{ memory: StoredMemory; yes: number }>; costUsd: number }> {
        const answer = await askJev({ apiKey, state: { candidate: memory.text }, questions: sameQuestions(entries), fetchFn: this.options.fetchFn })
        return { same: entries.map((entry, index) => ({ memory: entry, yes: yesProbability(answer.answers[`same${index}`]) })), costUsd: answer.costUsd }
    }

    /**
     * Several memories become one: the strongest stays (its status and level), the others are archived into it.
     * Mentions add up, links move over, the scope is kept only when all share it, and the text is written again from all
     * of them. Jev's merges keep the stronger text when a weaker memory would add words the user has not approved.
     * What changed is kept on the event, so the merge can be undone.
     */
    private async combine(
        namespace: string,
        group: StoredMemory[],
        options: { apiKey: string | null; by: 'user' | 'jev'; reason: string; text?: string }
    ): Promise<{ memory: StoredMemory; eventId: string; costUsd: number }> {
        const keep = group.reduce((a, b) => this.stronger(a, b)[0])
        const drops = group.filter((m) => m.id !== keep.id)
        let costUsd = 0
        let text = options.text ? normalize(options.text) : keep.text
        const mayRewrite = options.by === 'user' || drops.every((m) => STATUS_RANK[m.status] >= STATUS_RANK[keep.status])
        if (!options.text && mayRewrite && options.apiKey) {
            const rewritten = await this.rewrite(options.apiKey, group)
            costUsd += rewritten.costUsd
            text = rewritten.text ?? keep.text
        }

        const ids = new Set(group.map((m) => m.id))
        const existing = new Set(this.store.memories.links(namespace).map((l) => `${l.fromId}>${l.toId}`))
        const added: Array<[string, string]> = []
        for (const link of this.store.memories.links(namespace)) {
            const from = ids.has(link.fromId) ? keep.id : link.fromId
            const to = ids.has(link.toId) ? keep.id : link.toId
            if (from === to || existing.has(`${from}>${to}`)) continue
            this.store.memories.link(namespace, from, to)
            existing.add(`${from}>${to}`)
            added.push([from, to])
        }
        const detail: MergeDetail = {
            keep: { id: keep.id, text: keep.text, level: keep.level, scope: keep.scope, status: keep.status, reason: keep.reason, support: keep.support, said: keep.said },
            drops: drops.map((m) => ({ id: m.id, text: m.text, status: m.status, reason: m.reason })),
            links: added
        }
        for (const drop of drops) this.store.memories.update(drop.id, namespace, { status: 'archived', reason: '和另一条是同一件事，已合并' })
        this.store.memories.update(keep.id, namespace, {
            text,
            support: group.reduce((sum, m) => sum + m.support, 0),
            said: group.some((m) => m.said),
            scope: mergedScope(group, keep),
            bumpVersion: text !== keep.text
        })
        const event = this.store.memories.addEvent({
            namespace, memoryId: keep.id, action: 'merged', text, reason: options.reason,
            source: options.by === 'user' ? 'user_edit' : 'system', sourceLabel: options.by === 'user' ? '你' : '整理',
            sourceRef: null, hash: null, sessionId: null, jev: null, costUsd, latencyMs: 0, detail
        })
        return { memory: this.store.memories.get(keep.id, namespace)!, eventId: event.id, costUsd }
    }

    private async rewrite(apiKey: string, group: StoredMemory[]): Promise<{ text: string | null; costUsd: number }> {
        try {
            const oldestFirst = [...group].sort((a, b) => a.createdAt - b.createdAt)
            const result = await rewriteMerged({ apiKey, texts: oldestFirst.map((m) => m.text), fetchFn: this.options.fetchFn })
            return { text: result.text ? normalize(result.text) : null, costUsd: result.costUsd }
        } catch (error) {
            if (!(error instanceof ChatError)) throw error
            console.warn(`[MemoryService] Rewrite failed: ${error.message}`)
            return { text: null, costUsd: 0 }
        }
    }

    /** Memories the user picked, in the given order, or null when fewer than two are usable. */
    private picked(namespace: string, ids: string[]): StoredMemory[] | null {
        const group = Array.from(new Set(ids)).map((id) => this.store.memories.get(id, namespace)).filter((m): m is StoredMemory => Boolean(m) && m!.status !== 'archived')
        return group.length >= 2 ? group : null
    }

    /** What merging these would give, without changing anything: which one stays and the text written again. */
    async previewMerge(namespace: string, ids: string[]): Promise<MergePreview | null> {
        const group = this.picked(namespace, ids)
        if (!group) return null
        const keep = group.reduce((a, b) => this.stronger(a, b)[0])
        const apiKey = resolveJevApiKey((await this.getSettings()).jevApiKey)
        const rewritten = apiKey ? await this.rewrite(apiKey, group) : { text: null, costUsd: 0 }
        return {
            keepId: keep.id,
            text: rewritten.text ?? keep.text,
            rewritten: rewritten.text !== null,
            level: keep.level,
            scope: mergedScope(group, keep),
            status: keep.status,
            support: group.reduce((sum, m) => sum + m.support, 0),
            costUsd: rewritten.costUsd
        }
    }

    /** The user merges memories into one; `text` is what they settled on in the preview (written again when left out). */
    async mergeMany(namespace: string, ids: string[], text?: string): Promise<{ memory: StoredMemory; eventId: string } | null> {
        const group = this.picked(namespace, ids)
        if (!group) return null
        const apiKey = resolveJevApiKey((await this.getSettings()).jevApiKey)
        const merged = await this.combine(namespace, group, { apiKey, by: 'user', reason: `你把 ${group.length} 条合成了一条`, text: text?.trim() || undefined })
        this.options.onChange(namespace)
        return { memory: merged.memory, eventId: merged.eventId }
    }

    /** Puts a merge back: the kept memory gets its old text and numbers, the archived ones come back, moved links go. */
    undoMerge(namespace: string, eventId: string): StoredMemory | null {
        const event = this.store.memories.event(eventId, namespace)
        const detail = event?.detail as MergeDetail | null | undefined
        if (!event || event.action !== 'merged' || !detail?.keep) return null
        const { keep } = detail
        const current = this.store.memories.get(keep.id, namespace)
        if (!current) return null
        for (const [from, to] of detail.links) this.store.memories.unlink(namespace, from, to)
        for (const drop of detail.drops) {
            if (this.store.memories.get(drop.id, namespace)?.status === 'archived') this.store.memories.update(drop.id, namespace, { status: drop.status, reason: drop.reason })
        }
        this.store.memories.update(keep.id, namespace, {
            text: keep.text, level: keep.level, scope: keep.scope, status: keep.status, reason: keep.reason, support: keep.support, said: keep.said,
            bumpVersion: current.text !== keep.text
        })
        this.store.memories.setEventAction(eventId, namespace, 'merge_undone')
        this.log({
            namespace, memoryId: keep.id, action: 'unmerged', text: keep.text, reason: `拆回了 ${detail.drops.length} 条`,
            source: 'user_edit', sourceLabel: '你', sourceRef: null, hash: null, sessionId: null, jev: null, costUsd: 0, latencyMs: 0
        })
        return this.store.memories.get(keep.id, namespace)
    }

    /** Archives the given memories in one go; returns how many were archived. */
    archiveMany(namespace: string, ids: string[]): number {
        let archived = 0
        for (const id of new Set(ids)) {
            const current = this.store.memories.get(id, namespace)
            if (!current || current.status === 'archived') continue
            this.store.memories.update(id, namespace, { status: 'archived', reason: '你归档了' })
            this.quietLog(namespace, id, 'archived', current.text, '你归档了')
            archived += 1
        }
        if (archived > 0) this.options.onChange(namespace)
        return archived
    }

    /**
     * Memories that may be the same as `id`, for the user to merge: close ones by meaning, kept only when Jev
     * thinks they may be the same (`same`); without Jev, only the very close ones, unjudged.
     */
    async related(namespace: string, id: string, limit = 6): Promise<RelatedHit[]> {
        const memory = this.store.memories.get(id, namespace)
        const vectors = new Map(this.store.memories.vectors(namespace).map((v) => [v.memoryId, v.vector]))
        const own = vectors.get(id)
        if (!memory || !own) return []
        const close = this.store.memories.list(namespace)
            .filter((m) => mayMerge(memory, m) && vectors.has(m.id))
            .map((m) => ({ memory: m, score: cosine(own, vectors.get(m.id)!) }))
            .filter((hit) => hit.score >= VECTOR_FLOOR.related)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
        if (close.length === 0) return []
        const apiKey = resolveJevApiKey((await this.getSettings()).jevApiKey)
        if (apiKey) {
            try {
                const answer = await this.sameAs(apiKey, memory, close.map((hit) => hit.memory))
                return close
                    .map((hit, index) => ({ ...hit, same: answer.same[index]!.yes }))
                    .filter((hit) => hit.same >= THRESHOLDS.maybe)
                    .sort((a, b) => b.same - a.same)
            } catch (error) {
                if (!(error instanceof JevError)) throw error
            }
        }
        return close.filter((hit) => hit.score >= VECTOR_FLOOR.duplicate).map((hit) => ({ ...hit, same: null }))
    }

    /** Merges that can still be undone, by the memory they went into (the newest one each). */
    undoableMerges(namespace: string): Record<string, { eventId: string; createdAt: number; drops: Array<{ id: string; text: string }> }> {
        const merges: Record<string, { eventId: string; createdAt: number; drops: Array<{ id: string; text: string }> }> = {}
        for (const event of this.store.memories.merges(namespace)) {
            const detail = event.detail as MergeDetail | null
            if (!event.memoryId || !detail?.drops || merges[event.memoryId]) continue
            merges[event.memoryId] = { eventId: event.id, createdAt: event.createdAt, drops: detail.drops.map((d) => ({ id: d.id, text: d.text })) }
        }
        return merges
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

/** Two different memories, neither of them the offer to promote the other (that pair is the same text on purpose). */
function mayMerge(a: StoredMemory, b: StoredMemory): boolean {
    return a.id !== b.id && a.replaces !== b.id && b.replaces !== a.id
}

/** One project when all share it; global when any is global or they come from different projects. */
function mergedScope(group: StoredMemory[], keep: StoredMemory): string {
    return group.every((m) => m.scope === keep.scope) ? keep.scope : ''
}

function parseJson(raw: string | null): unknown {
    if (!raw) return null
    try {
        return JSON.parse(raw)
    } catch {
        return null
    }
}

/** The text of a message the user typed, or null for anything else. */
function messageText(content: string): string | null {
    const message = parseJson(content) as { role?: unknown; content?: { type?: unknown; text?: unknown } } | null
    if (message?.role !== 'user' || message.content?.type !== 'text' || typeof message.content.text !== 'string') return null
    return userText(message.content.text)
}
