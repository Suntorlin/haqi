import { askJev, JevError, yesProbability } from '../memory/jev'
import { projectNameFor } from '../memory/harvest'
import type { Store, StoredMemory, StoredSessionGuard } from '../store'
import { classifyMessage, type ClassifierAsk } from '../tasks/plugins/classifier/classifier'
import { agentAnswer, GUARD, nextGuard, ruleQuestions, type GuardRule, type GuardState, type GuardViolation } from './guard'

/** A thinking flap right at the turn's end settles before the check reads the turn. */
const DEBOUNCE_MS = 2_000

/**
 * Runs the compliance check after each turn: when a session stops thinking, the latest turn's reply is held
 * against the user's active principles (Jev answers one yes/no per rule), the turn's user message is
 * classified as a correction or not, and the session's light is moved and broadcast.
 */
export class GuardService {
    private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly running = new Set<string>()
    private stopped = false

    constructor(
        private readonly store: Store,
        private readonly options: {
            jevKey: () => Promise<string | null>
            /** The session's light changed: refresh and broadcast it. */
            onChange: (sessionId: string) => void
            fetchFn?: typeof fetch
        }
    ) {}

    /** The session stopped thinking; check its newest turn shortly. */
    noteTurnEnd(sessionId: string): void {
        if (this.stopped) return
        const existing = this.pending.get(sessionId)
        if (existing) clearTimeout(existing)
        this.pending.set(sessionId, setTimeout(() => {
            this.pending.delete(sessionId)
            void this.check(sessionId).catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(`[Guard] Check failed for ${sessionId}: ${message}`)
            })
        }, DEBOUNCE_MS))
    }

    stop(): void {
        this.stopped = true
        for (const timer of this.pending.values()) clearTimeout(timer)
        this.pending.clear()
    }

    /** One check of the session's newest turn; a turn already covered is not checked again. */
    async check(sessionId: string): Promise<void> {
        if (this.running.has(sessionId)) {
            this.noteTurnEnd(sessionId)
            return
        }
        this.running.add(sessionId)
        try {
            await this.checkNewestTurn(sessionId)
        } finally {
            this.running.delete(sessionId)
        }
    }

    private async checkNewestTurn(sessionId: string): Promise<void> {
        const session = this.store.sessions.getSession(sessionId)
        if (!session) return
        const turns = this.store.turns.getTurns(sessionId, 2)
        const turn = turns.at(-1)
        if (!turn || turn.agentEndSeq === null || !turn.assistantPreview) return
        const prev = this.store.guards.get(sessionId)
        if (prev && turn.agentEndSeq <= prev.checkedEndSeq) return
        const answer = agentAnswer(turn.assistantPreview)
        if (!answer) {
            // Nothing the agent said to judge (an aborted turn, a usage-limit notice); mark it seen, keep the light.
            if (prev) this.store.guards.upsert({ ...prev, checkedEndSeq: turn.agentEndSeq, updatedAt: Date.now() })
            return
        }
        const apiKey = await this.options.jevKey()
        if (!apiKey) return

        const path = (session.metadata as { path?: unknown } | null)?.path
        const project = typeof path === 'string' ? projectNameFor(path) : null
        const rules = selectRules(this.store.memories.list(session.namespace), project)

        const before = turns.length > 1 ? turns[0]!.assistantPreview : null
        let costUsd = 0
        const [violations, corrected] = await Promise.all([
            this.findViolations(apiKey, rules, turn.userPreview, answer, project).then((result) => {
                costUsd += result.costUsd
                return result.violations
            }),
            this.wasCorrection(apiKey, session.namespace, sessionId, turn.userMessageId, turn.userPreview, before, turn.createdAt).then((result) => {
                costUsd += result.costUsd
                return result.corrected
            })
        ])

        const prevState: GuardState | null = prev
            ? { status: prev.status, reason: prev.reason, memoryId: prev.memoryId, strikes: prev.strikes, cleanStreak: prev.cleanStreak }
            : null
        const checkedTurns = (prev?.checkedTurns ?? 0) + 1
        const ruleTexts = Object.fromEntries(rules.map((rule) => [rule.id, rule.text]))
        const next = nextGuard(prevState, { violations, corrected, ruleTexts }, checkedTurns)
        const guard: StoredSessionGuard = {
            sessionId,
            namespace: session.namespace,
            ...next,
            checkedEndSeq: turn.agentEndSeq,
            checkedTurns,
            costUsd: (prev?.costUsd ?? 0) + costUsd,
            updatedAt: Date.now()
        }
        this.store.guards.upsert(guard)
        if (prev?.status !== guard.status || prev?.reason !== guard.reason) {
            this.options.onChange(sessionId)
        }
    }

    private async findViolations(
        apiKey: string,
        rules: GuardRule[],
        userPreview: string | null,
        assistantPreview: string,
        project: string | null
    ): Promise<{ violations: GuardViolation[]; costUsd: number }> {
        if (rules.length === 0) return { violations: [], costUsd: 0 }
        try {
            const result = await askJev({
                apiKey,
                state: {
                    user_message: (userPreview ?? '').slice(0, GUARD.messageChars) || 'none',
                    agent_reply: assistantPreview.slice(-GUARD.replyChars),
                    project: project ?? 'none'
                },
                questions: ruleQuestions(rules),
                fetchFn: this.options.fetchFn
            })
            const violations = rules
                .map((rule, index) => ({
                    memoryId: rule.id,
                    text: rule.text,
                    yes: yesProbability(result.answers[`rule${index}`]),
                    applies: yesProbability(result.answers[`applies${index}`])
                }))
                .filter((entry) => entry.yes >= GUARD.violate && entry.applies >= GUARD.applies)
                .map(({ applies: _applies, ...violation }) => violation)
            return { violations, costUsd: result.costUsd }
        } catch (error) {
            if (!(error instanceof JevError)) throw error
            return { violations: [], costUsd: 0 }
        }
    }

    /** Was this turn's user message a correction? Stored like the housekeeping classifier's answers, so it is not paid for twice. */
    private async wasCorrection(
        apiKey: string,
        namespace: string,
        sessionId: string,
        userMessageId: string | null,
        userPreview: string | null,
        before: string | null,
        createdAt: number
    ): Promise<{ corrected: boolean; costUsd: number }> {
        if (!userPreview) return { corrected: false, costUsd: 0 }
        if (userMessageId && this.store.messageClasses.has(userMessageId)) {
            const stored = this.store.messageClasses.list(namespace, createdAt - 1, [sessionId]).find((row) => row.messageId === userMessageId)
            if (stored) return { corrected: stored.class === 'correction', costUsd: 0 }
        }
        const ask: ClassifierAsk = async (state, questions) => {
            const result = await askJev({ apiKey, state, questions: questions as Parameters<typeof askJev>[0]['questions'], fetchFn: this.options.fetchFn })
            return { answers: result.answers as Awaited<ReturnType<ClassifierAsk>>['answers'], costUsd: result.costUsd }
        }
        try {
            const result = await classifyMessage(ask, { message: userPreview, before, goal: null })
            if (!result) return { corrected: false, costUsd: 0 }
            if (userMessageId) {
                this.store.messageClasses.upsert({
                    messageId: userMessageId, namespace, sessionId,
                    class: result.class, confidence: result.confidence, jevCostUsd: result.costUsd, createdAt
                })
            }
            return { corrected: result.class === 'correction', costUsd: result.costUsd }
        } catch (error) {
            if (!(error instanceof JevError)) throw error
            return { corrected: false, costUsd: 0 }
        }
    }
}

/** The rules a turn is held against: the active principles that apply to the project, project-scoped first. */
export function selectRules(memories: StoredMemory[], project: string | null): GuardRule[] {
    return memories
        .filter((memory) => memory.status === 'active' && memory.level === 'principle' && (memory.scope === '' || memory.scope === project))
        .sort((a, b) => (b.scope ? 1 : 0) - (a.scope ? 1 : 0) || b.support - a.support)
        .slice(0, GUARD.rules)
        .map((memory) => ({ id: memory.id, text: memory.text }))
}
