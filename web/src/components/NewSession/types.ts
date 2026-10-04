export type AgentType = 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
export type SessionType = 'simple' | 'worktree'
export type ThinkEffort = 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
export type ModelOption = { value: string; label: string }
export type CodexThinkEffort = ThinkEffort
export type ServiceTier = 'auto' | 'fast' | 'flex'

export const CLAUDE_THINK_EFFORT_OPTIONS: { value: ThinkEffort; label: string }[] = [
    { value: 'max', label: 'Max' },
    { value: 'xhigh', label: 'Extra high' },
    { value: 'high', label: 'High' },
    { value: 'auto', label: 'Auto' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
]

export const CODEX_THINK_EFFORT_OPTIONS: { value: ThinkEffort; label: string }[] = [
    { value: 'xhigh', label: 'XHigh' },
    { value: 'auto', label: 'Auto' },
    { value: 'low', label: 'Low' },
    { value: 'medium', label: 'Medium' },
    { value: 'high', label: 'High' },
]

export const CODEX_SERVICE_TIER_OPTIONS: { value: ServiceTier; label: string }[] = [
    { value: 'auto', label: 'Auto' },
    { value: 'fast', label: 'Fast' },
    { value: 'flex', label: 'Flex' },
]

export function getThinkEffortOptions(agent: AgentType): { value: ThinkEffort; label: string }[] {
    if (agent === 'claude') {
        return CLAUDE_THINK_EFFORT_OPTIONS
    }
    if (agent === 'codex') {
        return CODEX_THINK_EFFORT_OPTIONS
    }
    return []
}

export const MODEL_OPTIONS: Record<AgentType, ModelOption[]> = {
    claude: [
        { value: 'auto', label: 'Default (recommended)' },
        { value: 'claude-fable-5', label: 'Fable 5' },
        { value: 'sonnet', label: 'Sonnet (latest)' },
        { value: 'opus', label: 'Opus (latest)' },
        { value: 'haiku', label: 'Haiku (latest)' },
        { value: 'claude-opus-5-5', label: 'Opus 5.5' },
        { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
        { value: 'claude-opus-4-6', label: 'Opus 4.6' },
        { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    ],
    codex: [
        { value: 'auto', label: 'Auto' },
        { value: 'gpt-6-astra', label: 'GPT-6 Astra' },
        { value: 'gpt-6-sol', label: 'GPT-6 Sol' },
        { value: 'gpt-6-luna', label: 'GPT-6 Luna' },
        { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
        { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
        { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
        { value: 'gpt-5.5', label: 'GPT-5.5' },
        { value: 'gpt-5.4', label: 'GPT-5.4' },
        { value: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
        { value: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
        { value: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' },
        { value: 'gpt-5.2', label: 'GPT-5.2' },
        { value: 'gpt-5.1-codex-max', label: 'GPT-5.1 Codex Max' },
        { value: 'gpt-5.1-codex-mini', label: 'GPT-5.1 Codex Mini' },
        { value: 'gpt-5.1-codex', label: 'GPT-5.1 Codex' },
        { value: 'gpt-5.1', label: 'GPT-5.1' },
        { value: 'gpt-5-codex', label: 'GPT-5 Codex' },
        { value: 'gpt-5-codex-mini', label: 'GPT-5 Codex Mini' },
        { value: 'gpt-5', label: 'GPT-5' },
    ],
    cursor: [],
    gemini: [
        { value: 'auto-gemini-3', label: 'Auto (Gemini 3)' },
        { value: 'auto-gemini-2.5', label: 'Auto (Gemini 2.5)' },
        { value: 'manual', label: 'Manual' },
    ],
    opencode: [],
}

function isModelOptionAllowedForAgent(agent: AgentType, value: string): boolean {
    if (agent === 'claude') {
        return value === 'auto' || value === 'sonnet' || value === 'opus' || value === 'haiku'
            || value.startsWith('claude-') || value.startsWith('us.anthropic.') || value.startsWith('global.anthropic.')
    }
    if (agent === 'codex') {
        return value === 'auto' || value.startsWith('gpt-')
    }
    if (agent === 'gemini') {
        return value === 'manual' || value.startsWith('auto-gemini-')
    }
    return true
}

export function getModelOptionsForAgent(agent: AgentType): ModelOption[] {
    const options = MODEL_OPTIONS[agent] ?? []
    const deduped = new Map<string, ModelOption>()
    for (const option of options) {
        if (!isModelOptionAllowedForAgent(agent, option.value)) {
            continue
        }
        if (!deduped.has(option.value)) {
            deduped.set(option.value, option)
        }
    }
    return [...deduped.values()]
}
