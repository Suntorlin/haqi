import type { TaskLoad } from '@hapi/protocol/types'

import { askJev, JevError } from '../memory/jev'
import { realUserText } from '../memory/userMessage'
import type { Store } from '../store'
import { classifyMessage, LOAD_CLASSES, MESSAGE_CLASSES, percentiles, type ClassifierAsk, type MessageClass } from './plugins/classifier/classifier'

const DAY_MS = 24 * 3600 * 1000
const PAGE = 200
const PARALLEL = 6
/** Each run looks back this far, so a message missed because Jev failed is retried the next time. */
const INCREMENTAL_LOOKBACK_MS = DAY_MS
export const BACKFILL_DAYS = 30

export type ClassifyRun = { scanned: number; classified: number; failed: number; costUsd: number }

export type LoadReport = {
    days: number
    since: number
    messages: number
    byClass: Record<MessageClass, number>
    sessions: number
    /** Per session: how many messages counted as load (progress, correction, decision), and all of them. */
    perSession: { load: ReturnType<typeof percentiles>; all: ReturnType<typeof percentiles> }
    costUsd: number
    backfill: { running: boolean; last: ClassifyRun | null }
}

/**
 * Classifies the user's messages with Jev and adds them up: per task (the task's member sessions since it was
 * created) and as a baseline over the last days.
 */
export class LoadService {
    private running = false
    private backfillRunning = false
    private lastBackfill: ClassifyRun | null = null

    constructor(
        private readonly store: Store,
        private readonly options: {
            jevKey: () => Promise<string | null>
            /** Session id -> the goal of its task, to help Jev read the message. Read once per run. */
            goals?: (namespace: string) => Map<string, string>
            fetchFn?: typeof fetch
        }
    ) {}

    /** New messages since the last run, from the 15-minute housekeeping. */
    async classifyRecent(namespace = 'default'): Promise<ClassifyRun> {
        const since = (this.store.messageClasses.newest(namespace) ?? Date.now()) - INCREMENTAL_LOOKBACK_MS
        return await this.classifySince(namespace, since)
    }

    /** The last BACKFILL_DAYS days; costs about $0.00006 per message. Runs in the background. */
    startBackfill(namespace = 'default'): { started: boolean } {
        if (this.backfillRunning) return { started: false }
        this.backfillRunning = true
        void this.classifySince(namespace, Date.now() - BACKFILL_DAYS * DAY_MS, true)
            .then((run) => { this.lastBackfill = run })
            .catch((error: unknown) => console.warn(`[LoadService] Backfill failed: ${error instanceof Error ? error.message : String(error)}`))
            .finally(() => { this.backfillRunning = false })
        return { started: true }
    }

    /** Messages per class in `sessionIds` since `since`; null until any of them is classified. */
    taskLoad(namespace: string, sessionIds: string[], since: number): TaskLoad | null {
        const rows = this.store.messageClasses.list(namespace, since, sessionIds)
        if (rows.length === 0) return null
        const count = (name: MessageClass) => rows.filter((row) => row.class === name).length
        return { progress: count('progress'), correction: count('correction'), decision: count('decision'), request: count('request') }
    }

    report(namespace: string, days = BACKFILL_DAYS): LoadReport {
        const since = Date.now() - days * DAY_MS
        const rows = this.store.messageClasses.list(namespace, since)
        const byClass = Object.fromEntries(MESSAGE_CLASSES.map((name) => [name, rows.filter((row) => row.class === name).length])) as Record<MessageClass, number>
        const perSession = new Map<string, { load: number; all: number }>()
        for (const row of rows) {
            const entry = perSession.get(row.sessionId) ?? { load: 0, all: 0 }
            entry.all += 1
            if (LOAD_CLASSES.includes(row.class as MessageClass)) entry.load += 1
            perSession.set(row.sessionId, entry)
        }
        const entries = [...perSession.values()]
        return {
            days,
            since,
            messages: rows.length,
            byClass,
            sessions: perSession.size,
            perSession: { load: percentiles(entries.map((e) => e.load)), all: percentiles(entries.map((e) => e.all)) },
            costUsd: rows.reduce((sum, row) => sum + row.jevCostUsd, 0),
            backfill: { running: this.backfillRunning, last: this.lastBackfill }
        }
    }

    private async classifySince(namespace: string, since: number, backfill = false): Promise<ClassifyRun> {
        const run: ClassifyRun = { scanned: 0, classified: 0, failed: 0, costUsd: 0 }
        if (this.running && !backfill) return run
        const apiKey = await this.options.jevKey()
        if (!apiKey) return run
        if (!backfill) this.running = true
        try {
            const ask: ClassifierAsk = async (state, questions) => {
                const result = await askJev({ apiKey, state, questions: questions as Parameters<typeof askJev>[0]['questions'], fetchFn: this.options.fetchFn })
                return { answers: result.answers as Awaited<ReturnType<ClassifierAsk>>['answers'], costUsd: result.costUsd }
            }
            const goals = this.options.goals?.(namespace) ?? new Map<string, string>()
            let cursor = since
            for (;;) {
                const turns = this.store.memories.userTurns(namespace, cursor, PAGE)
                if (turns.length === 0) break
                cursor = turns.at(-1)!.createdAt
                const todo = turns
                    .map((turn) => ({ turn, text: realUserText(turn.content) }))
                    .filter((item): item is { turn: typeof item.turn; text: string } => item.text !== null && !this.store.messageClasses.has(item.turn.messageId))
                run.scanned += turns.length
                for (let i = 0; i < todo.length; i += PARALLEL) {
                    await Promise.all(todo.slice(i, i + PARALLEL).map(async ({ turn, text }) => {
                        try {
                            const result = await classifyMessage(ask, { message: text, before: turn.before, goal: goals.get(turn.sessionId) ?? null })
                            if (!result) {
                                run.failed += 1
                                return
                            }
                            this.store.messageClasses.upsert({
                                messageId: turn.messageId,
                                namespace,
                                sessionId: turn.sessionId,
                                class: result.class,
                                confidence: result.confidence,
                                jevCostUsd: result.costUsd,
                                createdAt: turn.createdAt
                            })
                            run.classified += 1
                            run.costUsd += result.costUsd
                        } catch (error) {
                            if (!(error instanceof JevError)) throw error
                            run.failed += 1
                        }
                    }))
                }
                if (turns.length < PAGE) break
            }
            return run
        } finally {
            if (!backfill) this.running = false
        }
    }
}
