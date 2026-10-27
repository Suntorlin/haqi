import type { JevQuestion } from '../memory/jev'

/**
 * The compliance light of a session: after each turn, Jev checks the reply against the user's active
 * principles, and the light moves between ok, warn and alert. Warn is cheap and fires on one violation or
 * one correction; alert needs the same rule broken GUARD.alertStrikes times, and only GUARD.forgiveAfter
 * clean turns in a row turn it off again.
 */
export const GUARD = {
    /** Jev's yes at or above this counts as a violation. */
    violate: 0.7,
    /** How many rules one check sends to Jev. */
    rules: 12,
    /** Strikes on one rule that turn the light red. */
    alertStrikes: 2,
    /** Clean turns in a row that forgive an alert and reset the strikes. */
    forgiveAfter: 3,
    replyChars: 2000,
    messageChars: 1200,
    /** How much of a rule's text goes into the reason shown to the user. */
    reasonChars: 80
} as const

export type GuardStatus = 'ok' | 'warn' | 'alert'

export type GuardRule = { id: string; text: string }

export type GuardViolation = { memoryId: string; text: string; yes: number }

/** What one turn's check found: the rules the reply broke, and whether the user's message was a correction. */
export type GuardCheck = { violations: GuardViolation[]; corrected: boolean }

export type GuardState = {
    status: GuardStatus
    reason: string | null
    memoryId: string | null
    strikes: Record<string, number>
    cleanStreak: number
}

/** One yes/no per rule (keys `rule0`, `rule1`, ...): did the agent break it in this turn? */
export function ruleQuestions(rules: GuardRule[]): Record<string, JevQuestion> {
    const questions: Record<string, JevQuestion> = {}
    rules.forEach((rule, index) => {
        questions[`rule${index}`] = {
            type: 'noul',
            instructions: {
                rule: rule.text,
                question: 'In this turn (`user_message` is what the developer asked, `agent_reply` is how the coding agent answered), did the agent act against `rule`?'
            },
            criteria: {
                true: 'Yes: the reply does, proposes or claims something `rule` forbids, or skips something `rule` requires and that this turn clearly called for.',
                false: 'No: the reply follows the rule, or the rule does not apply to what this turn was about.'
            }
        }
    })
    return questions
}

function cut(text: string, max: number): string {
    const flat = text.replace(/\s+/g, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** The light after one checked turn, from the previous state and what the check found. */
export function nextGuard(prev: GuardState | null, check: GuardCheck): GuardState {
    const strikes = { ...(prev?.strikes ?? {}) }
    for (const violation of check.violations) {
        strikes[violation.memoryId] = (strikes[violation.memoryId] ?? 0) + 1
    }

    if (check.violations.length > 0) {
        const worst = check.violations.reduce((a, b) => {
            const [sa, sb] = [strikes[a.memoryId] ?? 0, strikes[b.memoryId] ?? 0]
            return sb > sa || (sb === sa && b.yes > a.yes) ? b : a
        })
        const count = strikes[worst.memoryId] ?? 1
        const repeat = count >= GUARD.alertStrikes
        return {
            status: repeat || prev?.status === 'alert' ? 'alert' : 'warn',
            reason: repeat
                ? `又违反了「${cut(worst.text, GUARD.reasonChars)}」（第 ${count} 次）`
                : `违反了「${cut(worst.text, GUARD.reasonChars)}」`,
            memoryId: worst.memoryId,
            strikes,
            cleanStreak: 0
        }
    }

    if (check.corrected) {
        // A correction is the user saying the agent got it wrong: it holds an alert and turns a green light yellow.
        return prev?.status === 'alert'
            ? { ...prev, strikes, cleanStreak: 0 }
            : { status: 'warn', reason: '你刚纠正了它', memoryId: null, strikes, cleanStreak: 0 }
    }

    const cleanStreak = (prev?.cleanStreak ?? 0) + 1
    if (prev?.status === 'alert' && cleanStreak < GUARD.forgiveAfter) {
        return { ...prev, strikes, cleanStreak }
    }
    const forgiven = prev?.status === 'alert'
    return { status: 'ok', reason: null, memoryId: null, strikes: forgiven ? {} : strikes, cleanStreak }
}
