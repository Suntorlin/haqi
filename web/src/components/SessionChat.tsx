import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type {
    AttachmentMetadata,
    ConversationTurn,
    McpServerSummary,
    QueueEntry,
    QueueState,
    QueueStatusResponse,
    SessionUsageOverview,
    DecryptedMessage,
    PermissionMode,
    Session,
    TeamControlRequest
} from '@/types/api'
import type { ChatBlock, NormalizedMessage } from '@/chat/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { extractToolProgress } from '@/chat/toolProgress'
import { reduceChatBlocks } from '@/chat/reducer'
import { reconcileChatBlocks } from '@/chat/reconcile'
import { HappyComposer, type CodexSendMode } from '@/components/AssistantChat/HappyComposer'
import { useCodexSendModePreference } from '@/hooks/useCodexSendModePreference'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { BriefTurnList } from '@/components/AssistantChat/BriefTurnList'
import { CliThread } from '@/components/AssistantChat/CliThread'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { SessionHeader } from '@/components/SessionHeader'
import { TeamPanel } from '@/components/TeamPanel'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionDock } from '@/hooks/useSessionDock'
import { PreviewLinkContext, type OpenInPreview } from '@/lib/preview-link'
import { normalizePreviewUrlInput } from '@/lib/preview-url'
import { queryKeys } from '@/lib/query-keys'
import { useQueueInlinePanel } from '@/hooks/useQueueInlinePanel'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useExperimentalSettings } from '@/hooks/queries/useExperimentalSettings'
import { QuestionToolOverlay } from '@/components/ToolCard/QuestionToolOverlay'
import { PlanApprovalOverlay } from '@/components/ToolCard/PlanApprovalOverlay'
import { findLatestPendingQuestionTool } from '@/components/ToolCard/questionTools'
import { findLatestPendingPlanApprovalTool } from '@/components/ToolCard/exitPlanMode'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/TextField'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/use-translation'
import { useVoiceOptional } from '@/lib/voice-context'
import { useToast } from '@/lib/toast-context'
import { registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'
import { supportsQueueControlsFlavor } from '@/lib/agentFlavorUtils'
import type { ChatViewMode } from '@/hooks/useChatViewMode'
import { computeRunStats, computeTimeSeparators } from '@/components/mobile/chatTimeline'
import { QueueSheet, QueueStatusSheet } from '@/components/AssistantChat/QueueSheets'
import { getContextBudgetTokens } from '@/chat/modelConfig'
import { useSemanticZoomController } from '@/vendor/semantic-zoom'
import { ZOOM_LEVEL_COUNT, ZOOM_REPLY } from '@/components/AssistantChat/chatZoomText'
import { EmptyState } from '@/components/ui/EmptyState'
import { Card } from '@/components/ui/card'

type CodexStatusRow = {
    label: string
    value: string
}

type McpGuideItem = {
    id: string
    label: string
    url: string
    descriptionKey: string
}

type SessionThinkEffort = 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
type SessionServiceTier = 'auto' | 'fast' | 'flex'

// Loaded on first use so the voice SDK stays out of the first page load.
const RealtimeVoiceSession = lazy(() => import('@/realtime/RealtimeVoiceSession').then((m) => ({ default: m.RealtimeVoiceSession })))

const MCP_GUIDES: McpGuideItem[] = [
    {
        id: 'linear',
        label: 'Linear',
        url: 'https://linear.app/docs/mcp',
        descriptionKey: 'mcp.guide.linear'
    },
    {
        id: 'notion',
        label: 'Notion',
        url: 'https://developers.notion.com/docs/mcp',
        descriptionKey: 'mcp.guide.notion'
    },
    {
        id: 'playwright',
        label: 'Playwright',
        url: 'https://github.com/microsoft/playwright-mcp',
        descriptionKey: 'mcp.guide.playwright'
    }
]

function parseCodexStatusRows(message: string): CodexStatusRow[] {
    return message
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- '))
        .map((line) => line.slice(2))
        .map((line) => {
            const separatorIndex = line.indexOf(':')
            if (separatorIndex <= 0) {
                return { label: line, value: '' }
            }
            return {
                label: line.slice(0, separatorIndex).trim(),
                value: line.slice(separatorIndex + 1).trim()
            }
        })
}

function describeTeamControlRequest(
    request: TeamControlRequest,
    t: (key: string, params?: Record<string, string | number>) => string
): string {
    const name = request.memberName
    switch (request.action) {
        case 'message':
            return name ? t('team.toast.message', { name }) : t('team.toast.messageAny')
        case 'nudge_member':
            return name ? t('team.toast.nudge', { name }) : t('team.toast.nudgeAny')
        case 'shutdown_member':
            return name ? t('team.toast.shutdown', { name }) : t('team.toast.shutdownAny')
        case 'assign_task':
            return name && request.taskId
                ? t('team.toast.assign', { task: request.taskId, name })
                : t('team.toast.assignAny')
        case 'cleanup_team':
            return t('team.toast.cleanup')
    }
}

function isQueueStatusField(label: string): boolean {
    const normalized = label.trim().toLowerCase()
    return normalized === 'queue pending'
        || normalized === 'in queue'
        || normalized === 'task running'
        || normalized === 'next queued message'
}

type CodexPlanStatus = 'pending' | 'in_progress' | 'completed'

type CodexPlanEntry = {
    step: string
    status: CodexPlanStatus
}

type CodexPlanSnapshot = {
    explanation: string | null
    entries: CodexPlanEntry[]
    updatedAt: number
    signature: string
}

function normalizeCodexPlanStatus(value: unknown): CodexPlanStatus {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
    const parsed = parseCodexPlanStatus(normalized)
    return parsed ?? 'pending'
}

function parseCodexPlanStatus(value: string): CodexPlanStatus | null {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'completed' || normalized === 'done') {
        return 'completed'
    }
    if (normalized === 'in_progress' || normalized === 'inprogress' || normalized === 'running') {
        return 'in_progress'
    }
    if (normalized === 'pending' || normalized === 'todo') {
        return 'pending'
    }
    return null
}

function buildCodexPlanSignature(explanation: string | null, entries: CodexPlanEntry[]): string {
    return JSON.stringify({
        explanation: explanation ?? '',
        entries
    })
}

function parseCodexPlanFromText(text: string, updatedAt: number): CodexPlanSnapshot | null {
    const lines = text.split(/\r?\n/)
    const explanationLines: string[] = []
    const entries: CodexPlanEntry[] = []

    for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue

        const match = trimmed.match(/^-\s*\[([^\]]+)\]\s+(.+)$/)
        if (match) {
            const parsedStatus = parseCodexPlanStatus(match[1] ?? '')
            if (!parsedStatus) {
                continue
            }
            const step = match[2]?.trim()
            if (!step) continue
            entries.push({
                step,
                status: parsedStatus
            })
            continue
        }

        if (entries.length === 0) {
            explanationLines.push(trimmed)
        }
    }

    if (entries.length === 0) {
        return null
    }

    const explanation = explanationLines.length > 0 ? explanationLines.join(' ') : null
    return {
        explanation,
        entries,
        updatedAt,
        signature: buildCodexPlanSignature(explanation, entries)
    }
}

function parseCodexPlanFromTodoWrite(input: unknown, updatedAt: number): CodexPlanSnapshot | null {
    if (!input || typeof input !== 'object') {
        return null
    }

    const value = input as Record<string, unknown>
    const todosValue = value.todos
    if (!Array.isArray(todosValue)) {
        return null
    }

    const entries: CodexPlanEntry[] = todosValue
        .map((todo) => {
            if (!todo || typeof todo !== 'object') return null
            const entry = todo as Record<string, unknown>
            const stepValue = typeof entry.content === 'string'
                ? entry.content.trim()
                : typeof entry.step === 'string'
                    ? entry.step.trim()
                    : ''
            if (!stepValue) return null
            return {
                step: stepValue,
                status: normalizeCodexPlanStatus(entry.status)
            } satisfies CodexPlanEntry
        })
        .filter((entry): entry is CodexPlanEntry => entry !== null)

    if (entries.length === 0) {
        return null
    }

    const explanationRaw = typeof value.explanation === 'string'
        ? value.explanation.trim()
        : ''
    const explanation = explanationRaw.length > 0 ? explanationRaw : null

    return {
        explanation,
        entries,
        updatedAt,
        signature: buildCodexPlanSignature(explanation, entries)
    }
}

function extractLatestCodexPlan(messages: NormalizedMessage[]): CodexPlanSnapshot | null {
    for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
        const message = messages[messageIndex]

        if (message.role === 'event' && message.content.type === 'plan-update') {
            const rawEntries = Array.isArray(message.content.plan) ? message.content.plan : []
            const entries: CodexPlanEntry[] = rawEntries
                .map((entry) => {
                    const step = typeof entry?.step === 'string' ? entry.step.trim() : ''
                    if (step.length === 0) return null
                    return {
                        step,
                        status: normalizeCodexPlanStatus(entry.status)
                    } satisfies CodexPlanEntry
                })
                .filter((entry): entry is CodexPlanEntry => entry !== null)

            const explanation = typeof message.content.explanation === 'string'
                ? message.content.explanation.trim()
                : ''

            if (entries.length === 0 && explanation.length === 0) {
                continue
            }

            const normalizedExplanation = explanation.length > 0 ? explanation : null
            return {
                explanation: normalizedExplanation,
                entries,
                updatedAt: message.createdAt,
                signature: buildCodexPlanSignature(normalizedExplanation, entries)
            }
        }

        if (message.role !== 'agent') {
            continue
        }

        for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex -= 1) {
            const part = message.content[partIndex]
            if (part.type === 'tool-call') {
                const toolName = part.name.trim().toLowerCase()
                if (toolName === 'todowrite') {
                    const parsedFromTodo = parseCodexPlanFromTodoWrite(part.input, message.createdAt)
                    if (parsedFromTodo) {
                        return parsedFromTodo
                    }
                }
                continue
            }
            if (part.type !== 'text') continue
            const parsed = parseCodexPlanFromText(part.text, message.createdAt)
            if (parsed) {
                return parsed
            }
        }
    }

    return null
}

function getCodexPlanStatusBadgeVariant(status: CodexPlanStatus): 'success' | 'info' | 'default' {
    if (status === 'completed') return 'success'
    if (status === 'in_progress') return 'info'
    return 'default'
}

function normalizeCodexCollaborationMode(value: string | undefined): 'plan' | 'default' {
    return value?.trim().toLowerCase() === 'plan' ? 'plan' : 'default'
}

export function SessionChat(props: {
    api: ApiClient
    session: Session
    messages: DecryptedMessage[]
    messagesWarning: string | null
    hasMoreMessages: boolean
    isLoadingMessages: boolean
    isLoadingMoreMessages: boolean
    turns: ConversationTurn[]
    turnsWarning: string | null
    hasMoreTurns: boolean
    isLoadingTurns: boolean
    isLoadingMoreTurns: boolean
    isSending: boolean
    pendingCount: number
    newestMessageSeq: number | null
    messagesVersion: number
    viewMode: ChatViewMode
    onViewModeChange: (mode: ChatViewMode) => void
    onBack: () => void
    onRefresh: () => void
    onLoadMore: () => Promise<unknown>
    onLoadMoreTurns: () => Promise<void>
    onSend: (text: string, attachments?: AttachmentMetadata[]) => Promise<boolean> | boolean
    onFlushPending: () => void
    onAtBottomChange: (atBottom: boolean) => void
    onRetryMessage?: (localId: string) => void
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    onToggleSidebar?: () => void
    sidebarVisible?: boolean
    density?: SessionListDensity
}) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { haptic } = usePlatform()
    const { queueInlinePanelMode } = useQueueInlinePanel()
    const navigate = useNavigate()
    const dock = useSessionDock()
    const queryClient = useQueryClient()
    const { settings: experimentalSettings } = useExperimentalSettings(props.api, true)
    const sessionInactive = !props.session.active
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const [forceScrollToken, setForceScrollToken] = useState(0)
    // Chat zoom (brief / reply / all steps): pinched in the thread, also switched from the header's view settings.
    const chatZoom = useSemanticZoomController({ levelCount: ZOOM_LEVEL_COUNT, initialLevel: ZOOM_REPLY })
    const [isCodexStatusDialogOpen, setIsCodexStatusDialogOpen] = useState(false)
    const [isCodexStatusLoading, setIsCodexStatusLoading] = useState(false)
    const [codexStatusMessage, setCodexStatusMessage] = useState('')
    const [codexStatusError, setCodexStatusError] = useState<string | null>(null)
    const [sessionUsage, setSessionUsage] = useState<SessionUsageOverview | null>(null)
    const [sessionUsageError, setSessionUsageError] = useState<string | null>(null)
    const [codexQueueStatus, setCodexQueueStatus] = useState<QueueStatusResponse['queue'] | null>(null)
    const [codexQueueState, setCodexQueueState] = useState<QueueState | null>(null)
    const [isCodexQueueDialogOpen, setIsCodexQueueDialogOpen] = useState(false)
    const [isCodexQueueLoading, setIsCodexQueueLoading] = useState(false)
    const [isCodexQueueMutating, setIsCodexQueueMutating] = useState(false)
    const [codexQueueError, setCodexQueueError] = useState<string | null>(null)
    // One system-wide setting (Settings > Interaction); there is no per-session send mode any more.
    const { codexSendModeDefault: codexSendMode } = useCodexSendModePreference()
    const [codexCollaborationMode, setCodexCollaborationMode] = useState<'plan' | 'default'>(
        () => normalizeCodexCollaborationMode(props.session.metadata?.collaborationMode)
    )
    const [dismissedCodexPlanSignature, setDismissedCodexPlanSignature] = useState<string | null>(null)
    const [isCodexPlanCollapsed, setIsCodexPlanCollapsed] = useState(false)
    const [isMcpDialogOpen, setIsMcpDialogOpen] = useState(false)
    const [isMcpLoading, setIsMcpLoading] = useState(false)
    const [mcpServers, setMcpServers] = useState<McpServerSummary[]>([])
    const [mcpFlavor, setMcpFlavor] = useState<string | null>(null)
    const [mcpCheckedAt, setMcpCheckedAt] = useState<number | null>(null)
    const [mcpWarning, setMcpWarning] = useState<string | null>(null)
    const [mcpError, setMcpError] = useState<string | null>(null)
    const [isMcpGuideExpanded, setIsMcpGuideExpanded] = useState(false)
    const [customMcpGuideInput, setCustomMcpGuideInput] = useState('')
    const [composerInjectedPrompt, setComposerInjectedPrompt] = useState<{ id: number; text: string } | null>(null)
    const composerPromptIdRef = useRef(0)
    const queueFullTextByIdRef = useRef<Map<string, string>>(new Map())
    const queueFullTextByPreviewRef = useRef<Map<string, string>>(new Map())
    const codexStatusRows = useMemo(() => parseCodexStatusRows(codexStatusMessage), [codexStatusMessage])
    const usageNumberFormatter = useMemo(() => new Intl.NumberFormat(), [])
    const formatUsageNumber = useCallback((value: number): string => usageNumberFormatter.format(value), [usageNumberFormatter])
    const codexStatusDetailRows = useMemo(
        () => codexQueueStatus
            ? codexStatusRows.filter((row) => !isQueueStatusField(row.label))
            : codexStatusRows,
        [codexQueueStatus, codexStatusRows]
    )
    const codexQueueEntries = codexQueueState?.entries ?? []
    const codexQueuePendingCount = codexQueueState?.pendingCount
        ?? codexQueueStatus?.pendingCount
        ?? 0
    const codexQueueSummary = useMemo(() => {
        if (codexQueueStatus) {
            return codexQueueStatus
        }
        if (codexQueueState) {
            return {
                pendingCount: codexQueueState.pendingCount,
                inQueue: codexQueueState.inQueue,
                taskRunning: codexQueueState.taskRunning,
                nextPreview: codexQueueState.nextPreview
            }
        }
        return null
    }, [codexQueueStatus, codexQueueState])
    const codexQueueHasLiveActivity = props.session.thinking || codexQueuePendingCount > 0 || codexQueueEntries.length > 0
    const inlineQueuePollIntervalMs = codexQueueHasLiveActivity ? 2_000 : 10_000
    const dialogQueuePollIntervalMs = codexQueueHasLiveActivity ? 2_000 : 6_000
    const agentFlavor = props.session.metadata?.flavor ?? null
    const supportsQueueControls = supportsQueueControlsFlavor(agentFlavor)
    const {
        abortSession,
        stopAndPreserveCodexQueue,
        switchSession,
        setPermissionMode,
        setModel,
        setThinkEffort,
        setServiceTier,
        setCollaborationMode,
        resumeSession,
        isPending
    } = useSessionActions(
        props.api,
        props.session.id,
        agentFlavor
    )

    // Voice assistant integration
    const voice = useVoiceOptional()
    // The project folder name is the word dictation most often gets wrong, so bias toward it.
    const sessionPath = props.session.metadata?.path
    const dictationHotwords = useMemo(() => {
        const folder = sessionPath?.split('/').filter(Boolean).pop()
        return folder ? [folder] : []
    }, [sessionPath])

    // Register session store for voice client tools
    useEffect(() => {
        registerSessionStore({
            getSession: () => props.session as { agentState?: { requests?: Record<string, unknown> } } | null,
            sendMessage: (_sessionId: string, message: string) => props.onSend(message),
            approvePermission: async (_sessionId: string, requestId: string) => {
                await props.api.approvePermission(props.session.id, requestId)
                props.onRefresh()
            },
            denyPermission: async (_sessionId: string, requestId: string) => {
                await props.api.denyPermission(props.session.id, requestId)
                props.onRefresh()
            }
        })
    }, [props.session, props.api, props.onSend, props.onRefresh])

    useEffect(() => {
        registerVoiceHooksStore(
            (sessionId) => (sessionId === props.session.id ? props.session : null),
            (sessionId) => (sessionId === props.session.id ? props.messages : [])
        )
    }, [props.session, props.messages])

    // Track and report new messages to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevMessagesRef = useRef<DecryptedMessage[]>([])

    useEffect(() => {
        const prevIds = new Set(prevMessagesRef.current.map(m => m.id))
        const newMessages = props.messages.filter(m => !prevIds.has(m.id))

        if (newMessages.length > 0) {
            voiceHooks.onMessages(props.session.id, newMessages)
        }

        prevMessagesRef.current = props.messages
    }, [props.messages, props.session.id])

    // Report ready event when thinking stops
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevThinkingRef = useRef(props.session.thinking)

    useEffect(() => {
        // Detect transition: thinking → not thinking
        if (prevThinkingRef.current && !props.session.thinking) {
            voiceHooks.onReady(props.session.id)
        }

        prevThinkingRef.current = props.session.thinking
    }, [props.session.thinking, props.session.id])

    // Report permission requests to voice assistant
    // Note: voiceHooks internally checks isVoiceSessionStarted() so we don't need to check voice.status here
    const prevRequestIdsRef = useRef<Set<string>>(new Set())

    useEffect(() => {
        const requests = props.session.agentState?.requests ?? {}
        const currentIds = new Set(Object.keys(requests))

        for (const [requestId, request] of Object.entries(requests)) {
            if (!prevRequestIdsRef.current.has(requestId)) {
                voiceHooks.onPermissionRequested(
                    props.session.id,
                    requestId,
                    (request as { tool?: string }).tool ?? 'unknown',
                    (request as { arguments?: unknown }).arguments
                )
            }
        }

        prevRequestIdsRef.current = currentIds
    }, [props.session.agentState?.requests, props.session.id])

    const handleVoiceToggle = useCallback(async () => {
        if (!voice) return
        if (voice.status === 'connected' || voice.status === 'connecting') {
            await voice.stopVoice()
        } else {
            await voice.startVoice(props.session.id)
        }
    }, [voice, props.session.id])

    const handleVoiceMicToggle = useCallback(() => {
        if (!voice) return
        voice.toggleMic()
    }, [voice])

    // Track session id to clear caches when it changes
    const prevSessionIdRef = useRef<string | null>(null)

    useEffect(() => {
        normalizedCacheRef.current.clear()
        blocksByIdRef.current.clear()
    }, [props.session.id])

    useEffect(() => {
        setIsCodexStatusDialogOpen(false)
        setIsCodexStatusLoading(false)
        setCodexStatusMessage('')
        setCodexStatusError(null)
        setSessionUsage(null)
        setSessionUsageError(null)
        setCodexQueueStatus(null)
        setCodexQueueState(null)
        setIsCodexQueueDialogOpen(false)
        setIsCodexQueueLoading(false)
        setIsCodexQueueMutating(false)
        setCodexQueueError(null)
        setCodexCollaborationMode(normalizeCodexCollaborationMode(props.session.metadata?.collaborationMode))
        setDismissedCodexPlanSignature(null)
        setIsCodexPlanCollapsed(false)
        setIsMcpDialogOpen(false)
        setIsMcpLoading(false)
        setMcpServers([])
        setMcpFlavor(null)
        setMcpCheckedAt(null)
        setMcpWarning(null)
        setMcpError(null)
        setIsMcpGuideExpanded(false)
        setCustomMcpGuideInput('')
        setComposerInjectedPrompt(null)
        composerPromptIdRef.current = 0
    }, [props.session.id])

    useEffect(() => {
        setCodexCollaborationMode(normalizeCodexCollaborationMode(props.session.metadata?.collaborationMode))
    }, [props.session.metadata?.collaborationMode])

    const normalizedMessages: NormalizedMessage[] = useMemo(() => {
        if (props.viewMode === 'brief') {
            normalizedCacheRef.current.clear()
            blocksByIdRef.current.clear()
            prevSessionIdRef.current = props.session.id
            return []
        }

        // Clear caches immediately when session changes (before useEffect runs)
        if (prevSessionIdRef.current !== null && prevSessionIdRef.current !== props.session.id) {
            normalizedCacheRef.current.clear()
            blocksByIdRef.current.clear()
        }
        prevSessionIdRef.current = props.session.id

        const cache = normalizedCacheRef.current
        const normalized: NormalizedMessage[] = []
        const seen = new Set<string>()
        for (const message of props.messages) {
            seen.add(message.id)
            const cached = cache.get(message.id)
            if (cached && cached.source === message) {
                if (cached.normalized) normalized.push(cached.normalized)
                continue
            }
            const next = normalizeDecryptedMessage(message)
            cache.set(message.id, { source: message, normalized: next })
            if (next) normalized.push(next)
        }
        for (const id of cache.keys()) {
            if (!seen.has(id)) {
                cache.delete(id)
            }
        }
        return normalized
    }, [props.messages, props.session.id, props.viewMode])

    const toolProgress = useMemo(
        () => (props.viewMode === 'brief' ? null : extractToolProgress(props.messages)),
        [props.messages, props.viewMode]
    )

    const latestCodexPlan = useMemo(
        () => extractLatestCodexPlan(normalizedMessages),
        [normalizedMessages]
    )
    const latestCodexPlanSignature = latestCodexPlan?.signature ?? null
    const showCodexPlanNotebook = supportsQueueControls
        && (props.viewMode === 'normal' || props.viewMode === 'cli')
        && latestCodexPlan !== null
        && latestCodexPlanSignature !== dismissedCodexPlanSignature

    useEffect(() => {
        if (!latestCodexPlanSignature) {
            return
        }
        if (latestCodexPlanSignature !== dismissedCodexPlanSignature) {
            setIsCodexPlanCollapsed(false)
        }
    }, [latestCodexPlanSignature, dismissedCodexPlanSignature])

    const reduced = useMemo(
        () => reduceChatBlocks(normalizedMessages, props.session.agentState, agentFlavor),
        [normalizedMessages, props.session.agentState, agentFlavor]
    )
    const reconciled = useMemo(
        () => reconcileChatBlocks(reduced.blocks, blocksByIdRef.current),
        [reduced.blocks]
    )
    const activeQuestionTool = useMemo(
        () => findLatestPendingQuestionTool(reconciled.blocks),
        [reconciled.blocks]
    )
    const activePlanApprovalTool = useMemo(
        () => findLatestPendingPlanApprovalTool(reconciled.blocks),
        [reconciled.blocks]
    )
    const composerDisabled = props.isSending || Boolean(activeQuestionTool) || Boolean(activePlanApprovalTool)
    const timeSeparators = useMemo(() => computeTimeSeparators(reconciled.blocks), [reconciled.blocks])
    const runStats = useMemo(() => computeRunStats(reconciled.blocks), [reconciled.blocks])
    const latestContextSize = reduced.latestUsage?.contextSize
    const latestContextWindowTokens = reduced.latestUsage?.contextWindowTokens
    const contextPercentLeft = useMemo(() => {
        if (latestContextSize === undefined) return null
        const budget = latestContextWindowTokens ?? getContextBudgetTokens(props.session.modelMode)
        if (!budget) return null
        return Math.max(0, Math.round(100 - (latestContextSize / budget) * 100))
    }, [latestContextSize, latestContextWindowTokens, props.session.modelMode])

    useEffect(() => {
        blocksByIdRef.current = reconciled.byId
    }, [reconciled.byId])

    // Permission mode change handler
    const handlePermissionModeChange = useCallback(async (mode: PermissionMode) => {
        try {
            await setPermissionMode(mode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set permission mode:', e)
        }
    }, [setPermissionMode, props.onRefresh, haptic])

    // Model change handler
    const handleModelChange = useCallback(async (model: string) => {
        try {
            await setModel(model)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set model:', e)
        }
    }, [setModel, props.onRefresh, haptic])

    const handleThinkEffortChange = useCallback(async (thinkEffort: SessionThinkEffort) => {
        try {
            await setThinkEffort(thinkEffort)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set think effort:', e)
        }
    }, [setThinkEffort, props.onRefresh, haptic])

    const handleServiceTierChange = useCallback(async (serviceTier: SessionServiceTier) => {
        try {
            await setServiceTier(serviceTier)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            haptic.notification('error')
            console.error('Failed to set service tier:', e)
        }
    }, [setServiceTier, props.onRefresh, haptic])

    const handleCodexPlanModeChange = useCallback(async (enabled: boolean) => {
        const nextMode: 'plan' | 'default' = enabled ? 'plan' : 'default'
        const previousMode = codexCollaborationMode
        setCodexCollaborationMode(nextMode)
        try {
            await setCollaborationMode(nextMode)
            haptic.notification('success')
            props.onRefresh()
        } catch (e) {
            setCodexCollaborationMode(previousMode)
            haptic.notification('error')
            console.error('Failed to set codex collaboration mode:', e)
        }
    }, [setCollaborationMode, props.onRefresh, haptic, codexCollaborationMode])

    // Switch to remote handler
    const handleSwitchToRemote = useCallback(async () => {
        await switchSession()
        props.onRefresh()
    }, [switchSession, props.onRefresh])

    const handleViewFiles = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/files',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleViewPreview = useCallback(() => {
        if (dock) {
            dock.toggle('preview')
            return
        }
        navigate({
            to: '/sessions/$sessionId/preview',
            params: { sessionId: props.session.id }
        })
    }, [dock, navigate, props.session.id])

    const handleViewTerminal = useCallback(() => {
        if (dock) {
            dock.toggle('terminal')
            return
        }
        navigate({
            to: '/sessions/$sessionId/terminal',
            params: { sessionId: props.session.id }
        })
    }, [dock, navigate, props.session.id])

    // Chat links open in this session's built-in preview (side panel on desktop, preview page on phones).
    const openLinkInPreview = useCallback<OpenInPreview>(async (url) => {
        const normalized = normalizePreviewUrlInput(url)
        if (!normalized.value) return false
        try {
            await props.api.setSessionPreviewUrl(props.session.id, normalized.value)
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.session(props.session.id) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
                queryClient.invalidateQueries({ queryKey: queryKeys.previewUrlHistory })
            ])
        } catch (error) {
            console.error('Failed to open link in preview', error)
            return false
        }
        if (dock) {
            dock.open('preview')
        } else {
            navigate({ to: '/sessions/$sessionId/preview', params: { sessionId: props.session.id } })
        }
        return true
    }, [dock, navigate, props.api, props.session.id, queryClient])

    const handleSend = useCallback(async (text: string, attachments?: AttachmentMetadata[]): Promise<boolean> => {
        const sent = await Promise.resolve(props.onSend(text, attachments))
        if (sent) {
            setForceScrollToken((token) => token + 1)
        }
        return sent
    }, [props.onSend])

    const normalizeQueueText = useCallback((value: string | undefined): string | undefined => {
        if (typeof value !== 'string') {
            return undefined
        }
        const normalized = value.trim()
        return normalized.length > 0 ? normalized : undefined
    }, [])

    const normalizeQueuePreview = useCallback((value: string | undefined): string | undefined => {
        if (typeof value !== 'string') {
            return undefined
        }
        const normalized = value.trim()
        return normalized.length > 0 ? normalized : undefined
    }, [])

    const buildQueuePreviewFromText = useCallback((text: string | undefined): string | undefined => {
        const normalized = normalizeQueueText(text)
        if (!normalized) {
            return undefined
        }
        const compact = normalized.replace(/\s+/g, ' ')
        return compact.length <= 180 ? compact : `${compact.slice(0, 180)}...`
    }, [normalizeQueueText])

    const mergeQueueWithLocalFullText = useCallback(
        (queue: QueueState | null | undefined, enqueuedText?: string): QueueState | null => {
            if (!queue) {
                queueFullTextByIdRef.current.clear()
                queueFullTextByPreviewRef.current.clear()
                return null
            }

            const previousMap = queueFullTextByIdRef.current
            const previousPreviewMap = queueFullTextByPreviewRef.current
            const nextMap = new Map<string, string>()
            const nextPreviewMap = new Map<string, string>()
            const entries = queue.entries.map((entry) => {
                const previewKey = normalizeQueuePreview(entry.preview)
                const fullText = normalizeQueueText(entry.fullText)
                    ?? previousMap.get(entry.id)
                    ?? (previewKey ? previousPreviewMap.get(previewKey) : undefined)
                if (fullText) {
                    nextMap.set(entry.id, fullText)
                    if (previewKey) {
                        nextPreviewMap.set(previewKey, fullText)
                    }
                    return { ...entry, fullText }
                }
                return entry
            })

            const normalizedEnqueued = normalizeQueueText(enqueuedText)
            if (normalizedEnqueued) {
                const previewFromEnqueued = buildQueuePreviewFromText(normalizedEnqueued)
                if (previewFromEnqueued) {
                    nextPreviewMap.set(previewFromEnqueued, normalizedEnqueued)
                }
                const candidates = entries
                    .map((entry, index) => ({ entry, index }))
                    .filter(({ entry }) => !previousMap.has(entry.id) && !normalizeQueueText(entry.fullText))
                const fallbackCandidates = entries
                    .map((entry, index) => ({ entry, index }))
                    .filter(({ entry }) => !normalizeQueueText(entry.fullText))
                const pool = candidates.length > 0 ? candidates : fallbackCandidates

                let best: { entry: QueueState['entries'][number]; index: number } | null = null
                for (const item of pool) {
                    if (!best) {
                        best = item
                        continue
                    }
                    if (item.entry.enqueuedAt > best.entry.enqueuedAt) {
                        best = item
                        continue
                    }
                    if (item.entry.enqueuedAt === best.entry.enqueuedAt && item.index > best.index) {
                        best = item
                    }
                }

                if (best) {
                    const target = entries[best.index]
                    if (target) {
                        entries[best.index] = {
                            ...target,
                            fullText: normalizedEnqueued
                        }
                        nextMap.set(target.id, normalizedEnqueued)
                        const previewKey = normalizeQueuePreview(target.preview)
                        if (previewKey) {
                            nextPreviewMap.set(previewKey, normalizedEnqueued)
                        }
                    }
                }
            }

            queueFullTextByIdRef.current = nextMap
            queueFullTextByPreviewRef.current = nextPreviewMap
            return {
                ...queue,
                entries
            }
        },
        [normalizeQueueText, normalizeQueuePreview, buildQueuePreviewFromText]
    )

    const applyQueueState = useCallback(
        (queue: QueueState | null | undefined, options?: { enqueuedText?: string }): void => {
            setCodexQueueState(mergeQueueWithLocalFullText(queue, options?.enqueuedText))
        },
        [mergeQueueWithLocalFullText]
    )

    const applyCodexQueueSummary = useCallback((queue: QueueStatusResponse['queue'] | QueueState | null | undefined) => {
        if (!queue) {
            setCodexQueueStatus(null)
            return
        }
        setCodexQueueStatus({
            pendingCount: queue.pendingCount,
            inQueue: queue.inQueue,
            taskRunning: queue.taskRunning,
            nextPreview: queue.nextPreview
        })
    }, [])

    const refreshCodexQueue = useCallback(async (options?: { silent?: boolean }): Promise<void> => {
        if (!supportsQueueControls) {
            return
        }

        if (!options?.silent) {
            setIsCodexQueueLoading(true)
        }

        try {
            const result = await props.api.getQueue(props.session.id)
            if (result.success) {
                applyQueueState(result.queue ?? null)
                applyCodexQueueSummary(result.queue)
                setCodexQueueError(null)
            } else {
                const message = result.error ?? t('queue.dialog.fetchError')
                setCodexQueueError(message)
                if (result.queue) {
                    applyQueueState(result.queue)
                }
                applyCodexQueueSummary(result.queue)
                if (!options?.silent) {
                    haptic.notification('error')
                }
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('queue.dialog.fetchError')
            setCodexQueueError(message)
            if (!options?.silent) {
                haptic.notification('error')
            }
        } finally {
            if (!options?.silent) {
                setIsCodexQueueLoading(false)
            }
        }
    }, [supportsQueueControls, props.api, props.session.id, t, haptic, applyCodexQueueSummary, applyQueueState])

    const handleCodexQueueRefreshAfterSend = useCallback(() => {
        if (!supportsQueueControls) {
            return
        }
        setTimeout(() => {
            void refreshCodexQueue({ silent: true })
        }, 150)
    }, [supportsQueueControls, refreshCodexQueue])

    const handleAbort = useCallback(async () => {
        if (agentFlavor === 'codex' && codexQueuePendingCount > 0) {
            await stopAndPreserveCodexQueue()
        } else {
            await abortSession()
        }
        props.onRefresh()
        void refreshCodexQueue({ silent: true })
    }, [
        abortSession,
        stopAndPreserveCodexQueue,
        agentFlavor,
        codexQueuePendingCount,
        props.onRefresh,
        refreshCodexQueue
    ])

    const handleCodexQueueOpen = useCallback(() => {
        if (!supportsQueueControls) {
            return
        }
        setIsCodexQueueDialogOpen((previous) => {
            const next = !previous
            if (next) {
                setCodexQueueError(null)
                void refreshCodexQueue()
            }
            return next
        })
    }, [supportsQueueControls, refreshCodexQueue])

    const handleCodexQueueEnqueue = useCallback(async (payload: {
        text: string
        attachments?: AttachmentMetadata[]
    }) => {
        if (!supportsQueueControls) {
            return
        }

        const previousQueue = codexQueueState
            ?? (codexQueueStatus
                ? { ...codexQueueStatus, entries: [] }
                : null)
        const preview = buildQueuePreviewFromText(payload.text) ?? ''
        const optimisticEntry: QueueEntry = {
            id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            index: previousQueue?.entries.length ?? 0,
            preview,
            fullText: payload.text,
            modeHash: 'optimistic',
            isolate: true,
            deferredUserMessage: true,
            enqueuedAt: Date.now()
        }
        const optimisticQueue: QueueState = previousQueue
            ? {
                ...previousQueue,
                pendingCount: previousQueue.pendingCount + 1,
                inQueue: true,
                nextPreview: previousQueue.nextPreview ?? preview,
                entries: [...previousQueue.entries, optimisticEntry]
            }
            : {
                pendingCount: 1,
                inQueue: true,
                taskRunning: props.session.thinking,
                nextPreview: preview,
                entries: [optimisticEntry]
            }

        // Render the queued message before waiting for the CLI RPC. The server
        // response below remains authoritative and replaces this temporary row.
        applyQueueState(optimisticQueue, { enqueuedText: payload.text })
        applyCodexQueueSummary(optimisticQueue)

        let result
        try {
            result = await props.api.enqueueQueueMessage(props.session.id, payload)
        } catch (error) {
            applyQueueState(previousQueue)
            applyCodexQueueSummary(previousQueue)
            throw error
        }
        if (!result.success) {
            const message = result.error ?? t('queue.dialog.actionError')
            setCodexQueueError(message)
            if (result.queue) {
                applyQueueState(result.queue)
                applyCodexQueueSummary(result.queue)
            } else {
                applyQueueState(previousQueue)
                applyCodexQueueSummary(previousQueue)
            }
            haptic.notification('error')
            throw new Error(message)
        }

        setCodexQueueError(null)
        if (result.queue) {
            applyQueueState(result.queue, { enqueuedText: payload.text })
            applyCodexQueueSummary(result.queue)
        }

        if (result.sessionId && result.sessionId !== props.session.id) {
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: result.sessionId }
            })
        }
    }, [supportsQueueControls, props.api, props.session.id, t, haptic, applyCodexQueueSummary, navigate, applyQueueState, codexQueueState, codexQueueStatus, buildQueuePreviewFromText])

    const runCodexQueueAction = useCallback(async (
        action: () => Promise<{ success: boolean; error?: string; queue?: QueueState | null }>
    ): Promise<boolean> => {
        if (!supportsQueueControls) {
            return false
        }
        setIsCodexQueueMutating(true)
        setCodexQueueError(null)
        try {
            const result = await action()
            if (result.success) {
                applyQueueState(result.queue ?? null)
                applyCodexQueueSummary(result.queue ?? null)
                return true
            }
            const message = result.error ?? t('queue.dialog.actionError')
            setCodexQueueError(message)
            if (result.queue) {
                applyQueueState(result.queue)
                applyCodexQueueSummary(result.queue)
            }
            haptic.notification('error')
            return false
        } catch (error) {
            const message = error instanceof Error ? error.message : t('queue.dialog.actionError')
            setCodexQueueError(message)
            haptic.notification('error')
            return false
        } finally {
            setIsCodexQueueMutating(false)
        }
    }, [supportsQueueControls, applyCodexQueueSummary, haptic, t, applyQueueState])

    const handleCodexQueueClear = useCallback(() => {
        void runCodexQueueAction(async () => {
            const result = await props.api.clearQueue(props.session.id)
            return {
                success: result.success,
                error: result.error,
                queue: result.queue ?? null
            }
        })
    }, [props.api, props.session.id, runCodexQueueAction])

    const handleCodexQueueRemove = useCallback((id: string) => {
        void runCodexQueueAction(async () => {
            const result = await props.api.removeQueueItem(props.session.id, id)
            return {
                success: result.success,
                error: result.error,
                queue: result.queue ?? null
            }
        })
    }, [props.api, props.session.id, runCodexQueueAction])

    const handleCodexQueueMove = useCallback((id: string, toIndex: number) => {
        void runCodexQueueAction(async () => {
            const result = await props.api.moveQueueItem(props.session.id, id, toIndex)
            return {
                success: result.success,
                error: result.error,
                queue: result.queue ?? null
            }
        })
    }, [props.api, props.session.id, runCodexQueueAction])

    const handleCodexQueueUpdate = useCallback((id: string, text: string) => {
        return runCodexQueueAction(async () => {
            const result = await props.api.updateQueueItem(props.session.id, id, text)
            return {
                success: result.success,
                error: result.error,
                queue: result.queue ?? null
            }
        })
    }, [props.api, props.session.id, runCodexQueueAction])

    const handleCodexStatus = useCallback(() => {
        if (!supportsQueueControls) {
            return
        }

        setIsCodexStatusDialogOpen(true)
        setIsCodexStatusLoading(true)
        setCodexStatusError(null)
        setSessionUsageError(null)

        void (async () => {
            let hadError = false
            const [statusResult, usageResult] = await Promise.allSettled([
                props.api.getQueueStatus(props.session.id),
                props.api.getSessionUsage(props.session.id)
            ])

            if (statusResult.status === 'fulfilled') {
                if (statusResult.value.success) {
                    setCodexStatusMessage(statusResult.value.message ?? '')
                    applyCodexQueueSummary(statusResult.value.queue ?? null)
                } else {
                    const errorMessage = statusResult.value.error ?? t('queueStatus.dialog.fetchError')
                    setCodexStatusMessage('')
                    setCodexStatusError(errorMessage)
                    applyCodexQueueSummary(statusResult.value.queue ?? null)
                    hadError = true
                }
            } else {
                const errorMessage = statusResult.reason instanceof Error
                    ? statusResult.reason.message
                    : t('queueStatus.dialog.fetchError')
                setCodexStatusMessage('')
                setCodexStatusError(errorMessage)
                applyCodexQueueSummary(null)
                hadError = true
            }

            if (usageResult.status === 'fulfilled') {
                if (usageResult.value.success && usageResult.value.usage) {
                    setSessionUsage(usageResult.value.usage)
                    setSessionUsageError(null)
                } else {
                    setSessionUsage(null)
                    setSessionUsageError(usageResult.value.error ?? t('queueStatus.usage.fetchError'))
                    hadError = true
                }
            } else {
                setSessionUsage(null)
                setSessionUsageError(usageResult.reason instanceof Error
                    ? usageResult.reason.message
                    : t('queueStatus.usage.fetchError'))
                hadError = true
            }

            if (hadError) {
                haptic.notification('error')
            }
            setIsCodexStatusLoading(false)
        })()
    }, [supportsQueueControls, props.api, props.session.id, t, haptic, applyCodexQueueSummary])

    const refreshMcpStatus = useCallback(async (options?: { silent?: boolean; applyDefaultGuideExpansion?: boolean }) => {
        if (!options?.silent) {
            setIsMcpLoading(true)
        }

        try {
            const result = await props.api.getSessionMcpServers(props.session.id)
            if (result.success) {
                const servers = result.servers ?? []
                setMcpServers(servers)
                setMcpFlavor(result.flavor ?? null)
                setMcpCheckedAt(result.checkedAt ?? Date.now())
                setMcpWarning(result.warning ?? null)
                setMcpError(null)
                if (options?.applyDefaultGuideExpansion) {
                    setIsMcpGuideExpanded(servers.length === 0)
                }
            } else {
                const servers = result.servers ?? []
                setMcpServers(servers)
                setMcpFlavor(result.flavor ?? null)
                setMcpCheckedAt(result.checkedAt ?? Date.now())
                setMcpWarning(result.warning ?? null)
                setMcpError(result.error ?? t('mcp.dialog.fetchError'))
                if (options?.applyDefaultGuideExpansion) {
                    setIsMcpGuideExpanded(servers.length === 0)
                }
                haptic.notification('error')
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('mcp.dialog.fetchError')
            setMcpError(message)
            haptic.notification('error')
        } finally {
            if (!options?.silent) {
                setIsMcpLoading(false)
            }
        }
    }, [props.api, props.session.id, t, haptic])

    const handleMcpStatus = useCallback(() => {
        setIsMcpDialogOpen(true)
        setMcpError(null)
        void refreshMcpStatus({ applyDefaultGuideExpansion: true })
    }, [refreshMcpStatus])

    const handleInsertMcpGuidePrompt = useCallback((guide: McpGuideItem) => {
        composerPromptIdRef.current += 1
        setComposerInjectedPrompt({
            id: composerPromptIdRef.current,
            text: `${t('mcp.guide.promptPrefixPage')} ${guide.label} (${guide.url})`
        })
        setIsMcpDialogOpen(false)
    }, [t])

    const handleInsertCustomMcpGuidePrompt = useCallback(() => {
        const customValue = customMcpGuideInput.trim()
        if (!customValue) {
            return
        }
        composerPromptIdRef.current += 1
        setComposerInjectedPrompt({
            id: composerPromptIdRef.current,
            text: `${t('mcp.guide.promptPrefixUser')} ${customValue}`
        })
        setCustomMcpGuideInput('')
        setIsMcpDialogOpen(false)
    }, [customMcpGuideInput, t])

    useEffect(() => {
        if (!supportsQueueControls) {
            return
        }
        void refreshCodexQueue({ silent: true })
    }, [supportsQueueControls, props.session.id, props.session.thinking, queueInlinePanelMode, refreshCodexQueue])

    useEffect(() => {
        if (!supportsQueueControls) {
            return
        }
        if (queueInlinePanelMode === 'off' || isCodexQueueDialogOpen) {
            return
        }
        const timer = window.setInterval(() => {
            void refreshCodexQueue({ silent: true })
        }, inlineQueuePollIntervalMs)
        return () => window.clearInterval(timer)
    }, [supportsQueueControls, queueInlinePanelMode, isCodexQueueDialogOpen, inlineQueuePollIntervalMs, refreshCodexQueue])

    useEffect(() => {
        if (!supportsQueueControls || !isCodexQueueDialogOpen) {
            return
        }
        const timer = window.setInterval(() => {
            void refreshCodexQueue({ silent: true })
        }, dialogQueuePollIntervalMs)
        return () => window.clearInterval(timer)
    }, [supportsQueueControls, isCodexQueueDialogOpen, dialogQueuePollIntervalMs, refreshCodexQueue])

    const handleResumeSession = useCallback(async () => {
        try {
            const resumedSessionId = await resumeSession()
            props.onRefresh()
            if (resumedSessionId !== props.session.id) {
                navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: resumedSessionId },
                    replace: true
                })
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : t('session.resumeFailed')
            addToast({
                title: t('session.resumeFailed'),
                body: message,
                sessionId: props.session.id,
                url: `/sessions/${props.session.id}`
            })
        }
    }, [addToast, navigate, props, resumeSession, t])

    const attachmentAdapter = useMemo(() => {
        if (!props.session.active) {
            return undefined
        }
        return createAttachmentAdapter(props.api, props.session.id)
    }, [props.api, props.session.id, props.session.active])

    const handleTeamControl = useCallback(async (request: TeamControlRequest) => {
        await props.api.controlTeam(props.session.id, request)
        addToast({
            title: t('team.toast.title'),
            body: describeTeamControlRequest(request, t),
            sessionId: props.session.id,
            url: `/sessions/${props.session.id}`
        })
    }, [addToast, props.api, props.session.id, t])

    const runtime = useHappyRuntime({
        session: props.session,
        blocks: reconciled.blocks,
        isSending: props.isSending,
        onSendMessage: handleSend,
        onAbort: handleAbort,
        attachmentAdapter
    })

    return (
        <PreviewLinkContext.Provider value={experimentalSettings.previewEnabled ? openLinkInPreview : null}>
            <div className="flex h-full flex-col">
                <SessionHeader
                    session={props.session}
                    onBack={props.onBack}
                    onOpenSession={(sessionId) => {
                        navigate({
                            to: '/sessions/$sessionId',
                            params: { sessionId }
                        })
                    }}
                    onToggleSidebar={props.onToggleSidebar}
                    sidebarVisible={props.sidebarVisible}
                    onViewPreview={experimentalSettings.previewEnabled ? handleViewPreview : undefined}
                    onViewFiles={props.session.metadata?.path ? handleViewFiles : undefined}
                    onViewMcpStatus={handleMcpStatus}
                    onViewTerminal={props.session.active ? handleViewTerminal : undefined}
                    viewMode={props.viewMode}
                    onViewModeChange={props.onViewModeChange}
                    zoomController={props.viewMode === 'normal' ? chatZoom : undefined}
                    usage={{
                        contextSize: latestContextSize,
                        contextWindowTokens: latestContextWindowTokens,
                        rateLimitSnapshot: props.session.metadata?.rateLimitSnapshot,
                        contextPercentLeft
                    }}
                    api={props.api}
                    onSessionDeleted={props.onBack}
                />


                {(props.session.teamState || (props.session.agentState?.runningAgents?.length ?? 0) > 0 || props.session.agentState?.runningAgent) && (
                    <TeamPanel
                        teamState={props.session.teamState}
                        agentState={props.session.agentState}
                        canControl={props.session.active && props.session.metadata?.flavor === 'claude' && Boolean(props.session.teamState)}
                        onControl={handleTeamControl}
                    />
                )}

                <AssistantRuntimeProvider runtime={runtime}>
                    <div className={`relative flex min-h-0 flex-1 flex-col${props.viewMode === 'cli' ? ' cli-session' : ''}`}>
                        {showCodexPlanNotebook && latestCodexPlan ? (
                            <div className="px-3 pt-2">
                                <Card className="mx-auto w-full max-w-content p-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">
                                            {t('queuePlan.title')}
                                        </span>
                                        <span className="text-caption text-[var(--social-fg-subtle)]">
                                            {t('queuePlan.updated', {
                                                time: new Date(latestCodexPlan.updatedAt).toLocaleTimeString([], {
                                                    hour: '2-digit',
                                                    minute: '2-digit'
                                                })
                                            })}
                                        </span>
                                        <div className="ml-auto flex items-center gap-1">
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="px-3"
                                                onClick={() => setIsCodexPlanCollapsed((prev) => !prev)}
                                            >
                                                {isCodexPlanCollapsed ? t('queuePlan.expand') : t('queuePlan.collapse')}
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                className="px-3"
                                                onClick={() => setDismissedCodexPlanSignature(latestCodexPlan.signature)}
                                            >
                                                {t('queuePlan.close')}
                                            </Button>
                                        </div>
                                    </div>

                                    {!isCodexPlanCollapsed ? (
                                        <div className="mt-2 space-y-1.5">
                                            {latestCodexPlan.explanation ? (
                                                <div className="text-footnote text-[var(--social-fg-muted)]">
                                                    {latestCodexPlan.explanation}
                                                </div>
                                            ) : null}
                                            <div className="space-y-1">
                                                {latestCodexPlan.entries.map((entry, index) => (
                                                    <div key={`${entry.step}:${index}`} className="flex items-start gap-2 text-footnote">
                                                        <Badge variant={getCodexPlanStatusBadgeVariant(entry.status)}>
                                                            {entry.status === 'completed'
                                                                ? t('queuePlan.status.completed')
                                                                : entry.status === 'in_progress'
                                                                    ? t('queuePlan.status.inProgress')
                                                                    : t('queuePlan.status.pending')}
                                                        </Badge>
                                                        <span className="min-w-0 flex-1 break-words pt-0.5 text-[var(--social-fg)]">
                                                            {entry.step}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : null}
                                </Card>
                            </div>
                        ) : null}

                        {props.viewMode === 'brief' ? (
                            <BriefTurnList
                                api={props.api}
                                session={props.session}
                                turns={props.turns}
                                warning={props.turnsWarning}
                                isLoading={props.isLoadingTurns}
                                isLoadingMore={props.isLoadingMoreTurns}
                                hasMore={props.hasMoreTurns}
                                thinking={props.session.thinking}
                                density={props.density ?? 'comfortable'}
                                onLoadMoreTurns={props.onLoadMoreTurns}
                            />
                        ) : props.viewMode === 'cli' ? (
                            <CliThread
                                api={props.api}
                                sessionId={props.session.id}
                                metadata={props.session.metadata}
                                agentState={props.session.agentState}
                                permissionMode={props.session.permissionMode}
                                disabled={sessionInactive}
                                blocks={reconciled.blocks}
                                isLoadingMessages={props.isLoadingMessages}
                                messagesWarning={props.messagesWarning}
                                hasMoreMessages={props.hasMoreMessages}
                                isLoadingMoreMessages={props.isLoadingMoreMessages}
                                onLoadMore={props.onLoadMore}
                                onRefresh={props.onRefresh}
                                onFlushPending={props.onFlushPending}
                                onRetryMessage={props.onRetryMessage}
                                onAtBottomChange={props.onAtBottomChange}
                                pendingCount={props.pendingCount}
                                newestMessageSeq={props.newestMessageSeq}
                                messagesVersion={props.messagesVersion}
                                density={props.density ?? 'comfortable'}
                            />
                        ) : (
                            <HappyThread
                                api={props.api}
                                sessionId={props.session.id}
                                metadata={props.session.metadata}
                                agentState={props.session.agentState}
                                permissionMode={props.session.permissionMode}
                                disabled={sessionInactive}
                                onRefresh={props.onRefresh}
                                onRetryMessage={props.onRetryMessage}
                                onFlushPending={props.onFlushPending}
                                onAtBottomChange={props.onAtBottomChange}
                                isLoadingMessages={props.isLoadingMessages}
                                messagesWarning={props.messagesWarning}
                                hasMoreMessages={props.hasMoreMessages}
                                isLoadingMoreMessages={props.isLoadingMoreMessages}
                                onLoadMore={props.onLoadMore}
                                pendingCount={props.pendingCount}
                                newestMessageSeq={props.newestMessageSeq}
                                messagesVersion={props.messagesVersion}
                                forceScrollToken={forceScrollToken}
                                density={props.density ?? 'comfortable'}
                                toolProgress={toolProgress}
                                layout="social"
                                timeSeparators={timeSeparators}
                                runStats={runStats}
                                zoomController={chatZoom}
                            />
                        )}

                        <HappyComposer
                            sessionId={props.session.id}
                            disabled={composerDisabled}
                            cliMode={props.viewMode === 'cli'}
                            permissionMode={props.session.permissionMode}
                            modelMode={props.session.modelMode}
                            model={props.session.metadata?.model}
                            thinkEffort={props.session.metadata?.thinkEffort}
                            serviceTier={props.session.metadata?.serviceTier}
                            codexCollaborationMode={codexCollaborationMode}
                            agentFlavor={agentFlavor}
                            active={props.session.active}
                            thinking={props.session.thinking}
                            agentState={props.session.agentState}
                            contextSize={reduced.latestUsage?.contextSize}
                            contextWindowTokens={reduced.latestUsage?.contextWindowTokens}
                            rateLimitSnapshot={props.session.metadata?.rateLimitSnapshot}
                            controlledByUser={props.session.agentState?.controlledByUser === true}
                            onPermissionModeChange={handlePermissionModeChange}
                            onModelChange={handleModelChange}
                            onThinkEffortChange={handleThinkEffortChange}
                            onServiceTierChange={handleServiceTierChange}
                            onSwitchToRemote={handleSwitchToRemote}
                            onTerminal={props.session.active ? handleViewTerminal : undefined}
                            onCodexStatus={supportsQueueControls ? handleCodexStatus : undefined}
                            codexSendMode={codexSendMode}
                            onCodexPlanModeChange={agentFlavor === 'codex' ? handleCodexPlanModeChange : undefined}
                            codexQueuePendingCount={codexQueuePendingCount}
                            codexQueueSummary={codexQueueSummary}
                            codexQueueEntries={codexQueueEntries}
                            codexQueueDialogOpen={isCodexQueueDialogOpen}
                            codexQueueInlinePanelMode={isCodexQueueDialogOpen ? 'off' : queueInlinePanelMode}
                            onCodexQueueOpen={supportsQueueControls ? handleCodexQueueOpen : undefined}
                            onCodexQueueUpdated={supportsQueueControls ? handleCodexQueueRefreshAfterSend : undefined}
                            onCodexQueueEnqueue={supportsQueueControls ? handleCodexQueueEnqueue : undefined}
                            isSendingMessage={props.isSending}
                            onSendMessage={handleSend}
                            onRemoveDraftAttachment={async (path) => {
                                await props.api.deleteUploadFile(props.session.id, path)
                            }}
                            autocompleteSuggestions={props.autocompleteSuggestions}
                            injectedPrompt={composerInjectedPrompt}
                            voiceStatus={voice?.status}
                            voiceMicMuted={voice?.micMuted}
                            onVoiceToggle={voice ? handleVoiceToggle : undefined}
                            onVoiceMicToggle={voice ? handleVoiceMicToggle : undefined}
                            dictationApi={props.api}
                            dictationHotwords={dictationHotwords}
                            offlineWakeMessage={t('session.inactiveMessage')}
                            offlineWakeLabel={t('session.wake')}
                            offlineWakingLabel={t('session.waking')}
                            offlineWakePending={isPending}
                            onOfflineWake={props.api ? () => void handleResumeSession() : undefined}
                        />

                        <QuestionToolOverlay
                            api={props.api}
                            sessionId={props.session.id}
                            tool={activeQuestionTool}
                            disabled={props.isSending}
                            onDone={props.onRefresh}
                        />

                        <PlanApprovalOverlay
                            api={props.api}
                            sessionId={props.session.id}
                            metadata={props.session.metadata ?? null}
                            tool={activePlanApprovalTool}
                            disabled={props.isSending}
                            onDone={props.onRefresh}
                        />
                    </div>
                </AssistantRuntimeProvider>

                <Dialog open={isMcpDialogOpen} onOpenChange={setIsMcpDialogOpen}>
                    <DialogContent className="max-h-[85vh] max-w-2xl overflow-hidden">
                        <DialogHeader>
                            <DialogTitle>{t('mcp.dialog.title')}</DialogTitle>
                            <DialogDescription>{t('mcp.dialog.description')}</DialogDescription>
                        </DialogHeader>
                        <div className="mt-3 max-h-[calc(85vh-7rem)] space-y-3 overflow-y-auto pr-1">
                            <div
                                className={`rounded-2xl border border-[var(--social-border)] bg-[var(--social-hover)] p-3 ${!isMcpGuideExpanded ? 'cursor-pointer' : ''}`}
                                onClick={() => {
                                    if (!isMcpGuideExpanded) {
                                        setIsMcpGuideExpanded(true)
                                    }
                                }}
                                onKeyDown={(event) => {
                                    if (isMcpGuideExpanded) {
                                        return
                                    }
                                    if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        setIsMcpGuideExpanded(true)
                                    }
                                }}
                                role="button"
                                tabIndex={0}
                                aria-expanded={isMcpGuideExpanded}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">
                                        {t('mcp.guide.title')}
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setIsMcpGuideExpanded((prev) => !prev)}
                                    >
                                        {isMcpGuideExpanded ? t('mcp.guide.collapse') : t('mcp.guide.expand')}
                                    </Button>
                                </div>
                                {isMcpGuideExpanded ? (
                                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {MCP_GUIDES.map((guide) => (
                                            <div
                                                key={guide.id}
                                                className="rounded-xl border border-[var(--social-border)] bg-[var(--social-surface)] p-3"
                                            >
                                                <div className="text-body font-semibold text-[var(--social-fg)]">
                                                    {guide.label}
                                                </div>
                                                <div className="mt-1 text-footnote text-[var(--social-fg-muted)]">
                                                    {t(guide.descriptionKey)}
                                                </div>
                                                <div className="mt-2 flex items-center gap-2">
                                                    <Button asChild variant="outline" size="sm">
                                                        <a href={guide.url} target="_blank" rel="noreferrer">
                                                            {t('mcp.guide.open')}
                                                        </a>
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleInsertMcpGuidePrompt(guide)}
                                                    >
                                                        {t('mcp.guide.insertPrompt')}
                                                    </Button>
                                                </div>
                                            </div>
                                        ))}
                                        <div className="rounded-xl border border-[var(--social-border)] bg-[var(--social-surface)] p-3">
                                            <div className="text-body font-semibold text-[var(--social-fg)]">
                                                {t('mcp.guide.custom.title')}
                                            </div>
                                            <div className="mt-2 space-y-2">
                                                <TextField
                                                    type="text"
                                                    value={customMcpGuideInput}
                                                    onChange={(event) => setCustomMcpGuideInput(event.target.value)}
                                                    placeholder={t('mcp.guide.custom.placeholder')}
                                                />
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full"
                                                    onClick={handleInsertCustomMcpGuidePrompt}
                                                    disabled={customMcpGuideInput.trim().length === 0}
                                                >
                                                    {t('mcp.guide.insertPrompt')}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>

                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="text-footnote text-[var(--social-fg-muted)]">
                                    {mcpFlavor ? `${t('mcp.dialog.flavor')}: ${mcpFlavor}` : null}
                                    {mcpCheckedAt ? ` · ${new Date(mcpCheckedAt).toLocaleString()}` : null}
                                </div>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void refreshMcpStatus()}
                                    disabled={isMcpLoading}
                                >
                                    {t('mcp.dialog.refresh')}
                                </Button>
                            </div>

                            {isMcpLoading ? (
                                <Card className="p-3 text-footnote text-[var(--social-fg-muted)]">
                                    {t('mcp.dialog.loading')}
                                </Card>
                            ) : null}

                            {mcpError ? (
                                <div className="rounded-2xl border border-[var(--app-badge-error-border)] bg-[var(--app-badge-error-bg)] p-3 text-footnote text-[var(--app-badge-error-text)]">
                                    {mcpError}
                                </div>
                            ) : null}

                            {mcpWarning ? (
                                <div className="rounded-2xl border border-[var(--app-badge-warning-border)] bg-[var(--app-badge-warning-bg)] p-3 text-footnote text-[var(--app-badge-warning-text)]">
                                    {mcpWarning}
                                </div>
                            ) : null}

                            {!isMcpLoading && mcpServers.length === 0 && !mcpError ? (
                                <EmptyState title={t('mcp.dialog.empty')} />
                            ) : null}

                            {mcpServers.length > 0 ? (
                                <div className="space-y-2">
                                    {mcpServers.map((server) => (
                                        <Card
                                            key={`${server.name}:${server.source ?? 'unknown'}`}
                                            className="p-3"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="text-body font-semibold text-[var(--social-fg)]">
                                                    {server.name}
                                                </div>
                                                <Badge variant={server.available ? 'success' : 'destructive'}>
                                                    {server.available ? t('mcp.server.available') : t('mcp.server.unavailable')}
                                                </Badge>
                                            </div>
                                            <div className="mt-2 grid grid-cols-1 gap-2 text-footnote text-[var(--social-fg-muted)] sm:grid-cols-2">
                                                <div>
                                                    <span className="text-caption uppercase tracking-wide">{t('mcp.server.status')}</span>
                                                    <div className="mt-1 break-all text-body text-[var(--social-fg)]">{server.status}</div>
                                                </div>
                                                <div>
                                                    <span className="text-caption uppercase tracking-wide">{t('mcp.server.transport')}</span>
                                                    <div className="mt-1 text-body text-[var(--social-fg)]">{server.transport ?? 'unknown'}</div>
                                                </div>
                                                {server.source ? (
                                                    <div>
                                                        <span className="text-caption uppercase tracking-wide">{t('mcp.server.source')}</span>
                                                        <div className="mt-1 text-body text-[var(--social-fg)]">{server.source}</div>
                                                    </div>
                                                ) : null}
                                                {server.target ? (
                                                    <div>
                                                        <span className="text-caption uppercase tracking-wide">{t('mcp.server.target')}</span>
                                                        <div className="mt-1 break-all text-footnote font-mono text-[var(--social-fg)]">{server.target}</div>
                                                    </div>
                                                ) : null}
                                                {server.auth ? (
                                                    <div className="sm:col-span-2">
                                                        <span className="text-caption uppercase tracking-wide">{t('mcp.server.auth')}</span>
                                                        <div className="mt-1 break-all text-body text-[var(--social-fg)]">{server.auth}</div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </DialogContent>
                </Dialog>

                <QueueStatusSheet
                    open={isCodexStatusDialogOpen}
                    onOpenChange={setIsCodexStatusDialogOpen}
                    loading={isCodexStatusLoading}
                    error={codexStatusError}
                    status={codexQueueStatus ?? null}
                    rows={codexStatusDetailRows}
                    message={codexStatusMessage}
                    usage={sessionUsage}
                    usageError={sessionUsageError}
                    formatNumber={formatUsageNumber}
                />

                <QueueSheet
                    open={isCodexQueueDialogOpen}
                    onOpenChange={setIsCodexQueueDialogOpen}
                    sendMode={codexSendMode}
                    loading={isCodexQueueLoading}
                    mutating={isCodexQueueMutating}
                    error={codexQueueError}
                    status={codexQueueStatus ?? null}
                    entries={codexQueueEntries}
                    onRefresh={() => void refreshCodexQueue()}
                    onClear={handleCodexQueueClear}
                    onMove={handleCodexQueueMove}
                    onRemove={handleCodexQueueRemove}
                    onUpdate={handleCodexQueueUpdate}
                />

                {/* Voice session component - renders nothing but initializes ElevenLabs */}
                {voice && (
                    <Suspense fallback={null}>
                        <RealtimeVoiceSession
                            api={props.api}
                            micMuted={voice.micMuted}
                            onStatusChange={voice.setStatus}
                        />
                    </Suspense>
                )}
            </div>
        </PreviewLinkContext.Provider>
    )
}
