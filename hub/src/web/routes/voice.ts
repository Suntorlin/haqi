import { Hono } from 'hono'
import { z } from 'zod'
import type { WebAppEnv } from '../middleware/auth'
import { configuration } from '../../configuration'
import { readSettingsOrThrow } from '../../config/settings'
import {
    ELEVENLABS_API_BASE,
    VOICE_AGENT_NAME,
    buildVoiceAgentConfig
} from '@hapi/protocol/voice'

const tokenRequestSchema = z.object({
    customAgentId: z.string().optional(),
    customApiKey: z.string().optional()
})

// Local dictation service (scripts/asr-server). The hub only forwards; the service checks the token again.
const ASR_URL = (process.env.HAQI_ASR_URL || 'http://127.0.0.1:18790').replace(/\/+$/, '')
const ASR_TIMEOUT_MS = 120_000

// Cache for auto-created agent IDs (keyed by API key hash)
const agentIdCache = new Map<string, string>()

interface ElevenLabsAgent {
    agent_id: string
    name: string
}

async function isPureContextModeEnabled(): Promise<boolean> {
    try {
        const settings = await readSettingsOrThrow(configuration.settingsFile)
        return settings.pureContextMode === true
    } catch {
        return false
    }
}

/**
 * Find an existing "Hapi Voice Assistant" agent
 */
async function findHapiAgent(apiKey: string): Promise<string | null> {
    try {
        const response = await fetch(`${ELEVENLABS_API_BASE}/convai/agents`, {
            method: 'GET',
            headers: {
                'xi-api-key': apiKey,
                'Accept': 'application/json'
            }
        })

        if (!response.ok) {
            return null
        }

        const data = await response.json() as { agents?: ElevenLabsAgent[] }
        const agents: ElevenLabsAgent[] = data.agents || []
        const hapiAgent = agents.find(agent => agent.name === VOICE_AGENT_NAME)

        return hapiAgent?.agent_id || null
    } catch {
        return null
    }
}

/**
 * Create or update "Hapi Voice Assistant" agent config.
 */
async function createHapiAgent(
    apiKey: string,
    pureContextMode: boolean,
    existingAgentId?: string
): Promise<string | null> {
    try {
        const response = await fetch(
            existingAgentId
                ? `${ELEVENLABS_API_BASE}/convai/agents/${existingAgentId}`
                : `${ELEVENLABS_API_BASE}/convai/agents/create`,
            {
                method: existingAgentId ? 'PATCH' : 'POST',
                headers: {
                    'xi-api-key': apiKey,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(buildVoiceAgentConfig({ pureContextMode }))
            }
        )

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({})) as { detail?: { message?: string } | string }
            const errorMessage = typeof errorData.detail === 'string'
                ? errorData.detail
                : (errorData.detail as { message?: string })?.message || `API error: ${response.status}`
            console.error('[Voice] Failed to create/update agent:', errorMessage)
            return null
        }

        const data = await response.json() as { agent_id?: string }
        return existingAgentId ?? data.agent_id ?? null
    } catch (error) {
        console.error('[Voice] Error creating/updating agent:', error)
        return null
    }
}

/**
 * Get or create agent ID - finds existing or creates new "Hapi Voice Assistant" agent
 */
async function getOrCreateAgentId(apiKey: string): Promise<string | null> {
    const pureContextMode = await isPureContextModeEnabled()
    // Check cache first (simple hash of first/last chars of API key)
    const cacheKey = `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}:pure=${pureContextMode ? '1' : '0'}`
    const cached = agentIdCache.get(cacheKey)
    if (cached) {
        return cached
    }

    // Try to find existing agent
    console.log('[Voice] No agent ID configured, searching for existing agent...')
    let agentId = await findHapiAgent(apiKey)

    if (agentId) {
        console.log('[Voice] Found existing agent, syncing config:', agentId)
        agentId = await createHapiAgent(apiKey, pureContextMode, agentId)
    } else {
        // Create new agent
        console.log('[Voice] No existing agent found, creating new one...')
        agentId = await createHapiAgent(apiKey, pureContextMode)
        if (agentId) {
            console.log('[Voice] Created new agent:', agentId)
        }
    }

    // Cache the result
    if (agentId) {
        agentIdCache.set(cacheKey, agentId)
    }

    return agentId
}

export function createVoiceRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // Get ElevenLabs ConvAI conversation token
    app.post('/voice/token', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = tokenRequestSchema.safeParse(json ?? {})
        if (!parsed.success) {
            return c.json({ allowed: false, error: 'Invalid request body' }, 400)
        }

        const { customAgentId, customApiKey } = parsed.data

        // Use custom credentials if provided, otherwise fall back to env vars
        const apiKey = customApiKey || process.env.ELEVENLABS_API_KEY
        let agentId = customAgentId || process.env.ELEVENLABS_AGENT_ID

        if (!apiKey) {
            return c.json({
                allowed: false,
                error: 'ElevenLabs API key not configured'
            }, 400)
        }

        const pureContextMode = await isPureContextModeEnabled()

        // If agent ID comes from env default, keep config synced with pure-context mode.
        if (agentId && !customAgentId) {
            const syncedAgentId = await createHapiAgent(apiKey, pureContextMode, agentId)
            if (!syncedAgentId) {
                return c.json({
                    allowed: false,
                    error: 'Failed to sync ElevenLabs agent config'
                }, 500)
            }
            agentId = syncedAgentId
        }

        // Auto-create agent if not configured
        if (!agentId) {
            agentId = await getOrCreateAgentId(apiKey) ?? undefined
            if (!agentId) {
                return c.json({
                    allowed: false,
                    error: 'Failed to create ElevenLabs agent automatically'
                }, 500)
            }
        }

        try {
            // Fetch conversation token from ElevenLabs
            const response = await fetch(
                `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
                {
                    method: 'GET',
                    headers: {
                        'xi-api-key': apiKey,
                        'Accept': 'application/json'
                    }
                }
            )

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({})) as { detail?: { message?: string }; error?: string }
                const errorMessage = errorData.detail?.message || errorData.error || `ElevenLabs API error: ${response.status}`
                console.error('[Voice] Failed to get token from ElevenLabs:', errorMessage)
                return c.json({
                    allowed: false,
                    error: errorMessage
                }, 500)
            }

            const data = await response.json() as { token?: string }
            if (!data.token) {
                return c.json({
                    allowed: false,
                    error: 'No token in ElevenLabs response'
                }, 500)
            }

            return c.json({
                allowed: true,
                token: data.token,
                agentId
            })
        } catch (error) {
            console.error('[Voice] Error fetching token:', error)
            return c.json({
                allowed: false,
                error: error instanceof Error ? error.message : 'Network error'
            }, 500)
        }
    })

    // Local dictation: is the speech-to-text service up?
    app.get('/voice/dictation', async (c) => {
        try {
            const response = await fetch(`${ASR_URL}/api/voice/dictation`, {
                headers: { authorization: c.req.header('authorization') ?? '' },
                signal: AbortSignal.timeout(5_000)
            })
            if (!response.ok) {
                return c.json({ available: false })
            }
            return c.json(await response.json())
        } catch {
            return c.json({ available: false })
        }
    })

    // Local dictation: raw audio in, text out.
    app.post('/voice/transcribe', async (c) => {
        const query = new URL(c.req.url).search
        try {
            const response = await fetch(`${ASR_URL}/api/voice/transcribe${query}`, {
                method: 'POST',
                headers: {
                    authorization: c.req.header('authorization') ?? '',
                    'content-type': c.req.header('content-type') ?? 'application/octet-stream'
                },
                body: await c.req.arrayBuffer(),
                signal: AbortSignal.timeout(ASR_TIMEOUT_MS)
            })
            return new Response(response.body, {
                status: response.status,
                headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }
            })
        } catch (error) {
            console.error('[Voice] Dictation service unreachable:', error)
            return c.json({ error: 'Dictation service is not available' }, 503)
        }
    })

    return app
}
