import { memo, useState } from 'react'
import type { ToolCallBlock } from '@/chat/types'
import { Spinner } from '@/components/Spinner'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { FitText } from '@/components/ui/FitText'
import { useTranslation } from '@/lib/use-translation'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { isObject } from '@hapi/protocol'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import { CliBlockRenderer } from './CliBlockRenderer'
import { CliPermission, CliAskUserQuestion, CliRequestUserInput } from './CliPermissionFooter'
import { TEXT_HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { cn } from '@/lib/utils'

/** CLI-style prefix character by tool category */
function getToolPrefix(toolName: string): string {
    const name = toolName.toLowerCase()
    if (name === 'bash' || name === 'execute' || name.includes('shell') || name.includes('terminal')) return '$'
    if (name === 'read' || name === 'glob' || name === 'grep' || name === 'ls') return '→'
    if (name === 'write' || name === 'edit' || name === 'multiedit' || name === 'notebook_edit' || name.includes('patch')) return '←'
    if (name === 'webfetch' || name === 'websearch') return '◎'
    if (name === 'task' || name === 'sendmessage' || name === 'teamcreate') return '▸'
    if (name.startsWith('mcp__')) return '⚡'
    return '•'
}

function extractResultText(result: unknown, depth = 0): string | null {
    if (depth > 2) return null
    if (result === null || result === undefined) return null
    if (typeof result === 'string') return result

    if (Array.isArray(result)) {
        const parts = result
            .map(item => {
                if (typeof item === 'string') return item
                if (isObject(item) && typeof item.text === 'string') return item.text
                return null
            })
            .filter((p): p is string => p !== null && p.length > 0)
        return parts.length > 0 ? parts.join('\n') : null
    }

    if (!isObject(result)) return null
    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text
    if (typeof result.output === 'string') return result.output
    if (typeof result.error === 'string') return result.error
    if (typeof result.message === 'string') return result.message

    if (Array.isArray(result.content)) {
        return extractResultText(result.content, depth + 1)
    }
    if (isObject(result.result)) {
        return extractResultText(result.result, depth + 1)
    }
    return null
}

const MAX_RESULT_LINES = 20

function truncateResult(text: string): { text: string; truncated: boolean } {
    const lines = text.split('\n')
    if (lines.length <= MAX_RESULT_LINES) return { text, truncated: false }
    return {
        text: lines.slice(0, MAX_RESULT_LINES).join('\n'),
        truncated: true
    }
}

function ResultPanel(props: {
    resultText: string
    expanded: boolean
    isError: boolean
    onExpand: () => void
}) {
    const { resultText, expanded, isError, onExpand } = props
    const { text: truncatedText, truncated } = truncateResult(resultText)
    const displayText = expanded ? resultText : truncatedText

    return (
        <div className="ml-5 mt-0.5 border-l border-[var(--social-divider)] pl-3 text-xs text-[var(--social-fg-muted)]">
            <pre className="whitespace-pre-wrap break-words leading-relaxed">
                {displayText}
            </pre>
            {truncated && !expanded && (
                <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onExpand() }}
                    className={cn('mt-0.5 text-[var(--social-fg)] hover:underline', TEXT_HIT_AREA_CLASS)}
                >
                    show more…
                </button>
            )}
            {isError && (
                <div className="text-[var(--app-badge-error-text)] mt-0.5">
                    error
                </div>
            )}
        </div>
    )
}

export const CliToolBlock = memo(function CliToolBlock(props: { block: ToolCallBlock }) {
    const { block } = props
    const ctx = useOptionalHappyChatContext()
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const isRunning = block.tool.state === 'running'
    const isError = block.tool.state === 'error'
    const isPending = block.tool.state === 'pending'

    const pres = getToolPresentation({
        t,
        toolName: block.tool.name,
        input: block.tool.input,
        result: block.tool.result,
        description: block.tool.description,
        childrenCount: block.children.length,
        metadata: ctx?.metadata ?? null,
    })

    const prefix = getToolPrefix(block.tool.name)
    const resultText = block.tool.result != null ? extractResultText(block.tool.result) : null
    const hasResult = resultText !== null && resultText.length > 0
    const showResult = expanded || isRunning || isError

    const stateColor = isError
        ? 'text-[var(--app-badge-error-text)]'
        : isPending
            ? 'text-[var(--app-badge-warning-text)]'
            : isRunning
                ? 'text-[var(--social-fg-muted)]'
                : 'text-[var(--social-fg-muted)] opacity-60'

    return (
        <div className="py-0.5">
            {/* Inline one-liner */}
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className={cn('flex w-full items-center gap-1.5 rounded-md px-1 -mx-1 text-left text-xs transition-colors', TEXT_HIT_AREA_CLASS, hasResult ? 'cursor-pointer hover:bg-[var(--social-hover)]' : 'cursor-default')}
            >
                {/* Status indicator */}
                <span className={`shrink-0 w-3.5 text-center ${stateColor}`}>
                    {isRunning ? (
                        <Spinner size="xs" label={null} />
                    ) : isError ? (
                        '✗'
                    ) : isPending ? (
                        '○'
                    ) : (
                        '✓'
                    )}
                </span>

                {/* Tool prefix */}
                <span className="shrink-0 text-[var(--cli-tool-icon-color)]">{prefix}</span>

                {/* Title */}
                <span className={`shrink-0 ${isRunning ? 'text-[var(--social-fg)]' : 'text-[var(--social-fg-muted)]'}`}>
                    {pres.title}
                </span>

                {/* Subtitle / key param */}
                {pres.subtitle && (
                    <FitText kind="preview" lines={1} text={pres.subtitle} className="flex-1 text-[var(--social-fg-muted)] opacity-70" />
                )}

                {/* Duration */}
                {block.tool.completedAt && block.tool.startedAt && (
                    <span className="ml-auto shrink-0 text-[var(--social-fg-muted)] opacity-50">
                        {((block.tool.completedAt - block.tool.startedAt) / 1000).toFixed(1)}s
                    </span>
                )}
            </button>

            {/* Result panel */}
            {showResult && hasResult && (
                <ResultPanel
                    resultText={resultText}
                    expanded={expanded}
                    isError={isError}
                    onExpand={() => setExpanded(true)}
                />
            )}

            {/* Nested children (sub-tasks, sub-tools) */}
            {block.children.length > 0 && (
                <div className="ml-5 border-l border-[var(--social-divider)] pl-2">
                    {block.children.map(child => (
                        <CliBlockRenderer key={child.id} block={child} />
                    ))}
                </div>
            )}

            {/* CLI-style permission / question footers */}
            {isAskUserQuestionToolName(block.tool.name) && block.tool.permission?.status === 'pending' ? (
                <CliAskUserQuestion tool={block.tool} disabled={ctx?.disabled ?? false} />
            ) : isRequestUserInputToolName(block.tool.name) && block.tool.permission?.status === 'pending' ? (
                <CliRequestUserInput tool={block.tool} disabled={ctx?.disabled ?? false} />
            ) : block.tool.permission?.status === 'pending' ? (
                <CliPermission tool={block.tool} disabled={ctx?.disabled ?? false} />
            ) : block.tool.permission && (block.tool.permission.status === 'denied' || block.tool.permission.status === 'canceled') && block.tool.permission.reason ? (
                <div className="ml-5 text-xs text-[var(--social-danger)] italic">denied: {block.tool.permission.reason}</div>
            ) : null}
        </div>
    )
})
