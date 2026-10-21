/** A small chat model through OpenRouter, for the few steps that must write text (Jev only answers questions). */

export const CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const CHAT_MODEL = 'anthropic/claude-haiku-4.5'

export class ChatError extends Error {}

/** One system + user turn; returns the reply and what it cost. Never logged by the provider (data_collection: deny). */
export async function chat(options: {
    apiKey: string
    system: string
    user: string
    maxTokens: number
    fetchFn?: typeof fetch
    timeoutMs?: number
}): Promise<{ content: string; costUsd: number }> {
    const fetchFn = options.fetchFn ?? fetch
    let response: Response
    try {
        response = await fetchFn(CHAT_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: CHAT_MODEL,
                provider: { data_collection: 'deny' },
                temperature: 0,
                max_tokens: options.maxTokens,
                usage: { include: true },
                messages: [
                    { role: 'system', content: options.system },
                    { role: 'user', content: options.user }
                ]
            }),
            signal: AbortSignal.timeout(options.timeoutMs ?? 30_000)
        })
    } catch (error) {
        throw new ChatError(error instanceof Error ? error.message : 'Chat request failed')
    }
    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new ChatError(`Chat HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }>; usage?: { cost?: number } }
    return { content: body.choices?.[0]?.message?.content ?? '', costUsd: body.usage?.cost ?? 0 }
}

/** The first JSON object in a reply, or null. */
export function jsonIn(content: string): unknown {
    const json = content.match(/\{[\s\S]*\}/)?.[0]
    if (!json) return null
    try {
        return JSON.parse(json)
    } catch {
        return null
    }
}

export function hasChinese(text: string): boolean {
    return /[一-鿿]/.test(text)
}
