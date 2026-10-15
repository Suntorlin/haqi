import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'

import { configuration } from '../configuration'

/**
 * The model settings the user picked last for a session: in the new-session form, or by switching
 * model / thinking / tier inside a chat. Kept on the hub so every device opens the form with the
 * same choice, instead of each browser remembering its own.
 */
export const newSessionDefaultsSchema = z.object({
    agent: z.enum(['claude', 'codex', 'cursor', 'gemini', 'opencode']).optional(),
    model: z.string().trim().max(255).optional(),
    customModel: z.string().trim().max(255).optional(),
    thinkEffort: z.enum(['auto', 'low', 'medium', 'high', 'max', 'xhigh']).optional(),
    serviceTier: z.enum(['auto', 'fast', 'flex']).optional(),
    yoloMode: z.boolean().optional(),
    /** Empty means the machine's default login. */
    claudeAccountId: z.union([z.literal(''), z.string().regex(/^[a-z0-9_-]{1,40}$/)]).optional()
}).strip()

export type NewSessionDefaultsInput = z.infer<typeof newSessionDefaultsSchema>
export type NewSessionDefaults = NewSessionDefaultsInput & { updatedAt: number }
export type ChatSettingChange = Pick<NewSessionDefaultsInput, 'model' | 'thinkEffort' | 'serviceTier'>

type DefaultsByNamespace = Record<string, NewSessionDefaults>

function parseStored(value: unknown): NewSessionDefaults | null {
    if (!value || typeof value !== 'object') return null
    const parsed = newSessionDefaultsSchema.safeParse(value)
    const updatedAt = (value as { updatedAt?: unknown }).updatedAt
    if (!parsed.success || typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null
    return { ...parsed.data, updatedAt }
}

export class NewSessionDefaultsStore {
    private cache: DefaultsByNamespace | null = null
    private queue: Promise<unknown> = Promise.resolve()

    constructor(private readonly file: string) {}

    async get(namespace: string): Promise<NewSessionDefaults | null> {
        const all = await this.load()
        return all[namespace] ?? null
    }

    /** A session was created from the form: its choice replaces what was remembered. */
    replace(namespace: string, input: NewSessionDefaultsInput): Promise<NewSessionDefaults> {
        return this.mutate(namespace, () => ({ ...input, updatedAt: Date.now() }))
    }

    /**
     * A setting was switched inside a chat. Only the remembered agent's settings follow, so a model
     * switch in a Codex chat neither rewrites the Claude choice nor flips the form to Codex.
     */
    rememberChatChange(namespace: string, agent: string, change: ChatSettingChange): Promise<NewSessionDefaults | null> {
        return this.mutate(namespace, (current) => {
            if ((current?.agent ?? 'claude') !== agent) {
                return null
            }
            const next: NewSessionDefaults = {
                ...current,
                agent: current?.agent ?? 'claude',
                updatedAt: Date.now()
            }
            if (change.model !== undefined) {
                next.model = change.model
                next.customModel = ''
            }
            if (change.thinkEffort !== undefined) {
                next.thinkEffort = change.thinkEffort
            }
            if (change.serviceTier !== undefined) {
                next.serviceTier = change.serviceTier
            }
            return next
        })
    }

    private mutate<T extends NewSessionDefaults | null>(
        namespace: string,
        update: (current: NewSessionDefaults | null) => T
    ): Promise<T> {
        const run = async (): Promise<T> => {
            const all = await this.load()
            const next = update(all[namespace] ?? null)
            if (next) {
                const written = { ...all, [namespace]: next }
                await this.write(written)
                this.cache = written
            }
            return next
        }
        const result = this.queue.then(run, run)
        this.queue = result.catch(() => undefined)
        return result
    }

    private async load(): Promise<DefaultsByNamespace> {
        if (this.cache) {
            return this.cache
        }
        const loaded: DefaultsByNamespace = {}
        if (existsSync(this.file)) {
            try {
                const raw = JSON.parse(await readFile(this.file, 'utf8')) as unknown
                if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                    for (const [namespace, value] of Object.entries(raw)) {
                        const parsed = parseStored(value)
                        if (parsed) loaded[namespace] = parsed
                    }
                }
            } catch (error) {
                console.error(`[WARN] Failed to read ${this.file}: ${error}`)
            }
        }
        this.cache = loaded
        return loaded
    }

    private async write(all: DefaultsByNamespace): Promise<void> {
        const dir = dirname(this.file)
        if (!existsSync(dir)) {
            await mkdir(dir, { recursive: true, mode: 0o700 })
        }
        const tmpFile = `${this.file}.tmp`
        await writeFile(tmpFile, JSON.stringify(all, null, 2), { mode: 0o600 })
        await rename(tmpFile, this.file)
    }
}

let sharedStore: NewSessionDefaultsStore | null = null

export function getNewSessionDefaultsStore(): NewSessionDefaultsStore {
    sharedStore ??= new NewSessionDefaultsStore(join(configuration.dataDir, 'new-session-defaults.json'))
    return sharedStore
}
