import { spawnSync } from 'node:child_process'

/**
 * Jev (TypeSafe "System One") through OpenRouter: typed questions in, calibrated answers out.
 * Text only; one request can carry several questions, answered in parallel.
 */

export const JEV_URL = 'https://openrouter.ai/api/v1/systemone'
export const JEV_MODEL = 'jev-latest'
const KEYCHAIN_SERVICE = 'claude-code-openrouter'

export type JevQuestion =
    | { type: 'noul'; instructions: unknown; criteria?: { true: unknown; false: unknown } }
    | { type: 'choice'; instructions: unknown; criteria: Record<string, unknown> }

export type JevNoul = { type: 'noul'; noul: number | { yes: number; no?: number } }
export type JevChoice = { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
export type JevAnswer = JevNoul | JevChoice

export type JevResult = {
    answers: Record<string, JevAnswer>
    costUsd: number
    latencyMs: number
    model: string
}

export function yesProbability(answer: JevAnswer | undefined): number {
    if (!answer || answer.type !== 'noul') return 0
    return typeof answer.noul === 'number' ? answer.noul : answer.noul.yes
}

let cachedKey: string | null | undefined

/** settings key > JEV_API_KEY > OPENROUTER_API_KEY > macOS keychain item `claude-code-openrouter`. */
export function resolveJevApiKey(settingsKey?: string | null): string | null {
    const direct = settingsKey?.trim() || process.env.JEV_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim()
    if (direct) return direct
    if (cachedKey !== undefined) return cachedKey
    cachedKey = null
    if (process.platform === 'darwin') {
        const result = spawnSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8', timeout: 5_000 })
        const value = result.status === 0 ? result.stdout.trim() : ''
        if (value) cachedKey = value
    }
    return cachedKey
}

export class JevError extends Error {}

export async function askJev(options: {
    apiKey: string
    state: Record<string, unknown>
    questions: Record<string, JevQuestion>
    timeoutMs?: number
    fetchFn?: typeof fetch
}): Promise<JevResult> {
    const started = Date.now()
    const fetchFn = options.fetchFn ?? fetch
    let response: Response
    try {
        response = await fetchFn(JEV_URL, {
            method: 'POST',
            headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: JEV_MODEL, state: options.state, questions: options.questions }),
            signal: AbortSignal.timeout(options.timeoutMs ?? 15_000)
        })
    } catch (error) {
        throw new JevError(error instanceof Error ? error.message : 'Jev request failed')
    }
    if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new JevError(`Jev HTTP ${response.status}${body ? `: ${body.slice(0, 200)}` : ''}`)
    }
    const body = await response.json() as { answers?: Record<string, JevAnswer>; usage?: { cost?: number }; model?: string }
    if (!body.answers) throw new JevError('Jev returned no answers')
    return {
        answers: body.answers,
        costUsd: body.usage?.cost ?? 0,
        latencyMs: Date.now() - started,
        model: body.model ?? JEV_MODEL
    }
}
