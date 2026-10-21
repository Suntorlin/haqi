/**
 * Why the user had to speak: each message the user typed falls in one of four classes. The first three are the
 * cognitive load HAQI tries to take off the user; a new request is the user's own work and does not count as load.
 */

export const MESSAGE_CLASSES = ['progress', 'correction', 'decision', 'request'] as const
export type MessageClass = typeof MESSAGE_CLASSES[number]

/** The classes that count as load. */
export const LOAD_CLASSES: readonly MessageClass[] = ['progress', 'correction', 'decision']

export type ClassifierAsk = (state: Record<string, unknown>, questions: Record<string, unknown>) => Promise<{
    answers: Record<string, { type: string; choice?: string; confidence?: number }>
    costUsd: number
}>

export type ClassifiedMessage = { class: MessageClass; confidence: number; costUsd: number }

const BEFORE_CHARS = 600
const MESSAGE_CHARS = 1500

const QUESTION = {
    type: 'choice',
    instructions: {
        context: '`message` is what a developer typed to their coding agent. `agent_before` is the end of the agent\'s previous reply. `task_goal` is the goal of the task the session belongs to, or "none".',
        question: 'Why did the developer have to write `message`?'
    },
    criteria: {
        progress: 'Chasing progress or status: asks whether the work is done, how far it got, what happened, or to report back; includes "继续", "好了吗", "进展如何".',
        correction: 'Correcting the agent: points out a mistake, a wrong result or a misunderstanding, or asks to redo or undo work the agent already did.',
        decision: 'Making a call the agent asked for or was waiting on: approves, picks an option, answers a question, gives permission, such as "可以", "按方案 2", "推送吧".',
        request: 'A new request: a new task, a new requirement or more scope, a question for information, or pasted material to work with.'
    }
} as const

export async function classifyMessage(ask: ClassifierAsk, input: { message: string; before: string | null; goal: string | null }): Promise<ClassifiedMessage | null> {
    const result = await ask(
        { message: input.message.slice(0, MESSAGE_CHARS), agent_before: input.before?.slice(-BEFORE_CHARS) ?? 'none', task_goal: input.goal ?? 'none' },
        { why: QUESTION }
    )
    const answer = result.answers.why
    const choice = answer?.type === 'choice' ? answer.choice : undefined
    if (!choice || !(MESSAGE_CLASSES as readonly string[]).includes(choice)) return null
    return { class: choice as MessageClass, confidence: answer?.confidence ?? 0, costUsd: result.costUsd }
}

/** Median, 75th and 90th percentile, nearest rank. */
export function percentiles(values: number[]): { median: number; p75: number; p90: number } {
    if (values.length === 0) return { median: 0, p75: 0, p90: 0 }
    const sorted = [...values].sort((a, b) => a - b)
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]!
    return { median: at(0.5), p75: at(0.75), p90: at(0.9) }
}
