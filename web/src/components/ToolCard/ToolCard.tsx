import type { ToolCallBlock } from '@/chat/types'
import { TOOL_PROGRESS_STALE_AFTER_MS, type ToolProgressSignal } from '@/chat/toolProgress'
import type { ApiClient } from '@/api/client'
import type { SessionMetadataSummary } from '@/types/api'
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isObject, safeStringify } from '@hapi/protocol'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { DiffView } from '@/components/DiffView'
import { parseUnifiedDiff } from '@/lib/gitDiff'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { PermissionFooter } from '@/components/ToolCard/PermissionFooter'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { getExitPlanText, isExitPlanToolName } from '@/components/ToolCard/exitPlanMode'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { getToolFullViewComponent, getToolViewComponent } from '@/components/ToolCard/views/_all'
import { getToolResultViewComponent } from '@/components/ToolCard/views/_results'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { usePointerFocusRing } from '@/hooks/usePointerFocusRing'
import { getInputString, getInputStringAny, truncate } from '@/lib/toolInputUtils'
import { cn } from '@/lib/utils'
import { formatRunningAgentNames, formatTaskChildStateSummary, getRunningAgentsForTaskBlock, getTaskChildStateSummary } from '@/components/ToolCard/taskSummary'
import { useTranslation } from '@/lib/use-translation'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'

const ELAPSED_INTERVAL_MS = 1000
const MOBILE_DETAIL_BREAKPOINT_QUERY = '(max-width: 767px)'
const TURN_CHANGES_DETAIL_QUERY_KEY = 'turnChangesToolId'
const DIFF_DETAIL_QUERY_KEY = 'diffToolId'

function readTurnChangesDetailToolId(search: string): string | null {
    const rawValue = new URLSearchParams(search).get(TURN_CHANGES_DETAIL_QUERY_KEY)
    const value = rawValue?.trim() ?? ''
    return value.length > 0 ? value : null
}

function writeTurnChangesDetailToolId(toolId: string | null, mode: 'push' | 'replace'): void {
    if (typeof window === 'undefined') {
        return
    }

    const url = new URL(window.location.href)
    if (toolId) {
        url.searchParams.set(TURN_CHANGES_DETAIL_QUERY_KEY, toolId)
    } else {
        url.searchParams.delete(TURN_CHANGES_DETAIL_QUERY_KEY)
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    if (mode === 'replace') {
        window.history.replaceState(window.history.state, '', nextUrl)
        return
    }

    window.history.pushState(window.history.state, '', nextUrl)
}

function readDiffDetailToolId(search: string): string | null {
    const rawValue = new URLSearchParams(search).get(DIFF_DETAIL_QUERY_KEY)
    const value = rawValue?.trim() ?? ''
    return value.length > 0 ? value : null
}

function writeDiffDetailToolId(toolId: string | null, mode: 'push' | 'replace'): void {
    if (typeof window === 'undefined') {
        return
    }

    const url = new URL(window.location.href)
    if (toolId) {
        url.searchParams.set(DIFF_DETAIL_QUERY_KEY, toolId)
    } else {
        url.searchParams.delete(DIFF_DETAIL_QUERY_KEY)
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    if (mode === 'replace') {
        window.history.replaceState(window.history.state, '', nextUrl)
        return
    }

    window.history.pushState(window.history.state, '', nextUrl)
}

function ElapsedView(props: { from: number; active: boolean; signal?: ToolProgressSignal | null }) {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (!props.active) return
        const id = setInterval(() => setNow(Date.now()), ELAPSED_INTERVAL_MS)
        return () => clearInterval(id)
    }, [props.active])

    if (!props.active) return null

    const elapsed = (now - props.from) / 1000
    if (!Number.isFinite(elapsed)) return null

    // Backend heartbeats (tool_progress) prove the tool is really alive; the
    // local timer alone would keep ticking even if the backend died.
    const signalAgeMs = props.signal ? now - props.signal.at : null
    const stale = signalAgeMs !== null && signalAgeMs > TOOL_PROGRESS_STALE_AFTER_MS

    return (
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[var(--app-hint)]">
            {elapsed.toFixed(1)}s
            {signalAgeMs !== null && !stale && (
                <span
                    className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500"
                    title={`Backend heartbeat ${Math.max(0, Math.round(signalAgeMs / 1000))}s ago`}
                />
            )}
            {stale && (
                <span className="text-amber-500" title="The backend stopped sending tool heartbeats">
                    no signal {Math.round(signalAgeMs! / 1000)}s
                </span>
            )}
        </span>
    )
}

function formatTaskChildLabel(child: ToolCallBlock, metadata: SessionMetadataSummary | null): string {
    const presentation = getToolPresentation({
        toolName: child.tool.name,
        input: child.tool.input,
        result: child.tool.result,
        childrenCount: child.children.length,
        description: child.tool.description,
        metadata
    })

    if (presentation.subtitle) {
        return truncate(`${presentation.title}: ${presentation.subtitle}`, 140)
    }

    return presentation.title
}

function TaskStateIcon(props: { state: ToolCallBlock['tool']['state'] }) {
    if (props.state === 'completed') {
        return <span className="text-emerald-600">✓</span>
    }
    if (props.state === 'error') {
        return <span className="text-red-600">✕</span>
    }
    if (props.state === 'pending') {
        return <span className="text-amber-600">🔐</span>
    }
    return <span className="text-amber-600 animate-pulse">●</span>
}

function getTaskSummaryChildren(block: ToolCallBlock): { visible: ToolCallBlock[]; remaining: number } | null {
    if (block.tool.name !== 'Task') return null

    const children = block.children
        .filter((child): child is ToolCallBlock => child.kind === 'tool-call')
        .filter((child) => child.tool.state === 'pending' || child.tool.state === 'running' || child.tool.state === 'completed' || child.tool.state === 'error')

    if (children.length === 0) return null

    const visible = children.slice(-3)
    return { visible, remaining: children.length - visible.length }
}

function renderTaskSummary(block: ToolCallBlock, metadata: SessionMetadataSummary | null): ReactNode | null {
    const summary = getTaskSummaryChildren(block)
    if (!summary) return null

    const visible = summary.visible
    const remaining = summary.remaining

    return (
        <div className="flex flex-col gap-1 px-1">
            <div className="flex flex-col gap-1">
                {visible.map((child) => (
                    <div key={child.id} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1 font-mono text-xs text-[var(--app-hint)]">
                            <span className="mr-2 inline-block w-4 text-center align-middle">
                                <TaskStateIcon state={child.tool.state} />
                            </span>
                            <span className="align-middle break-all">
                                {formatTaskChildLabel(child, metadata)}
                            </span>
                        </div>
                    </div>
                ))}
                {remaining > 0 ? (
                    <div className="text-xs text-[var(--app-hint)] italic">
                        (+{remaining} more)
                    </div>
                ) : null}
            </div>
        </div>
    )
}

function renderTaskStateBadge(taskStateSummaryText: string | null, runningAgentNames: string | null, toolName: string): ReactNode | null {
    if (toolName !== 'Task' || (!taskStateSummaryText && !runningAgentNames)) {
        return null
    }

    return (
        <div className="flex flex-wrap gap-1">
            {taskStateSummaryText ? (
                <span className="rounded-full bg-[var(--app-subtle-bg)] px-2 py-0.5 text-[10px] text-[var(--app-hint)]">
                    {taskStateSummaryText}
                </span>
            ) : null}
            {runningAgentNames ? (
                <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600">
                    {runningAgentNames}
                </span>
            ) : null}
        </div>
    )
}

function renderEditInput(input: unknown): ReactNode | null {
    if (!isObject(input)) return null
    const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
    const oldString = getInputString(input, 'old_string')
    const newString = getInputString(input, 'new_string')
    if (oldString === null || newString === null) return null

    return (
        <DiffView
            oldString={oldString}
            newString={newString}
            filePath={filePath}
        />
    )
}

function renderExitPlanModeInput(input: unknown): ReactNode | null {
    const plan = getExitPlanText(input)
    if (!plan) return null
    return <MarkdownRenderer content={plan} />
}

function renderToolInput(block: ToolCallBlock): ReactNode {
    const toolName = block.tool.name
    const input = block.tool.input

    if (toolName === 'Task' && isObject(input) && typeof input.prompt === 'string') {
        return <MarkdownRenderer content={input.prompt} />
    }

    if (toolName === 'Edit') {
        const diff = renderEditInput(input)
        if (diff) return diff
    }

    if (toolName === 'MultiEdit' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
        const edits = Array.isArray(input.edits) ? input.edits : null
        if (edits && edits.length > 0) {
            const rendered = edits
                .slice(0, 3)
                .map((edit, idx) => {
                    if (!isObject(edit)) return null
                    const oldString = getInputString(edit, 'old_string')
                    const newString = getInputString(edit, 'new_string')
                    if (oldString === null || newString === null) return null
                    return (
                        <div key={idx}>
                            <DiffView oldString={oldString} newString={newString} filePath={filePath} />
                        </div>
                    )
                })
                .filter(Boolean)

            if (rendered.length > 0) {
                return (
                    <div className="flex flex-col gap-2">
                        {rendered}
                        {edits.length > 3 ? (
                            <div className="text-xs text-[var(--app-hint)]">
                                (+{edits.length - 3} more edits)
                            </div>
                        ) : null}
                    </div>
                )
            }
        }
    }

    if (toolName === 'Write' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path'])
        const content = getInputStringAny(input, ['content', 'text'])
        if (filePath && content !== null) {
            return (
                <div className="flex flex-col gap-2">
                    <div className="text-xs text-[var(--app-hint)] font-mono break-all">
                        {filePath}
                    </div>
                    <CodeBlock code={content} language="text" />
                </div>
            )
        }
    }

    if (toolName === 'CodexDiff' && isObject(input) && typeof input.unified_diff === 'string') {
        const parsed = parseUnifiedDiff(input.unified_diff)
        return (
            <DiffView
                oldString={parsed.oldText}
                newString={parsed.newText}
                filePath={parsed.fileName}
                variant="inline"
            />
        )
    }

    if (isExitPlanToolName(toolName)) {
        const plan = renderExitPlanModeInput(input)
        if (plan) return plan
    }

    const commandArray = isObject(input) && Array.isArray(input.command) ? input.command : null
    if ((toolName === 'CodexBash' || toolName === 'Bash') && (typeof commandArray?.[0] === 'string' || typeof input === 'object')) {
        const cmd = Array.isArray(commandArray)
            ? commandArray.filter((part) => typeof part === 'string').join(' ')
            : getInputStringAny(input, ['command', 'cmd'])
        if (cmd) {
            return <CodeBlock code={cmd} language="bash" />
        }
    }

    return <CodeBlock code={safeStringify(input)} language="json" />
}

function StatusIcon(props: { state: ToolCallBlock['tool']['state'] }) {
    if (props.state === 'completed') {
        return (
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5.2 8.3l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        )
    }
    if (props.state === 'error') {
        return (
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        )
    }
    if (props.state === 'pending') {
        return (
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <rect x="4.5" y="7" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 7V5.8a2 2 0 0 1 4 0V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        )
    }
    return (
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
        </svg>
    )
}

function statusColorClass(state: ToolCallBlock['tool']['state']): string {
    if (state === 'completed') return 'text-emerald-600'
    if (state === 'error') return 'text-red-600'
    if (state === 'pending') return 'text-amber-600'
    return 'text-[var(--app-hint)]'
}

function getToolStatusLabel(
    state: ToolCallBlock['tool']['state'],
    permissionStatus?: string
): string {
    if (permissionStatus === 'pending') return 'Needs approval'
    if (state === 'completed') return 'Done'
    if (state === 'error') return 'Failed'
    if (state === 'pending') return 'Pending'
    return 'Running'
}

function statusBadgeClass(
    state: ToolCallBlock['tool']['state'],
    permissionStatus?: string
): string {
    if (permissionStatus === 'pending') {
        return 'bg-amber-500/10 text-amber-600'
    }
    if (state === 'completed') return 'bg-emerald-500/10 text-emerald-600'
    if (state === 'error') return 'bg-red-500/10 text-red-600'
    if (state === 'pending') return 'bg-amber-500/10 text-amber-600'
    return 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
}

function DetailsIcon(props: { className?: string }) {
    return (
        <svg className={props.className ?? 'h-4 w-4'} viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

function BackIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

type ToolCardProps = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    density: SessionListDensity
    onDone: () => void
    block: ToolCallBlock
}

function ToolCardInner(props: ToolCardProps) {
    const { t } = useTranslation()
    const chatContext = useHappyChatContext()
    const presentation = useMemo(() => getToolPresentation({
        toolName: props.block.tool.name,
        input: props.block.tool.input,
        result: props.block.tool.result,
        childrenCount: props.block.children.length,
        description: props.block.tool.description,
        metadata: props.metadata
    }), [
        props.block.tool.name,
        props.block.tool.input,
        props.block.tool.result,
        props.block.children.length,
        props.block.tool.description,
        props.metadata
    ])

    const toolName = props.block.tool.name
    const isCompact = props.density === 'compact'
    const isTurnChangesTool = toolName === 'CodexTurnChanges'
    const isDiffTool = toolName === 'CodexDiff'
    const toolTitle = presentation.title
    const subtitle = presentation.subtitle ?? props.block.tool.description
    const taskChildStateSummary = getTaskChildStateSummary(props.block)
    const taskStateSummaryText = formatTaskChildStateSummary(taskChildStateSummary)
    const taskRunningAgents = getRunningAgentsForTaskBlock(props.block, chatContext.agentState?.runningAgents ?? null)
    const runningAgentNames = formatRunningAgentNames(taskRunningAgents)
    const taskSummary = renderTaskSummary(props.block, props.metadata)
    const runningFrom = props.block.tool.startedAt ?? props.block.tool.createdAt
    const toolProgressMap = chatContext.toolProgress ?? null
    let progressSignal = toolProgressMap?.get(props.block.tool.id) ?? null
    if (toolProgressMap) {
        // Task cards: a heartbeat from any child tool proves the subagent is alive.
        for (const child of props.block.children) {
            if (child.kind !== 'tool-call') continue
            const childSignal = toolProgressMap.get(child.tool.id)
            if (childSignal && (!progressSignal || childSignal.at > progressSignal.at)) {
                progressSignal = childSignal
            }
        }
    }
    const showInline = !presentation.minimal && toolName !== 'Task' && !isTurnChangesTool
    const CompactToolView = showInline ? getToolViewComponent(toolName) : null
    const FullToolView = getToolFullViewComponent(toolName)
    const ResultToolView = getToolResultViewComponent(toolName)
    const permission = props.block.tool.permission
    const isAskUserQuestion = isAskUserQuestionToolName(toolName)
    const isRequestUserInput = isRequestUserInputToolName(toolName)
    const isQuestionTool = isAskUserQuestion || isRequestUserInput
    const showsPermissionFooter = Boolean(permission && (
        permission.status === 'pending'
        || ((permission.status === 'denied' || permission.status === 'canceled') && Boolean(permission.reason))
    ))
    const hasBody = showInline || taskSummary !== null || showsPermissionFooter
    const compactRowOpensDetail = isCompact && props.disabled && !isTurnChangesTool && !isDiffTool
    const requiresInteraction = permission?.status === 'pending'
    const hideResultSection = toolName === 'CodexTurnChanges'
    const statusLabel = getToolStatusLabel(props.block.tool.state, permission?.status)
    const statusBadgeToneClass = statusBadgeClass(props.block.tool.state, permission?.status)
    const [isExpanded, setIsExpanded] = useState(() => (isCompact ? requiresInteraction : true))
    const [hasUserToggledExpand, setHasUserToggledExpand] = useState(false)
    const showCardBody = hasBody && (!isCompact || isExpanded) && !compactRowOpensDetail
    const { suppressFocusRing, onTriggerPointerDown, onTriggerKeyDown, onTriggerBlur } = usePointerFocusRing()
    const [isMobileViewport, setIsMobileViewport] = useState(() => (
        typeof window !== 'undefined' && window.matchMedia(MOBILE_DETAIL_BREAKPOINT_QUERY).matches
    ))
    const [isTurnChangesDetailOpen, setIsTurnChangesDetailOpen] = useState(false)
    const [isDiffDetailOpen, setIsDiffDetailOpen] = useState(false)

    useEffect(() => {
        setHasUserToggledExpand(false)
        setIsExpanded(isCompact ? requiresInteraction : true)
    }, [props.block.id, isCompact, requiresInteraction])

    useEffect(() => {
        if (!isCompact || hasUserToggledExpand) return
        setIsExpanded(requiresInteraction)
    }, [isCompact, hasUserToggledExpand, requiresInteraction])

    useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        const mediaQuery = window.matchMedia(MOBILE_DETAIL_BREAKPOINT_QUERY)
        const handleChange = () => {
            setIsMobileViewport(mediaQuery.matches)
        }

        handleChange()
        if (typeof mediaQuery.addEventListener === 'function') {
            mediaQuery.addEventListener('change', handleChange)
            return () => {
                mediaQuery.removeEventListener('change', handleChange)
            }
        }

        mediaQuery.addListener(handleChange)
        return () => {
            mediaQuery.removeListener(handleChange)
        }
    }, [])

    useEffect(() => {
        if (!isTurnChangesTool || typeof window === 'undefined') {
            return
        }

        const syncFromHistory = () => {
            setIsTurnChangesDetailOpen(readTurnChangesDetailToolId(window.location.search) === props.block.id)
        }

        syncFromHistory()
        window.addEventListener('popstate', syncFromHistory)
        return () => {
            window.removeEventListener('popstate', syncFromHistory)
        }
    }, [isTurnChangesTool, props.block.id])

    useEffect(() => {
        if (!isDiffTool || typeof window === 'undefined') {
            return
        }

        if (!isMobileViewport) {
            if (readDiffDetailToolId(window.location.search) === props.block.id) {
                writeDiffDetailToolId(null, 'replace')
            }
            return
        }

        const syncFromHistory = () => {
            setIsDiffDetailOpen(readDiffDetailToolId(window.location.search) === props.block.id)
        }

        syncFromHistory()
        window.addEventListener('popstate', syncFromHistory)
        return () => {
            window.removeEventListener('popstate', syncFromHistory)
        }
    }, [isDiffTool, isMobileViewport, props.block.id])

    const openTurnChangesDetail = useCallback(() => {
        setIsTurnChangesDetailOpen(true)

        if (isMobileViewport && typeof window !== 'undefined') {
            const currentToolId = readTurnChangesDetailToolId(window.location.search)
            if (currentToolId !== props.block.id) {
                writeTurnChangesDetailToolId(props.block.id, 'push')
            }
        }
    }, [isMobileViewport, props.block.id])

    const closeTurnChangesDetail = useCallback(() => {
        if (isMobileViewport && typeof window !== 'undefined') {
            const currentToolId = readTurnChangesDetailToolId(window.location.search)
            if (currentToolId === props.block.id) {
                window.history.back()
                return
            }
        }

        if (typeof window !== 'undefined' && readTurnChangesDetailToolId(window.location.search) === props.block.id) {
            writeTurnChangesDetailToolId(null, 'replace')
        }
        setIsTurnChangesDetailOpen(false)
    }, [isMobileViewport, props.block.id])

    const openDiffDetail = useCallback(() => {
        setIsDiffDetailOpen(true)

        if (isMobileViewport && typeof window !== 'undefined') {
            const currentToolId = readDiffDetailToolId(window.location.search)
            if (currentToolId !== props.block.id) {
                writeDiffDetailToolId(props.block.id, 'push')
            }
        }
    }, [isMobileViewport, props.block.id])

    const closeDiffDetail = useCallback(() => {
        if (isMobileViewport && typeof window !== 'undefined') {
            const currentToolId = readDiffDetailToolId(window.location.search)
            if (currentToolId === props.block.id) {
                window.history.back()
                return
            }
        }

        setIsDiffDetailOpen(false)
    }, [isMobileViewport, props.block.id])

    if (toolName === 'CodexReasoning') {
        const reasoningDetail = getInputStringAny(props.block.tool.result, ['content'])
        const compactDetail = reasoningDetail && reasoningDetail.trim() !== toolTitle
            ? truncate(reasoningDetail, isCompact ? 120 : 180)
            : null

        return (
            <div
                className={cn(
                    'rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/40',
                    isCompact ? 'px-2 py-1' : 'px-2.5 py-1.5'
                )}
            >
                <div className="flex items-center gap-1.5">
                    <span className={cn('shrink-0', statusColorClass(props.block.tool.state))}>
                        <StatusIcon state={props.block.tool.state} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs text-[var(--app-hint)]">
                        {toolTitle}
                    </span>
                    <ElapsedView from={runningFrom} active={props.block.tool.state === 'running'} signal={progressSignal} />
                </div>
                {compactDetail ? (
                    <div className="mt-1 pl-4 text-[11px] text-[var(--app-hint)]">
                        {compactDetail}
                    </div>
                ) : null}
            </div>
        )
    }

    const renderDetailBody = (options?: { mobile?: boolean }) => {
        const mobile = options?.mobile === true
        const isQuestionToolWithAnswers = isQuestionTool
            && permission?.answers
            && Object.keys(permission.answers).length > 0

        return (
            <div className={cn(
                'flex flex-col gap-4 overflow-auto',
                mobile
                    ? 'mt-0 min-h-0 flex-1 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]'
                    : isTurnChangesTool
                        ? 'mt-3 max-h-[85vh]'
                        : 'mt-3 max-h-[75vh]'
            )}>
                <div>
                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">
                        {isQuestionToolWithAnswers ? t('tool.questionsAnswers') : t('tool.input')}
                    </div>
                    {FullToolView ? (
                        <FullToolView block={props.block} metadata={props.metadata} />
                    ) : (
                        renderToolInput(props.block)
                    )}
                </div>
                {!isQuestionToolWithAnswers && !hideResultSection && (
                    <div>
                        <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('tool.result')}</div>
                        <ResultToolView block={props.block} metadata={props.metadata} />
                    </div>
                )}
            </div>
        )
    }

    const renderDialogContent = () => (
        <DialogContent className={cn(
            isTurnChangesTool
                ? 'w-[calc(100vw-16px)] max-w-[min(1440px,98vw)]'
                : 'max-w-2xl'
        )}>
            <DialogHeader>
                <DialogTitle>{toolTitle}</DialogTitle>
            </DialogHeader>
            {renderDetailBody()}
        </DialogContent>
    )

    const renderTurnChangesDetailLayer = () => {
        if (isMobileViewport) {
            if (!isTurnChangesDetailOpen) {
                return null
            }

            return (
                <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--app-bg)]">
                    <div className="border-b border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={closeTurnChangesDetail}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--app-border)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                                aria-label="Back"
                            >
                                <BackIcon />
                            </button>
                            <div className="min-w-0 truncate text-sm font-semibold text-[var(--app-fg)]">
                                {toolTitle}
                            </div>
                        </div>
                    </div>
                    {renderDetailBody({ mobile: true })}
                </div>
            )
        }

        return (
            <Dialog
                open={isTurnChangesDetailOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setIsTurnChangesDetailOpen(false)
                    }
                }}
            >
                {renderDialogContent()}
            </Dialog>
        )
    }

    const renderDiffDetailLayer = () => {
        if (isMobileViewport) {
            if (!isDiffDetailOpen) {
                return null
            }

            return (
                <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--app-bg)]">
                    <div className="border-b border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={closeDiffDetail}
                                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--app-border)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                                aria-label="Back"
                            >
                                <BackIcon />
                            </button>
                            <div className="min-w-0 truncate text-sm font-semibold text-[var(--app-fg)]">
                                {toolTitle}
                            </div>
                        </div>
                    </div>
                    {renderDetailBody({ mobile: true })}
                </div>
            )
        }

        return (
            <Dialog
                open={isDiffDetailOpen}
                onOpenChange={(open) => {
                    if (!open) {
                        setIsDiffDetailOpen(false)
                    }
                }}
            >
                {renderDialogContent()}
            </Dialog>
        )
    }

    const compactSummary = (() => {
        if (toolName === 'Task' && taskStateSummaryText && runningAgentNames && subtitle) {
            return truncate(`${taskStateSummaryText} — ${runningAgentNames} — ${subtitle}`, 96)
        }
        if (toolName === 'Task' && taskStateSummaryText && runningAgentNames) {
            return truncate(`${taskStateSummaryText} — ${runningAgentNames}`, 96)
        }
        if (toolName === 'Task' && taskStateSummaryText && subtitle) {
            return truncate(`${taskStateSummaryText} — ${subtitle}`, 96)
        }
        if (toolName === 'Task' && taskStateSummaryText) {
            return truncate(taskStateSummaryText, 96)
        }
        return subtitle ? truncate(subtitle, 96) : null
    })()

    return (
        <Card className="overflow-hidden shadow-sm">
            <CardHeader className={cn('space-y-0', isCompact ? 'p-2.5' : 'p-3')}>
                {isCompact ? (
                    isTurnChangesTool ? (
                        <>
                            <button
                                type="button"
                                className={cn(
                                    'w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                    suppressFocusRing && 'focus-visible:ring-0'
                                )}
                                onClick={openTurnChangesDetail}
                                onPointerDown={onTriggerPointerDown}
                                onKeyDown={onTriggerKeyDown}
                                onBlur={onTriggerBlur}
                            >
                                <div className="flex items-center gap-2">
                                    <div className="shrink-0 flex h-5 w-5 items-center justify-center rounded bg-[var(--app-subtle-bg)] text-[var(--app-hint)] leading-none">
                                        {presentation.icon}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-xs font-medium leading-tight">
                                            {toolTitle}
                                            {compactSummary ? (
                                                <span className="ml-1 font-mono text-[10px] text-[var(--app-hint)]">
                                                    - {compactSummary}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                    <span className={cn(
                                        'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                                        statusBadgeToneClass
                                    )}>
                                        <StatusIcon state={props.block.tool.state} />
                                        {statusLabel}
                                    </span>
                                    <span className="shrink-0 text-[var(--app-hint)]">
                                        <DetailsIcon className="h-3.5 w-3.5" />
                                    </span>
                                </div>
                            </button>
                            {renderTurnChangesDetailLayer()}
                        </>
                    ) : (
                        compactRowOpensDetail ? (
                            <Dialog>
                                <DialogTrigger asChild>
                                    <button
                                        type="button"
                                        className={cn(
                                            'w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                            suppressFocusRing && 'focus-visible:ring-0'
                                        )}
                                        onPointerDown={onTriggerPointerDown}
                                        onKeyDown={onTriggerKeyDown}
                                        onBlur={onTriggerBlur}
                                    >
                                        <div className="flex items-center gap-2">
                                            <div className="shrink-0 flex h-5 w-5 items-center justify-center rounded bg-[var(--app-subtle-bg)] text-[var(--app-hint)] leading-none">
                                                {presentation.icon}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-xs font-medium leading-tight">
                                                    {toolTitle}
                                                    {compactSummary ? (
                                                        <span className="ml-1 font-mono text-[10px] text-[var(--app-hint)]">
                                                            - {compactSummary}
                                                        </span>
                                                    ) : null}
                                                </div>
                                            </div>
                                            <span className={cn(
                                                'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                                                statusBadgeToneClass
                                            )}>
                                                <StatusIcon state={props.block.tool.state} />
                                                {statusLabel}
                                            </span>
                                            <span className="shrink-0 text-[var(--app-hint)]">
                                                <DetailsIcon className="h-3.5 w-3.5" />
                                            </span>
                                        </div>
                                    </button>
                                </DialogTrigger>
                                {renderDialogContent()}
                            </Dialog>
                        ) : (
                            <div className="flex items-start gap-2">
                                <button
                                    type="button"
                                    className={cn(
                                        'w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                        suppressFocusRing && 'focus-visible:ring-0'
                                    )}
                                    onClick={() => {
                                        if (!hasBody) return
                                        setHasUserToggledExpand(true)
                                        setIsExpanded((prev) => !prev)
                                    }}
                                    onPointerDown={onTriggerPointerDown}
                                    onKeyDown={onTriggerKeyDown}
                                    onBlur={onTriggerBlur}
                                >
                                    <div className="flex items-center gap-2">
                                        <div className="shrink-0 flex h-5 w-5 items-center justify-center rounded bg-[var(--app-subtle-bg)] text-[var(--app-hint)] leading-none">
                                            {presentation.icon}
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-xs font-medium leading-tight">
                                                {toolTitle}
                                                {compactSummary ? (
                                                    <span className="ml-1 font-mono text-[10px] text-[var(--app-hint)]">
                                                        - {compactSummary}
                                                    </span>
                                                ) : null}
                                            </div>
                                        </div>
                                        <span className={cn(
                                            'inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                                            statusBadgeToneClass
                                        )}>
                                            <StatusIcon state={props.block.tool.state} />
                                            {statusLabel}
                                        </span>
                                        {hasBody ? (
                                            <span className={cn(
                                                'shrink-0 text-[var(--app-hint)] transition-transform',
                                                isExpanded ? 'rotate-90' : 'rotate-0'
                                            )}>
                                                <DetailsIcon className="h-3.5 w-3.5" />
                                            </span>
                                        ) : null}
                                    </div>
                                </button>
                                {isDiffTool ? (
                                    <>
                                        <button
                                            type="button"
                                            className="shrink-0 rounded p-1 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                            title={t('session.more')}
                                            aria-label={t('session.more')}
                                            onClick={openDiffDetail}
                                        >
                                            <DetailsIcon className="h-4 w-4" />
                                        </button>
                                        {renderDiffDetailLayer()}
                                    </>
                                ) : (
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <button
                                                type="button"
                                                className="shrink-0 rounded p-1 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                                                title={t('session.more')}
                                                aria-label={t('session.more')}
                                            >
                                                <DetailsIcon className="h-4 w-4" />
                                            </button>
                                        </DialogTrigger>
                                        {renderDialogContent()}
                                    </Dialog>
                                )}
                            </div>
                        )
                    )
                ) : isTurnChangesTool ? (
                    <>
                        <button
                            type="button"
                            className={cn(
                                'w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                suppressFocusRing && 'focus-visible:ring-0'
                            )}
                            onClick={openTurnChangesDetail}
                            onPointerDown={onTriggerPointerDown}
                            onKeyDown={onTriggerKeyDown}
                            onBlur={onTriggerBlur}
                        >
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0 flex items-center gap-2">
                                        <div className="shrink-0 flex h-3.5 w-3.5 items-center justify-center text-[var(--app-hint)] leading-none">
                                            {presentation.icon}
                                        </div>
                                        <CardTitle className="min-w-0 text-sm font-medium leading-tight break-words">
                                            {toolTitle}
                                        </CardTitle>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <ElapsedView from={runningFrom} active={props.block.tool.state === 'running'} signal={progressSignal} />
                                        <span className={statusColorClass(props.block.tool.state)}>
                                            <StatusIcon state={props.block.tool.state} />
                                        </span>
                                        <span className="text-[var(--app-hint)]">
                                            <DetailsIcon className="h-4 w-4" />
                                        </span>
                                    </div>
                                </div>

                                {subtitle ? (
                                    <CardDescription className="font-mono text-xs break-all opacity-80">
                                        {truncate(subtitle, 160)}
                                    </CardDescription>
                                ) : null}
                                {renderTaskStateBadge(taskStateSummaryText, runningAgentNames, toolName)}
                            </div>
                        </button>
                        {renderTurnChangesDetailLayer()}
                    </>
                ) : isDiffTool ? (
                    <>
                        <button
                            type="button"
                            className={cn(
                                'w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                suppressFocusRing && 'focus-visible:ring-0'
                            )}
                            onClick={openDiffDetail}
                            onPointerDown={onTriggerPointerDown}
                            onKeyDown={onTriggerKeyDown}
                            onBlur={onTriggerBlur}
                        >
                            <div className="flex flex-col gap-1">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0 flex items-center gap-2">
                                        <div className="shrink-0 flex h-3.5 w-3.5 items-center justify-center text-[var(--app-hint)] leading-none">
                                            {presentation.icon}
                                        </div>
                                        <CardTitle className="min-w-0 text-sm font-medium leading-tight break-words">
                                            {toolTitle}
                                        </CardTitle>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        <ElapsedView from={runningFrom} active={props.block.tool.state === 'running'} signal={progressSignal} />
                                        <span className={statusColorClass(props.block.tool.state)}>
                                            <StatusIcon state={props.block.tool.state} />
                                        </span>
                                        <span className="text-[var(--app-hint)]">
                                            <DetailsIcon className="h-4 w-4" />
                                        </span>
                                    </div>
                                </div>

                                {subtitle ? (
                                    <CardDescription className="font-mono text-xs break-all opacity-80">
                                        {truncate(subtitle, 160)}
                                    </CardDescription>
                                ) : null}
                                {renderTaskStateBadge(taskStateSummaryText, runningAgentNames, toolName)}
                            </div>
                        </button>
                        {renderDiffDetailLayer()}
                    </>
                ) : (
                    <Dialog>
                        <DialogTrigger asChild>
                            <button
                                type="button"
                                className={cn(
                                    'w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                    suppressFocusRing && 'focus-visible:ring-0'
                                )}
                                onPointerDown={onTriggerPointerDown}
                                onKeyDown={onTriggerKeyDown}
                                onBlur={onTriggerBlur}
                            >
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="min-w-0 flex items-center gap-2">
                                            <div className="shrink-0 flex h-3.5 w-3.5 items-center justify-center text-[var(--app-hint)] leading-none">
                                                {presentation.icon}
                                            </div>
                                            <CardTitle className="min-w-0 text-sm font-medium leading-tight break-words">
                                                {toolTitle}
                                            </CardTitle>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            <ElapsedView from={runningFrom} active={props.block.tool.state === 'running'} signal={progressSignal} />
                                            <span className={statusColorClass(props.block.tool.state)}>
                                                <StatusIcon state={props.block.tool.state} />
                                            </span>
                                            <span className="text-[var(--app-hint)]">
                                                <DetailsIcon className="h-4 w-4" />
                                            </span>
                                        </div>
                                    </div>

                                    {subtitle ? (
                                        <CardDescription className="font-mono text-xs break-all opacity-80">
                                            {truncate(subtitle, 160)}
                                        </CardDescription>
                                    ) : null}
                                    {toolName === 'Task' && taskStateSummaryText ? (
                                        <div className="flex flex-wrap gap-1">
                                            <span className="rounded-full bg-[var(--app-subtle-bg)] px-2 py-0.5 text-[10px] text-[var(--app-hint)]">
                                                {taskStateSummaryText}
                                            </span>
                                        </div>
                                    ) : null}
                                </div>
                            </button>
                        </DialogTrigger>
                        {renderDialogContent()}
                    </Dialog>
                )}
            </CardHeader>

            {showCardBody ? (
                <CardContent className={cn(isCompact ? 'px-2.5 pb-2.5 pt-0' : 'px-3 pb-3 pt-0')}>
                    {taskSummary ? (
                        <div className={isCompact ? 'mt-1.5' : 'mt-2'}>
                            {taskSummary}
                        </div>
                    ) : null}

                    {showInline ? (
                        CompactToolView ? (
                            <div className={isCompact ? 'mt-2' : 'mt-3'}>
                                <CompactToolView block={props.block} metadata={props.metadata} />
                            </div>
                        ) : (
                            <div className={cn('flex flex-col', isCompact ? 'mt-2 gap-2' : 'mt-3 gap-3')}>
                                <div>
                                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('tool.input')}</div>
                                    {renderToolInput(props.block)}
                                </div>
                                <div>
                                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('tool.result')}</div>
                                    <ResultToolView block={props.block} metadata={props.metadata} />
                                </div>
                            </div>
                        )
                    ) : null}

                    {isQuestionTool && permission?.status === 'pending' ? (
                        <div className="mt-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-3">
                            <div className="text-xs font-medium text-[var(--app-hint)]">
                                {t('tool.questionOverlay.inlineTitle')}
                            </div>
                            <div className="mt-1 text-sm text-[var(--app-fg)]">
                                {t('tool.questionOverlay.inlineDescription')}
                            </div>
                        </div>
                    ) : (
                        <PermissionFooter
                            api={props.api}
                            sessionId={props.sessionId}
                            metadata={props.metadata}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    )}
                </CardContent>
            ) : null}
        </Card>
    )
}

export const ToolCard = memo(ToolCardInner)
