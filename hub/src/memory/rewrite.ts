import { chat, hasChinese, jsonIn } from './chat'

/** Notes that say the same thing, written again as one: every detail kept, nothing added. */

const MAX_CHARS = 400

const SYSTEM = [
    'You merge notes from one developer\'s long-term memory for coding agents. The notes are about the same rule, lesson or fact.',
    'Write one note that keeps every concrete detail from all of them: commands, paths, names, numbers, conditions and reasons. Drop only what repeats.',
    'Do not add anything the notes do not say. When two notes disagree, keep what the newer one says; the notes are listed oldest first.',
    `Use short standalone sentences that make sense without the notes, at most ${MAX_CHARS} characters in all.`,
    'Answer with JSON only: {"text":"..."}.'
].join('\n')

export async function rewriteMerged(options: { apiKey: string; texts: string[]; fetchFn?: typeof fetch; timeoutMs?: number }): Promise<{ text: string | null; costUsd: number }> {
    const notes = options.texts.map((text, index) => `${index + 1}. ${text}`).join('\n')
    const reply = await chat({
        apiKey: options.apiKey,
        system: SYSTEM,
        user: `notes:\n${notes}\n\nWrite "text" in ${options.texts.some(hasChinese) ? 'Simplified Chinese' : 'the language of the notes'}.`,
        maxTokens: 500,
        fetchFn: options.fetchFn,
        timeoutMs: options.timeoutMs
    })
    const parsed = jsonIn(reply.content) as { text?: unknown } | null
    const text = typeof parsed?.text === 'string' ? parsed.text.trim() : ''
    return { text: text || null, costUsd: reply.costUsd }
}
