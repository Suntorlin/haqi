import { describe, expect, it } from 'vitest'
import { isSkippableAgentContent, normalizeAgentRecord } from './normalizeAgent'

describe('normalizeAgentRecord codex token_count usage', () => {
    it('extracts usage from snake_case last_token_usage payload', () => {
        const normalized = normalizeAgentRecord(
            'message-1',
            null,
            1_700_000_000_000,
            {
                type: 'codex',
                data: {
                    type: 'token_count',
                    info: {
                        last_token_usage: {
                            input_tokens: 100_000,
                            output_tokens: 800,
                            cached_input_tokens: 12_000
                        }
                    }
                }
            }
        )

        expect(normalized).toMatchObject({
            role: 'agent',
            usage: {
                input_tokens: 100_000,
                output_tokens: 800,
                cache_read_input_tokens: 12_000
            }
        })
        expect(normalized?.role === 'agent' ? normalized.content : null).toEqual([])
    })

    it('extracts usage from camelCase token usage payload', () => {
        const normalized = normalizeAgentRecord(
            'message-2',
            null,
            1_700_000_000_001,
            {
                type: 'codex',
                data: {
                    type: 'token_count',
                    info: {
                        lastTokenUsage: {
                            inputTokens: 88_000,
                            outputTokens: 640,
                            cacheReadInputTokens: 4_000,
                            serviceTier: 'default'
                        }
                    }
                }
            }
        )

        expect(normalized).toMatchObject({
            role: 'agent',
            usage: {
                input_tokens: 88_000,
                output_tokens: 640,
                cache_read_input_tokens: 4_000,
                service_tier: 'default'
            }
        })
    })

    it('returns null when token_count payload has no usable usage', () => {
        const normalized = normalizeAgentRecord(
            'message-3',
            null,
            1_700_000_000_002,
            {
                type: 'codex',
                data: {
                    type: 'token_count',
                    info: {}
                }
            }
        )

        expect(normalized).toBeNull()
    })

    it('extracts usage from total_token_usage payload', () => {
        const normalized = normalizeAgentRecord(
            'message-4',
            null,
            1_700_000_000_003,
            {
                type: 'codex',
                data: {
                    type: 'token_count',
                    info: {
                        total_token_usage: {
                            input_tokens: 120_000,
                            output_tokens: 2_000,
                            cached_input_tokens: 20_000
                        }
                    }
                }
            }
        )

        expect(normalized).toMatchObject({
            role: 'agent',
            usage: {
                input_tokens: 120_000,
                output_tokens: 2_000,
                cache_read_input_tokens: 20_000
            }
        })
    })

    it('extracts usage from info.last payload', () => {
        const normalized = normalizeAgentRecord(
            'message-5',
            null,
            1_700_000_000_004,
            {
                type: 'codex',
                data: {
                    type: 'token_count',
                    info: {
                        total: {
                            inputTokens: 900_000,
                            outputTokens: 2_000
                        },
                        last: {
                            inputTokens: 110_000,
                            outputTokens: 1_000,
                            cachedInputTokens: 30_000
                        },
                        modelContextWindow: 258_400
                    }
                }
            }
        )

        expect(normalized).toMatchObject({
            role: 'agent',
            usage: {
                input_tokens: 110_000,
                output_tokens: 1_000,
                cache_read_input_tokens: 30_000,
                context_window_tokens: 258_400
            }
        })
    })
})

describe('normalizeAgentRecord rate_limit_event', () => {
    it('returns null for allowed rate limit events', () => {
        const normalized = normalizeAgentRecord(
            'msg-rl-1',
            null,
            1_700_000_000_000,
            {
                type: 'output',
                data: {
                    type: 'rate_limit_event',
                    rate_limit_info: {
                        status: 'allowed',
                        resetsAt: 1773655200,
                        rateLimitType: 'five_hour'
                    }
                }
            }
        )
        expect(normalized).toBeNull()
    })

    it('returns event for non-allowed rate limit events', () => {
        const normalized = normalizeAgentRecord(
            'msg-rl-2',
            null,
            1_700_000_000_001,
            {
                type: 'output',
                data: {
                    type: 'rate_limit_event',
                    rate_limit_info: {
                        status: 'rate_limited',
                        resetsAt: 1773655200,
                        rateLimitType: 'five_hour'
                    }
                }
            }
        )
        expect(normalized).toMatchObject({
            role: 'event',
            content: {
                type: 'rate-limit',
                status: 'rate_limited',
                resetsAt: 1773655200,
                rateLimitType: 'five_hour'
            }
        })
    })
})

describe('skill body messages', () => {
    const skillBody = (extra: Record<string, unknown> = {}) => ({
        type: 'output',
        data: {
            type: 'user',
            message: {
                role: 'user',
                content: [{ type: 'text', text: 'Base directory for this skill: /x/skills/ping\n\n# Ping' }]
            },
            ...extra
        }
    })

    it('hides a skill body stored without any flag', () => {
        expect(isSkippableAgentContent(skillBody())).toBe(true)
        expect(normalizeAgentRecord('m1', null, 1, skillBody())).toBeNull()
    })

    it('hides an isSynthetic user message', () => {
        const content = {
            type: 'output',
            data: { type: 'user', isSynthetic: true, message: { role: 'user', content: [{ type: 'text', text: 'x' }] } }
        }
        expect(isSkippableAgentContent(content)).toBe(true)
    })

    it('keeps a normal user text message', () => {
        const content = {
            type: 'output',
            data: { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hello' }] } }
        }
        expect(isSkippableAgentContent(content)).toBe(false)
    })
})
