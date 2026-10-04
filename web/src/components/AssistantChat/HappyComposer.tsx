import { getPermissionModeOptionsForFlavor } from '@hapi/protocol'
import { ComposerPrimitive, useAssistantApi, useAssistantState } from '@assistant-ui/react'
import type { Attachment } from '@assistant-ui/react'
import {
    type ChangeEvent as ReactChangeEvent,
    type ClipboardEvent as ReactClipboardEvent,
    type FormEvent as ReactFormEvent,
    type KeyboardEvent as ReactKeyboardEvent,
    type SyntheticEvent as ReactSyntheticEvent,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import type {
    AgentState,
    AttachmentMetadata,
    QueueEntry,
    QueueSummary,
    ModelMode,
    PermissionMode
} from '@/types/api'
import type { ClaudeRateLimitSnapshot } from '@hapi/protocol/types'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import type { ConversationStatus } from '@/realtime/types'
import type { QueueInlinePanelMode } from '@/hooks/useQueueInlinePanel'
import { useActiveWord } from '@/hooks/useActiveWord'
import { useActiveSuggestions } from '@/hooks/useActiveSuggestions'
import { applySuggestion } from '@/utils/applySuggestion'
import { usePlatform } from '@/hooks/usePlatform'
import { useEnterBehavior } from '@/hooks/useEnterBehavior'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { isClaudeFlavor, supportsQueueControlsFlavor } from '@/lib/agentFlavorUtils'
import { useMobileQueueEmptyStatePreference } from '@/hooks/useMobileQueueEmptyStatePreference'
import { markSkillUsed } from '@/lib/recent-skills'
import { preserveUploadPathsForQueue } from '@/lib/attachmentAdapter'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { StatusBar } from '@/components/AssistantChat/StatusBar'
import { ComposerButtons } from '@/components/AssistantChat/ComposerButtons'
import { AttachmentItem } from '@/components/AssistantChat/AttachmentItem'
import { useTranslation } from '@/lib/use-translation'

export interface TextInputState {
    text: string
    selection: { start: number; end: number }
}

export type CodexSendMode = 'direct' | 'queue'

type QueueEnqueuePayload = {
    text: string
    attachments?: AttachmentMetadata[]
}

type ComposerModelOption = {
    value: string
    label: string
}

type SessionThinkEffort = 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
type SessionServiceTier = 'auto' | 'fast' | 'flex'

type ComposerThinkEffortOption = {
    value: SessionThinkEffort
    label: string
}

type ComposerServiceTierOption = {
    value: SessionServiceTier
    label: string
}

type ComposerInjectedPrompt = {
    id: number
    text: string
}

const defaultSuggestionHandler = async (): Promise<Suggestion[]> => []
const SEND_DEBOUNCE_MS = 600
const COMPOSER_DRAFT_STORAGE_PREFIX = 'hapi:sessionComposerDraft:'

type ComposerDraft = {
    text: string
    attachments: AttachmentMetadata[]
}

function getComposerDraftStorageKey(sessionId: string): string {
    return `${COMPOSER_DRAFT_STORAGE_PREFIX}${sessionId}`
}

function normalizeAttachmentMetadata(value: unknown): AttachmentMetadata | null {
    if (!value || typeof value !== 'object') {
        return null
    }

    const record = value as Record<string, unknown>
    const id = typeof record.id === 'string' ? record.id.trim() : ''
    const filename = typeof record.filename === 'string' ? record.filename.trim() : ''
    const mimeType = typeof record.mimeType === 'string' ? record.mimeType.trim() : ''
    const path = typeof record.path === 'string' ? record.path.trim() : ''
    const size = typeof record.size === 'number' && Number.isFinite(record.size)
        ? Math.max(0, record.size)
        : Number.NaN

    if (!id || !filename || !mimeType || !path || Number.isNaN(size)) {
        return null
    }

    const previewUrl = typeof record.previewUrl === 'string' && record.previewUrl.trim().length > 0
        ? record.previewUrl
        : undefined

    return {
        id,
        filename,
        mimeType,
        size,
        path,
        ...(previewUrl ? { previewUrl } : {})
    }
}

function dedupeAttachmentMetadata(attachments: AttachmentMetadata[]): AttachmentMetadata[] {
    const unique = new Map<string, AttachmentMetadata>()
    for (const attachment of attachments) {
        const key = attachment.path.trim()
        if (!key || unique.has(key)) {
            continue
        }
        unique.set(key, attachment)
    }
    return Array.from(unique.values())
}

function mergeAttachmentMetadata(
    preferred: AttachmentMetadata[],
    fallback: AttachmentMetadata[]
): AttachmentMetadata[] {
    return dedupeAttachmentMetadata([...preferred, ...fallback])
}

function areAttachmentListsEqual(a: AttachmentMetadata[], b: AttachmentMetadata[]): boolean {
    if (a.length !== b.length) {
        return false
    }
    for (let index = 0; index < a.length; index += 1) {
        const left = a[index]
        const right = b[index]
        if (!left || !right) {
            return false
        }
        if (
            left.path !== right.path
            || left.id !== right.id
            || left.filename !== right.filename
            || left.mimeType !== right.mimeType
            || left.size !== right.size
            || left.previewUrl !== right.previewUrl
        ) {
            return false
        }
    }
    return true
}

function readComposerDraft(sessionId: string): ComposerDraft {
    const emptyDraft: ComposerDraft = { text: '', attachments: [] }
    if (typeof window === 'undefined') return emptyDraft
    try {
        const raw = localStorage.getItem(getComposerDraftStorageKey(sessionId))
        if (!raw) {
            return emptyDraft
        }

        try {
            const parsed = JSON.parse(raw) as unknown
            if (!parsed || typeof parsed !== 'object') {
                return { text: raw, attachments: [] }
            }

            const record = parsed as Record<string, unknown>
            const text = typeof record.text === 'string' ? record.text : ''
            const attachments = Array.isArray(record.attachments)
                ? dedupeAttachmentMetadata(
                    record.attachments
                        .map((item) => normalizeAttachmentMetadata(item))
                        .filter((item): item is AttachmentMetadata => item !== null)
                )
                : []
            return { text, attachments }
        } catch {
            return { text: raw, attachments: [] }
        }
    } catch {
        return emptyDraft
    }
}

function writeComposerDraft(sessionId: string, draft: ComposerDraft): void {
    if (typeof window === 'undefined') return
    try {
        const key = getComposerDraftStorageKey(sessionId)
        if (draft.text.length === 0 && draft.attachments.length === 0) {
            localStorage.removeItem(key)
            return
        }
        localStorage.setItem(key, JSON.stringify(draft))
    } catch {
    }
}

type AttachmentMetadataEnvelope = {
    __attachmentMetadata?: AttachmentMetadata
}

function parseAttachmentMetadataFromAttachment(attachment: Attachment): AttachmentMetadata | null {
    const fromCompleteContent = (() => {
        if (attachment.status.type !== 'complete') return null
        const parts = attachment.content ?? []
        for (const part of parts) {
            if (part.type !== 'text') continue
            const textPart = (part as { text?: unknown }).text
            if (typeof textPart !== 'string') continue
            try {
                const parsed = JSON.parse(textPart) as AttachmentMetadataEnvelope
                const metadata = parsed.__attachmentMetadata
                if (!metadata || typeof metadata !== 'object') continue
                if (typeof metadata.path !== 'string' || metadata.path.length === 0) continue
                return metadata
            } catch {
                continue
            }
        }
        return null
    })()

    if (fromCompleteContent) {
        return fromCompleteContent
    }

    if (attachment.status.type !== 'requires-action') {
        return null
    }

    const path = (attachment as { path?: unknown }).path
    if (typeof path !== 'string' || path.length === 0) {
        return null
    }

    return {
        id: attachment.id,
        filename: attachment.name,
        mimeType: attachment.contentType ?? 'application/octet-stream',
        size: attachment.file?.size ?? 0,
        path,
        previewUrl: (attachment as { previewUrl?: unknown }).previewUrl as string | undefined
    }
}

function buildClaudeModelOptions(
    currentModel: string | undefined
): ComposerModelOption[] {
    const options: ComposerModelOption[] = [
        { value: 'auto', label: 'Default (recommended)' },
        { value: 'sonnet', label: 'Sonnet (latest)' },
        { value: 'opus', label: 'Opus (latest)' },
        { value: 'haiku', label: 'Haiku (latest)' },
        { value: 'claude-opus-5-5', label: 'Opus 5.5' },
        { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
        { value: 'claude-opus-4-6', label: 'Opus 4.6' },
        { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    ]

    if (currentModel && !options.some((option) => option.value === currentModel)) {
        options.push({ value: currentModel, label: currentModel })
    }

    return options
}

function getThinkEffortOptionsForFlavor(flavor?: string | null): ComposerThinkEffortOption[] {
    if (flavor === 'claude') {
        // cc CLI accepts low/medium/high/xhigh/max. xhigh is Opus 4.7-only;
        // cc downgrades unsupported levels server-side, so it's safe to expose.
        return [
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'Extra high' },
            { value: 'max', label: 'Max' },
        ]
    }
    if (flavor === 'codex') {
        return [
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'XHigh' },
        ]
    }
    return []
}

function getServiceTierOptionsForFlavor(flavor?: string | null): ComposerServiceTierOption[] {
    if (flavor === 'codex') {
        return [
            { value: 'auto', label: 'Auto' },
            { value: 'fast', label: 'Fast' },
            { value: 'flex', label: 'Flex' },
        ]
    }
    return []
}

export function HappyComposer(props: {
    sessionId: string
    disabled?: boolean
    cliMode?: boolean
    permissionMode?: PermissionMode
    modelMode?: ModelMode
    model?: string
    thinkEffort?: string
    serviceTier?: string
    active?: boolean
    allowSendWhenInactive?: boolean
    thinking?: boolean
    agentState?: AgentState | null
    contextSize?: number
    contextWindowTokens?: number
    rateLimitSnapshot?: ClaudeRateLimitSnapshot
    controlledByUser?: boolean
    agentFlavor?: string | null
    onPermissionModeChange?: (mode: PermissionMode) => void
    onModelChange?: (model: string) => void
    onThinkEffortChange?: (thinkEffort: SessionThinkEffort) => void
    onServiceTierChange?: (serviceTier: SessionServiceTier) => void
    onSwitchToRemote?: () => void
    onTerminal?: () => void
    onCodexStatus?: () => void
    codexSendMode?: CodexSendMode
    codexCollaborationMode?: string
    onCodexSendModeChange?: (mode: CodexSendMode) => void
    onCodexPlanModeChange?: (enabled: boolean) => void
    codexQueuePendingCount?: number
    codexQueueSummary?: QueueSummary | null
    codexQueueEntries?: QueueEntry[]
    codexQueueDialogOpen?: boolean
    codexQueueInlinePanelMode?: QueueInlinePanelMode
    onCodexQueueOpen?: () => void
    onCodexQueueUpdated?: () => void
    onCodexQueueEnqueue?: (payload: QueueEnqueuePayload) => Promise<void>
    isSendingMessage?: boolean
    onSendMessage?: (text: string, attachments?: AttachmentMetadata[]) => Promise<boolean> | boolean
    onRemoveDraftAttachment?: (path: string) => Promise<void> | void
    autocompletePrefixes?: string[]
    autocompleteSuggestions?: (query: string) => Promise<Suggestion[]>
    injectedPrompt?: ComposerInjectedPrompt | null
    // Voice assistant props
    voiceStatus?: ConversationStatus
    voiceMicMuted?: boolean
    onVoiceToggle?: () => void
    onVoiceMicToggle?: () => void
    offlineWakeMessage?: string
    offlineWakeLabel?: string
    offlineWakingLabel?: string
    offlineWakePending?: boolean
    onOfflineWake?: () => void
}) {
    const { t } = useTranslation()
    const {
        sessionId,
        disabled = false,
        cliMode = false,
        permissionMode: rawPermissionMode,
        modelMode: rawModelMode,
        model: rawModel,
        thinkEffort: rawThinkEffort,
        serviceTier: rawServiceTier,
        active = true,
        allowSendWhenInactive = false,
        thinking = false,
        agentState,
        contextSize,
        contextWindowTokens,
        rateLimitSnapshot,
        controlledByUser = false,
        agentFlavor,
        onPermissionModeChange,
        onModelChange,
        onThinkEffortChange,
        onServiceTierChange,
        onSwitchToRemote,
        onTerminal,
        onCodexStatus,
        codexSendMode = 'direct',
        codexCollaborationMode,
        onCodexSendModeChange,
        onCodexPlanModeChange,
        codexQueuePendingCount = 0,
        codexQueueSummary = null,
        codexQueueEntries = [],
        codexQueueDialogOpen = false,
        codexQueueInlinePanelMode = 'compact',
        onCodexQueueOpen,
        onCodexQueueUpdated,
        onCodexQueueEnqueue,
        isSendingMessage = false,
        onSendMessage,
        onRemoveDraftAttachment,
        autocompletePrefixes = ['@', '/', '$'],
        autocompleteSuggestions = defaultSuggestionHandler,
        injectedPrompt = null,
        voiceStatus = 'disconnected',
        voiceMicMuted = false,
        onVoiceToggle,
        onVoiceMicToggle,
        offlineWakeMessage,
        offlineWakeLabel,
        offlineWakingLabel,
        offlineWakePending = false,
        onOfflineWake
    } = props

    // Use ?? so missing values fall back to default (destructuring defaults only handle undefined)
    const permissionMode = rawPermissionMode ?? 'default'
    const modelMode = rawModelMode ?? 'default'
    const model = typeof rawModel === 'string' && rawModel.trim()
        ? rawModel.trim()
        : undefined
    const normalizedThinkEffort = typeof rawThinkEffort === 'string'
        ? rawThinkEffort.trim().toLowerCase()
        : ''
    const currentModelValue = model ?? (modelMode === 'default' ? 'auto' : modelMode)
    const modelOptions = useMemo(
        () => agentFlavor === 'claude'
            ? buildClaudeModelOptions(model)
            : [],
        [agentFlavor, model]
    )
    const modelValues = useMemo(
        () => modelOptions.map((option) => option.value),
        [modelOptions]
    )
    const thinkEffortOptions = useMemo(
        () => getThinkEffortOptionsForFlavor(agentFlavor),
        [agentFlavor]
    )
    const serviceTierOptions = useMemo(
        () => getServiceTierOptionsForFlavor(agentFlavor),
        [agentFlavor]
    )
    const currentThinkEffortValue: SessionThinkEffort = useMemo(() => {
        if (normalizedThinkEffort === 'auto'
            || normalizedThinkEffort === 'low'
            || normalizedThinkEffort === 'medium'
            || normalizedThinkEffort === 'high'
            || normalizedThinkEffort === 'xhigh'
            || normalizedThinkEffort === 'max') {
            return thinkEffortOptions.some((option) => option.value === normalizedThinkEffort)
                ? normalizedThinkEffort
                : 'auto'
        }
        return 'auto'
    }, [normalizedThinkEffort, thinkEffortOptions])
    const currentServiceTierValue: SessionServiceTier = useMemo(() => {
        if (typeof rawServiceTier !== 'string') {
            return 'auto'
        }
        const normalized = rawServiceTier.trim().toLowerCase()
        if (normalized === 'fast' || normalized === 'flex') {
            return normalized
        }
        return 'auto'
    }, [rawServiceTier])

    const api = useAssistantApi()
    const { mobileQueueEmptyStatePreference } = useMobileQueueEmptyStatePreference()
    const composerText = useAssistantState(({ composer }) => composer.text)
    const attachments = useAssistantState(({ composer }) => composer.attachments)
    const threadIsRunning = useAssistantState(({ thread }) => thread.isRunning)
    const threadIsDisabled = useAssistantState(({ thread }) => thread.isDisabled)

    const controlsDisabled = disabled || (!active && !allowSendWhenInactive) || threadIsDisabled
    const supportsQueueControls = supportsQueueControlsFlavor(agentFlavor)
    const normalizedCollaborationMode = typeof codexCollaborationMode === 'string'
        ? codexCollaborationMode.trim().toLowerCase()
        : ''
    const isCodexPlanMode = normalizedCollaborationMode === 'plan'
    const queueSendEnabled = supportsQueueControls && codexSendMode === 'queue'
    const showInlineQueuePanel = supportsQueueControls
        && codexSendMode === 'queue'
        && codexQueueInlinePanelMode !== 'off'
    const inlineQueuePendingCount = Math.max(0, codexQueueSummary?.pendingCount ?? codexQueuePendingCount)
    const inlineQueueNextPreview = codexQueueSummary?.nextPreview?.trim() ?? ''
    const hideEmptyInlineQueuePanelOnMobile = mobileQueueEmptyStatePreference === 'hide'
        && inlineQueuePendingCount <= 0
        && codexQueueEntries.length <= 0
    const inlineQueueHeadline = useMemo(() => {
        if (inlineQueueNextPreview.length > 0) {
            return `${t('queue.inline.next')}: ${inlineQueueNextPreview}`
        }
        const firstEntryPreview = codexQueueEntries[0]?.preview?.trim()
        if (firstEntryPreview) {
            return `${t('queue.inline.next')}: ${firstEntryPreview}`
        }
        if (inlineQueuePendingCount > 0) {
            return t('queue.inline.pending', { count: inlineQueuePendingCount })
        }
        return t('queue.inline.empty')
    }, [inlineQueueNextPreview, codexQueueEntries, inlineQueuePendingCount, t])
    const trimmed = composerText.trim()
    const hasText = trimmed.length > 0
    const hasRuntimeAttachments = attachments.length > 0
    const attachmentsReady = !hasRuntimeAttachments || attachments.every((attachment) => {
        if (attachment.status.type === 'complete') {
            return true
        }
        if (attachment.status.type !== 'requires-action') {
            return false
        }
        const path = (attachment as { path?: string }).path
        return typeof path === 'string' && path.length > 0
    })
    const queueAttachments = useMemo(
        () => attachments
            .map(parseAttachmentMetadataFromAttachment)
            .filter((metadata): metadata is AttachmentMetadata => metadata !== null),
        [attachments]
    )
    const previousQueueAttachmentPathsRef = useRef<Set<string>>(new Set())
    const [draftAttachments, setDraftAttachments] = useState<AttachmentMetadata[]>([])
    const mergedDraftAttachments = useMemo(
        () => mergeAttachmentMetadata(queueAttachments, draftAttachments),
        [queueAttachments, draftAttachments]
    )
    const runtimeAttachmentPathSet = useMemo(
        () => new Set(queueAttachments.map((attachment) => attachment.path)),
        [queueAttachments]
    )
    const restoredDraftAttachments = useMemo(
        () => draftAttachments.filter((attachment) => !runtimeAttachmentPathSet.has(attachment.path)),
        [draftAttachments, runtimeAttachmentPathSet]
    )
    const hasAnyAttachments = mergedDraftAttachments.length > 0
    const sendBusy = isSendingMessage
    const canSendBase = (hasText || hasAnyAttachments) && attachmentsReady && !controlsDisabled && !sendBusy
    const canSend = canSendBase && (!threadIsRunning || queueSendEnabled)

    const [inputState, setInputState] = useState<TextInputState>({
        text: '',
        selection: { start: 0, end: 0 }
    })
    const [showSettings, setShowSettings] = useState(false)
    const [isAborting, setIsAborting] = useState(false)
    const [isSwitching, setIsSwitching] = useState(false)
    const [showContinueHint, setShowContinueHint] = useState(false)
    const [isComposerSending, setIsComposerSending] = useState(false)

    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const lastSendAtRef = useRef(0)
    const prevControlledByUser = useRef(controlledByUser)
    const pendingDraftRestoreRef = useRef<{
        sessionId: string
        text: string
        attachments: AttachmentMetadata[]
    } | null>(null)
    const lastInjectedPromptIdRef = useRef<number | null>(null)

    useEffect(() => {
        const restoredDraft = readComposerDraft(sessionId)
        pendingDraftRestoreRef.current = {
            sessionId,
            text: restoredDraft.text,
            attachments: restoredDraft.attachments
        }
        setDraftAttachments(restoredDraft.attachments)
        previousQueueAttachmentPathsRef.current = new Set()

        if (composerText !== restoredDraft.text) {
            api.composer().setText(restoredDraft.text)
        }
    }, [api, sessionId])

    useEffect(() => {
        const pendingRestore = pendingDraftRestoreRef.current
        if (pendingRestore && pendingRestore.sessionId === sessionId) {
            if (composerText !== pendingRestore.text) {
                return
            }
            if (!areAttachmentListsEqual(draftAttachments, pendingRestore.attachments)) {
                return
            }
            pendingDraftRestoreRef.current = null
        }
        writeComposerDraft(sessionId, {
            text: composerText,
            attachments: draftAttachments
        })
    }, [sessionId, composerText, draftAttachments])

    useEffect(() => {
        setDraftAttachments((prev) => {
            const previousQueuePaths = previousQueueAttachmentPathsRef.current
            const currentQueuePaths = new Set(queueAttachments.map((attachment) => attachment.path))

            const removedPaths = new Set<string>()
            for (const path of previousQueuePaths) {
                if (!currentQueuePaths.has(path)) {
                    removedPaths.add(path)
                }
            }

            let next = prev
            if (removedPaths.size > 0) {
                next = next.filter((attachment) => !removedPaths.has(attachment.path))
            }
            next = mergeAttachmentMetadata(queueAttachments, next)
            if (areAttachmentListsEqual(prev, next)) {
                return prev
            }
            return next
        })
        previousQueueAttachmentPathsRef.current = new Set(queueAttachments.map((attachment) => attachment.path))
    }, [queueAttachments])

    useEffect(() => {
        setInputState((prev) => {
            if (prev.text === composerText) return prev
            // When syncing from composerText, update selection to end of text
            // This ensures activeWord detection works correctly
            const newPos = composerText.length
            return { text: composerText, selection: { start: newPos, end: newPos } }
        })
    }, [composerText])

    useEffect(() => {
        if (!injectedPrompt || !injectedPrompt.text.trim()) {
            return
        }
        if (lastInjectedPromptIdRef.current === injectedPrompt.id) {
            return
        }

        const injectedText = injectedPrompt.text.trim()
        const baseText = composerText
        const separator = baseText.trim().length > 0 ? '\n' : ''
        const nextText = `${baseText}${separator}${injectedText}`

        lastInjectedPromptIdRef.current = injectedPrompt.id
        api.composer().setText(nextText)
    }, [api, composerText, injectedPrompt])

    // Track one-time "continue" hint after switching from local to remote.
    useEffect(() => {
        if (prevControlledByUser.current === true && controlledByUser === false) {
            setShowContinueHint(true)
        }
        if (controlledByUser) {
            setShowContinueHint(false)
        }
        prevControlledByUser.current = controlledByUser
    }, [controlledByUser])

    const { haptic: platformHaptic, isTouch } = usePlatform()
    const { enterBehavior } = useEnterBehavior()
    const { isStandalone, isIOS } = usePWAInstall()
    const isIOSPWA = isIOS && isStandalone
    const bottomPaddingClass = isIOSPWA ? 'pb-0' : 'pb-3'
    const activeWord = useActiveWord(inputState.text, inputState.selection, autocompletePrefixes)
    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeWord,
        autocompleteSuggestions,
        { clampSelection: true, wrapAround: true }
    )

    const haptic = useCallback((type: 'light' | 'success' | 'error' = 'light') => {
        if (type === 'light') {
            platformHaptic.impact('light')
        } else if (type === 'success') {
            platformHaptic.notification('success')
        } else {
            platformHaptic.notification('error')
        }
    }, [platformHaptic])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (!suggestion || !textareaRef.current) return
        if (suggestion.text.startsWith('$')) {
            markSkillUsed(suggestion.text.slice(1))
        }

        // For Codex user prompts with content, expand the content instead of command name
        let textToInsert = suggestion.text
        let addSpace = true
        if (agentFlavor === 'codex' && suggestion.source === 'user' && suggestion.content) {
            textToInsert = suggestion.content
            addSpace = false
        }

        const result = applySuggestion(
            inputState.text,
            inputState.selection,
            textToInsert,
            autocompletePrefixes,
            addSpace
        )

        api.composer().setText(result.text)
        setInputState({
            text: result.text,
            selection: { start: result.cursorPosition, end: result.cursorPosition }
        })

        setTimeout(() => {
            const el = textareaRef.current
            if (!el) return
            el.setSelectionRange(result.cursorPosition, result.cursorPosition)
            try {
                el.focus({ preventScroll: true })
            } catch {
                el.focus()
            }
        }, 0)

        haptic('light')
    }, [api, suggestions, inputState, autocompletePrefixes, haptic, agentFlavor])

    const abortDisabled = controlsDisabled || isAborting || !threadIsRunning
    const switchDisabled = controlsDisabled || isSwitching || !controlledByUser
    const showSwitchButton = Boolean(controlledByUser && onSwitchToRemote)
    const showTerminalButton = Boolean(onTerminal)
    const showStatusButton = Boolean(supportsQueueControls && onCodexStatus)
    const showQueueButton = Boolean(supportsQueueControls && onCodexQueueOpen)

    useEffect(() => {
        if (!isAborting) return
        if (threadIsRunning) return
        setIsAborting(false)
    }, [isAborting, threadIsRunning])

    useEffect(() => {
        if (!isSwitching) return
        if (controlledByUser) return
        setIsSwitching(false)
    }, [isSwitching, controlledByUser])

    const handleAbort = useCallback(() => {
        if (abortDisabled) return
        haptic('error')
        setIsAborting(true)
        api.thread().cancelRun()
    }, [abortDisabled, api, haptic])

    const handleSwitch = useCallback(async () => {
        if (switchDisabled || !onSwitchToRemote) return
        haptic('light')
        setIsSwitching(true)
        try {
            await onSwitchToRemote()
        } catch {
            setIsSwitching(false)
        }
    }, [switchDisabled, onSwitchToRemote, haptic])

    const handleCodexStatus = useCallback(() => {
        if (controlsDisabled || threadIsRunning || !onCodexStatus) return
        haptic('light')
        onCodexStatus()
    }, [controlsDisabled, threadIsRunning, onCodexStatus, haptic])

    const handleCodexQueueOpen = useCallback(() => {
        if (controlsDisabled || !onCodexQueueOpen) return
        haptic('light')
        onCodexQueueOpen()
    }, [controlsDisabled, onCodexQueueOpen, haptic])

    const handleCodexSendModeChange = useCallback((nextMode: CodexSendMode) => {
        if (!onCodexSendModeChange || controlsDisabled || codexSendMode === nextMode) {
            return
        }
        onCodexSendModeChange(nextMode)
        haptic('light')
    }, [onCodexSendModeChange, controlsDisabled, codexSendMode, haptic])

    const handleCodexPlanModeToggle = useCallback(() => {
        if (!onCodexPlanModeChange || controlsDisabled) {
            return
        }
        onCodexPlanModeChange(!isCodexPlanMode)
        haptic('light')
    }, [onCodexPlanModeChange, controlsDisabled, isCodexPlanMode, haptic])

    const isSendButtonLoading = isSendingMessage || isComposerSending

    const shouldEnqueueWithoutImmediateChat = queueSendEnabled
        && Boolean(onCodexQueueEnqueue)
        && (trimmed.length > 0 || mergedDraftAttachments.length > 0)

    const claimSendSlot = useCallback(() => {
        const now = Date.now()
        if (now - lastSendAtRef.current < SEND_DEBOUNCE_MS) {
            return false
        }
        lastSendAtRef.current = now
        return true
    }, [])

    const sendComposerNow = useCallback(async () => {
        if (!canSend || isComposerSending || !claimSendSlot()) {
            return
        }

        setIsComposerSending(true)
        try {
            if (shouldEnqueueWithoutImmediateChat && onCodexQueueEnqueue) {
                if (hasRuntimeAttachments && queueAttachments.length < attachments.length) {
                    haptic('error')
                    return
                }
                try {
                    await onCodexQueueEnqueue({
                        text: trimmed,
                        attachments: mergedDraftAttachments.length > 0 ? mergedDraftAttachments : undefined
                    })
                    preserveUploadPathsForQueue(
                        sessionId,
                        mergedDraftAttachments.map((attachment) => attachment.path)
                    )
                    await api.composer().clearAttachments()
                    api.composer().setText('')
                    setDraftAttachments([])
                    onCodexQueueUpdated?.()
                    return
                } catch {
                    haptic('error')
                    return
                }
            }

            if (onSendMessage) {
                const sent = await Promise.resolve(onSendMessage(
                    trimmed,
                    mergedDraftAttachments.length > 0 ? mergedDraftAttachments : undefined
                ))
                if (!sent) {
                    return
                }
                preserveUploadPathsForQueue(
                    sessionId,
                    mergedDraftAttachments.map((attachment) => attachment.path)
                )
                await api.composer().clearAttachments()
                api.composer().setText('')
                setDraftAttachments([])
                if (queueSendEnabled && threadIsRunning) {
                    onCodexQueueUpdated?.()
                }
                return
            }

            api.composer().send()
            if (queueSendEnabled && threadIsRunning) {
                onCodexQueueUpdated?.()
            }
        } finally {
            setIsComposerSending(false)
        }
    }, [
        canSend,
        claimSendSlot,
        api,
        queueSendEnabled,
        threadIsRunning,
        onCodexQueueUpdated,
        onCodexQueueEnqueue,
        shouldEnqueueWithoutImmediateChat,
        queueAttachments,
        hasRuntimeAttachments,
        attachments.length,
        trimmed,
        haptic,
        mergedDraftAttachments,
        sessionId,
        queueSendEnabled,
        isComposerSending,
        onSendMessage
    ])

    const handleRemoveDraftAttachment = useCallback((attachment: AttachmentMetadata) => {
        setDraftAttachments((prev) => prev.filter((item) => item.path !== attachment.path))
        if (onRemoveDraftAttachment) {
            void Promise.resolve(onRemoveDraftAttachment(attachment.path)).catch(() => {
            })
        }
    }, [onRemoveDraftAttachment])

    const permissionModeOptions = useMemo(
        () => getPermissionModeOptionsForFlavor(agentFlavor),
        [agentFlavor]
    )
    const permissionModes = useMemo(
        () => permissionModeOptions.map((option) => option.mode),
        [permissionModeOptions]
    )

    const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        const key = e.key

        // Avoid intercepting IME composition keystrokes (Enter, arrows, etc.)
        if (e.nativeEvent.isComposing) {
            return
        }

        // Enter behavior depends on user setting:
        // 'send' (default): Enter sends, Shift+Enter newline
        // 'newline': Enter newline, Shift+Enter sends
        const enterSends = enterBehavior === 'send'

        if (key === 'Enter' && e.shiftKey && enterSends) {
            // Shift+Enter inserts newline when Enter sends (default browser behavior, no preventDefault)
            return
        }

        if (key === 'Enter' && e.shiftKey && !enterSends) {
            e.preventDefault()
            if (!canSend) return
            void sendComposerNow()
            setShowContinueHint(false)
            return
        }

        if (suggestions.length > 0) {
            if (key === 'ArrowUp') {
                e.preventDefault()
                moveUp()
                return
            }
            if (key === 'ArrowDown') {
                e.preventDefault()
                moveDown()
                return
            }
            if ((key === 'Enter' || key === 'Tab') && !e.shiftKey) {
                e.preventDefault()
                const indexToSelect = selectedIndex >= 0 ? selectedIndex : 0
                handleSuggestionSelect(indexToSelect)
                return
            }
            if (key === 'Escape') {
                e.preventDefault()
                clearSuggestions()
                return
            }
        }

        if (key === 'Escape' && threadIsRunning) {
            e.preventDefault()
            handleAbort()
            return
        }

        if (key === 'Enter' && !e.shiftKey && enterSends && queueSendEnabled && canSend) {
            e.preventDefault()
            void sendComposerNow()
            return
        }

        if (key === 'Enter' && !e.shiftKey && !enterSends && canSend) {
            // In 'newline' mode, plain Enter inserts newline (default textarea behavior, no preventDefault)
            return
        }

        if (key === 'Tab' && e.shiftKey && onPermissionModeChange && permissionModes.length > 0) {
            e.preventDefault()
            const currentIndex = permissionModes.indexOf(permissionMode)
            const nextIndex = (currentIndex + 1) % permissionModes.length
            const nextMode = permissionModes[nextIndex] ?? 'default'
            onPermissionModeChange(nextMode)
            haptic('light')
        }
    }, [
        suggestions,
        selectedIndex,
        moveUp,
        moveDown,
        clearSuggestions,
        handleSuggestionSelect,
        handleAbort,
        queueSendEnabled,
        canSend,
        sendComposerNow,
        onPermissionModeChange,
        permissionMode,
        permissionModes,
        haptic,
        enterBehavior
    ])

    useEffect(() => {
        const handleGlobalKeyDown = (e: globalThis.KeyboardEvent) => {
            if (e.key === 'm' && (e.metaKey || e.ctrlKey) && onModelChange && isClaudeFlavor(agentFlavor) && modelValues.length > 0) {
                e.preventDefault()
                const currentIndex = modelValues.indexOf(currentModelValue)
                const nextIndex = (currentIndex + 1) % modelValues.length
                onModelChange(modelValues[nextIndex] ?? 'auto')
                haptic('light')
            }
        }

        window.addEventListener('keydown', handleGlobalKeyDown)
        return () => window.removeEventListener('keydown', handleGlobalKeyDown)
    }, [onModelChange, haptic, agentFlavor, modelValues, currentModelValue])

    const handleChange = useCallback((e: ReactChangeEvent<HTMLTextAreaElement>) => {
        const selection = {
            start: e.target.selectionStart,
            end: e.target.selectionEnd
        }
        setInputState({ text: e.target.value, selection })
    }, [])

    const handleSelect = useCallback((e: ReactSyntheticEvent<HTMLTextAreaElement>) => {
        const target = e.target as HTMLTextAreaElement
        setInputState(prev => ({
            ...prev,
            selection: { start: target.selectionStart, end: target.selectionEnd }
        }))
    }, [])

    const handlePaste = useCallback(async (e: ReactClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(e.clipboardData?.files || [])
        const imageFiles = files.filter(file => file.type.startsWith('image/'))

        if (imageFiles.length === 0) return

        e.preventDefault()

        try {
            for (const file of imageFiles) {
                await api.composer().addAttachment(file)
            }
        } catch (error) {
            console.error('Error adding pasted image:', error)
        }
    }, [api])

    const handleSettingsToggle = useCallback(() => {
        haptic('light')
        setShowSettings(prev => !prev)
    }, [haptic])

    const handleSubmit = useCallback((event?: ReactFormEvent<HTMLFormElement>) => {
        if (event) {
            event.preventDefault()
            if (canSend) {
                void sendComposerNow()
            }
        }
        setShowContinueHint(false)
    }, [canSend, sendComposerNow])

    const handlePermissionChange = useCallback((mode: PermissionMode) => {
        if (!onPermissionModeChange || controlsDisabled) return
        onPermissionModeChange(mode)
        setShowSettings(false)
        haptic('light')
    }, [onPermissionModeChange, controlsDisabled, haptic])

    const handleModelChange = useCallback((modelValue: string) => {
        if (!onModelChange || controlsDisabled) return
        onModelChange(modelValue)
        setShowSettings(false)
        haptic('light')
    }, [onModelChange, controlsDisabled, haptic])

    const handleThinkEffortChange = useCallback((thinkEffortValue: SessionThinkEffort) => {
        if (!onThinkEffortChange || controlsDisabled) return
        onThinkEffortChange(thinkEffortValue)
        setShowSettings(false)
        haptic('light')
    }, [onThinkEffortChange, controlsDisabled, haptic])

    const handleServiceTierChange = useCallback((serviceTierValue: SessionServiceTier) => {
        if (!onServiceTierChange || controlsDisabled) return
        onServiceTierChange(serviceTierValue)
        setShowSettings(false)
        haptic('light')
    }, [onServiceTierChange, controlsDisabled, haptic])

    const showPermissionSettings = Boolean(onPermissionModeChange && permissionModeOptions.length > 0)
    const showModelSettings = Boolean(onModelChange && isClaudeFlavor(agentFlavor) && modelOptions.length > 0)
    const showThinkEffortSettings = Boolean(onThinkEffortChange && thinkEffortOptions.length > 0)
    const showServiceTierSettings = Boolean(onServiceTierChange && serviceTierOptions.length > 0)
    const showSettingsButton = Boolean(showPermissionSettings || showModelSettings || showThinkEffortSettings || showServiceTierSettings)
    const showAbortButton = true
    const voiceEnabled = Boolean(onVoiceToggle)

    const overlays = useMemo(() => {
        if (showSettings && (showPermissionSettings || showModelSettings || showThinkEffortSettings || showServiceTierSettings)) {
            const showPermissionDivider = showPermissionSettings && (showModelSettings || showThinkEffortSettings || showServiceTierSettings)
            const showModelDivider = showModelSettings && (showThinkEffortSettings || showServiceTierSettings)
            const showThinkEffortDivider = showThinkEffortSettings && showServiceTierSettings
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay maxHeight={320}>
                        {showPermissionSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    {t('misc.permissionMode')}
                                </div>
                                {permissionModeOptions.map((option) => (
                                    <button
                                        key={option.mode}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handlePermissionChange(option.mode)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                permissionMode === option.mode
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {permissionMode === option.mode && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={permissionMode === option.mode ? 'text-[var(--app-link)]' : ''}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        {showPermissionDivider ? (
                            <div className="mx-3 h-px bg-[var(--app-divider)]" />
                        ) : null}

                        {showModelSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    {t('misc.model')}
                                </div>
                                {modelOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handleModelChange(option.value)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                currentModelValue === option.value
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {currentModelValue === option.value && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={currentModelValue === option.value ? 'text-[var(--app-link)]' : ''}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        {showModelDivider ? (
                            <div className="mx-3 h-px bg-[var(--app-divider)]" />
                        ) : null}

                        {showThinkEffortSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    {t('newSession.think')}
                                </div>
                                {thinkEffortOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handleThinkEffortChange(option.value)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                currentThinkEffortValue === option.value
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {currentThinkEffortValue === option.value && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={currentThinkEffortValue === option.value ? 'text-[var(--app-link)]' : ''}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}

                        {showThinkEffortDivider ? (
                            <div className="mx-3 h-px bg-[var(--app-divider)]" />
                        ) : null}

                        {showServiceTierSettings ? (
                            <div className="py-2">
                                <div className="px-3 pb-1 text-xs font-semibold text-[var(--app-hint)]">
                                    {t('newSession.serviceTier')}
                                </div>
                                {serviceTierOptions.map((option) => (
                                    <button
                                        key={option.value}
                                        type="button"
                                        disabled={controlsDisabled}
                                        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                            controlsDisabled
                                                ? 'cursor-not-allowed opacity-50'
                                                : 'cursor-pointer hover:bg-[var(--app-secondary-bg)]'
                                        }`}
                                        onClick={() => handleServiceTierChange(option.value)}
                                        onMouseDown={(e) => e.preventDefault()}
                                    >
                                        <div
                                            className={`flex h-4 w-4 items-center justify-center rounded-full border-2 ${
                                                currentServiceTierValue === option.value
                                                    ? 'border-[var(--app-link)]'
                                                    : 'border-[var(--app-hint)]'
                                            }`}
                                        >
                                            {currentServiceTierValue === option.value && (
                                                <div className="h-2 w-2 rounded-full bg-[var(--app-link)]" />
                                            )}
                                        </div>
                                        <span className={currentServiceTierValue === option.value ? 'text-[var(--app-link)]' : ''}>
                                            {option.label}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </FloatingOverlay>
                </div>
            )
        }

        if (suggestions.length > 0) {
            return (
                <div className="absolute bottom-[100%] mb-2 w-full">
                    <FloatingOverlay>
                        <Autocomplete
                            suggestions={suggestions}
                            selectedIndex={selectedIndex}
                            onSelect={(index) => handleSuggestionSelect(index)}
                        />
                    </FloatingOverlay>
                </div>
            )
        }

        return null
    }, [
        showSettings,
        showPermissionSettings,
        showModelSettings,
        showThinkEffortSettings,
        showServiceTierSettings,
        suggestions,
        selectedIndex,
        controlsDisabled,
        permissionMode,
        currentModelValue,
        currentThinkEffortValue,
        currentServiceTierValue,
        modelOptions,
        thinkEffortOptions,
        serviceTierOptions,
        permissionModeOptions,
        handlePermissionChange,
        handleModelChange,
        handleThinkEffortChange,
        handleServiceTierChange,
        handleSuggestionSelect
    ])

    return (
        <div className={`px-3 ${bottomPaddingClass} pt-2 bg-[var(--app-bg)] ${cliMode ? 'cli-composer' : ''}`}>
            <div className="mx-auto w-full max-w-content">
                <ComposerPrimitive.Root className="relative" onSubmit={handleSubmit}>
                    {overlays}

                    <StatusBar
                        active={active}
                        thinking={thinking}
                        agentState={agentState}
                        contextSize={contextSize}
                        contextWindowTokens={contextWindowTokens}
                        rateLimitSnapshot={rateLimitSnapshot}
                        modelMode={modelMode}
                        permissionMode={permissionMode}
                        agentFlavor={agentFlavor}
                        collaborationMode={codexCollaborationMode}
                        voiceStatus={voiceStatus}
                    />

                    <ComposerPrimitive.AttachmentDropzone
                        asChild
                        disabled={controlsDisabled}
                    >
                        <div className={`relative overflow-hidden transition-[box-shadow] data-[dragging=true]:ring-2 data-[dragging=true]:ring-inset data-[dragging=true]:ring-[var(--app-link)] ${cliMode ? 'rounded border border-[var(--app-border)] bg-transparent' : 'rounded-[20px] bg-[var(--app-secondary-bg)]'}`}>
                            {!active ? (
                                <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--app-secondary-bg)]/95 px-4 py-3 backdrop-blur-[1px]">
                                    <div className="flex w-full flex-wrap items-center justify-between gap-3 rounded-2xl bg-[var(--app-bg)]/80 px-3 py-2 text-sm text-[var(--app-hint)] shadow-sm ring-1 ring-[var(--app-border)]">
                                        <span>{offlineWakeMessage ?? t('session.inactiveMessage')}</span>
                                        <button
                                            type="button"
                                            onClick={onOfflineWake}
                                            disabled={!onOfflineWake || offlineWakePending}
                                            className="rounded-full bg-[var(--app-button)] px-3 py-1.5 text-xs font-semibold text-[var(--app-button-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                                        >
                                            {offlineWakePending
                                                ? (offlineWakingLabel ?? t('session.waking'))
                                                : (offlineWakeLabel ?? t('session.wake'))}
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {showInlineQueuePanel ? (
                                <div className={`border-b border-[var(--app-border)] bg-[var(--app-subtle-bg)] px-3 py-2 ${hideEmptyInlineQueuePanelOnMobile ? 'hidden sm:block' : ''}`}>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                            {t('queue.dialog.title')}
                                        </span>
                                        <span className="inline-flex rounded-full bg-[var(--app-secondary-bg)] px-2 py-0.5 text-xs text-[var(--app-fg)]">
                                            {t('queue.inline.pending', { count: inlineQueuePendingCount })}
                                        </span>
                                        <span
                                            className="min-w-0 flex-1 truncate whitespace-nowrap text-xs text-[var(--app-hint)]"
                                            title={inlineQueueHeadline}
                                        >
                                            {inlineQueueHeadline}
                                        </span>
                                        <button
                                            type="button"
                                            className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-secondary-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                                            onClick={handleCodexQueueOpen}
                                            disabled={controlsDisabled || !onCodexQueueOpen}
                                        >
                                            {t('queue.inline.open')}
                                        </button>
                                    </div>

                                    {codexQueueInlinePanelMode === 'full' ? (
                                        <div className="mt-2 space-y-1">
                                            {codexQueueEntries.length > 0 ? (
                                                <>
                                                    {codexQueueEntries.slice(0, 5).map((entry, index) => {
                                                        const previewText = entry.preview || t('queue.dialog.emptyMessage')

                                                        return (
                                                            <div
                                                                key={entry.id}
                                                                className="flex items-center gap-2 rounded-md bg-[var(--app-secondary-bg)] px-2 py-1.5"
                                                            >
                                                                <span className="text-[10px] text-[var(--app-hint)]">
                                                                    #{index + 1}
                                                                </span>
                                                                <span
                                                                    className="block min-w-0 flex-1 truncate text-xs text-[var(--app-fg)]"
                                                                >
                                                                    {previewText}
                                                                </span>
                                                                <span className="shrink-0 text-[10px] text-[var(--app-hint)]">
                                                                    {new Date(entry.enqueuedAt).toLocaleTimeString([], {
                                                                        hour: '2-digit',
                                                                        minute: '2-digit'
                                                                    })}
                                                                </span>
                                                            </div>
                                                        )
                                                    })}
                                                    {codexQueueEntries.length > 5 ? (
                                                        <div className="px-1 text-[11px] text-[var(--app-hint)]">
                                                            +{codexQueueEntries.length - 5}
                                                        </div>
                                                    ) : null}
                                                </>
                                            ) : inlineQueuePendingCount > 0 ? (
                                                <div className="px-1 text-xs text-[var(--app-hint)]">
                                                    {t('queue.inline.pending', { count: inlineQueuePendingCount })}
                                                </div>
                                            ) : (
                                                <div className="px-1 text-xs text-[var(--app-hint)]">
                                                    {t('queue.dialog.empty')}
                                                </div>
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                            ) : null}

                            {attachments.length > 0 || restoredDraftAttachments.length > 0 ? (
                                <div className="flex flex-wrap gap-2 px-4 pt-3">
                                    {restoredDraftAttachments.map((attachment) => (
                                        <div
                                            key={`draft:${attachment.path}`}
                                            className="flex max-w-full items-center gap-2 rounded-md border border-[var(--app-divider)] bg-[var(--app-bg)] px-2 py-1 text-xs text-[var(--app-fg)]"
                                            title={attachment.path}
                                        >
                                            <span className="max-w-[180px] truncate">
                                                {attachment.filename}
                                            </span>
                                            <button
                                                type="button"
                                                className="rounded px-1 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                                                onClick={() => {
                                                    handleRemoveDraftAttachment(attachment)
                                                }}
                                                aria-label={`Remove ${attachment.filename}`}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                    <ComposerPrimitive.Attachments components={{ Attachment: AttachmentItem }} />
                                </div>
                            ) : null}

                            <div className={`flex items-center ${cliMode ? 'px-2 py-1.5' : 'px-4 py-3'}`}>
                                {cliMode && (
                                    <span className="mr-1.5 shrink-0 select-none text-[var(--cli-prompt-color,#3b82f6)] font-semibold text-sm">{'❯'}</span>
                                )}
                                <ComposerPrimitive.Input
                                    ref={textareaRef}
                                    autoFocus={!controlsDisabled && !isTouch}
                                    placeholder={showContinueHint ? t('misc.typeMessage') : t('misc.typeAMessage')}
                                    disabled={controlsDisabled || isSendButtonLoading}
                                    maxRows={5}
                                    submitOnEnter={!isTouch && enterBehavior === 'send'}
                                    cancelOnEscape={false}
                                    onChange={handleChange}
                                    onSelect={handleSelect}
                                    onKeyDown={handleKeyDown}
                                    onPaste={handlePaste}
                                    className={`flex-1 resize-none bg-transparent leading-snug text-[var(--app-fg)] placeholder-[var(--app-hint)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${cliMode ? 'font-mono text-[0.8125rem]' : 'text-base'}`}
                                />
                            </div>

                            <ComposerButtons
                                canSend={canSend}
                                isSending={isSendButtonLoading}
                                controlsDisabled={controlsDisabled}
                                showSettingsButton={showSettingsButton}
                                onSettingsToggle={handleSettingsToggle}
                                showTerminalButton={showTerminalButton}
                                terminalDisabled={controlsDisabled}
                                onTerminal={onTerminal ?? (() => {})}
                                showStatusButton={showStatusButton}
                                statusDisabled={controlsDisabled || threadIsRunning}
                                onStatus={handleCodexStatus}
                                showQueueButton={showQueueButton}
                                queueActive={codexQueueDialogOpen}
                                queueDisabled={controlsDisabled}
                                queuePendingCount={Math.max(0, codexQueuePendingCount)}
                                onQueue={handleCodexQueueOpen}
                                showPlanModeToggle={supportsQueueControls && Boolean(onCodexPlanModeChange)}
                                planModeEnabled={isCodexPlanMode}
                                planModeDisabled={controlsDisabled || !onCodexPlanModeChange}
                                onPlanModeToggle={handleCodexPlanModeToggle}
                                showSendModeToggle={supportsQueueControls}
                                sendMode={codexSendMode}
                                sendModeDisabled={controlsDisabled || !onCodexSendModeChange}
                                onSendModeChange={handleCodexSendModeChange}
                                showAbortButton={showAbortButton}
                                abortDisabled={abortDisabled}
                                isAborting={isAborting}
                                onAbort={handleAbort}
                                showSwitchButton={showSwitchButton}
                                switchDisabled={switchDisabled}
                                isSwitching={isSwitching}
                                onSwitch={handleSwitch}
                                voiceEnabled={voiceEnabled}
                                voiceStatus={voiceStatus}
                                voiceMicMuted={voiceMicMuted}
                                onVoiceToggle={onVoiceToggle ?? (() => {})}
                                onVoiceMicToggle={onVoiceMicToggle}
                                onSend={() => { void sendComposerNow() }}
                            />
                        </div>
                    </ComposerPrimitive.AttachmentDropzone>
                </ComposerPrimitive.Root>
            </div>
        </div>
    )
}
