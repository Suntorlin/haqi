import { memo } from 'react'
import type { AgentReasoningBlock } from '@/chat/types'

export const CliReasoningBlock = memo(function CliReasoningBlock(props: { block: AgentReasoningBlock }) {
    return (
        <details className="py-0.5 group">
            <summary className="text-[var(--social-fg-muted)] italic text-xs cursor-pointer select-none hover:text-[var(--social-fg)] transition-colors">
                thinking…
            </summary>
            <div className="text-[var(--social-fg-muted)] italic text-xs pl-4 border-l border-[var(--social-divider)] mt-1 whitespace-pre-wrap break-words">
                {props.block.text}
            </div>
        </details>
    )
})
