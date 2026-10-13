import { memo } from 'react'
import type { AgentEventBlock } from '@/chat/types'
import type { AgentEvent } from '@/chat/types'

function formatEventLine(event: AgentEvent): string | null {
    switch (event.type) {
        case 'turn-duration': {
            const ms = (event as { durationMs: number }).durationMs
            const seconds = (ms / 1000).toFixed(1)
            return `completed in ${seconds}s`
        }
        case 'rate-limit': {
            const e = event as { status: string; rateLimitType: string }
            return `rate limited (${e.rateLimitType}): ${e.status}`
        }
        case 'limit-reached':
            return 'context limit reached'
        case 'api-error': {
            const e = event as { retryAttempt: number; maxRetries: number }
            return `api error, retry ${e.retryAttempt}/${e.maxRetries}`
        }
        case 'compact': {
            const e = event as { trigger: string; preTokens: number }
            return `compacted context (${e.trigger}, ${e.preTokens} tokens)`
        }
        case 'microcompact': {
            const e = event as { tokensSaved: number }
            return `micro-compacted (saved ${e.tokensSaved} tokens)`
        }
        case 'ready':
        case 'title-changed':
        case 'switch':
        case 'message':
            return null
        default:
            return null
    }
}

export const CliEventBlock = memo(function CliEventBlock(props: { block: AgentEventBlock }) {
    const line = formatEventLine(props.block.event)
    if (!line) return null

    const isWarning = props.block.event.type === 'rate-limit'
        || props.block.event.type === 'limit-reached'
        || props.block.event.type === 'api-error'

    return (
        <div className={`text-xs py-0.5 italic ${isWarning ? 'text-[var(--app-badge-warning-text)]' : 'text-[var(--social-fg-muted)]'}`}>
            — {line}
        </div>
    )
})
