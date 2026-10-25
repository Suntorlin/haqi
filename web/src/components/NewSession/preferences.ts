import type { ClaudeAccountPool, ClaudeAccountSelection } from '@hapi/protocol/schemas'
import type { NewSessionDefaults } from '@/types/api'
import type { AgentType, ServiceTier, SessionType, ThinkEffort } from './types'
import { CODEX_SERVICE_TIER_OPTIONS, MODEL_OPTIONS, getModelOptionsForAgent, getThinkEffortOptions } from './types'

const AGENT_STORAGE_KEY = 'hapi:newSession:agent'
const YOLO_STORAGE_KEY = 'hapi:newSession:yolo'
const SESSION_TYPE_STORAGE_KEY = 'hapi:newSession:sessionType'
const THINK_EFFORT_STORAGE_KEY = 'hapi:newSession:thinkEffortByAgent'
const SERVICE_TIER_STORAGE_KEY = 'hapi:newSession:serviceTierByAgent'
const MODEL_STORAGE_KEY = 'hapi:newSession:modelByAgent'
const CUSTOM_MODEL_STORAGE_KEY = 'hapi:newSession:customModelByAgent'
const LAST_CONFIG_STORAGE_KEY = 'hapi:newSession:lastConfig'

const VALID_AGENTS: AgentType[] = ['claude', 'codex', 'cursor', 'gemini', 'opencode']
const VALID_THINK_EFFORTS: ThinkEffort[] = ['auto', 'low', 'medium', 'high', 'max', 'xhigh']
type AgentPreferenceMap = Partial<Record<AgentType, string>>

export type LastSessionConfig = {
    agent?: AgentType
    model?: string
    customModel?: string
    thinkEffort?: ThinkEffort
    serviceTier?: ServiceTier
    yoloMode?: boolean
    sessionType?: SessionType
    worktreeName?: string
    previewUrl?: string
    /** Claude account chosen last time; empty/absent means the machine default. */
    claudeAccountId?: string
    /** When this choice was made, to compare with the copy shared through the hub. */
    savedAt?: number
}

/** The part of the last config that the hub shares between devices. */
const SHARED_CONFIG_KEYS = ['agent', 'model', 'customModel', 'thinkEffort', 'serviceTier', 'yoloMode', 'claudeAccountId'] as const
const CLAUDE_ACCOUNT_ID_PATTERN = /^[a-z0-9_-]{1,40}$/

function loadAgentPreferenceMap(storageKey: string): AgentPreferenceMap {
    try {
        const stored = localStorage.getItem(storageKey)
        if (!stored) return {}
        const parsed = JSON.parse(stored)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {}
        }

        const result: AgentPreferenceMap = {}
        for (const [key, value] of Object.entries(parsed)) {
            if (VALID_AGENTS.includes(key as AgentType) && typeof value === 'string') {
                result[key as AgentType] = value
            }
        }
        return result
    } catch {
        return {}
    }
}

function saveAgentPreferenceValue(storageKey: string, agent: AgentType, value: string): void {
    try {
        const current = loadAgentPreferenceMap(storageKey)
        if (value.trim().length === 0) {
            delete current[agent]
        } else {
            current[agent] = value
        }
        localStorage.setItem(storageKey, JSON.stringify(current))
    } catch {
        // Ignore storage errors
    }
}

export function loadPreferredAgent(): AgentType {
    try {
        const stored = localStorage.getItem(AGENT_STORAGE_KEY)
        if (stored && VALID_AGENTS.includes(stored as AgentType)) {
            return stored as AgentType
        }
    } catch {
        // Ignore storage errors
    }
    return 'claude'
}

export function savePreferredAgent(agent: AgentType): void {
    try {
        localStorage.setItem(AGENT_STORAGE_KEY, agent)
    } catch {
        // Ignore storage errors
    }
}

// YOLO is the default; only an explicit "off" saved by the user switches it off.
export function loadPreferredYoloMode(): boolean {
    try {
        return localStorage.getItem(YOLO_STORAGE_KEY) !== 'false'
    } catch {
        return true
    }
}

export function savePreferredYoloMode(enabled: boolean): void {
    try {
        localStorage.setItem(YOLO_STORAGE_KEY, enabled ? 'true' : 'false')
    } catch {
        // Ignore storage errors
    }
}

export function loadPreferredSessionType(): SessionType {
    try {
        const stored = localStorage.getItem(SESSION_TYPE_STORAGE_KEY)
        if (stored === 'simple' || stored === 'worktree') {
            return stored
        }
    } catch {
        // Ignore storage errors
    }
    return 'simple'
}

export function savePreferredSessionType(value: SessionType): void {
    try {
        localStorage.setItem(SESSION_TYPE_STORAGE_KEY, value)
    } catch {
        // Ignore storage errors
    }
}

export function loadPreferredThinkEffort(agent: AgentType): ThinkEffort | null {
    const availableOptions = getThinkEffortOptions(agent)
    if (availableOptions.length === 0) {
        return null
    }

    const storedValue = loadAgentPreferenceMap(THINK_EFFORT_STORAGE_KEY)[agent]
    if (!storedValue) {
        return null
    }

    if (availableOptions.some((option) => option.value === storedValue)) {
        return storedValue as ThinkEffort
    }

    return null
}

export function savePreferredThinkEffort(agent: AgentType, value: ThinkEffort): void {
    const availableOptions = getThinkEffortOptions(agent)
    if (!availableOptions.some((option) => option.value === value)) {
        return
    }

    saveAgentPreferenceValue(THINK_EFFORT_STORAGE_KEY, agent, value)
}

export function loadPreferredServiceTier(agent: AgentType): ServiceTier | null {
    if (agent !== 'codex') {
        return null
    }

    const storedValue = loadAgentPreferenceMap(SERVICE_TIER_STORAGE_KEY)[agent]
    if (!storedValue) {
        return null
    }

    if (CODEX_SERVICE_TIER_OPTIONS.some((option) => option.value === storedValue)) {
        return storedValue as ServiceTier
    }

    return null
}

export function savePreferredServiceTier(agent: AgentType, value: ServiceTier): void {
    if (agent !== 'codex') {
        return
    }
    if (!CODEX_SERVICE_TIER_OPTIONS.some((option) => option.value === value)) {
        return
    }
    saveAgentPreferenceValue(SERVICE_TIER_STORAGE_KEY, agent, value)
}

export function loadPreferredModel(agent: AgentType): string | null {
    const availableOptions = MODEL_OPTIONS[agent]
    if (availableOptions.length === 0) {
        return null
    }

    const storedValue = loadAgentPreferenceMap(MODEL_STORAGE_KEY)[agent]
    if (!storedValue) {
        return null
    }

    if (availableOptions.some((option) => option.value === storedValue)) {
        return storedValue
    }

    return null
}

export function savePreferredModel(agent: AgentType, value: string): void {
    const availableOptions = MODEL_OPTIONS[agent]
    if (!availableOptions.some((option) => option.value === value)) {
        return
    }

    saveAgentPreferenceValue(MODEL_STORAGE_KEY, agent, value)
}

export function loadPreferredCustomModel(agent: AgentType): string {
    const storedValue = loadAgentPreferenceMap(CUSTOM_MODEL_STORAGE_KEY)[agent]
    if (!storedValue) {
        return ''
    }
    return storedValue
}

export function savePreferredCustomModel(agent: AgentType, value: string): void {
    saveAgentPreferenceValue(CUSTOM_MODEL_STORAGE_KEY, agent, value)
}

function sanitizeLastSessionConfig(parsed: unknown): LastSessionConfig | null {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null
    }
    const raw = parsed as Record<string, unknown>
    const config: LastSessionConfig = {}

    if (typeof raw.agent === 'string' && VALID_AGENTS.includes(raw.agent as AgentType)) {
        config.agent = raw.agent as AgentType
    }
    if (typeof raw.model === 'string') {
        config.model = raw.model
    }
    if (typeof raw.customModel === 'string') {
        config.customModel = raw.customModel
    }
    if (typeof raw.thinkEffort === 'string' && VALID_THINK_EFFORTS.includes(raw.thinkEffort as ThinkEffort)) {
        config.thinkEffort = raw.thinkEffort as ThinkEffort
    }
    if (typeof raw.serviceTier === 'string' && CODEX_SERVICE_TIER_OPTIONS.some((option) => option.value === raw.serviceTier)) {
        config.serviceTier = raw.serviceTier as ServiceTier
    }
    if (typeof raw.yoloMode === 'boolean') {
        config.yoloMode = raw.yoloMode
    }
    if (raw.sessionType === 'simple' || raw.sessionType === 'worktree') {
        config.sessionType = raw.sessionType
    }
    if (typeof raw.worktreeName === 'string') {
        config.worktreeName = raw.worktreeName
    }
    if (typeof raw.previewUrl === 'string') {
        config.previewUrl = raw.previewUrl
    }
    if (typeof raw.claudeAccountId === 'string' && CLAUDE_ACCOUNT_ID_PATTERN.test(raw.claudeAccountId)) {
        config.claudeAccountId = raw.claudeAccountId
    }
    if (typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt)) {
        config.savedAt = raw.savedAt
    }

    return Object.keys(config).length > 0 ? config : null
}

export function loadLastSessionConfig(): LastSessionConfig | null {
    try {
        const stored = localStorage.getItem(LAST_CONFIG_STORAGE_KEY)
        if (!stored) return null
        return sanitizeLastSessionConfig(JSON.parse(stored))
    } catch {
        return null
    }
}

export function saveLastSessionConfig(config: LastSessionConfig): void {
    try {
        localStorage.setItem(LAST_CONFIG_STORAGE_KEY, JSON.stringify(config))
    } catch {
        // Ignore storage errors
    }
}

/** The model settings of a config, as the hub stores them. An empty account means the machine default. */
export function toNewSessionDefaults(config: LastSessionConfig): Omit<NewSessionDefaults, 'updatedAt'> {
    return {
        agent: config.agent,
        model: config.model,
        customModel: config.customModel ?? '',
        thinkEffort: config.thinkEffort,
        serviceTier: config.serviceTier,
        yoloMode: config.yoloMode,
        claudeAccountId: config.claudeAccountId ?? ''
    }
}

/**
 * The newer of this browser's last config and the copy shared through the hub (which also follows
 * model switches made inside a chat). Only the model settings are shared; session type, worktree
 * name and preview URL stay with the browser.
 */
/** The remembered Claude account, when it is still enabled on the machine; otherwise the machine login. */
export function rememberedAccountSelection(
    pool: ClaudeAccountPool | undefined,
    accountId: string | undefined
): ClaudeAccountSelection | undefined {
    if (!pool || !accountId) return undefined
    return pool.profiles.some((profile) => profile.enabled && profile.id === accountId)
        ? { accountId, automatic: pool.autoSwitch }
        : undefined
}

export function pickRememberedConfig(
    local: LastSessionConfig | null,
    shared: NewSessionDefaults | null | undefined
): LastSessionConfig | null {
    if (!shared) return local
    if (local?.savedAt !== undefined && local.savedAt > shared.updatedAt) return local

    const fromHub = sanitizeLastSessionConfig(shared) ?? {}
    const merged: LastSessionConfig = { ...local }
    for (const key of SHARED_CONFIG_KEYS) {
        if (shared[key] === undefined) continue
        if (key === 'claudeAccountId' && shared.claudeAccountId === '') {
            delete merged.claudeAccountId
            continue
        }
        if (fromHub[key] !== undefined) {
            (merged as Record<string, unknown>)[key] = fromHub[key]
        }
    }
    merged.savedAt = shared.updatedAt
    return merged
}

export function getDefaultThinkEffort(agent: AgentType): ThinkEffort {
    return getThinkEffortOptions(agent)[0]?.value ?? 'auto'
}

export type SessionModelParams = {
    model: string
    customModel: string
    thinkEffort: ThinkEffort
    serviceTier: ServiceTier
}

/**
 * Model, thinking and tier to start `agent` with: the remembered choice when it was made for this
 * agent, otherwise what this browser last used with the agent.
 */
export function resolveSessionModelParams(agent: AgentType, remembered: LastSessionConfig | null): SessionModelParams {
    const own = remembered?.agent === agent ? remembered : null
    const modelOptions = getModelOptionsForAgent(agent)
    const isListed = (value: string | undefined): value is string =>
        Boolean(value) && modelOptions.some((option) => option.value === value)
    const thinkOptions = getThinkEffortOptions(agent)

    if (!own) {
        return {
            model: loadPreferredModel(agent) ?? modelOptions[0]?.value ?? 'auto',
            customModel: loadPreferredCustomModel(agent),
            thinkEffort: loadPreferredThinkEffort(agent) ?? getDefaultThinkEffort(agent),
            serviceTier: loadPreferredServiceTier(agent) ?? 'auto'
        }
    }

    // A model switched to in a chat that the form does not list is kept as a custom model.
    const unlistedModel = own.model && !isListed(own.model) && modelOptions.length > 0 ? own.model : ''
    return {
        model: isListed(own.model) ? own.model : (loadPreferredModel(agent) ?? modelOptions[0]?.value ?? 'auto'),
        customModel: own.customModel?.trim() || unlistedModel,
        thinkEffort: own.thinkEffort && thinkOptions.some((option) => option.value === own.thinkEffort)
            ? own.thinkEffort
            : (loadPreferredThinkEffort(agent) ?? getDefaultThinkEffort(agent)),
        serviceTier: own.serviceTier ?? loadPreferredServiceTier(agent) ?? 'auto'
    }
}
