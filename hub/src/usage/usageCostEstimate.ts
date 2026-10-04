import type {
    UsageModelOverview,
    UsageOverview,
    UsageProviderOverview,
    UsageTotals
} from './usageScanner'

const TOKENS_PER_MILLION = 1_000_000
const PRICING_CACHE_TTL_MS = 10 * 60 * 1000
const LITELLM_PRICING_URL =
    'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const DEFAULT_USD_PER_MILLION_TOKENS: Record<'claude' | 'codex', number> = {
    claude: 5,
    codex: 5
}

const RATE_ENV_NAMES: Record<'claude' | 'codex', string> = {
    claude: 'HAPI_USAGE_ESTIMATE_CLAUDE_USD_PER_MTOK',
    codex: 'HAPI_USAGE_ESTIMATE_CODEX_USD_PER_MTOK'
}

const MODEL_ENV_NAMES: Record<'claude' | 'codex', string> = {
    claude: 'HAPI_USAGE_ESTIMATE_CLAUDE_MODEL',
    codex: 'HAPI_USAGE_ESTIMATE_CODEX_MODEL'
}

const DEFAULT_MODEL_CANDIDATES: Record<'claude' | 'codex', string[]> = {
    claude: ['claude-sonnet-4-20250514', 'claude-sonnet-4', 'claude-3-7-sonnet'],
    codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.6', 'gpt-5.5', 'gpt-5.4', 'gpt-5-codex', 'gpt-5.1-codex', 'gpt-5', 'gpt-4.1']
}

const MODEL_PROVIDER_PREFIXES: Record<'claude' | 'codex', string[]> = {
    claude: ['anthropic/', 'openrouter/anthropic/', 'openrouter/'],
    codex: ['openai/', 'azure/', 'openrouter/openai/', 'openrouter/']
}

type LiteLLMModelPricing = {
    input_cost_per_token?: number
    output_cost_per_token?: number
    cache_creation_input_token_cost?: number
    cache_read_input_token_cost?: number
}

type TokenRates = {
    inputCostPerToken: number
    outputCostPerToken: number
    cacheCreationCostPerToken: number
    cacheReadCostPerToken: number
}

type LiteLLMPricingDataset = {
    fetchedAt: number
    value: Record<string, LiteLLMModelPricing>
}

type MatchedModelPricing = {
    model: string
    rates: TokenRates
}

export type UsageCostEstimate = {
    currency: 'USD'
    unit: 'usd_per_million_tokens'
    usdPerMillionTokens: number
    allTimeUsd: number
    last30DaysUsd: number
    approximate: true
    rateSource: 'litelm' | 'env' | 'default'
    pricingModel?: string
    pricingFetchedAt?: number
}

export type UsageOverviewWithCostEstimate = Omit<UsageOverview, 'claude' | 'codex'> & {
    claude: UsageProviderOverview & { estimatedCost: UsageCostEstimate }
    codex: UsageProviderOverview & { estimatedCost: UsageCostEstimate }
}

let cachedPricingDataset: {
    expiresAt: number
    fetchedAt: number
    value: Record<string, LiteLLMModelPricing>
} | null = null

let inFlightPricingDataset: Promise<LiteLLMPricingDataset | null> | null = null

function createEmptyTotals(): UsageTotals {
    return {
        inputTokens: 0,
        cachedInputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0
    }
}

function addTotals(target: UsageTotals, delta: UsageTotals): void {
    target.inputTokens += delta.inputTokens
    target.cachedInputTokens += delta.cachedInputTokens
    target.cacheReadTokens += delta.cacheReadTokens
    target.cacheCreationTokens += delta.cacheCreationTokens
    target.outputTokens += delta.outputTokens
    target.reasoningOutputTokens += delta.reasoningOutputTokens
    target.totalTokens += delta.totalTokens
}

function parseUsdPerMillionTokens(raw: string | undefined): number | null {
    if (!raw) {
        return null
    }

    const value = Number(raw.trim())
    if (!Number.isFinite(value) || value <= 0) {
        return null
    }

    return value
}

function toPositiveNumber(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return null
    }
    return value
}

function createUniformTokenRates(usdPerMillionTokens: number): TokenRates {
    const perToken = usdPerMillionTokens / TOKENS_PER_MILLION
    return {
        inputCostPerToken: perToken,
        outputCostPerToken: perToken,
        cacheCreationCostPerToken: perToken,
        cacheReadCostPerToken: perToken
    }
}

function createTokenRatesFromLiteLLMPricing(pricing: LiteLLMModelPricing): TokenRates | null {
    const inputCost = toPositiveNumber(pricing.input_cost_per_token)
    const outputCost = toPositiveNumber(pricing.output_cost_per_token) ?? inputCost
    const cacheCreationCost = toPositiveNumber(pricing.cache_creation_input_token_cost) ?? inputCost
    const cacheReadCost = toPositiveNumber(pricing.cache_read_input_token_cost) ?? inputCost

    if (inputCost == null && outputCost == null && cacheCreationCost == null && cacheReadCost == null) {
        return null
    }

    const fallback = inputCost ?? outputCost ?? cacheCreationCost ?? cacheReadCost ?? 0
    return {
        inputCostPerToken: inputCost ?? fallback,
        outputCostPerToken: outputCost ?? fallback,
        cacheCreationCostPerToken: cacheCreationCost ?? fallback,
        cacheReadCostPerToken: cacheReadCost ?? fallback
    }
}

async function fetchPricingDatasetFromLiteLLM(): Promise<LiteLLMPricingDataset | null> {
    const now = Date.now()
    if (cachedPricingDataset && cachedPricingDataset.expiresAt > now) {
        return {
            fetchedAt: cachedPricingDataset.fetchedAt,
            value: cachedPricingDataset.value
        }
    }

    if (inFlightPricingDataset) {
        return await inFlightPricingDataset
    }

    inFlightPricingDataset = (async () => {
        try {
            const response = await fetch(LITELLM_PRICING_URL)
            if (!response.ok) {
                throw new Error(`LiteLLM pricing fetch failed: ${response.status}`)
            }

            const raw = await response.json()
            if (!raw || typeof raw !== 'object') {
                throw new Error('LiteLLM pricing payload is not an object')
            }

            const value: Record<string, LiteLLMModelPricing> = {}
            for (const [key, entry] of Object.entries(raw as Record<string, unknown>)) {
                if (!entry || typeof entry !== 'object') {
                    continue
                }
                value[key] = entry as LiteLLMModelPricing
            }

            const fetchedAt = Date.now()
            cachedPricingDataset = {
                value,
                fetchedAt,
                expiresAt: fetchedAt + PRICING_CACHE_TTL_MS
            }

            return { fetchedAt, value }
        } catch {
            if (cachedPricingDataset) {
                return {
                    fetchedAt: cachedPricingDataset.fetchedAt,
                    value: cachedPricingDataset.value
                }
            }
            return null
        } finally {
            inFlightPricingDataset = null
        }
    })()

    return await inFlightPricingDataset
}

function normalizeModelName(model: string): string {
    return model.trim().toLowerCase()
}

function buildModelCandidates(provider: 'claude' | 'codex', modelName: string): string[] {
    const base = modelName.trim()
    if (base.length === 0) {
        return []
    }

    const candidates = new Set<string>()
    candidates.add(base)
    candidates.add(base.toLowerCase())

    for (const prefix of MODEL_PROVIDER_PREFIXES[provider]) {
        candidates.add(`${prefix}${base}`)
        candidates.add(`${prefix}${base.toLowerCase()}`)
    }

    if (base.includes('/')) {
        const tail = base.split('/').pop()
        if (tail) {
            candidates.add(tail)
            candidates.add(tail.toLowerCase())
        }
    }

    return Array.from(candidates)
}

function findModelPricing(
    provider: 'claude' | 'codex',
    dataset: Record<string, LiteLLMModelPricing>,
    modelName: string
): MatchedModelPricing | null {
    const candidates = buildModelCandidates(provider, modelName)
    if (candidates.length === 0) {
        return null
    }

    for (const candidate of candidates) {
        const exact = dataset[candidate]
        if (!exact) {
            continue
        }
        const rates = createTokenRatesFromLiteLLMPricing(exact)
        if (rates) {
            return { model: candidate, rates }
        }
    }

    const entries = Object.entries(dataset)
    for (const candidate of candidates) {
        const normalizedCandidate = normalizeModelName(candidate)
        const matched = entries.find(([model]) => {
            const normalizedModel = normalizeModelName(model)
            return normalizedModel === normalizedCandidate
                || normalizedModel.endsWith(`/${normalizedCandidate}`)
                || normalizedModel.includes(normalizedCandidate)
                || normalizedCandidate.includes(normalizedModel)
        })

        if (!matched) {
            continue
        }

        const rates = createTokenRatesFromLiteLLMPricing(matched[1])
        if (!rates) {
            continue
        }

        return {
            model: matched[0],
            rates
        }
    }

    return null
}

function calculateCachedInputTokens(totals: UsageTotals): number {
    const inputTokens = Math.max(totals.inputTokens, 0)
    const cachedInputTokens = Math.max(totals.cachedInputTokens, totals.cacheReadTokens, 0)
    return Math.min(cachedInputTokens, inputTokens)
}

function calculateUsd(totals: UsageTotals, rates: TokenRates): number {
    const inputTokens = Math.max(totals.inputTokens, 0)
    const cachedInputTokens = calculateCachedInputTokens(totals)
    const nonCachedInputTokens = Math.max(inputTokens - cachedInputTokens, 0)
    const outputTokens = Math.max(totals.outputTokens, 0)
    const cacheCreationTokens = Math.max(totals.cacheCreationTokens, 0)

    return (nonCachedInputTokens * rates.inputCostPerToken)
        + (cachedInputTokens * rates.cacheReadCostPerToken)
        + (outputTokens * rates.outputCostPerToken)
        + (cacheCreationTokens * rates.cacheCreationCostPerToken)
}

function calculateEffectiveUsdPerMillionTokens(totalTokens: number, usd: number): number {
    if (!Number.isFinite(totalTokens) || totalTokens <= 0) {
        return 0
    }
    return (usd / totalTokens) * TOKENS_PER_MILLION
}

function buildEstimateFromRates(
    provider: UsageProviderOverview,
    rates: TokenRates,
    rateSource: 'litelm' | 'env' | 'default',
    pricingModel?: string,
    pricingFetchedAt?: number
): UsageCostEstimate {
    const allTimeUsd = calculateUsd(provider.allTime, rates)
    const last30DaysUsd = calculateUsd(provider.last30Days, rates)
    const usdPerMillionTokens = calculateEffectiveUsdPerMillionTokens(
        provider.allTime.totalTokens,
        allTimeUsd
    )

    return {
        currency: 'USD',
        unit: 'usd_per_million_tokens',
        usdPerMillionTokens,
        allTimeUsd,
        last30DaysUsd,
        approximate: true,
        rateSource,
        pricingModel,
        pricingFetchedAt
    }
}

function buildEstimateFromModelBreakdown(
    provider: UsageProviderOverview,
    matched: Array<{ usage: UsageModelOverview; pricing: MatchedModelPricing }>,
    unmatchedAllTime: UsageTotals,
    unmatchedLast30Days: UsageTotals,
    fallbackRates: TokenRates,
    pricingFetchedAt: number
): UsageCostEstimate {
    let allTimeUsd = 0
    let last30DaysUsd = 0
    const matchedModelSet = new Set<string>()

    for (const entry of matched) {
        allTimeUsd += calculateUsd(entry.usage.allTime, entry.pricing.rates)
        last30DaysUsd += calculateUsd(entry.usage.last30Days, entry.pricing.rates)
        matchedModelSet.add(entry.pricing.model)
    }

    if (unmatchedAllTime.totalTokens > 0 || unmatchedLast30Days.totalTokens > 0) {
        allTimeUsd += calculateUsd(unmatchedAllTime, fallbackRates)
        last30DaysUsd += calculateUsd(unmatchedLast30Days, fallbackRates)
    }

    const usdPerMillionTokens = calculateEffectiveUsdPerMillionTokens(
        provider.allTime.totalTokens,
        allTimeUsd
    )

    const matchedModels = Array.from(matchedModelSet)
    const pricingModel = matchedModels.length === 0
        ? undefined
        : matchedModels.length === 1
            ? matchedModels[0]
            : `mixed(${matchedModels.length})`

    return {
        currency: 'USD',
        unit: 'usd_per_million_tokens',
        usdPerMillionTokens,
        allTimeUsd,
        last30DaysUsd,
        approximate: true,
        rateSource: 'litelm',
        pricingModel,
        pricingFetchedAt
    }
}

async function resolveFallbackRates(
    provider: 'claude' | 'codex',
    dataset: LiteLLMPricingDataset | null
): Promise<{ rates: TokenRates; pricingModel?: string }> {
    const preferredModel = process.env[MODEL_ENV_NAMES[provider]]?.trim()
    const candidates = preferredModel ? [preferredModel] : DEFAULT_MODEL_CANDIDATES[provider]

    if (dataset) {
        for (const candidate of candidates) {
            const matched = findModelPricing(provider, dataset.value, candidate)
            if (matched) {
                return {
                    rates: matched.rates,
                    pricingModel: matched.model
                }
            }
        }
    }

    return {
        rates: createUniformTokenRates(DEFAULT_USD_PER_MILLION_TOKENS[provider])
    }
}

function normalizeProviderModels(provider: UsageProviderOverview): UsageModelOverview[] {
    if (provider.models.length > 0) {
        return provider.models
    }

    return [
        {
            model: 'unknown',
            eventCount: provider.eventCount,
            last30DaysEventCount: provider.last30DaysEventCount,
            allTime: provider.allTime,
            last30Days: provider.last30Days
        }
    ]
}

export async function estimateProviderCost(provider: UsageProviderOverview): Promise<UsageCostEstimate> {
    const envRate = parseUsdPerMillionTokens(process.env[RATE_ENV_NAMES[provider.provider]])
    if (envRate != null) {
        return buildEstimateFromRates(
            provider,
            createUniformTokenRates(envRate),
            'env'
        )
    }

    const dataset = await fetchPricingDatasetFromLiteLLM()
    if (!dataset) {
        return buildEstimateFromRates(
            provider,
            createUniformTokenRates(DEFAULT_USD_PER_MILLION_TOKENS[provider.provider]),
            'default'
        )
    }

    const models = normalizeProviderModels(provider)
    const matched: Array<{ usage: UsageModelOverview; pricing: MatchedModelPricing }> = []
    const unmatchedAllTime = createEmptyTotals()
    const unmatchedLast30Days = createEmptyTotals()

    for (const modelUsage of models) {
        const modelPricing = findModelPricing(provider.provider, dataset.value, modelUsage.model)
        if (!modelPricing) {
            addTotals(unmatchedAllTime, modelUsage.allTime)
            addTotals(unmatchedLast30Days, modelUsage.last30Days)
            continue
        }
        matched.push({
            usage: modelUsage,
            pricing: modelPricing
        })
    }

    if (matched.length === 0) {
        const fallback = await resolveFallbackRates(provider.provider, dataset)
        return buildEstimateFromRates(
            provider,
            fallback.rates,
            'litelm',
            fallback.pricingModel,
            dataset.fetchedAt
        )
    }

    const fallback = await resolveFallbackRates(provider.provider, dataset)
    return buildEstimateFromModelBreakdown(
        provider,
        matched,
        unmatchedAllTime,
        unmatchedLast30Days,
        fallback.rates,
        dataset.fetchedAt
    )
}

export async function withUsageCostEstimate(overview: UsageOverview): Promise<UsageOverviewWithCostEstimate> {
    const [claudeCost, codexCost] = await Promise.all([
        estimateProviderCost(overview.claude),
        estimateProviderCost(overview.codex)
    ])

    return {
        ...overview,
        claude: {
            ...overview.claude,
            estimatedCost: claudeCost
        },
        codex: {
            ...overview.codex,
            estimatedCost: codexCost
        }
    }
}
