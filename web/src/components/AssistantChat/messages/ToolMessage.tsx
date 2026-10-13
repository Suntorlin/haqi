import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type { ChatBlock } from '@/chat/types'
import type { ToolCallBlock } from '@/chat/types'
import { isObject, safeStringify } from '@hapi/protocol'
import { getEventPresentation } from '@/chat/presentation'
import { useTranslation } from '@/lib/use-translation'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { LazyRainbowText } from '@/components/LazyRainbowText'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { ToolCard } from '@/components/ToolCard/ToolCard'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'

function isToolCallBlock(value: unknown): value is ToolCallBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'tool-call') return false
    if (typeof value.id !== 'string') return false
    if (value.localId !== null && typeof value.localId !== 'string') return false
    if (typeof value.createdAt !== 'number') return false
    if (!Array.isArray(value.children)) return false
    if (!isObject(value.tool)) return false
    if (typeof value.tool.name !== 'string') return false
    if (!('input' in value.tool)) return false
    if (value.tool.description !== null && typeof value.tool.description !== 'string') return false
    if (value.tool.state !== 'pending' && value.tool.state !== 'running' && value.tool.state !== 'completed' && value.tool.state !== 'error') return false
    return true
}

function isPendingPermissionBlock(block: ChatBlock): boolean {
    return block.kind === 'tool-call' && block.tool.permission?.status === 'pending'
}

function splitTaskChildren(block: ToolCallBlock): { pending: ChatBlock[]; rest: ChatBlock[] } {
    const pending: ChatBlock[] = []
    const rest: ChatBlock[] = []

    for (const child of block.children) {
        if (isPendingPermissionBlock(child)) {
            pending.push(child)
        } else {
            rest.push(child)
        }
    }

    return { pending, rest }
}

function HappyNestedBlockList(props: {
    blocks: ChatBlock[]
    density: SessionListDensity
}) {
    const { t } = useTranslation()
    const ctx = useHappyChatContext()
    const isCompact = props.density === 'compact'

    return (
        <div className={`flex flex-col ${isCompact ? 'gap-2' : 'gap-3'}`}>
            {props.blocks.map((block) => {
                if (block.kind === 'user-text') {
                    const userBubbleClass = 'ml-auto w-fit min-w-0 max-w-[88%] rounded-xl bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-fg)] shadow-sm sm:max-w-[84%] lg:max-w-[76%]'
                    const status = block.status
                    const canRetry = status === 'failed' && typeof block.localId === 'string' && Boolean(ctx.onRetryMessage)
                    const onRetry = canRetry ? () => ctx.onRetryMessage!(block.localId!) : undefined

                    return (
                        <div key={`user:${block.id}`} className={userBubbleClass}>
                            <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <LazyRainbowText text={block.text} />
                                </div>
                                {status ? (
                                    <div className="shrink-0 self-end pb-0.5">
                                        <MessageStatusIndicator status={status} onRetry={onRetry} />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-text') {
                    return (
                        <div key={`agent:${block.id}`} className="px-1">
                            <MarkdownRenderer content={block.text} />
                        </div>
                    )
                }

                if (block.kind === 'cli-output') {
                    const alignClass = block.source === 'user'
                        ? 'ml-auto w-full max-w-[88%] sm:max-w-[84%] lg:max-w-[76%]'
                        : ''
                    return (
                        <div key={`cli:${block.id}`} className="px-1 min-w-0 max-w-full overflow-x-hidden">
                            <div className={alignClass}>
                                <CliOutputBlock text={block.text} />
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-event') {
                    const presentation = getEventPresentation(block.event, t)
                    return (
                        <div key={`event:${block.id}`} className="py-1">
                            <div className="mx-auto w-fit max-w-[88%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80 sm:max-w-[84%] lg:max-w-[76%]">
                                <span className="inline-flex items-center gap-1">
                                    {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
                                    <span>{presentation.text}</span>
                                </span>
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'tool-call') {
                    const isTask = block.tool.name === 'Task'
                    const isReasoningTool = block.tool.name === 'CodexReasoning'
                    const taskChildren = isTask ? splitTaskChildren(block) : null

                    return (
                        <div key={`tool:${block.id}`} className={isReasoningTool ? 'py-0' : (isCompact ? 'py-0.5' : 'py-1')}>
                            <ToolCard
                                api={ctx.api}
                                sessionId={ctx.sessionId}
                                metadata={ctx.metadata}
                                disabled={ctx.disabled}
                                onDone={ctx.onRefresh}
                                block={block}
                                density={props.density}
                            />
                            {block.children.length > 0 ? (
                                isTask ? (
                                    <>
                                        {taskChildren && taskChildren.pending.length > 0 ? (
                                            <div className={isCompact ? 'mt-1.5 pl-2.5' : 'mt-2 pl-3'}>
                                                <HappyNestedBlockList blocks={taskChildren.pending} density={props.density} />
                                            </div>
                                        ) : null}
                                        {taskChildren && taskChildren.rest.length > 0 ? (
                                            <details className={isCompact ? 'mt-1.5' : 'mt-2'}>
                                                <summary className="cursor-pointer text-xs text-[var(--app-hint)]">
                                                    Task details ({taskChildren.rest.length})
                                                </summary>
                                                <div className={isCompact ? 'mt-1.5 pl-2.5' : 'mt-2 pl-3'}>
                                                    <HappyNestedBlockList blocks={taskChildren.rest} density={props.density} />
                                                </div>
                                            </details>
                                        ) : null}
                                    </>
                                ) : (
                                    <div className={isCompact ? 'mt-1.5 pl-2.5' : 'mt-2 pl-3'}>
                                        <HappyNestedBlockList blocks={block.children} density={props.density} />
                                    </div>
                                )
                            ) : null}
                        </div>
                    )
                }

                return null
            })}
        </div>
    )
}

export function HappyToolMessage(props: ToolCallMessagePartProps) {
    const ctx = useHappyChatContext()
    const artifact = props.artifact
    const isCompact = ctx.density === 'compact'

    if (!isToolCallBlock(artifact)) {
        const argsText = typeof props.argsText === 'string' ? props.argsText.trim() : ''
        const hasArgsText = argsText.length > 0
        const hasResult = props.result !== undefined
        const resultText = hasResult ? safeStringify(props.result) : ''

        return (
            <div className={`${isCompact ? 'py-0.5' : 'py-1'} min-w-0 max-w-full overflow-x-hidden`}>
                <div className={`rounded-xl bg-[var(--app-secondary-bg)] shadow-sm ${isCompact ? 'p-2.5' : 'p-3'}`}>
                    <div className="flex items-center gap-2 text-xs">
                        <div className="font-mono text-[var(--app-hint)]">
                            Tool: {props.toolName}
                        </div>
                        {props.isError ? (
                            <span className="text-[var(--social-danger)]">Error</span>
                        ) : null}
                        {props.status.type === 'running' && !hasResult ? (
                            <span className="text-[var(--app-hint)]">Running…</span>
                        ) : null}
                    </div>

                    {hasArgsText ? (
                        <div className={isCompact ? 'mt-1.5' : 'mt-2'}>
                            <CodeBlock code={argsText} language="json" />
                        </div>
                    ) : null}

                    {hasResult ? (
                        <div className={isCompact ? 'mt-1.5' : 'mt-2'}>
                            <CodeBlock code={resultText} language={typeof props.result === 'string' ? 'text' : 'json'} />
                        </div>
                    ) : null}
                </div>
            </div>
        )
    }

    const block = artifact
    const isTask = block.tool.name === 'Task'
    const isReasoningTool = block.tool.name === 'CodexReasoning'
    const taskChildren = isTask ? splitTaskChildren(block) : null

    return (
        <div className={`${isReasoningTool ? 'py-0' : (isCompact ? 'py-0.5' : 'py-1')} min-w-0 max-w-full overflow-x-hidden`}>
            <ToolCard
                api={ctx.api}
                sessionId={ctx.sessionId}
                metadata={ctx.metadata}
                disabled={ctx.disabled}
                onDone={ctx.onRefresh}
                block={block}
                density={ctx.density}
            />
            {block.children.length > 0 ? (
                isTask ? (
                    <>
                        {taskChildren && taskChildren.pending.length > 0 ? (
                            <div className={isCompact ? 'mt-1.5 pl-2.5' : 'mt-2 pl-3'}>
                                <HappyNestedBlockList blocks={taskChildren.pending} density={ctx.density} />
                            </div>
                        ) : null}
                        {taskChildren && taskChildren.rest.length > 0 ? (
                            <details className={isCompact ? 'mt-1.5' : 'mt-2'}>
                                <summary className="cursor-pointer text-xs text-[var(--app-hint)]">
                                    Task details ({taskChildren.rest.length})
                                </summary>
                                <div className={isCompact ? 'mt-1.5 pl-2.5' : 'mt-2 pl-3'}>
                                    <HappyNestedBlockList blocks={taskChildren.rest} density={ctx.density} />
                                </div>
                            </details>
                        ) : null}
                    </>
                ) : (
                    <div className={isCompact ? 'mt-1.5 pl-2.5' : 'mt-2 pl-3'}>
                        <HappyNestedBlockList blocks={block.children} density={ctx.density} />
                    </div>
                )
            ) : null}
        </div>
    )
}
