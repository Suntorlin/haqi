import { chat, hasChinese, jsonIn } from './chat'
import { askJev, yesProbability, JevError } from './jev'

/**
 * Memories from the user's own messages. Three steps, cheapest first:
 * 1. Local rules drop what the user did not write (context summaries, command output, pasted logs).
 * 2. Jev answers "does this message state a lasting rule or preference?"; only a sure yes goes on.
 * 3. A small model rewrites what the user said into standalone sentences, each with the user's exact words.
 */

/** Jev must be at least this sure that a message states a lasting rule. */
export const GATE = 0.7

const MIN_CHARS = 8
const MAX_CHARS = 1500
const BEFORE_CHARS = 600

const NOT_WRITTEN_BY_USER = [
    /^This session is being continued from a previous conversation/,
    /<local-command-stdout>|<command-name>|<command-message>|<system-reminder>|<task-notification>/,
    /^Caveat: The messages below were generated/,
    /^\[Request interrupted/
]

/** The user's text without attachment paths, or null when the message is not something the user wrote. */
export function userText(raw: string): string | null {
    if (NOT_WRITTEN_BY_USER.some((pattern) => pattern.test(raw))) return null
    const text = raw.replace(/@\/\S*hapi-blobs\/\S+/g, ' ').replace(/[ \t]+/g, ' ').trim()
    if (text.length < MIN_CHARS || text.length > MAX_CHARS) return null
    return text
}

export async function gate(options: { apiKey: string; message: string; before: string | null; fetchFn?: typeof fetch }): Promise<{ yes: number; costUsd: number }> {
    const result = await askJev({
        apiKey: options.apiKey,
        state: { message: options.message, agent_before: options.before?.slice(-BEFORE_CHARS) ?? 'none' },
        questions: {
            lasting: {
                type: 'noul',
                instructions: '`message` is what a developer typed to their coding agent; `agent_before` is the end of the agent\'s previous reply. Does `message` state a preference, rule, correction or decision of the developer that should still guide agents in future, unrelated tasks?',
                criteria: {
                    true: 'Yes: a standing preference or rule (how to report, what to avoid, how to verify or deliver, what needs approval, taste in design or code), or a correction of the agent that applies beyond this task, such as "don\'t X", "always Y", "X should be Y because Z".',
                    false: 'No: an instruction, question or feedback only about the current task or screen, a status check, an approval such as "ok, deploy it", a task brief, or pasted text, logs or notes.'
                }
            }
        },
        fetchFn: options.fetchFn
    })
    return { yes: yesProbability(result.answers.lasting), costUsd: result.costUsd }
}

export type ExtractedRule = { text: string; quote: string }

const SYSTEM = [
    'You read one message a developer sent to their coding agent, and the end of the agent\'s reply before it.',
    'Write down only the lasting rules, preferences or decisions the developer states in the message: things that should still guide agents in future, unrelated tasks.',
    'Leave out requests that only make sense for the current task (which port, which file, commit this, push that), anything the agent said, and anything you infer but the developer did not say. When unsure, leave it out.',
    'For each rule: "text" is one short standalone sentence that makes sense without the conversation, written in the same language as the message (a Chinese message gets a Chinese sentence); "quote" is the developer\'s exact words it comes from, copied from the message.',
    'Answer with JSON only: {"rules":[{"text":"...","quote":"..."}]}. At most 3 rules. If there is none, answer {"rules":[]}.'
].join('\n')

export { ChatError as ExtractError } from './chat'

export async function extractRules(options: { apiKey: string; message: string; before: string | null; fetchFn?: typeof fetch; timeoutMs?: number }): Promise<{ rules: ExtractedRule[]; costUsd: number }> {
    const reply = await chat({
        apiKey: options.apiKey,
        system: SYSTEM,
        user: `agent_before:\n${options.before?.slice(-BEFORE_CHARS) ?? '(none)'}\n\nmessage:\n${options.message}\n\nWrite every "text" in ${hasChinese(options.message) ? 'Simplified Chinese' : 'the language of the message'}.`,
        maxTokens: 600,
        fetchFn: options.fetchFn,
        timeoutMs: options.timeoutMs
    })
    const parsed = jsonIn(reply.content) as { rules?: Array<{ text?: unknown; quote?: unknown }> } | null
    const rules = (parsed?.rules ?? [])
        .filter((rule): rule is { text: string; quote: string } => typeof rule.text === 'string' && typeof rule.quote === 'string')
        .map((rule) => ({ text: rule.text.trim(), quote: rule.quote.trim() }))
        // The quote must really be in the message: the user's own words are the whole point.
        .filter((rule) => rule.text && rule.quote && options.message.includes(rule.quote.slice(0, 12)))
        .slice(0, 3)
    return { rules, costUsd: reply.costUsd }
}

export { JevError }
