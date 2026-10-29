import type { JevQuestion } from '../memory/jev'

/**
 * The compliance light of a session: after each turn, Jev checks the reply against the user's active
 * principles, and the light moves between ok, warn and alert. Warn means the newest turn broke a rule or the
 * user corrected the agent; alert means one rule was broken in GUARD.alertStrikes turns within the last
 * GUARD.window conversation turns, and it clears by itself once the window no longer holds that many.
 */
export const GUARD = {
    /** Jev's yes on "did the reply break the rule" at or above this, with `applies`, counts as a violation. */
    violate: 0.8,
    /** Jev's yes on "is this turn what the rule is about" must reach this too; it keeps off-topic rules quiet. */
    applies: 0.5,
    /** How many rules one check sends to Jev. */
    rules: 12,
    /** Strikes on one rule within the window that turn the light red. */
    alertStrikes: 3,
    /** How many conversation turns back a strike still counts. */
    window: 5,
    replyChars: 2000,
    messageChars: 1200,
    /** How much of a rule's text goes into the reason shown to the user. */
    reasonChars: 80
} as const

export type GuardStatus = 'ok' | 'warn' | 'alert'

export type GuardRule = { id: string; text: string }

export type GuardViolation = { memoryId: string; text: string; yes: number }

/**
 * What one turn's check found: the rules the reply broke, and whether the user's message was a correction.
 * `ruleTexts` (memory id to text, for every rule checked) names an alert's rule on a turn that did not break it.
 */
export type GuardCheck = { violations: GuardViolation[]; corrected: boolean; ruleTexts?: Record<string, string> }

export type GuardState = {
    status: GuardStatus
    reason: string | null
    memoryId: string | null
    /** Per rule, the conversation turn indexes whose reply broke it, only those still inside the window. */
    strikes: Record<string, number[]>
    cleanStreak: number
}

/**
 * Two yes/no per rule: `applies<i>` (is this turn the kind of situation the rule is about?) and `rule<i>`
 * (did the reply break it?). A long rule asked alone gets a yes for nearly any reply; the first question
 * keeps a handoff rule quiet when no handoff happens, an architecture rule quiet when no design is described.
 */
export function ruleQuestions(rules: GuardRule[]): Record<string, JevQuestion> {
    const questions: Record<string, JevQuestion> = {}
    rules.forEach((rule, index) => {
        questions[`applies${index}`] = {
            type: 'noul',
            instructions: {
                rule: rule.text,
                question: 'Is this turn (`user_message` is what the developer asked, `agent_reply` is the coding agent\'s final message) one of the situations `rule` is about?'
            },
            criteria: {
                true: 'Yes: the turn is squarely the kind of work or message `rule` governs.',
                false: 'No: `rule` is about a different kind of work, a different moment (for example a session handoff that is not happening now), or another project.'
            }
        }
        questions[`rule${index}`] = {
            type: 'noul',
            instructions: {
                rule: rule.text,
                question: 'The developer wrote `rule` for the coding agent. Reading `agent_reply` (the agent\'s final message for `user_message`), would the developer point at it and say "you broke this rule"?'
            },
            criteria: {
                true: 'Yes: the reply plainly breaks the rule in a way the developer would notice at once, for example the wrong language, a forbidden action it reports, or a thing the rule demands for exactly this kind of turn that is missing.',
                false: 'No: the reply follows the rule, the rule is about a different situation, or the only gap is a matter of degree or polish (a long sentence, a missing optional detail) or something the reply does not show.'
            }
        }
    })
    return questions
}

/** Lines the CLI writes into the turn as session events, not words of the agent. */
const EVENT_LINE = /^(?:账号已核验：.*|账号 .+ 仍超限.*|启动时的额度检查失败：.*|You've hit your .*limit\b.*|Aborted by user|Process exited unexpectedly)$/gm

/**
 * The agent's own answer in a turn's reply preview, or null when there is nothing to judge: the user aborted
 * the turn (the reply is cut off), or the reply is only a usage-limit notice and the CLI's event lines.
 */
export function agentAnswer(preview: string): string | null {
    if (/^Aborted by user$/m.test(preview)) return null
    const answer = preview.replace(EVENT_LINE, '').trim()
    return answer || null
}

function cut(text: string, max: number): string {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * The light after the check of conversation turn `turn`, from the previous state and what the check found.
 * Strikes older than the window drop out, so an old run of misses does not keep a session red for good; the
 * same turn checked twice (the agent wrote more after its first end) strikes a rule once.
 */
export function nextGuard(prev: GuardState | null, check: GuardCheck, turn: number): GuardState {
    const strikes: Record<string, number[]> = {}
    for (const [memoryId, turns] of Object.entries(prev?.strikes ?? {})) {
        const kept = turns.filter((n) => n > turn - GUARD.window)
        if (kept.length > 0) strikes[memoryId] = kept
    }
    for (const violation of check.violations) {
        const turns = strikes[violation.memoryId] ?? []
        strikes[violation.memoryId] = turns.includes(turn) ? turns : [...turns, turn]
    }
    const cleanStreak = check.violations.length === 0 && !check.corrected ? (prev?.cleanStreak ?? 0) + 1 : 0

    const repeated = Object.entries(strikes)
        .filter(([, turns]) => turns.length >= GUARD.alertStrikes)
        .sort((a, b) => b[1].length - a[1].length || Math.max(...b[1]) - Math.max(...a[1]))[0]
    if (repeated) {
        const [memoryId, turns] = repeated
        const text = check.violations.find((v) => v.memoryId === memoryId)?.text ?? check.ruleTexts?.[memoryId] ?? null
        return {
            status: 'alert',
            reason: text
                ? `最近 ${GUARD.window} 轮里 ${turns.length} 次违反了「${cut(text, GUARD.reasonChars)}」`
                : `最近 ${GUARD.window} 轮里 ${turns.length} 次违反了同一条规则`,
            memoryId,
            strikes,
            cleanStreak
        }
    }

    if (check.violations.length > 0) {
        const worst = check.violations.reduce((a, b) => (b.yes > a.yes ? b : a))
        return { status: 'warn', reason: `违反了「${cut(worst.text, GUARD.reasonChars)}」`, memoryId: worst.memoryId, strikes, cleanStreak }
    }
    if (check.corrected) {
        return { status: 'warn', reason: '你刚纠正了它', memoryId: null, strikes, cleanStreak }
    }
    return { status: 'ok', reason: null, memoryId: null, strikes, cleanStreak }
}
