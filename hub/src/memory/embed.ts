/**
 * Sentence embeddings through OpenRouter, with the same key as Jev. They find the same memory
 * written in other words or another language, which character overlap cannot.
 * Providers that keep or train on the data are refused (`data_collection: deny`).
 */

export const EMBED_URL = 'https://openrouter.ai/api/v1/embeddings'
export const EMBED_MODEL = 'openai/text-embedding-3-small'

export class EmbedError extends Error {}

export async function embedTexts(options: {
    apiKey: string
    texts: string[]
    timeoutMs?: number
    fetchFn?: typeof fetch
}): Promise<{ vectors: number[][]; costUsd: number; model: string }> {
    if (options.texts.length === 0) return { vectors: [], costUsd: 0, model: EMBED_MODEL }
    const fetchFn = options.fetchFn ?? fetch
    let response: Response
    try {
        response = await fetchFn(EMBED_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: EMBED_MODEL, input: options.texts, provider: { data_collection: 'deny' } }),
            signal: AbortSignal.timeout(options.timeoutMs ?? 20_000)
        })
    } catch (error) {
        throw new EmbedError(error instanceof Error ? error.message : 'Embedding request failed')
    }
    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new EmbedError(`Embedding HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
    const body = await response.json() as { data?: Array<{ index?: number; embedding?: number[] }>; usage?: { cost?: number } }
    const vectors: number[][] = []
    for (const [position, item] of (body.data ?? []).entries()) {
        if (!Array.isArray(item.embedding)) throw new EmbedError('Embedding response without a vector')
        vectors[item.index ?? position] = item.embedding
    }
    if (vectors.length !== options.texts.length) throw new EmbedError('Embedding response has the wrong number of vectors')
    return { vectors, costUsd: body.usage?.cost ?? 0, model: EMBED_MODEL }
}

export function cosine(a: number[], b: number[]): number {
    let dot = 0
    let normA = 0
    let normB = 0
    const length = Math.min(a.length, b.length)
    for (let i = 0; i < length; i++) {
        dot += a[i]! * b[i]!
        normA += a[i]! * a[i]!
        normB += b[i]! * b[i]!
    }
    return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB)
}
