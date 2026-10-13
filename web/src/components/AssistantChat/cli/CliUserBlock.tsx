import { memo } from 'react'
import type { UserTextBlock } from '@/chat/types'

export const CliUserBlock = memo(function CliUserBlock(props: { block: UserTextBlock }) {
    const { block } = props
    return (
        <div className="border-l-2 border-[var(--cli-prompt-color)] pl-3 py-1">
            <span className="text-[var(--cli-prompt-color)] mr-2 select-none">{'❯'}</span>
            <span className="text-[var(--social-fg)] whitespace-pre-wrap break-words">{block.text}</span>
            {block.attachments && block.attachments.length > 0 && (
                <span className="ml-2 text-[var(--social-fg-muted)] text-xs">
                    {block.attachments.map((a, i) => (
                        <span key={i} className="ml-1">[{a.filename ?? 'file'}]</span>
                    ))}
                </span>
            )}
        </div>
    )
})
