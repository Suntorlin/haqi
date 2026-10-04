import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { AssistantRuntimeProvider } from '@assistant-ui/react'
import type { ApiClient } from '@/api/client'
import type {
    AttachmentMetadata,
    ConversationTurn,
    McpServerSummary,
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
import { safeReadCodexSendModeDefault } from '@/hooks/useCodexSendModePreference'
import { HappyThread } from '@/components/AssistantChat/HappyThread'
import { BriefTurnList } from '@/components/AssistantChat/BriefTurnList'
import { CliThread } from '@/components/AssistantChat/CliThread'
import { LiveActivityBar } from '@/components/AssistantChat/LiveActivityBar'
import { useHappyRuntime } from '@/lib/assistant-runtime'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { SessionHeader } from '@/components/SessionHeader'
import { TeamPanel } from '@/components/TeamPanel'
import { usePlatform } from '@/hooks/usePlatform'
import { useQueueInlinePanel } from '@/hooks/useQueueInlinePanel'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { useExperimentalSettings } from '@/hooks/queries/useExperimentalSettings'
import { QuestionToolOverlay } from '@/components/ToolCard/QuestionToolOverlay'
import { PlanApprovalOverlay } from '@/components/ToolCard/PlanApprovalOverlay'
import { findLatestPendingQuestionTool } from '@/components/ToolCard/questionTools'
import { findLatestPendingPlanApprovalTool } from '@/components/ToolCard/exitPlanMode'
import type { SessionListDensity } from '@/hooks/useSessionListDensity'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from '@/lib/use-translation'
import { useVoiceOptional } from '@/lib/voice-context'
import { useToast } from '@/lib/toast-context'
import { RealtimeVoiceSession, registerSessionStore, registerVoiceHooksStore, voiceHooks } from '@/realtime'
import { supportsQueueControlsFlavor } from '@/lib/agentFlavorUtils'
import type { ChatViewMode } from '@/hooks/useChatViewMode'

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

function isWideStatusField(label: string): boolean {
    const normalized = label.toLowerCase()
    return normalized.includes('rate limit')
        || normalized.includes('login status')
        || normalized.includes('native status warnings')
}

function parseRateLimitValue(value: string): { usedPercent: number | null; resetAt: string } {
    const match = value.match(/^(\d+(?:\.\d+)?)%\s*,\s*resets at\s*(.+)$/i)
    if (!match) {
        return { usedPercent: null, resetAt: value }
    }
    return {
        usedPercent: Number.parseFloat(match[1]),
        resetAt: match[2] ?? ''
    }
}

function getBooleanValueTone(value: string): 'yes' | 'no' | 'unknown' | null {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'yes') return 'yes'
    if (normalized === 'no') return 'no'
    if (normalized === 'unknown') return 'unknown'
    return null
}

function describeTeamControlRequest(request: TeamControlRequest): string {
    switch (request.action) {
        case 'message':
            return request.memberName
                ? `Sent a message request for ${request.memberName}.`
                : 'Sent a teammate message request.'
        case 'nudge_member':
            return request.memberName
                ? `Asked the lead to check on ${request.memberName}.`
                : 'Asked the lead to nudge a teammate.'
        case 'shutdown_member':
            return request.memberName
                ? `Asked the lead to shut down ${request.memberName} gracefully.`
                : 'Asked the lead to shut down a teammate.'
        case 'assign_task':
            return request.memberName && request.taskId
                ? `Asked the lead to assign ${request.taskId} to ${request.memberName}.`
                : 'Asked the lead to assign a task.'
        case 'cleanup_team':
            return 'Asked the lead to clean up the entire team.'
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

function getCodexPlanStatusBadgeClass(status: CodexPlanStatus): string {
    if (status === 'completed') return 'bg-emerald-500/10 text-emerald-600'
    if (status === 'in_progress') return 'bg-blue-500/10 text-blue-600'
    return 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
}

const CODEX_SEND_MODE_STORAGE_PREFIX = 'hapi:codexSendMode:'

function getCodexSendModeStorageKey(sessionId: string): string {
    return `${CODEX_SEND_MODE_STORAGE_PREFIX}${sessionId}`
}

function readCodexSendMode(sessionId: string): CodexSendMode {
    if (typeof window === 'undefined') {
        return 'direct'
    }
    try {
        const value = localStorage.getItem(getCodexSendModeStorageKey(sessionId))
        if (value === 'queue' || value === 'direct') {
            return value
        }
        return safeReadCodexSendModeDefault()
    } catch {
        return safeReadCodexSendModeDefault()
    }
}

function writeCodexSendMode(sessionId: string, mode: CodexSendMode): void {
    if (typeof window === 'undefined') {
        return
    }
    try {
        localStorage.setItem(getCodexSendModeStorageKey(sessionId), mode)
    } catch {
    }
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
    const { settings: experimentalSettings } = useExperimentalSettings(props.api, true)
    const sessionInactive = !props.session.active
    const normalizedCacheRef = useRef<Map<string, { source: DecryptedMessage; normalized: NormalizedMessage | null }>>(new Map())
    const blocksByIdRef = useRef<Map<string, ChatBlock>>(new Map())
    const [forceScrollToken, setForceScrollToken] = useState(0)
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
    const [codexSendMode, setCodexSendMode] = useState<CodexSendMode>(() => readCodexSendMode(props.session.id))
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
        setCodexSendMode(readCodexSendMode(props.session.id))
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
        navigate({
            to: '/sessions/$sessionId/preview',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

    const handleViewTerminal = useCallback(() => {
        navigate({
            to: '/sessions/$sessionId/terminal',
            params: { sessionId: props.session.id }
        })
    }, [navigate, props.session.id])

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

    const handleCodexQueueModeChange = useCallback((mode: CodexSendMode) => {
        setCodexSendMode(mode)
        writeCodexSendMode(props.session.id, mode)
    }, [props.session.id])

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

        const result = await props.api.enqueueQueueMessage(props.session.id, payload)
        if (!result.success) {
            const message = result.error ?? t('queue.dialog.actionError')
            setCodexQueueError(message)
            if (result.queue) {
                applyQueueState(result.queue)
                applyCodexQueueSummary(result.queue)
            }
            haptic.notification('error')
            throw new Error(message)
        }

        setCodexQueueError(null)
        applyQueueState(result.queue ?? null, { enqueuedText: payload.text })
        applyCodexQueueSummary(result.queue ?? null)

        if (result.sessionId && result.sessionId !== props.session.id) {
            navigate({
                to: '/sessions/$sessionId',
                params: { sessionId: result.sessionId }
            })
        }
    }, [supportsQueueControls, props.api, props.session.id, t, haptic, applyCodexQueueSummary, navigate, applyQueueState])

    const runCodexQueueAction = useCallback(async (
        action: () => Promise<{ success: boolean; error?: string; queue?: QueueState | null }>
    ) => {
        if (!supportsQueueControls) {
            return
        }
        setIsCodexQueueMutating(true)
        setCodexQueueError(null)
        try {
            const result = await action()
            if (result.success) {
                applyQueueState(result.queue ?? null)
                applyCodexQueueSummary(result.queue ?? null)
                return
            }
            const message = result.error ?? t('queue.dialog.actionError')
            setCodexQueueError(message)
            if (result.queue) {
                applyQueueState(result.queue)
                applyCodexQueueSummary(result.queue)
            }
            haptic.notification('error')
        } catch (error) {
            const message = error instanceof Error ? error.message : t('queue.dialog.actionError')
            setCodexQueueError(message)
            haptic.notification('error')
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
            const message = error instanceof Error ? error.message : 'Resume failed'
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
            title: 'Team lead notified',
            body: describeTeamControlRequest(request),
            sessionId: props.session.id,
            url: `/sessions/${props.session.id}`
        })
    }, [addToast, props.api, props.session.id])

    const runtime = useHappyRuntime({
        session: props.session,
        blocks: reconciled.blocks,
        isSending: props.isSending,
        onSendMessage: handleSend,
        onAbort: handleAbort,
        attachmentAdapter
    })

    return (
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
                            <div className="mx-auto w-full max-w-content rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/50 p-2.5">
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                        {t('queuePlan.title')}
                                    </span>
                                    <span className="text-[10px] text-[var(--app-hint)]">
                                        {t('queuePlan.updated', {
                                            time: new Date(latestCodexPlan.updatedAt).toLocaleTimeString([], {
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })
                                        })}
                                    </span>
                                    <div className="ml-auto flex items-center gap-1">
                                        <button
                                            type="button"
                                            className="rounded px-1.5 py-1 text-[11px] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                                            onClick={() => setIsCodexPlanCollapsed((prev) => !prev)}
                                        >
                                            {isCodexPlanCollapsed ? t('queuePlan.expand') : t('queuePlan.collapse')}
                                        </button>
                                        <button
                                            type="button"
                                            className="rounded px-1.5 py-1 text-[11px] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                                            onClick={() => setDismissedCodexPlanSignature(latestCodexPlan.signature)}
                                        >
                                            {t('queuePlan.close')}
                                        </button>
                                    </div>
                                </div>

                                {!isCodexPlanCollapsed ? (
                                    <div className="mt-2 space-y-1.5">
                                        {latestCodexPlan.explanation ? (
                                            <div className="text-xs text-[var(--app-hint)]">
                                                {latestCodexPlan.explanation}
                                            </div>
                                        ) : null}
                                        <div className="space-y-1">
                                            {latestCodexPlan.entries.map((entry, index) => (
                                                <div key={`${entry.step}:${index}`} className="flex items-start gap-2 text-xs">
                                                    <span
                                                        className={`mt-0.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium ${getCodexPlanStatusBadgeClass(entry.status)}`}
                                                    >
                                                        {entry.status === 'completed'
                                                            ? t('queuePlan.status.completed')
                                                            : entry.status === 'in_progress'
                                                                ? t('queuePlan.status.inProgress')
                                                                : t('queuePlan.status.pending')}
                                                    </span>
                                                    <span className="min-w-0 flex-1 break-words text-[var(--app-fg)]">
                                                        {entry.step}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    ) : null}

                    <div className="px-3 pt-2">
                        <div className="mx-auto flex w-full max-w-content items-center justify-end gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/40 p-1">
                            <button
                                type="button"
                                className={`rounded px-2.5 py-1 text-xs transition-colors ${props.viewMode === 'normal'
                                    ? 'bg-[var(--app-bg)] text-[var(--app-fg)]'
                                    : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                                onClick={() => props.onViewModeChange('normal')}
                            >
                                Normal
                            </button>
                            <button
                                type="button"
                                className={`rounded px-2.5 py-1 text-xs transition-colors ${props.viewMode === 'brief'
                                    ? 'bg-[var(--app-bg)] text-[var(--app-fg)]'
                                    : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                                onClick={() => props.onViewModeChange('brief')}
                            >
                                Brief
                            </button>
                            <button
                                type="button"
                                className={`rounded px-2.5 py-1 text-xs font-mono transition-colors ${props.viewMode === 'cli'
                                    ? 'bg-[var(--app-bg)] text-[var(--app-fg)]'
                                    : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                                onClick={() => props.onViewModeChange('cli')}
                            >
                                CLI
                            </button>
                        </div>
                    </div>

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
                        />
                    )}

                    {props.viewMode === 'normal' && (
                        <LiveActivityBar
                            messages={props.messages}
                            visible={props.session.thinking === true}
                            toolProgress={toolProgress}
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
                        onCodexPlanModeChange={supportsQueueControls ? handleCodexPlanModeChange : undefined}
                        onCodexSendModeChange={supportsQueueControls ? handleCodexQueueModeChange : undefined}
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
                            className={`rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 ${!isMcpGuideExpanded ? 'cursor-pointer' : ''}`}
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
                                <div className="text-[11px] uppercase tracking-wide text-[var(--app-hint)]">
                                    {t('mcp.guide.title')}
                                </div>
                                <button
                                    type="button"
                                    className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() => setIsMcpGuideExpanded((prev) => !prev)}
                                >
                                    {isMcpGuideExpanded ? t('mcp.guide.collapse') : t('mcp.guide.expand')}
                                </button>
                            </div>
                            {isMcpGuideExpanded ? (
                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {MCP_GUIDES.map((guide) => (
                                        <div
                                            key={guide.id}
                                            className="rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-2.5"
                                        >
                                            <div className="text-sm font-semibold text-[var(--app-fg)]">
                                                {guide.label}
                                            </div>
                                            <div className="mt-1 text-xs text-[var(--app-hint)]">
                                                {t(guide.descriptionKey)}
                                            </div>
                                            <div className="mt-2 flex items-center gap-2">
                                                <a
                                                    href={guide.url}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                                                >
                                                    {t('mcp.guide.open')}
                                                </a>
                                                <button
                                                    type="button"
                                                    onClick={() => handleInsertMcpGuidePrompt(guide)}
                                                    className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                                                >
                                                    {t('mcp.guide.insertPrompt')}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                    <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-2.5">
                                        <div className="text-sm font-semibold text-[var(--app-fg)]">
                                            {t('mcp.guide.custom.title')}
                                        </div>
                                        <div className="mt-2 space-y-2">
                                            <input
                                                type="text"
                                                value={customMcpGuideInput}
                                                onChange={(event) => setCustomMcpGuideInput(event.target.value)}
                                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 text-xs text-[var(--app-fg)] outline-none transition-colors focus:border-[var(--app-link)]"
                                                placeholder={t('mcp.guide.custom.placeholder')}
                                            />
                                            <button
                                                type="button"
                                                onClick={handleInsertCustomMcpGuidePrompt}
                                                disabled={customMcpGuideInput.trim().length === 0}
                                                className="w-full rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {t('mcp.guide.insertPrompt')}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : null}
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-[var(--app-hint)]">
                                {mcpFlavor ? `${t('mcp.dialog.flavor')}: ${mcpFlavor}` : null}
                                {mcpCheckedAt ? ` · ${new Date(mcpCheckedAt).toLocaleString()}` : null}
                            </div>
                            <button
                                type="button"
                                className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                                onClick={() => void refreshMcpStatus()}
                                disabled={isMcpLoading}
                            >
                                {t('mcp.dialog.refresh')}
                            </button>
                        </div>

                        {isMcpLoading ? (
                            <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-sm text-[var(--app-hint)]">
                                {t('mcp.dialog.loading')}
                            </div>
                        ) : null}

                        {mcpError ? (
                            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
                                {mcpError}
                            </div>
                        ) : null}

                        {mcpWarning ? (
                            <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-600">
                                {mcpWarning}
                            </div>
                        ) : null}

                        {!isMcpLoading && mcpServers.length === 0 && !mcpError ? (
                            <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-sm text-[var(--app-hint)]">
                                {t('mcp.dialog.empty')}
                            </div>
                        ) : null}

                        {mcpServers.length > 0 ? (
                            <div className="space-y-2">
                                {mcpServers.map((server) => (
                                    <div
                                        key={`${server.name}:${server.source ?? 'unknown'}`}
                                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3"
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-sm font-semibold text-[var(--app-fg)]">
                                                {server.name}
                                            </div>
                                            <span
                                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                                    server.available
                                                        ? 'bg-emerald-500/10 text-emerald-600'
                                                        : 'bg-red-500/10 text-red-500'
                                                }`}
                                            >
                                                {server.available ? t('mcp.server.available') : t('mcp.server.unavailable')}
                                            </span>
                                        </div>
                                        <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-[var(--app-hint)] sm:grid-cols-2">
                                            <div>
                                                <span className="text-[10px] uppercase tracking-wide">{t('mcp.server.status')}</span>
                                                <div className="mt-1 break-all text-sm text-[var(--app-fg)]">{server.status}</div>
                                            </div>
                                            <div>
                                                <span className="text-[10px] uppercase tracking-wide">{t('mcp.server.transport')}</span>
                                                <div className="mt-1 text-sm text-[var(--app-fg)]">{server.transport ?? 'unknown'}</div>
                                            </div>
                                            {server.source ? (
                                                <div>
                                                    <span className="text-[10px] uppercase tracking-wide">{t('mcp.server.source')}</span>
                                                    <div className="mt-1 text-sm text-[var(--app-fg)]">{server.source}</div>
                                                </div>
                                            ) : null}
                                            {server.target ? (
                                                <div>
                                                    <span className="text-[10px] uppercase tracking-wide">{t('mcp.server.target')}</span>
                                                    <div className="mt-1 break-all text-sm font-mono text-[var(--app-fg)]">{server.target}</div>
                                                </div>
                                            ) : null}
                                            {server.auth ? (
                                                <div className="sm:col-span-2">
                                                    <span className="text-[10px] uppercase tracking-wide">{t('mcp.server.auth')}</span>
                                                    <div className="mt-1 break-all text-sm text-[var(--app-fg)]">{server.auth}</div>
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : null}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={isCodexStatusDialogOpen} onOpenChange={setIsCodexStatusDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{t('queueStatus.dialog.title')}</DialogTitle>
                        <DialogDescription>{t('queueStatus.dialog.description')}</DialogDescription>
                    </DialogHeader>
                    <div className="mt-3 max-h-[75vh] overflow-auto">
                        {isCodexStatusLoading ? (
                            <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-sm text-[var(--app-hint)]">
                                {t('queueStatus.dialog.loading')}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {codexStatusError ? (
                                    <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
                                        {codexStatusError}
                                    </div>
                                ) : null}

                                {codexStatusDetailRows.length > 0 || codexQueueStatus ? (
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {codexQueueStatus ? (
                                            <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 sm:col-span-2">
                                                <div className="text-[11px] uppercase tracking-wide text-[var(--app-hint)]">
                                                    Queue
                                                </div>
                                                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                                    <div className="rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                        <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                            Pending
                                                        </div>
                                                        <div className="mt-1 text-lg font-semibold text-[var(--app-fg)]">
                                                            {codexQueueStatus.pendingCount}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                        <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                            In queue
                                                        </div>
                                                        <div className="mt-1">
                                                            <span
                                                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                                                    codexQueueStatus.inQueue
                                                                        ? 'bg-emerald-500/10 text-emerald-600'
                                                                        : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
                                                                }`}
                                                            >
                                                                {codexQueueStatus.inQueue ? 'yes' : 'no'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                        <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                            Task running
                                                        </div>
                                                        <div className="mt-1">
                                                            <span
                                                                className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                                                                    codexQueueStatus.taskRunning
                                                                        ? 'bg-blue-500/10 text-blue-600'
                                                                        : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
                                                                }`}
                                                            >
                                                                {codexQueueStatus.taskRunning ? 'yes' : 'no'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                                {codexQueueStatus.nextPreview ? (
                                                    <div className="mt-2 rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                        <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                            Next queued message
                                                        </div>
                                                        <div className="mt-1 break-all text-sm font-mono text-[var(--app-fg)]">
                                                            {codexQueueStatus.nextPreview}
                                                        </div>
                                                    </div>
                                                ) : null}
                                            </div>
                                        ) : null}
                                        {codexStatusDetailRows.map((row) => {
                                            const rowKey = `${row.label}:${row.value}`
                                            const isWide = isWideStatusField(row.label)
                                            const booleanTone = getBooleanValueTone(row.value)
                                            const isRateLimit = row.label.toLowerCase().includes('rate limit')
                                            const rateLimit = isRateLimit ? parseRateLimitValue(row.value) : null
                                            const usedPercent = rateLimit?.usedPercent ?? null
                                            const progressToneClass = usedPercent === null
                                                ? 'bg-[var(--app-border)]'
                                                : usedPercent >= 85
                                                    ? 'bg-red-500'
                                                    : usedPercent >= 60
                                                        ? 'bg-amber-500'
                                                        : 'bg-emerald-500'
                                            const booleanToneClass = booleanTone === 'yes'
                                                ? 'bg-emerald-500/10 text-emerald-600'
                                                : booleanTone === 'no'
                                                    ? 'bg-red-500/10 text-red-600'
                                                    : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'

                                            return (
                                                <div
                                                    key={rowKey}
                                                    className={`rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 ${isWide ? 'sm:col-span-2' : ''}`}
                                                >
                                                    <div className="text-[11px] uppercase tracking-wide text-[var(--app-hint)]">
                                                        {row.label}
                                                    </div>
                                                    {isRateLimit && rateLimit ? (
                                                        <div className="mt-2 space-y-2">
                                                            <div className="flex items-center justify-between gap-3">
                                                                <span className="text-sm font-semibold">
                                                                    {usedPercent === null ? t('queueStatus.dialog.empty') : `${usedPercent}%`}
                                                                </span>
                                                                <span className="text-xs text-[var(--app-hint)] break-all">
                                                                    {rateLimit.resetAt}
                                                                </span>
                                                            </div>
                                                            {usedPercent !== null ? (
                                                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--app-subtle-bg)]">
                                                                    <div
                                                                        className={`h-full rounded-full ${progressToneClass}`}
                                                                        style={{ width: `${Math.max(0, Math.min(100, usedPercent))}%` }}
                                                                    />
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    ) : booleanTone ? (
                                                        <div className="mt-2">
                                                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${booleanToneClass}`}>
                                                                {row.value}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <div className="mt-2 break-all text-sm font-mono text-[var(--app-fg)]">
                                                            {row.value || t('queueStatus.dialog.empty')}
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : !codexStatusError ? (
                                    <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-sm text-[var(--app-hint)]">
                                        {codexStatusMessage || t('queueStatus.dialog.empty')}
                                    </div>
                                ) : null}

                                {sessionUsage ? (
                                    <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-[11px] uppercase tracking-wide text-[var(--app-hint)]">
                                                {t('queueStatus.usage.title')}
                                            </div>
                                            <div className="text-xs text-[var(--app-hint)]">
                                                {sessionUsage.provider === 'claude'
                                                    ? t('settings.usage.provider.claude')
                                                    : sessionUsage.provider === 'codex'
                                                        ? t('settings.usage.provider.codex')
                                                        : sessionUsage.provider}
                                            </div>
                                        </div>
                                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            <div className="rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                    {t('queueStatus.usage.totalTokens')}
                                                </div>
                                                <div className="mt-1 text-lg font-semibold text-[var(--app-fg)]">
                                                    {formatUsageNumber(sessionUsage.allTime.totalTokens)}
                                                </div>
                                            </div>
                                            <div className="rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                    {t('queueStatus.usage.events')}
                                                </div>
                                                <div className="mt-1 text-sm text-[var(--app-fg)]">
                                                    {formatUsageNumber(sessionUsage.usageEventCount)}
                                                </div>
                                            </div>
                                            <div className="rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                    {t('queueStatus.usage.inputTokens')}
                                                </div>
                                                <div className="mt-1 text-sm text-[var(--app-fg)]">
                                                    {formatUsageNumber(sessionUsage.allTime.inputTokens)}
                                                </div>
                                            </div>
                                            <div className="rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                    {t('queueStatus.usage.outputTokens')}
                                                </div>
                                                <div className="mt-1 text-sm text-[var(--app-fg)]">
                                                    {formatUsageNumber(sessionUsage.allTime.outputTokens)}
                                                </div>
                                            </div>
                                            <div className="rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                    {t('queueStatus.usage.cachedInputTokens')}
                                                </div>
                                                <div className="mt-1 text-sm text-[var(--app-fg)]">
                                                    {formatUsageNumber(sessionUsage.allTime.cachedInputTokens)}
                                                </div>
                                            </div>
                                            <div className="rounded-md bg-[var(--app-subtle-bg)] p-2">
                                                <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                    {t('queueStatus.usage.cacheCreationTokens')}
                                                </div>
                                                <div className="mt-1 text-sm text-[var(--app-fg)]">
                                                    {formatUsageNumber(sessionUsage.allTime.cacheCreationTokens)}
                                                </div>
                                            </div>
                                            {sessionUsage.allTime.reasoningOutputTokens > 0 ? (
                                                <div className="rounded-md bg-[var(--app-subtle-bg)] p-2 sm:col-span-2">
                                                    <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                                        {t('queueStatus.usage.reasoningOutputTokens')}
                                                    </div>
                                                    <div className="mt-1 text-sm text-[var(--app-fg)]">
                                                        {formatUsageNumber(sessionUsage.allTime.reasoningOutputTokens)}
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                        <div className="mt-2 text-[10px] text-[var(--app-hint)]">
                                            {t('queueStatus.usage.messages')}: {formatUsageNumber(sessionUsage.messageCount)}
                                            {sessionUsage.lastUsageAt
                                                ? ` · ${t('queueStatus.usage.lastUpdated')}: ${new Date(sessionUsage.lastUsageAt).toLocaleString()}`
                                                : ''}
                                        </div>
                                    </div>
                                ) : sessionUsageError ? (
                                    <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
                                        {sessionUsageError}
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={isCodexQueueDialogOpen} onOpenChange={setIsCodexQueueDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{t('queue.dialog.title')}</DialogTitle>
                        <DialogDescription>{t('queue.dialog.description')}</DialogDescription>
                    </DialogHeader>
                    <div className="mt-3 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs text-[var(--app-hint)]">
                                {t('queue.dialog.modeLabel')}: {codexSendMode === 'queue'
                                    ? t('queue.mode.queue')
                                    : t('queue.mode.direct')}
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={() => void refreshCodexQueue()}
                                    disabled={isCodexQueueLoading || isCodexQueueMutating}
                                >
                                    {t('queue.dialog.refresh')}
                                </button>
                                <button
                                    type="button"
                                    className="rounded-md border border-red-500/40 px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                                    onClick={handleCodexQueueClear}
                                    disabled={isCodexQueueMutating || codexQueueEntries.length === 0}
                                >
                                    {t('queue.dialog.clear')}
                                </button>
                            </div>
                        </div>

                        {isCodexQueueLoading ? (
                            <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-sm text-[var(--app-hint)]">
                                {t('queue.dialog.loading')}
                            </div>
                        ) : null}

                        {codexQueueError ? (
                            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">
                                {codexQueueError}
                            </div>
                        ) : null}

                        {codexQueueStatus ? (
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3">
                                    <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                        {t('queue.summary.pending')}
                                    </div>
                                    <div className="mt-1 text-lg font-semibold text-[var(--app-fg)]">
                                        {codexQueueStatus.pendingCount}
                                    </div>
                                </div>
                                <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3">
                                    <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                        {t('queue.summary.inQueue')}
                                    </div>
                                    <div className="mt-1 text-sm text-[var(--app-fg)]">
                                        {codexQueueStatus.inQueue ? 'yes' : 'no'}
                                    </div>
                                </div>
                                <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3">
                                    <div className="text-[10px] uppercase tracking-wide text-[var(--app-hint)]">
                                        {t('queue.summary.taskRunning')}
                                    </div>
                                    <div className="mt-1 text-sm text-[var(--app-fg)]">
                                        {codexQueueStatus.taskRunning ? 'yes' : 'no'}
                                    </div>
                                </div>
                            </div>
                        ) : null}

                        {codexQueueEntries.length > 0 ? (
                            <div className="max-h-[55vh] space-y-2 overflow-auto pr-1">
                                {codexQueueEntries.map((entry, index) => {
                                    const previewText = entry.preview || t('queue.dialog.emptyMessage')

                                    return (
                                        <div
                                            key={entry.id}
                                            className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3"
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[11px] uppercase tracking-wide text-[var(--app-hint)]">
                                                        #{index + 1}
                                                        {entry.isolate ? ` · ${t('queue.entry.isolate')}` : ''}
                                                    </div>
                                                    <div className="mt-1 break-all text-sm font-mono text-[var(--app-fg)]">
                                                        {previewText}
                                                    </div>
                                                    <div className="mt-1 text-[10px] text-[var(--app-hint)]">
                                                        {new Date(entry.enqueuedAt).toLocaleTimeString()}
                                                    </div>
                                                </div>
                                                <div className="ml-2 flex items-center gap-1">
                                                    <button
                                                        type="button"
                                                        aria-label={t('queue.entry.moveUp')}
                                                        title={t('queue.entry.moveUp')}
                                                        className="rounded border border-[var(--app-border)] px-1.5 py-1 text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                                                        onClick={() => handleCodexQueueMove(entry.id, index - 1)}
                                                        disabled={isCodexQueueMutating || index <= 0}
                                                    >
                                                        ↑
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-label={t('queue.entry.moveDown')}
                                                        title={t('queue.entry.moveDown')}
                                                        className="rounded border border-[var(--app-border)] px-1.5 py-1 text-xs text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                                                        onClick={() => handleCodexQueueMove(entry.id, index + 1)}
                                                        disabled={isCodexQueueMutating || index >= codexQueueEntries.length - 1}
                                                    >
                                                        ↓
                                                    </button>
                                                    <button
                                                        type="button"
                                                        aria-label={t('queue.entry.remove')}
                                                        title={t('queue.entry.remove')}
                                                        className="rounded border border-red-500/40 px-1.5 py-1 text-xs text-red-500 transition-colors hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                                                        onClick={() => handleCodexQueueRemove(entry.id)}
                                                        disabled={isCodexQueueMutating}
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                        ) : (
                            <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3 text-sm text-[var(--app-hint)]">
                                {t('queue.dialog.empty')}
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* Voice session component - renders nothing but initializes ElevenLabs */}
            {voice && (
                <RealtimeVoiceSession
                    api={props.api}
                    micMuted={voice.micMuted}
                    onStatusChange={voice.setStatus}
                />
            )}
        </div>
    )
}
