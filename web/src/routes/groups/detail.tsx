import { forwardRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ClipboardEvent, type ComponentProps, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useParams, useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import type { Attachment, PendingAttachment } from '@assistant-ui/react'
import ReactMarkdown from 'react-markdown'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useAppContext } from '@/lib/app-context'
import type { ApiClient } from '@/api/client'
import { useGroup } from '@/hooks/queries/useGroup'
import { useGroupMessages } from '@/hooks/queries/useGroupMessages'
import { useGroupConversationTurns } from '@/hooks/queries/useGroupConversationTurns'
import { useGroupNote } from '@/hooks/queries/useGroupNote'
import { useSession } from '@/hooks/queries/useSession'
import { useGroupActions } from '@/hooks/mutations/useGroupActions'
import { useSessions } from '@/hooks/queries/useSessions'
import { useMachines } from '@/hooks/queries/useMachines'
import type {
    AttachmentMetadata,
    GroupConversationTurn,
    GroupMember,
    GroupTimelineMessage,
    GroupTaskStatus,
    SessionSummary
} from '@/types/api'
import { LoadingState } from '@/components/LoadingState'
import { MARKDOWN_PLUGINS, defaultComponents } from '@/components/assistant-ui/markdown-text'
import { BriefCardMarkdownPreview } from '@/components/AssistantChat/BriefCardMarkdownPreview'
import { BriefFullMarkdownContent } from '@/components/AssistantChat/BriefFullMarkdownContent'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { FileIcon } from '@/components/FileIcon'
import { Spinner } from '@/components/Spinner'
import { cn } from '@/lib/utils'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { isImageMimeType } from '@/lib/fileAttachments'
import { NewSession } from '@/components/NewSession'
import { useTranslation } from '@/lib/use-translation'
import { getSessionTitle } from '@/lib/session-title'
import { matchesSessionSearch } from '@/lib/session-search'
import { useLongPress } from '@/hooks/useLongPress'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { queryKeys } from '@/lib/query-keys'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { useChatViewMode } from '@/hooks/useChatViewMode'
import { ContextMenu, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { TrashIcon } from '@/components/mobile/icons'

// ─── Custom Hooks ──────────────────────────────────────────────────────────────

// Custom hook for debouncing values to prevent excessive re-renders
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState(value)

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value)
        }, delay)

        return () => {
            clearTimeout(handler)
        }
    }, [value, delay])

    return debouncedValue
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function PlusIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function ChevronDownIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <polyline points="6 9 12 15 18 9" />
        </svg>
    )
}

function ChevronRightIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function ChevronLeftIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <polyline points="15 18 9 12 15 6" />
        </svg>
    )
}

function CloseIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    )
}

function QuoteIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
            <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
        </svg>
    )
}

function AttachmentIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.65 5.66l-9.2 9.19a2 2 0 0 1-2.82-2.83l8.48-8.48" />
        </svg>
    )
}

function AttachmentErrorIcon(props: { className?: string }) {
    return (
        <svg className={props.className} viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="11" r="0.75" fill="currentColor" />
        </svg>
    )
}

function SendIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="19" x2="12" y2="5" />
            <polyline points="5 12 12 5 19 12" />
        </svg>
    )
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function taskStatusClass(status: GroupTaskStatus): string {
    if (status === 'completed' || status === 'manual_done') return 'bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)]'
    if (status === 'failed' || status === 'canceled' || status === 'expired') return 'bg-[var(--app-badge-error-bg)] text-[var(--app-badge-error-text)]'
    if (status === 'running' || status === 'enqueued') return 'bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]'
    return 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
}

function isTerminalStatus(status: GroupTaskStatus): boolean {
    return status === 'completed' || status === 'manual_done' || status === 'failed' || status === 'canceled' || status === 'expired'
}

type GroupComposerAttachment = {
    id: string
    filename: string
    mimeType: string
    size: number
    status: 'uploading' | 'complete' | 'error'
    uploadSessionId: string
    path?: string
    previewUrl?: string
    error?: string
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

    const previewUrl = typeof record.previewUrl === 'string' && record.previewUrl.trim()
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

function extractBubbleAttachments(message: GroupTimelineMessage): AttachmentMetadata[] {
    const payload = message.payload
    if (!payload || typeof payload !== 'object') {
        return []
    }

    const rawAttachments = (payload as { attachments?: unknown }).attachments
    if (!Array.isArray(rawAttachments)) {
        return []
    }

    return rawAttachments
        .map((attachment) => normalizeAttachmentMetadata(attachment))
        .filter((attachment): attachment is AttachmentMetadata => attachment !== null)
}

function extractBubbleText(message: GroupTimelineMessage): string {
    const p = message.payload
    if (typeof p === 'string') return p
    if (p && typeof p === 'object') {
        const o = p as { text?: unknown; status?: unknown; command?: unknown; reason?: unknown; attachments?: unknown }
        if (typeof o.text === 'string' && o.text.trim()) return o.text
        if (typeof o.command === 'string' && o.command.trim()) return o.command
        if (typeof o.status === 'string') {
            const reason = typeof o.reason === 'string' ? `: ${o.reason}` : ''
            return `${o.status}${reason}`
        }
        if (Array.isArray(o.attachments)) return ''
    }
    try { return JSON.stringify(p) } catch { return '' }
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getAvatarInitial(label: string): string {
    const trimmed = label.trim()
    if (!trimmed) {
        return '?'
    }
    const first = Array.from(trimmed)[0]
    return first.toUpperCase()
}

function getSessionAvatarTone(session: SessionSummary | undefined): string {
    const flavor = session?.metadata?.flavor ?? ''
    if (flavor === 'claude') return 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30'
    if (flavor === 'codex') return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30'
    if (flavor === 'gemini') return 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/20 dark:text-blue-300 dark:border-blue-500/30'
    if (flavor === 'opencode') return 'bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-500/20 dark:text-fuchsia-300 dark:border-fuchsia-500/30'
    return 'bg-[var(--app-secondary-bg)] text-[var(--app-fg)] border-[var(--app-divider)]'
}

type MemberWorkStatus = 'offline' | 'pending' | 'working' | 'completed'

function getMemberWorkStatus(session: SessionSummary | undefined): MemberWorkStatus {
    if (!session?.active) {
        return 'offline'
    }
    if ((session.pendingRequestsCount ?? 0) > 0) {
        return 'pending'
    }
    if (session.thinking) {
        return 'working'
    }
    return 'completed'
}

function getMemberStatusDotClass(status: MemberWorkStatus): string {
    if (status === 'working') return 'bg-[var(--app-badge-info-text)] animate-pulse'
    if (status === 'pending') return 'bg-[var(--app-badge-warning-text)]'
    if (status === 'completed') return 'bg-[var(--app-badge-success-text)]'
    return 'bg-[var(--app-hint)]'
}

function getMemberStatusBadgeClass(status: MemberWorkStatus): string {
    if (status === 'working') return 'bg-[var(--app-badge-info-bg)] text-[var(--app-badge-info-text)]'
    if (status === 'pending') return 'bg-[var(--app-badge-warning-bg)] text-[var(--app-badge-warning-text)]'
    if (status === 'completed') return 'bg-[var(--app-badge-success-bg)] text-[var(--app-badge-success-text)]'
    return 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'
}

function getMemberStatusLabel(
    status: MemberWorkStatus,
    t: (key: string, params?: Record<string, string | number>) => string
): string {
    if (status === 'pending') {
        return t('session.item.pending')
    }
    if (status === 'working') {
        return t('session.item.thinking')
    }
    if (status === 'completed') {
        return t('session.item.completed')
    }
    return t('misc.offline')
}

function getSessionWorkingDirectory(session: SessionSummary | undefined): string {
    const worktreePath = session?.metadata?.worktree?.worktreePath?.trim()
    if (worktreePath) {
        return worktreePath
    }

    const metadataPath = session?.metadata?.path?.trim()
    if (metadataPath) {
        return metadataPath
    }

    const basePath = session?.metadata?.worktree?.basePath?.trim()
    if (basePath) {
        return basePath
    }

    return '-'
}

type PendingPermissionRequest = {
    id: string
    tool: string
    arguments: unknown
    createdAt: number | null
}

function extractPendingPermissionRequests(requests: Record<string, unknown> | null | undefined): PendingPermissionRequest[] {
    if (!requests) {
        return []
    }

    return Object.entries(requests)
        .map(([requestId, requestValue]) => {
            const request = requestValue && typeof requestValue === 'object'
                ? requestValue as Record<string, unknown>
                : null
            const tool = typeof request?.tool === 'string' ? request.tool.trim() : ''
            const createdAt = typeof request?.createdAt === 'number' && Number.isFinite(request.createdAt)
                ? request.createdAt
                : null

            return {
                id: requestId,
                tool: tool || 'unknown',
                arguments: request?.arguments,
                createdAt
            } satisfies PendingPermissionRequest
        })
        .sort((left, right) => {
            if (left.createdAt === null && right.createdAt === null) return left.id.localeCompare(right.id)
            if (left.createdAt === null) return 1
            if (right.createdAt === null) return -1
            return left.createdAt - right.createdAt
        })
}

function formatPermissionArguments(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (value === undefined) {
        return '(empty)'
    }

    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
}

function buildSessionTooltipLines(options: {
    session: SessionSummary | undefined
    sessionId: string
    statusLabel: string
}): string[] {
    const directory = getSessionWorkingDirectory(options.session)
    const agentLabel = options.session?.metadata?.flavor ?? 'unknown'
    const modelLabel = options.session?.metadata?.model?.trim() || options.session?.modelMode || 'default'
    const branch = options.session?.metadata?.worktree?.branch ?? null
    const machineId = options.session?.metadata?.machineId ?? null

    return [
        `Status: ${options.statusLabel}`,
        `Session: ${options.sessionId}`,
        `Directory: ${directory}`,
        `Agent: ${agentLabel}`,
        `Model: ${modelLabel}`,
        ...(branch ? [`Branch: ${branch}`] : []),
        ...(machineId ? [`Machine: ${machineId}`] : [])
    ]
}

function getActorSessionId(message: GroupTimelineMessage): string | null {
    if (message.actorSessionId) {
        return message.actorSessionId
    }
    if (message.source.startsWith('session:')) {
        const value = message.source.slice('session:'.length).trim()
        return value || null
    }
    return null
}

function canQuoteMessage(message: GroupTimelineMessage): boolean {
    // 只允许引用聊天消息，不允许引用系统消息等
    return message.type === 'chat' && !message.source.startsWith('system:')
}

function truncateText(text: string, maxLength: number = 100): string {
    if (text.length <= maxLength) return text
    return text.slice(0, maxLength) + '...'
}

function parseQuoteFromText(text: string): { actorName: string; quotedText: string } | null {
    if (!text.startsWith('>')) return null

    const lines = text.split('\n')
    const quotedLines: string[] = []
    let actorName = 'Unknown'

    for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('>')) break

        const content = trimmed.slice(1).trim()
        if (quotedLines.length === 0 && content.includes(':')) {
            // First line might contain "Author: content"
            const colonIndex = content.indexOf(':')
            actorName = content.slice(0, colonIndex).trim()
            const remainingContent = content.slice(colonIndex + 1).trim()
            if (remainingContent) {
                quotedLines.push(remainingContent)
            }
        } else if (content) {
            quotedLines.push(content)
        }
    }

    return quotedLines.length > 0 ? {
        actorName,
        quotedText: quotedLines.join(' ')
    } : null
}

function getDisplayText(message: GroupTimelineMessage): string {
    const text = extractBubbleText(message)

    // Only filter quote content if we have the quotedMessage field from backend
    // If backend doesn't provide quotedMessage field, we rely on parseQuoteFromText for UI display
    if (message.quotedMessage) {
        const lines = text.split('\n')
        let startIndex = 0

        // Skip all lines that start with '>' (blockquote) and subsequent empty lines
        while (startIndex < lines.length) {
            const line = lines[startIndex].trim()
            if (line.startsWith('>')) {
                startIndex++
            } else if (startIndex > 0 && line === '') {
                startIndex++
            } else {
                break
            }
        }

        const remainingText = lines.slice(startIndex).join('\n').trim()
        return remainingText || text // fallback to original text if nothing remains
    }

    return text
}

type CommandTextPart =
    | { type: 'text'; value: string }
    | { type: 'mention'; raw: string; sessionId: string }

function splitCommandTextByMention(text: string): CommandTextPart[] {
    if (!text) {
        return []
    }

    const mentionRegex = /\B@([A-Za-z0-9._:-]+)/g
    const parts: CommandTextPart[] = []
    let lastIndex = 0
    let match: RegExpExecArray | null

    while ((match = mentionRegex.exec(text)) !== null) {
        const raw = match[0] ?? ''
        const sessionId = (match[1] ?? '').trim()
        const matchIndex = match.index

        if (matchIndex > lastIndex) {
            parts.push({
                type: 'text',
                value: text.slice(lastIndex, matchIndex)
            })
        }

        if (!sessionId) {
            parts.push({ type: 'text', value: raw })
        } else {
            parts.push({ type: 'mention', raw, sessionId })
        }

        lastIndex = matchIndex + raw.length
    }

    if (lastIndex < text.length) {
        parts.push({
            type: 'text',
            value: text.slice(lastIndex)
        })
    }

    return parts.length > 0 ? parts : [{ type: 'text', value: text }]
}

function CommandText(props: {
    content: string
    sessionMap: Map<string, SessionSummary>
    isUser: boolean
    onOpenSession: (sessionId: string) => void
}) {
    const parts = splitCommandTextByMention(props.content)

    return (
        <>
            {parts.map((part, index) => {
                const key = `${part.type}:${index}`
                if (part.type === 'text') {
                    return <span key={key}>{part.value}</span>
                }

                if (part.sessionId === 'all') {
                    return (
                        <span
                            key={key}
                            className={cn(
                                'font-semibold',
                                props.isUser ? 'text-[var(--app-button-text)] opacity-90' : 'text-[var(--app-link)]'
                            )}
                        >
                            {part.raw}
                        </span>
                    )
                }

                const session = props.sessionMap.get(part.sessionId)
                if (!session) {
                    return <span key={key}>{part.raw}</span>
                }

                const sessionTitle = getSessionTitle(session, {
                    fallbackSessionId: part.sessionId,
                    fallbackIdLength: 12
                })
                const mentionLabel = `@${sessionTitle}`
                const showSessionId = sessionTitle !== part.sessionId

                return (
                    <span key={key}>
                        <button
                            type="button"
                            onClick={() => props.onOpenSession(part.sessionId)}
                            className={cn(
                                'rounded px-0.5 align-baseline underline decoration-dotted underline-offset-2 transition-colors',
                                props.isUser
                                    ? 'text-[var(--app-button-text)] hover:bg-[var(--app-subtle-bg)]'
                                    : 'text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)]'
                            )}
                            title={`Open session ${sessionTitle} (${part.sessionId})`}
                        >
                            {mentionLabel}
                        </button>
                        {showSessionId ? (
                            <span className={cn(props.isUser ? 'text-[var(--app-button-text)] opacity-70' : 'text-[var(--app-hint)]')}>
                                ({part.sessionId})
                            </span>
                        ) : null}
                    </span>
                )
            })}
        </>
    )
}

function BubbleMarkdown(props: {
    content: string
    isUser: boolean
}) {
    return (
        <div
            className={cn(
                'aui-md min-w-0 max-w-full break-words text-sm',
                props.isUser
                    ? '[&_.aui-md-a]:text-[var(--app-button-text)] [&_.aui-md-a]:decoration-[var(--app-button-text)] [&_.aui-md-a]:opacity-90 [&_.aui-md-code]:bg-[var(--app-subtle-bg)] [&_.aui-md-blockquote]:border-[var(--app-divider)]'
                    : ''
            )}
        >
            <ReactMarkdown
                remarkPlugins={MARKDOWN_PLUGINS}
                components={defaultComponents}
            >
                {props.content}
            </ReactMarkdown>
        </div>
    )
}

const COMPOSER_MIN_HEIGHT_PX = 38
const COMPOSER_MAX_HEIGHT_PX = 120

function resizeComposerTextarea(el: HTMLTextAreaElement | null): void {
    if (!el) return

    const selectionStart = el.selectionStart
    const selectionEnd = el.selectionEnd

    el.style.height = 'auto'
    const scrollHeight = el.scrollHeight
    const nextHeight = Math.min(Math.max(scrollHeight, COMPOSER_MIN_HEIGHT_PX), COMPOSER_MAX_HEIGHT_PX)
    el.style.height = `${nextHeight}px`

    const shouldScroll = scrollHeight > COMPOSER_MAX_HEIGHT_PX
    el.style.overflowY = shouldScroll ? 'auto' : 'hidden'

    // Re-apply selection to keep caret visible after internal textarea resize.
    if (shouldScroll && selectionStart !== null && selectionEnd !== null) {
        el.setSelectionRange(selectionStart, selectionEnd)
    } else if (!shouldScroll && el.scrollTop !== 0) {
        el.scrollTop = 0
    }
}

// ─── AddMemberModal ───────────────────────────────────────────────────────────

function AddMemberModal(props: {
    existingMemberSessionIds: Set<string>
    onAdd: (sessionId: string) => Promise<void>
    onClose: () => void
    isPending: boolean
}) {
    const { t } = useTranslation()
    const { api } = useAppContext()
    const { sessions, isLoading: sessionsLoading } = useSessions(api)
    const { machines } = useMachines(api, true)
    const [search, setSearch] = useState('')
    const [addingId, setAddingId] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [offlineExpanded, setOfflineExpanded] = useState(false)
    const [mode, setMode] = useState<'select' | 'create'>('select')

    const onlineMachines = useMemo(() => machines.filter((m) => m.active), [machines])

    const { online, offline } = useMemo(() => {
        const available = sessions.filter((s) => {
            if (props.existingMemberSessionIds.has(s.id)) return false
            return matchesSessionSearch(s, search)
        })
        return {
            online: available.filter((s) => s.active),
            offline: available.filter((s) => !s.active)
        }
    }, [sessions, props.existingMemberSessionIds, search])

    const handleAdd = async (sessionId: string) => {
        setAddingId(sessionId)
        setError(null)
        try {
            await props.onAdd(sessionId)
            props.onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add member')
        } finally {
            setAddingId(null)
        }
    }

    const handleSessionCreated = async (sessionId: string) => {
        setError(null)
        try {
            await props.onAdd(sessionId)
            props.onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to add member')
        }
    }

    const renderSessionRow = (s: (typeof sessions)[0]) => {
        const title = getSessionTitle(s, { fallbackIdLength: 12 })
        const path = s.metadata?.path ?? ''
        const workStatus = getMemberWorkStatus(s)
        const dotClass = getMemberStatusDotClass(workStatus)
        return (
            <button
                key={s.id}
                type="button"
                disabled={addingId === s.id || props.isPending}
                onClick={() => { void handleAdd(s.id) }}
                className="flex w-full items-start gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--app-subtle-bg)] disabled:opacity-60"
            >
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--app-fg)]">{title}</div>
                    {path
                        ? <div className="truncate text-xs text-[var(--app-hint)]">{path}</div>
                        : <div className="truncate text-xs text-[var(--app-hint)]">{s.id.slice(0, 20)}…</div>
                    }
                </div>
            </button>
        )
    }

    if (mode === 'create') {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="flex w-full max-w-lg flex-col rounded-xl border border-[var(--app-divider)] bg-[var(--app-bg)] shadow-xl" style={{ maxHeight: '90vh' }}>
                    <div className="flex items-center justify-between border-b border-[var(--app-divider)] px-4 py-3">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setMode('select')}
                                className="rounded-full p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                title={t('button.back')}
                            >
                                <ChevronLeftIcon />
                            </button>
                            <div className="font-semibold text-sm text-[var(--app-fg)]">{t('newSession.title')}</div>
                        </div>
                        <button type="button" onClick={props.onClose} className="rounded-full p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]">
                            <CloseIcon />
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto">
                        <NewSession
                            api={api}
                            machines={machines}
                            onSuccess={handleSessionCreated}
                            onCancel={() => setMode('select')}
                        />
                    </div>

                    {error ? <div className="border-t border-[var(--app-divider)] px-4 py-2 text-xs text-red-600">{error}</div> : null}
                </div>
            </div>
        )
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="flex w-full max-w-sm flex-col rounded-xl border border-[var(--app-divider)] bg-[var(--app-bg)] shadow-xl" style={{ maxHeight: '80vh' }}>
                <div className="flex items-center justify-between border-b border-[var(--app-divider)] px-4 py-3">
                    <div className="font-semibold text-sm text-[var(--app-fg)]">{t('groups.detail.addMember')}</div>
                    <button type="button" onClick={props.onClose} className="rounded-full p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]">
                        <CloseIcon />
                    </button>
                </div>

                {/* Mode toggle */}
                <div className="border-b border-[var(--app-divider)]">
                    <button
                        type="button"
                        onClick={() => setMode('create')}
                        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-sm text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                    >
                        <PlusIcon className="h-3.5 w-3.5 shrink-0" />
                        Create new session
                        <ChevronRightIcon className="ml-auto h-3.5 w-3.5 text-[var(--app-hint)]" />
                    </button>
                </div>

                <div className="border-b border-[var(--app-divider)] px-3 py-2">
                    <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('sessions.search.placeholder')} className="w-full rounded-md border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-1.5 text-sm outline-none focus:border-[var(--app-link)]" />
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                    {sessionsLoading ? (
                        <div className="px-4 py-3 text-sm text-[var(--app-hint)]">{t('mobile.feed.loading')}</div>
                    ) : online.length === 0 && offline.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-[var(--app-hint)]">{search ? 'No sessions match.' : 'No sessions available.'}</div>
                    ) : (
                        <>
                            {online.length > 0 ? (
                                <>
                                    <div className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">Online ({online.length})</div>
                                    {online.map(renderSessionRow)}
                                </>
                            ) : null}
                            {offline.length > 0 ? (
                                <>
                                    <button type="button" onClick={() => setOfflineExpanded((v) => !v)} className="flex w-full items-center gap-1.5 px-4 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] transition-colors">
                                        <ChevronRightIcon className={`h-3 w-3 transition-transform ${offlineExpanded ? 'rotate-90' : ''}`} />
                                        Offline ({offline.length})
                                    </button>
                                    {offlineExpanded ? offline.map(renderSessionRow) : null}
                                </>
                            ) : null}
                        </>
                    )}
                </div>

                {error ? <div className="border-t border-[var(--app-divider)] px-4 py-2 text-xs text-red-600">{error}</div> : null}
            </div>
        </div>
    )
}

// ─── MemberPill ───────────────────────────────────────────────────────────────

function MemberPill(props: {
    member: GroupMember
    session?: SessionSummary
    status: MemberWorkStatus
    onClick: () => void
    onOpenActions?: (point: { x: number; y: number }) => void
}) {
    const { t } = useTranslation()
    const { member, session, status } = props
    const title = getSessionTitle(session, { fallbackSessionId: member.sessionId, fallbackIdLength: 12 })
    const idText = member.sessionId ?? `user:${member.userId ?? member.id}`
    const avatarInitial = getAvatarInitial(title)
    const avatarTone = getSessionAvatarTone(session)
    const clickable = Boolean(member.sessionId)
    const dotClass = getMemberStatusDotClass(status)
    const statusClass = getMemberStatusBadgeClass(status)
    const statusLabel = getMemberStatusLabel(status, t)
    const tooltipLines = buildSessionTooltipLines({
        session,
        sessionId: idText,
        statusLabel
    })
    const tooltipText = tooltipLines.join('\n')
    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            if (clickable) {
                props.onOpenActions?.(point)
            }
        },
        onClick: props.onClick,
        threshold: 500,
        disabled: !clickable
    })

    return (
        <button
            type="button"
            {...longPressHandlers}
            disabled={!clickable}
            className={`group relative flex items-center gap-1.5 rounded-lg border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-2 py-1 text-left transition-colors ${clickable ? 'hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-link)]' : 'cursor-default'}`}
            style={{ WebkitTouchCallout: 'none' }}
            aria-label={tooltipText}
        >
            <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden w-80 max-w-[calc(100vw-1rem)] -translate-x-1/2 rounded-md border border-[var(--app-divider)] bg-[var(--app-bg)] px-2.5 py-2 text-xs text-[var(--app-fg)] shadow-lg group-hover:block group-focus-visible:block">
                <div className="space-y-0.5">
                    <div className="font-medium">{title}</div>
                    {tooltipLines.map((line) => (
                        <div key={line} className="text-[var(--app-hint)] break-all">{line}</div>
                    ))}
                </div>
            </div>
            <span className="relative shrink-0">
                <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold ${avatarTone}`}>
                    {avatarInitial}
                </span>
                <span className={`absolute -bottom-px -right-px h-1.5 w-1.5 rounded-full ${dotClass}`} />
            </span>
            <span className="max-w-[120px] truncate text-[11px] font-medium text-[var(--app-fg)]">{title}</span>
            <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${statusClass}`}>
                {statusLabel}
            </span>
        </button>
    )
}

type MemberActionMenuProps = {
    isOpen: boolean
    onClose: () => void
    onRemove: () => void
    anchorPoint: { x: number; y: number }
}

function MemberActionMenu(props: MemberActionMenuProps) {
    const { t } = useTranslation()
    return (
        <ContextMenu open={props.isOpen} anchorPoint={props.anchorPoint} onClose={props.onClose} label={t('session.more')}>
            <ContextMenuItem
                icon={<TrashIcon />}
                label={t('groups.member.remove')}
                destructive
                onSelect={() => {
                    props.onClose()
                    props.onRemove()
                }}
            />
        </ContextMenu>
    )
}

function PendingRequestsQuickModal(props: {
    sessionId: string
    sessionTitle: string
    isLoading: boolean
    requests: PendingPermissionRequest[]
    loadError: string | null
    actionError: string | null
    activeRequestId: string | null
    onApprove: (requestId: string) => Promise<void>
    onDeny: (requestId: string) => Promise<void>
    onRefresh: () => void
    onOpenSession: () => void
    onClose: () => void
}) {
    const { t } = useTranslation()
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    props.onClose()
                }
            }}
        >
            <div
                className="flex w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-[var(--app-divider)] bg-[var(--app-bg)] shadow-xl"
                style={{ maxHeight: '85vh' }}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between border-b border-[var(--app-divider)] px-4 py-3">
                    <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-[var(--app-fg)]">
                            {t('groups.detail.pendingRequests')}
                        </div>
                        <div className="truncate text-xs text-[var(--app-hint)]">
                            {props.sessionTitle} · {props.sessionId}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={props.onClose}
                        className="rounded-full p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                        title={t('button.close')}
                    >
                        <CloseIcon />
                    </button>
                </div>

                <div className="flex flex-wrap items-center gap-2 border-b border-[var(--app-divider)] px-4 py-2">
                    <button
                        type="button"
                        onClick={props.onRefresh}
                        className="rounded border border-[var(--app-divider)] px-2 py-1 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    >
                        Refresh
                    </button>
                    <button
                        type="button"
                        onClick={props.onOpenSession}
                        className="rounded border border-[var(--app-divider)] px-2 py-1 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                    >
                        Open Session
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                    {props.loadError ? (
                        <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {props.loadError}
                        </div>
                    ) : null}
                    {props.actionError ? (
                        <div className="mb-2 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">
                            {props.actionError}
                        </div>
                    ) : null}

                    {props.isLoading ? (
                        <LoadingState label="Loading pending requests..." className="py-4 text-sm" />
                    ) : props.requests.length === 0 ? (
                        <div className="rounded border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-2 text-sm text-[var(--app-hint)]">
                            No pending requests.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {props.requests.map((request) => {
                                const isActing = props.activeRequestId === request.id
                                return (
                                    <div key={request.id} className="rounded-lg border border-[var(--app-divider)] bg-[var(--app-secondary-bg)]">
                                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--app-divider)] px-3 py-2 text-xs">
                                            <span className="rounded bg-[var(--app-subtle-bg)] px-1.5 py-0.5 font-semibold text-[var(--app-fg)]">
                                                {request.tool}
                                            </span>
                                            <span className="text-[var(--app-hint)]">
                                                #{request.id}
                                            </span>
                                            {request.createdAt ? (
                                                <span className="text-[var(--app-hint)]">
                                                    {new Date(request.createdAt).toLocaleString()}
                                                </span>
                                            ) : null}
                                        </div>

                                        <div className="px-3 py-2">
                                            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--app-hint)]">
                                                Arguments
                                            </div>
                                            <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all rounded border border-[var(--app-divider)] bg-[var(--app-bg)] p-2 text-[11px] text-[var(--app-fg)]">
                                                {formatPermissionArguments(request.arguments)}
                                            </pre>
                                        </div>

                                        <div className="flex items-center justify-end gap-2 border-t border-[var(--app-divider)] px-3 py-2">
                                            <button
                                                type="button"
                                                onClick={() => { void props.onDeny(request.id) }}
                                                disabled={props.activeRequestId !== null}
                                                className="rounded border border-red-400 px-2 py-1 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {t('groups.detail.deny')}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => { void props.onApprove(request.id) }}
                                                disabled={props.activeRequestId !== null}
                                                className="rounded border border-green-500 px-2 py-1 text-xs text-green-700 hover:bg-green-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                {isActing ? t('groups.detail.processing') : t('groups.detail.approve')}
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── TaskStateList ─────────────────────────────────────────────────────────────
// Collapsible task detail shown under a command bubble

type LatestTaskStates = Map<string, GroupTimelineMessage>  // taskId → latest msg

function TaskStateList(props: { taskStates: LatestTaskStates }) {
    const [open, setOpen] = useState(false)
    const tasks = Array.from(props.taskStates.values())
    if (tasks.length === 0) return null

    const allDone = tasks.every((t) => {
        const p = t.payload as { status?: unknown } | null
        return isTerminalStatus((p?.status ?? 'pending') as GroupTaskStatus)
    })
    const summary = `${tasks.length} task${tasks.length > 1 ? 's' : ''}${allDone ? ' ✓' : ''}`

    return (
        <div className="mt-1 max-w-[88%] sm:max-w-[82%] lg:max-w-[75%]">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex items-center gap-1 text-[10px] text-[var(--app-hint)] hover:text-[var(--app-fg)] transition-colors"
            >
                <ChevronRightIcon className={`h-2.5 w-2.5 transition-transform ${open ? 'rotate-90' : ''}`} />
                {summary}
            </button>
            {open ? (
                <div className="mt-1 space-y-1">
                    {tasks.map((t) => {
                        const p = t.payload as { status?: unknown; targetSessionId?: unknown; error?: unknown } | null
                        const status = (p?.status ?? 'pending') as GroupTaskStatus
                        const target = typeof p?.targetSessionId === 'string' ? p.targetSessionId.slice(0, 14) : ''
                        const error = typeof p?.error === 'string' ? p.error : null
                        return (
                            <div key={t.taskId ?? t.id} className="flex flex-wrap items-center gap-1.5 rounded-md border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-2 py-1">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${taskStatusClass(status)}`}>{status}</span>
                                {target ? <span className="text-[10px] text-[var(--app-hint)]">{target}</span> : null}
                                {error ? <span className="text-[10px] text-red-500">{error}</span> : null}
                            </div>
                        )
                    })}
                </div>
            ) : null}
        </div>
    )
}

// ─── TimelineBubble ───────────────────────────────────────────────────────────

function TimelineBubble(props: {
    message: GroupTimelineMessage
    sessionMap: Map<string, SessionSummary>
    onOpenSession: (sessionId: string) => void
    onQuote?: (message: GroupTimelineMessage) => void
    taskStates?: LatestTaskStates
}) {
    const { t } = useTranslation()
    const { message } = props
    const text = getDisplayText(message)
    const attachments = extractBubbleAttachments(message)
    const isUser = message.source.startsWith('user:')
    const isSystem = message.type === 'system' || message.type === 'note_state'
    const isCommand = message.type === 'command'

    // Get quote information either from message.quotedMessage or parse from text
    const quoteInfo = message.quotedMessage
        ? { actorName: message.quotedMessage.actorName || 'Unknown', quotedText: message.quotedMessage.text }
        : parseQuoteFromText(extractBubbleText(message))

    if (isSystem) {
        return (
            <div className="flex justify-center py-1">
                <span className="rounded-full bg-[var(--app-secondary-bg)] px-3 py-1 text-[11px] italic text-[var(--app-hint)]">{text}</span>
            </div>
        )
    }

    const actorSessionId = getActorSessionId(message)
    const actorSession = actorSessionId ? props.sessionMap.get(actorSessionId) : undefined
    const actorTitle = actorSessionId
        ? getSessionTitle(actorSession, { fallbackSessionId: actorSessionId, fallbackIdLength: 12 })
        : (message.actorName || message.source)
    const actorId = actorSessionId ?? null
    const actorInitial = getAvatarInitial(actorTitle)
    const actorTone = getSessionAvatarTone(actorSession)
    const actorStatusLabel = actorSessionId
        ? getMemberStatusLabel(getMemberWorkStatus(actorSession), t)
        : 'unknown'
    const actorTooltipLines = actorSessionId
        ? buildSessionTooltipLines({
            session: actorSession,
            sessionId: actorSessionId,
            statusLabel: actorStatusLabel
        })
        : []
    const actorTooltipText = actorTooltipLines.join('\n')

    const replyBtn = canQuoteMessage(message) && props.onQuote ? (
        <button
            type="button"
            onClick={() => props.onQuote?.(message)}
            className="mb-1 shrink-0 self-end rounded-full p-1 text-[var(--app-hint)] opacity-100 transition-opacity hover:bg-[var(--app-subtle-bg)] md:opacity-0 md:group-hover/message:opacity-100"
            title={t('groups.detail.reply')}
        >
            <QuoteIcon className="h-3.5 w-3.5" />
        </button>
    ) : null

    return (
        <div className={`group/message flex items-end gap-1 py-1 ${isUser ? 'justify-end pl-3.5 pr-2' : 'justify-start pl-2 pr-3.5'}`}>
            {isUser && replyBtn}
            <div className={`flex max-w-[88%] flex-col ${isUser ? 'items-end' : 'items-start'} sm:max-w-[82%] lg:max-w-[75%]`}>
                <div className="mb-1 flex items-center gap-2">
                    {actorSessionId ? (
                        <div className="group relative shrink-0">
                            <button
                                type="button"
                                onClick={() => props.onOpenSession(actorSessionId)}
                                className="transition-opacity hover:opacity-80"
                                aria-label={actorTooltipText}
                            >
                                <span className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${actorTone}`}>
                                    {actorInitial}
                                </span>
                            </button>
                            <div className={`pointer-events-none absolute top-full z-30 mt-2 hidden w-80 max-w-[calc(100vw-1rem)] rounded-md border border-[var(--app-divider)] bg-[var(--app-bg)] px-2.5 py-2 text-xs text-[var(--app-fg)] shadow-lg group-hover:block group-focus-within:block ${isUser ? 'right-0' : 'left-0'}`}>
                                <div className="space-y-0.5">
                                    <div className="font-medium">{actorTitle}</div>
                                    {actorTooltipLines.map((line) => (
                                        <div key={line} className="text-[var(--app-hint)] break-all">{line}</div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : null}
                    <div className={`min-w-0 ${isUser ? 'text-right' : 'text-left'}`}>
                        <div className="truncate text-[11px] font-medium text-[var(--app-fg)]">{actorTitle}</div>
                        {actorId ? (
                            <div className="truncate text-[10px] text-[var(--app-hint)]">
                                {actorId}
                            </div>
                        ) : null}
                    </div>
                </div>
                <div
                    className={`rounded-2xl px-3 py-2 text-sm ${
                        isUser
                            ? 'bg-[var(--app-button)] text-[var(--app-button-text)] rounded-br-sm'
                            : 'bg-[var(--app-secondary-bg)] text-[var(--app-fg)] rounded-bl-sm'
                    } ${isCommand
                        ? 'font-mono text-xs whitespace-pre-wrap break-words'
                        : isUser
                            ? '[&_.aui-md]:text-sm [&_.aui-md-a]:text-[var(--app-button-text)] [&_.aui-md-a]:decoration-[var(--app-button-text)] [&_.aui-md-a]:opacity-90 [&_.aui-md-code]:bg-[var(--app-subtle-bg)] [&_.aui-md-blockquote]:border-[var(--app-divider)]'
                            : '[&_.aui-md]:text-sm'
                    }`}
                >
                    {quoteInfo && (
                        <div className={`mb-1.5 flex items-start gap-1.5 rounded px-2 py-1.5 ${
                            isUser ? 'bg-[var(--app-subtle-bg)]' : 'bg-[var(--app-bg)]/60'
                        }`}>
                            <QuoteIcon className="mt-0.5 h-2.5 w-2.5 shrink-0 opacity-60" />
                            <div className="min-w-0 flex-1">
                                <span className={`text-[10px] font-medium ${
                                    isUser ? 'text-[var(--app-button-text)] opacity-90' : 'text-[var(--app-link)]'
                                }`}>
                                    {quoteInfo.actorName}:
                                </span>
                                <span className={`ml-1 break-all text-[10px] leading-4 ${
                                    isUser ? 'text-[var(--app-button-text)] opacity-70' : 'text-[var(--app-hint)]'
                                }`}>
                                    {truncateText(quoteInfo.quotedText, 64)}
                                </span>
                            </div>
                        </div>
                    )}
                    {text ? (
                        isCommand
                            ? (
                                <CommandText
                                    content={text}
                                    sessionMap={props.sessionMap}
                                    isUser={isUser}
                                    onOpenSession={props.onOpenSession}
                                />
                            )
                            : <BubbleMarkdown content={text} isUser={isUser} />
                    ) : null}
                    {attachments.length > 0 ? (
                        <MessageAttachments attachments={attachments} />
                    ) : null}
                </div>
                {isCommand && props.taskStates && props.taskStates.size > 0 ? (
                    <TaskStateList taskStates={props.taskStates} />
                ) : null}
                <div className="mt-0.5 text-[10px] text-[var(--app-hint)]">
                    {formatTime(message.createdAt)}
                </div>
            </div>
            {!isUser && replyBtn}
        </div>
    )
}

// ─── MentionPopup ─────────────────────────────────────────────────────────────

type MentionCandidate = { id: string; label: string; sublabel?: string }

function MentionPopup(props: {
    candidates: MentionCandidate[]
    activeIndex: number
    onSelect: (id: string) => void
    position?: number
}) {
    if (props.candidates.length === 0) return null

    const suggestions: Suggestion[] = props.candidates.map((candidate) => ({
        key: candidate.id,
        text: `@${candidate.id}`,
        label: candidate.sublabel ?? candidate.id,
        description: `@${candidate.id}`,
        source: 'builtin'
    }))

    return (
        <div
            className="absolute bottom-full z-20 mb-1 min-w-[240px] max-w-[320px] overflow-hidden"
            style={{ left: `${props.position ?? 0}px` }}
        >
            <FloatingOverlay maxHeight={220}>
                <Autocomplete
                    suggestions={suggestions}
                    selectedIndex={props.activeIndex}
                    onSelect={(index) => {
                        const candidate = props.candidates[index]
                        if (candidate) {
                            props.onSelect(candidate.id)
                        }
                    }}
                />
            </FloatingOverlay>
        </div>
    )
}

function isPendingAttachmentAsyncGenerator(
    value: Promise<PendingAttachment> | AsyncGenerator<PendingAttachment, void, unknown>
): value is AsyncGenerator<PendingAttachment, void, unknown> {
    return typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
}

function ComposerAttachmentList(props: {
    attachments: GroupComposerAttachment[]
    disabled: boolean
    onRemove: (id: string) => void
}) {
    const { t } = useTranslation()
    if (props.attachments.length === 0) {
        return null
    }

    return (
        <div className="flex flex-wrap gap-2 border-b border-[var(--app-border)] px-4 pb-2 pt-3">
            {props.attachments.map((attachment) => {
                const isImage = isImageMimeType(attachment.mimeType) && Boolean(attachment.previewUrl)
                const statusText = attachment.status === 'uploading'
                    ? t('groups.detail.uploading')
                    : attachment.status === 'error'
                        ? (attachment.error ?? 'Upload failed')
                        : formatFileSize(attachment.size)

                return (
                    <div key={attachment.id} className="flex min-w-[180px] max-w-full items-center gap-2 rounded-lg bg-[var(--app-subtle-bg)] px-3 py-2 text-base text-[var(--app-fg)]">
                        {attachment.status === 'uploading' ? (
                            <Spinner size="sm" label={null} className="text-[var(--app-hint)]" />
                        ) : null}
                        {attachment.status === 'error' ? (
                            <span className="text-red-500">
                                <AttachmentErrorIcon className="h-4 w-4" />
                            </span>
                        ) : null}
                        {isImage ? (
                            <img
                                src={attachment.previewUrl}
                                alt={attachment.filename}
                                className="h-8 w-8 shrink-0 rounded object-cover"
                            />
                        ) : (
                            <span className="shrink-0">
                                <FileIcon fileName={attachment.filename} size={20} />
                            </span>
                        )}
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-[var(--app-fg)]">
                                {attachment.filename}
                            </div>
                            <div className={`truncate text-[10px] ${attachment.status === 'error' ? 'text-red-600' : 'text-[var(--app-hint)]'}`}>
                                {statusText}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={() => { void props.onRemove(attachment.id) }}
                            disabled={props.disabled}
                            className="shrink-0 rounded p-0.5 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                            title={t('groups.detail.removeAttachment')}
                        >
                            <CloseIcon className="h-3 w-3" />
                        </button>
                    </div>
                )
            })}
        </div>
    )
}

const TIMELINE_FIRST_ITEM_INDEX_BASE = 1_000_000

const TimelineScroller = forwardRef<HTMLDivElement, ComponentProps<'div'>>(
    function TimelineScroller(props, ref) {
        return (
            <div
                {...props}
                ref={ref}
                className={`app-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden ${props.className ?? ''}`.trim()}
            />
        )
    }
)

function TimelineHistoryControl(props: {
    isLoading: boolean
    hasMore: boolean
    onLoadMore: () => void
}) {
    if (!props.isLoading && !props.hasMore) {
        return null
    }

    if (props.isLoading) {
        return (
            <div className="py-1.5 text-center">
                <span className="inline-flex rounded-full bg-[var(--app-button)] px-2.5 py-1 text-xs text-[var(--app-button-text)]">
                    Loading history...
                </span>
            </div>
        )
    }

    return (
        <div className="py-1.5 text-center">
            <button
                type="button"
                onClick={props.onLoadMore}
                className="inline-flex rounded-full border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-2.5 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
            >
                Load older
            </button>
        </div>
    )
}

type GroupTurnDetailState = {
    isLoading: boolean
    isLoadingMore: boolean
    error: string | null
    messages: GroupTimelineMessage[]
    nextBeforeSeq: number | null
    hasMore: boolean
}

type GroupTurnDetailStateMap = Record<string, GroupTurnDetailState>

const GROUP_TURN_DETAIL_PAGE_LIMIT = 120
const MOBILE_BRIEF_BREAKPOINT_QUERY = '(max-width: 767px)'
const MOBILE_BRIEF_TURN_QUERY_KEY = 'briefTurnId'

function normalizeBriefPreview(value: string | null | undefined, fallback: string): string {
    const text = value?.trim() ?? ''
    return text.length > 0 ? text : fallback
}

function buildDefaultGroupTurnDetailState(): GroupTurnDetailState {
    return {
        isLoading: false,
        isLoadingMore: false,
        error: null,
        messages: [],
        nextBeforeSeq: null,
        hasMore: false
    }
}

function readMobileBriefTurnId(search: string): string | null {
    const rawValue = new URLSearchParams(search).get(MOBILE_BRIEF_TURN_QUERY_KEY)
    const value = rawValue?.trim() ?? ''
    return value.length > 0 ? value : null
}

function writeMobileBriefTurnId(turnId: string | null, mode: 'push' | 'replace'): void {
    if (typeof window === 'undefined') {
        return
    }

    const url = new URL(window.location.href)
    if (turnId) {
        url.searchParams.set(MOBILE_BRIEF_TURN_QUERY_KEY, turnId)
    } else {
        url.searchParams.delete(MOBILE_BRIEF_TURN_QUERY_KEY)
    }

    const nextUrl = `${url.pathname}${url.search}${url.hash}`
    if (mode === 'replace') {
        window.history.replaceState(window.history.state, '', nextUrl)
        return
    }

    window.history.pushState(window.history.state, '', nextUrl)
}

function GroupBriefTurnDetailList(props: {
    messages: GroupTimelineMessage[]
    hasMore: boolean
    isLoadingMore: boolean
    onLoadMore: () => Promise<void>
    sessionMap: Map<string, SessionSummary>
    onOpenSession: (sessionId: string) => void
}) {
    const listRef = useRef<VirtuosoHandle | null>(null)
    const initialBottomDoneRef = useRef(false)

    const taskStateMap = useMemo(() => {
        const map = new Map<string, Map<string, GroupTimelineMessage>>()
        for (const msg of props.messages) {
            if (msg.type !== 'task_state' || !msg.traceId) continue
            if (!map.has(msg.traceId)) map.set(msg.traceId, new Map())
            const byTask = map.get(msg.traceId)!
            const taskKey = msg.taskId ?? msg.id
            const prev = byTask.get(taskKey)
            if (!prev || msg.seq > prev.seq) {
                byTask.set(taskKey, msg)
            }
        }
        return map
    }, [props.messages])

    const visibleMessages = useMemo(
        () => props.messages.filter((message) => message.type !== 'task_state'),
        [props.messages]
    )

    useEffect(() => {
        if (visibleMessages.length === 0) {
            initialBottomDoneRef.current = false
            return
        }
        if (initialBottomDoneRef.current) {
            return
        }
        initialBottomDoneRef.current = true
        const rafId = window.requestAnimationFrame(() => {
            listRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
        })
        return () => {
            window.cancelAnimationFrame(rafId)
        }
    }, [visibleMessages.length])

    return (
        <Virtuoso
            ref={listRef}
            data={visibleMessages}
            style={{ height: '100%' }}
            increaseViewportBy={{ top: 400, bottom: 400 }}
            startReached={() => {
                if (!props.hasMore || props.isLoadingMore) {
                    return
                }
                void props.onLoadMore()
            }}
            followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
            components={{
                Scroller: TimelineScroller,
                Header: () => (
                    <TimelineHistoryControl
                        isLoading={props.isLoadingMore}
                        hasMore={props.hasMore}
                        onLoadMore={() => {
                            if (props.isLoadingMore || !props.hasMore) {
                                return
                            }
                            void props.onLoadMore()
                        }}
                    />
                ),
                Footer: () => <div className="h-2" />
            }}
            itemContent={(_index, message) => (
                <TimelineBubble
                    key={message.id}
                    message={message}
                    sessionMap={props.sessionMap}
                    onOpenSession={props.onOpenSession}
                    taskStates={message.type === 'command' && message.traceId
                        ? taskStateMap.get(message.traceId)
                        : undefined
                    }
                />
            )}
        />
    )
}

function GroupBriefTurnList(props: {
    api: ApiClient
    groupId: string
    turns: GroupConversationTurn[]
    warning: string | null
    isLoading: boolean
    isLoadingMore: boolean
    hasMore: boolean
    onLoadMoreTurns: () => Promise<void>
    sessionMap: Map<string, SessionSummary>
    onOpenSession: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const listRef = useRef<VirtuosoHandle | null>(null)
    const autoScrollToBottomDoneRef = useRef(false)
    const isAtBottomRef = useRef(true)
    const [activeTurnId, setActiveTurnId] = useState<string | null>(null)
    const [turnDetailStateById, setTurnDetailStateById] = useState<GroupTurnDetailStateMap>({})
    const [isMobileViewport, setIsMobileViewport] = useState(() => (
        typeof window !== 'undefined' && window.matchMedia(MOBILE_BRIEF_BREAKPOINT_QUERY).matches
    ))

    const activeTurn = useMemo(
        () => props.turns.find((turn) => turn.id === activeTurnId) ?? null,
        [activeTurnId, props.turns]
    )

    const activeDetail = useMemo(
        () => (activeTurnId ? (turnDetailStateById[activeTurnId] ?? buildDefaultGroupTurnDetailState()) : null),
        [activeTurnId, turnDetailStateById]
    )

    const fetchTurnMessages = useCallback(async (turnId: string, beforeSeq: number | null, prepend: boolean) => {
        setTurnDetailStateById((prev) => ({
            ...prev,
            [turnId]: {
                ...(prev[turnId] ?? buildDefaultGroupTurnDetailState()),
                isLoading: !prepend,
                isLoadingMore: prepend,
                error: null
            }
        }))

        try {
            const response = await props.api.getGroupConversationTurnMessages(props.groupId, turnId, {
                limit: GROUP_TURN_DETAIL_PAGE_LIMIT,
                beforeSeq
            })

            setTurnDetailStateById((prev) => {
                const previous = prev[turnId] ?? buildDefaultGroupTurnDetailState()
                const merged = prepend
                    ? [...response.messages, ...previous.messages]
                    : response.messages

                const byId = new Map<string, GroupTimelineMessage>()
                for (const message of merged) {
                    byId.set(message.id, message)
                }
                const deduped = Array.from(byId.values()).sort((left, right) => left.seq - right.seq)

                return {
                    ...prev,
                    [turnId]: {
                        isLoading: false,
                        isLoadingMore: false,
                        error: null,
                        messages: deduped,
                        nextBeforeSeq: response.page.nextBeforeSeq,
                        hasMore: response.page.hasMore
                    }
                }
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to load turn details'
            setTurnDetailStateById((prev) => ({
                ...prev,
                [turnId]: {
                    ...(prev[turnId] ?? buildDefaultGroupTurnDetailState()),
                    isLoading: false,
                    isLoadingMore: false,
                    error: message
                }
            }))
        }
    }, [props.api, props.groupId])

    const openTurnDetails = useCallback((turnId: string) => {
        setActiveTurnId(turnId)

        if (isMobileViewport && typeof window !== 'undefined') {
            const currentTurnId = readMobileBriefTurnId(window.location.search)
            if (currentTurnId !== turnId) {
                writeMobileBriefTurnId(turnId, 'push')
            }
        }
    }, [isMobileViewport])

    const closeTurnDetails = useCallback(() => {
        if (isMobileViewport && typeof window !== 'undefined') {
            const currentTurnId = readMobileBriefTurnId(window.location.search)
            if (currentTurnId) {
                window.history.back()
                return
            }
        }

        setActiveTurnId(null)
    }, [isMobileViewport])

    const loadMoreActiveTurnDetails = useCallback(async () => {
        if (!activeTurn || !activeDetail) {
            return
        }
        if (!activeDetail.hasMore || activeDetail.nextBeforeSeq === null || activeDetail.isLoadingMore) {
            return
        }
        await fetchTurnMessages(activeTurn.id, activeDetail.nextBeforeSeq, true)
    }, [activeDetail, activeTurn, fetchTurnMessages])

    useEffect(() => {
        if (!activeTurnId) {
            return
        }

        const existing = turnDetailStateById[activeTurnId]
        if (!existing || (existing.messages.length === 0 && !existing.isLoading && !existing.isLoadingMore)) {
            void fetchTurnMessages(activeTurnId, null, false)
        }
    }, [activeTurnId, fetchTurnMessages, turnDetailStateById])

    useEffect(() => {
        if (typeof window === 'undefined') {
            return
        }

        const mediaQuery = window.matchMedia(MOBILE_BRIEF_BREAKPOINT_QUERY)
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
        if (typeof window === 'undefined') {
            return
        }

        if (!isMobileViewport) {
            if (readMobileBriefTurnId(window.location.search)) {
                writeMobileBriefTurnId(null, 'replace')
            }
            return
        }

        const syncFromHistory = () => {
            setActiveTurnId(readMobileBriefTurnId(window.location.search))
        }

        syncFromHistory()
        window.addEventListener('popstate', syncFromHistory)
        return () => {
            window.removeEventListener('popstate', syncFromHistory)
        }
    }, [isMobileViewport])

    useEffect(() => {
        autoScrollToBottomDoneRef.current = false
    }, [props.groupId])

    const latestTurnUpdateToken = useMemo(() => {
        if (props.turns.length === 0) {
            return 'empty'
        }
        const latestTurn = props.turns[props.turns.length - 1]
        return [
            props.turns.length,
            latestTurn.id,
            latestTurn.messageCount,
            latestTurn.status,
            latestTurn.updatedAt
        ].join(':')
    }, [props.turns])

    useEffect(() => {
        if (props.turns.length === 0) {
            autoScrollToBottomDoneRef.current = false
            return
        }
        if (props.isLoading) {
            return
        }
        if (autoScrollToBottomDoneRef.current && !isAtBottomRef.current) {
            return
        }
        autoScrollToBottomDoneRef.current = true
        const scrollToBottom = () => {
            listRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
        }
        scrollToBottom()
        const rafId = window.requestAnimationFrame(scrollToBottom)
        const timeoutId = window.setTimeout(scrollToBottom, 120)
        return () => {
            window.cancelAnimationFrame(rafId)
            window.clearTimeout(timeoutId)
        }
    }, [latestTurnUpdateToken, props.isLoading, props.turns.length])

    return (
        <>
            <div className="relative min-h-0 flex-1">
                {props.warning ? (
                    <div className="mx-3 mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700">
                        {props.warning}
                    </div>
                ) : null}

                {props.isLoading && props.turns.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-sm text-[var(--app-hint)]">
                        Loading turns...
                    </div>
                ) : props.turns.length === 0 ? (
                    <div className="flex items-center justify-center py-8 text-sm text-[var(--app-hint)]">
                        No turns yet.
                    </div>
                ) : (
                    <Virtuoso
                        ref={listRef}
                        data={props.turns}
                        style={{ height: '100%' }}
                        increaseViewportBy={{ top: 320, bottom: 320 }}
                        atBottomStateChange={(isAtBottom) => {
                            isAtBottomRef.current = isAtBottom
                        }}
                        startReached={() => {
                            if (!props.hasMore || props.isLoadingMore) {
                                return
                            }
                            void props.onLoadMoreTurns()
                        }}
                        components={{
                            Header: () => (
                                <div className="px-3 pt-2">
                                    <TimelineHistoryControl
                                        isLoading={props.isLoadingMore}
                                        hasMore={props.hasMore}
                                        onLoadMore={() => {
                                            if (props.isLoadingMore || !props.hasMore) {
                                                return
                                            }
                                            void props.onLoadMoreTurns()
                                        }}
                                    />
                                </div>
                            ),
                            Footer: () => <div className="h-2" />
                        }}
                        itemContent={(_index, turn) => {
                            const initiatorPreview = normalizeBriefPreview(turn.initiatorPreview, '(empty)')
                            const responderPreview = normalizeBriefPreview(
                                turn.responderPreview,
                                turn.status === 'open' ? 'Generating…' : '(empty)'
                            )
                            const initiatorIsUser = (turn.initiatorSource ?? '').startsWith('user:')

                            return (
                                <div className="px-3 pb-3">
                                    <div className="space-y-2">
                                        <div className={`flex ${initiatorIsUser ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[92%] rounded-2xl border px-3 py-2 text-sm ${
                                                initiatorIsUser
                                                    ? 'rounded-br-sm bg-[var(--app-button)] text-[var(--app-button-text)]'
                                                    : 'rounded-bl-sm bg-[var(--app-secondary-bg)] text-[var(--app-fg)] border-[var(--app-border)]'
                                            }`}>
                                                <BriefCardMarkdownPreview content={initiatorPreview} />
                                            </div>
                                        </div>

                                        <div className="flex justify-start">
                                            {turn.status === 'open' ? (
                                                <div className={`relative w-full max-w-[92%] rounded-2xl rounded-bl-sm border bg-[var(--app-bg)] px-3 py-2 ${
                                                    turn.status === 'open'
                                                        ? 'border-blue-500/40 shadow-[0_0_0_1px_rgba(59,130,246,0.2)]'
                                                        : 'border-[var(--app-border)]'
                                                }`}>
                                                    <button
                                                        type="button"
                                                        className="block w-full text-left"
                                                        onClick={() => openTurnDetails(turn.id)}
                                                        aria-label={t('groups.detail.openTurn')}
                                                    >
                                                        <BriefCardMarkdownPreview
                                                            content={responderPreview}
                                                            className="text-[var(--app-fg)]"
                                                        />
                                                        <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--app-hint)]">
                                                            <span>{turn.messageCount} message{turn.messageCount === 1 ? '' : 's'}</span>
                                                            <span>·</span>
                                                            <span className="underline decoration-dotted">{t('groups.detail.openTurnHint')}</span>
                                                            {turn.status === 'open' ? (
                                                                <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                                                                    <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500" />
                                                                    Generating
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="w-full max-w-[92%] px-1 py-1">
                                                    <BriefFullMarkdownContent content={responderPreview} />
                                                    <div className="mt-2 flex items-center gap-2 text-[11px] text-[var(--app-hint)]">
                                                        <span>{turn.messageCount} message{turn.messageCount === 1 ? '' : 's'}</span>
                                                        <span>·</span>
                                                        <button
                                                            type="button"
                                                            className="underline decoration-dotted hover:text-[var(--app-fg)]"
                                                            onClick={() => openTurnDetails(turn.id)}
                                                        >
                                                            Open details
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )
                        }}
                    />
                )}
            </div>

            {isMobileViewport ? (
                activeTurnId ? (
                    <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--app-bg)]">
                        <div className="border-b border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={closeTurnDetails}
                                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--app-border)] text-[var(--app-hint)] transition-colors hover:bg-[var(--app-secondary-bg)] hover:text-[var(--app-fg)]"
                                    aria-label={t('button.back')}
                                >
                                    <ChevronLeftIcon />
                                </button>
                                <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-[var(--app-fg)]">
                                        {activeTurn ? `Turn #${activeTurn.turnIndex} details` : 'Turn details'}
                                    </div>
                                    {activeTurn ? (
                                        <div className="text-xs text-[var(--app-hint)]">
                                            {activeTurn.messageCount} message{activeTurn.messageCount === 1 ? '' : 's'}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </div>

                        <div className="min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)]">
                            {activeTurn && activeDetail?.error ? (
                                <div className="h-full overflow-y-auto p-4 text-sm text-rose-500">
                                    {activeDetail.error}
                                    <div className="mt-2">
                                        <button
                                            type="button"
                                            className="rounded border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                                            onClick={() => {
                                                void fetchTurnMessages(activeTurn.id, null, false)
                                            }}
                                        >
                                            Retry
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {activeTurn && activeDetail && !activeDetail.error ? (
                                <div className="flex h-full min-h-0 flex-col">
                                    <GroupBriefTurnDetailList
                                        key={activeTurn.id}
                                        messages={activeDetail.messages}
                                        hasMore={activeDetail.hasMore}
                                        isLoadingMore={activeDetail.isLoadingMore}
                                        onLoadMore={loadMoreActiveTurnDetails}
                                        sessionMap={props.sessionMap}
                                        onOpenSession={props.onOpenSession}
                                    />
                                </div>
                            ) : activeTurn && activeDetail?.error ? null : (
                                <div className="flex h-full items-center justify-center text-sm text-[var(--app-hint)]">
                                    {activeTurn && activeDetail?.isLoading ? 'Loading turn details…' : 'No detail messages'}
                                </div>
                            )}
                        </div>
                    </div>
                ) : null
            ) : (
                <Dialog open={Boolean(activeTurnId)} onOpenChange={(open) => {
                    if (!open) {
                        setActiveTurnId(null)
                    }
                }}>
                    <DialogContent className="flex h-[90vh] max-h-[90vh] max-w-4xl flex-col overflow-hidden p-0">
                        <div className="border-b border-[var(--app-border)] px-4 py-3">
                            <DialogHeader>
                                <DialogTitle>
                                    {activeTurn ? `Turn #${activeTurn.turnIndex} details` : 'Turn details'}
                                </DialogTitle>
                            </DialogHeader>
                            {activeTurn ? (
                                <div className="mt-1 text-xs text-[var(--app-hint)]">
                                    {activeTurn.messageCount} message{activeTurn.messageCount === 1 ? '' : 's'}
                                </div>
                            ) : null}
                        </div>

                        <div className="min-h-0 flex-1 overflow-hidden">
                            {activeTurn && activeDetail?.error ? (
                                <div className="h-full overflow-y-auto p-4 text-sm text-rose-500">
                                    {activeDetail.error}
                                    <div className="mt-2">
                                        <button
                                            type="button"
                                            className="rounded border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                                            onClick={() => {
                                                void fetchTurnMessages(activeTurn.id, null, false)
                                            }}
                                        >
                                            Retry
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {activeTurn && activeDetail && !activeDetail.error ? (
                                <div className="flex h-full min-h-0 flex-col">
                                    <GroupBriefTurnDetailList
                                        key={activeTurn.id}
                                        messages={activeDetail.messages}
                                        hasMore={activeDetail.hasMore}
                                        isLoadingMore={activeDetail.isLoadingMore}
                                        onLoadMore={loadMoreActiveTurnDetails}
                                        sessionMap={props.sessionMap}
                                        onOpenSession={props.onOpenSession}
                                    />
                                </div>
                            ) : activeTurn && activeDetail?.error ? null : (
                                <div className="flex h-full items-center justify-center text-sm text-[var(--app-hint)]">
                                    {activeTurn && activeDetail?.isLoading ? 'Loading turn details…' : 'No detail messages'}
                                </div>
                            )}
                        </div>
                    </DialogContent>
                </Dialog>
            )}
        </>
    )
}

// ─── GroupDetailPage ──────────────────────────────────────────────────────────

export default function GroupDetailPage() {
    const { t } = useTranslation()
    const { api } = useAppContext()
    const { groupId } = useParams({ from: '/groups/$groupId' })
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { viewMode, setViewMode } = useChatViewMode()

    const { group, isLoading: groupLoading, error: groupError } = useGroup(api, groupId)
    const {
        messages,
        isLoading: messagesLoading,
        isLoadingMore: messagesLoadingMore,
        hasMore: messagesHasMore,
        loadMore: loadMoreMessages
    } = useGroupMessages(api, groupId, { enabled: viewMode === 'normal' || viewMode === 'cli' })
    const {
        turns: groupTurns,
        warning: groupTurnsWarning,
        isLoading: turnsLoading,
        isLoadingMore: turnsLoadingMore,
        hasMore: turnsHasMore,
        loadMore: loadMoreTurns
    } = useGroupConversationTurns(api, groupId, { enabled: viewMode === 'brief' })
    const { note, isLoading: noteLoading } = useGroupNote(api, groupId)
    const { postMessage, updateNote, refreshNote, broadcastNote, addMember, removeMember, updateGroup, isPending } = useGroupActions(api, groupId)
    const { sessions } = useSessions(api)
    const [pendingQuickSessionId, setPendingQuickSessionId] = useState<string | null>(null)
    const [pendingQuickActionError, setPendingQuickActionError] = useState<string | null>(null)
    const [pendingQuickActiveRequestId, setPendingQuickActiveRequestId] = useState<string | null>(null)
    const {
        session: pendingQuickSession,
        isLoading: pendingQuickSessionLoading,
        error: pendingQuickSessionError,
        refetch: refetchPendingQuickSession
    } = useSession(api, pendingQuickSessionId)

    const [composer, setComposer] = useState('')
    const [composerAttachments, setComposerAttachments] = useState<GroupComposerAttachment[]>([])
    const [noteDraft, setNoteDraft] = useState('')
    const [notePromptDraft, setNotePromptDraft] = useState('')
    const [noteOpen, setNoteOpen] = useState(false)
    const [showAddMember, setShowAddMember] = useState(false)
    const [memberActionMenuOpen, setMemberActionMenuOpen] = useState(false)
    const [memberActionAnchorPoint, setMemberActionAnchorPoint] = useState({ x: 0, y: 0 })
    const [memberActionSessionId, setMemberActionSessionId] = useState<string | null>(null)
    const [memberRemoveSessionId, setMemberRemoveSessionId] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)
    const [quotedMessage, setQuotedMessage] = useState<GroupTimelineMessage | null>(null)
    const [membersExpanded, setMembersExpanded] = useState(() => {
        // 默认在小屏幕上折叠成员列表
        if (typeof window !== 'undefined') {
            return window.innerWidth > 768
        }
        return true
    })
    const timelineRef = useRef<VirtuosoHandle | null>(null)
    const composerRef = useRef<HTMLTextAreaElement>(null)
    const composerAttachmentInputRef = useRef<HTMLInputElement>(null)
    const composerAttachmentRuntimeRef = useRef<Map<string, {
        adapter: ReturnType<typeof createAttachmentAdapter>
        attachment: Attachment
    }>>(new Map())
    const previousVisibleMessageIdsRef = useRef<string[]>([])
    const timelineInitializedRef = useRef(false)
    const [timelineFirstItemIndex, setTimelineFirstItemIndex] = useState(TIMELINE_FIRST_ITEM_INDEX_BASE)

    // Mention autocomplete state
    const [mentionQuery, setMentionQuery] = useState<string | null>(null)
    const [mentionIndex, setMentionIndex] = useState(0)
    const [mentionPosition, setMentionPosition] = useState(0)

    // Debounce mention query for better performance
    const debouncedMentionQuery = useDebounce(mentionQuery, 100)

    useEffect(() => {
        return () => {
            const runtimes = Array.from(composerAttachmentRuntimeRef.current.values())
            composerAttachmentRuntimeRef.current.clear()
            for (const runtime of runtimes) {
                void runtime.adapter.remove(runtime.attachment).catch(() => {
                    // Best effort cleanup for unsent uploads
                })
            }
        }
    }, [groupId])

    useEffect(() => {
        setNoteDraft(note?.content ?? '')
    }, [note?.content])

    useEffect(() => {
        setNotePromptDraft(group?.group?.notePrompt ?? '')
    }, [group?.group?.notePrompt])

    useLayoutEffect(() => {
        resizeComposerTextarea(composerRef.current)
    }, [composer])

    useEffect(() => {
        setTimelineFirstItemIndex(TIMELINE_FIRST_ITEM_INDEX_BASE)
        previousVisibleMessageIdsRef.current = []
        timelineInitializedRef.current = false
    }, [groupId])

    const members = group?.members ?? []
    const existingMemberSessionIds = useMemo(
        () => new Set(members.filter((m) => m.sessionId).map((m) => m.sessionId as string)),
        [members]
    )

    useEffect(() => {
        if (!memberRemoveSessionId) {
            return
        }
        const exists = members.some((member) => member.sessionId === memberRemoveSessionId)
        if (!exists) {
            setMemberRemoveSessionId(null)
        }
    }, [memberRemoveSessionId, members])

    useEffect(() => {
        if (!memberActionSessionId) {
            return
        }
        const exists = members.some((member) => member.sessionId === memberActionSessionId)
        if (!exists) {
            setMemberActionMenuOpen(false)
            setMemberActionSessionId(null)
        }
    }, [memberActionSessionId, members])

    // Build map: sessionId → session (for status dots)
    const sessionMap = useMemo(() => {
        const m = new Map<string, (typeof sessions)[0]>()
        for (const s of sessions) m.set(s.id, s)
        return m
    }, [sessions])
    const memberActionTarget = useMemo(() => {
        if (!memberActionSessionId) {
            return null
        }
        const member = members.find((item) => item.sessionId === memberActionSessionId)
        if (!member) {
            return null
        }
        const session = member.sessionId ? sessionMap.get(member.sessionId) : undefined
        const title = getSessionTitle(session, {
            fallbackSessionId: member.sessionId,
            fallbackIdLength: 12
        })
        return {
            sessionId: member.sessionId as string,
            title
        }
    }, [memberActionSessionId, members, sessionMap])
    const memberRemoveTarget = useMemo(() => {
        if (!memberRemoveSessionId) {
            return null
        }
        const member = members.find((item) => item.sessionId === memberRemoveSessionId)
        if (!member) {
            return null
        }
        const session = member.sessionId ? sessionMap.get(member.sessionId) : undefined
        const title = getSessionTitle(session, {
            fallbackSessionId: member.sessionId,
            fallbackIdLength: 12
        })
        return {
            sessionId: member.sessionId as string,
            title
        }
    }, [memberRemoveSessionId, members, sessionMap])
    const pendingQuickRequests = useMemo(
        () => extractPendingPermissionRequests(
            (pendingQuickSession?.agentState?.requests ?? null) as Record<string, unknown> | null
        ),
        [pendingQuickSession?.agentState?.requests]
    )
    const pendingQuickSessionSummary = useMemo(
        () => (pendingQuickSessionId ? sessionMap.get(pendingQuickSessionId) : undefined),
        [pendingQuickSessionId, sessionMap]
    )

    // Build task-state map: traceId → Map<taskId, latestMsg>
    // task_state messages are excluded from the main render loop
    const taskStateMap = useMemo(() => {
        const map = new Map<string, Map<string, GroupTimelineMessage>>()
        for (const msg of messages) {
            if (msg.type !== 'task_state' || !msg.traceId) continue
            if (!map.has(msg.traceId)) map.set(msg.traceId, new Map())
            const byTask = map.get(msg.traceId)!
            const taskKey = msg.taskId ?? msg.id
            const prev = byTask.get(taskKey)
            if (!prev || msg.seq > prev.seq) {
                byTask.set(taskKey, msg)
            }
        }
        return map
    }, [messages])

    // Filtered messages — exclude task_state; they appear under their command bubble
    const visibleMessages = useMemo(
        () => messages.filter((m) => m.type !== 'task_state'),
        [messages]
    )

    useLayoutEffect(() => {
        const previousIds = previousVisibleMessageIdsRef.current
        if (previousIds.length === 0) {
            previousVisibleMessageIdsRef.current = visibleMessages.map((message) => message.id)
            return
        }

        const previousFirstId = previousIds[0]
        if (previousFirstId) {
            const preservedIndex = visibleMessages.findIndex((message) => message.id === previousFirstId)
            if (preservedIndex > 0) {
                setTimelineFirstItemIndex((value) => value - preservedIndex)
            }
        }

        previousVisibleMessageIdsRef.current = visibleMessages.map((message) => message.id)
    }, [visibleMessages])

    useEffect(() => {
        if (timelineInitializedRef.current || messagesLoading || visibleMessages.length === 0) {
            return
        }
        timelineInitializedRef.current = true
        requestAnimationFrame(() => {
            timelineRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
        })
    }, [messagesLoading, visibleMessages.length])

    const mentionableMemberSessionIds = useMemo(() => {
        const ids: string[] = []
        for (const member of members) {
            if (!member.sessionId) continue
            const session = sessionMap.get(member.sessionId)
            if (getMemberWorkStatus(session) !== 'offline') {
                ids.push(member.sessionId)
            }
        }
        return ids
    }, [members, sessionMap])

    const mentionableMemberSessionIdSet = useMemo(
        () => new Set(mentionableMemberSessionIds),
        [mentionableMemberSessionIds]
    )

    const uploadSessionId = useMemo(() => {
        const preferred = group?.group?.noteSessionId ?? null
        if (preferred && mentionableMemberSessionIdSet.has(preferred)) {
            return preferred
        }
        return mentionableMemberSessionIds[0] ?? null
    }, [group?.group?.noteSessionId, mentionableMemberSessionIds, mentionableMemberSessionIdSet])

    const readyComposerAttachments = useMemo<AttachmentMetadata[]>(() => (
        composerAttachments
            .filter((attachment) => attachment.status === 'complete' && Boolean(attachment.path))
            .map((attachment) => ({
                id: attachment.id,
                filename: attachment.filename,
                mimeType: attachment.mimeType,
                size: attachment.size,
                path: attachment.path as string,
                ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {})
            }))
    ), [composerAttachments])

    const hasUploadingAttachments = useMemo(
        () => composerAttachments.some((attachment) => attachment.status === 'uploading'),
        [composerAttachments]
    )
    const uploadAdapter = useMemo(
        () => (uploadSessionId ? createAttachmentAdapter(api, uploadSessionId) : null),
        [api, uploadSessionId]
    )

    // Base mention candidates (cached separately from filtering)
    const baseMentionCandidates = useMemo<MentionCandidate[]>(() => {
        const candidates: MentionCandidate[] = []
        if (mentionableMemberSessionIds.length > 0) {
            candidates.push({ id: 'all', label: 'all', sublabel: 'Broadcast to online members' })
        }
        for (const member of members) {
            if (!member.sessionId) continue
            if (!mentionableMemberSessionIdSet.has(member.sessionId)) continue
            const s = sessionMap.get(member.sessionId)
            const title = getSessionTitle(s, { fallbackSessionId: member.sessionId, fallbackIdLength: 12 })
            candidates.push({
                id: member.sessionId,
                label: member.sessionId,
                sublabel: title
            })
        }
        return candidates
    }, [members, sessionMap, mentionableMemberSessionIds.length, mentionableMemberSessionIdSet])

    // Filtered mention candidates (only re-filters when query changes)
    const mentionCandidates = useMemo<MentionCandidate[]>(() => {
        const q = (debouncedMentionQuery ?? '').toLowerCase()
        if (!q) return baseMentionCandidates
        return baseMentionCandidates.filter(
            (c) => c.id.toLowerCase().includes(q) || (c.sublabel ?? '').toLowerCase().includes(q)
        )
    }, [baseMentionCandidates, debouncedMentionQuery])

    // Detect @mention in composer (optimized)
    const detectMention = useCallback((value: string, cursorPos: number) => {
        // Quick check: if no @ character near cursor, bail early
        const before = value.slice(Math.max(0, cursorPos - 50), cursorPos)
        const lastAtIndex = before.lastIndexOf('@')

        if (lastAtIndex === -1) {
            // No @ found, clear mention state if needed
            if (mentionQuery !== null) {
                setMentionQuery(null)
            }
            return
        }

        // Check if we're in a potential mention context
        const potentialMention = before.slice(lastAtIndex + 1)
        const isValidMention = /^[A-Za-z0-9._:-]*$/.test(potentialMention)

        if (isValidMention) {
            if (mentionQuery !== potentialMention) {
                setMentionQuery(potentialMention)
                setMentionIndex(0)

                // Calculate horizontal position of @ symbol for popup positioning
                const textarea = composerRef.current
                if (textarea) {
                    const atPosition = cursorPos - potentialMention.length
                    const beforeAt = value.slice(0, atPosition)
                    const lines = beforeAt.split('\n')
                    const currentLine = lines[lines.length - 1]

                    // Create a temporary element to measure text width more accurately
                    const measurer = document.createElement('span')
                    measurer.style.cssText = `
                        position: absolute;
                        top: -9999px;
                        left: -9999px;
                        visibility: hidden;
                        white-space: pre;
                        font-family: ${getComputedStyle(textarea).fontFamily};
                        font-size: ${getComputedStyle(textarea).fontSize};
                        font-weight: ${getComputedStyle(textarea).fontWeight};
                        letter-spacing: ${getComputedStyle(textarea).letterSpacing};
                    `
                    measurer.textContent = currentLine
                    document.body.appendChild(measurer)

                    const leftOffset = measurer.offsetWidth
                    document.body.removeChild(measurer)

                    // Clamp position to prevent popup from going off-screen
                    const textareaRect = textarea.getBoundingClientRect()
                    const maxLeft = Math.max(0, textareaRect.width - 240) // min popup width
                    setMentionPosition(Math.min(leftOffset + 16, maxLeft)) // +16px for padding
                }
            }
        } else {
            if (mentionQuery !== null) {
                setMentionQuery(null)
            }
        }
    }, [mentionQuery])

    const handleComposerChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
        const value = e.target.value
        const cursorPos = e.target.selectionStart ?? value.length

        // Update state immediately for responsive typing
        setComposer(value)
        resizeComposerTextarea(e.target)

        // Detect mentions (will be debounced via debouncedMentionQuery)
        detectMention(value, cursorPos)
    }, [detectMention])

    const insertMention = useCallback((id: string) => {
        const el = composerRef.current
        const pos = el?.selectionStart ?? composer.length
        const before = composer.slice(0, pos)
        const after = composer.slice(pos)
        const lastAt = before.lastIndexOf('@')
        const newText = before.slice(0, lastAt) + `@${id} ` + after
        setComposer(newText)
        setMentionQuery(null)
        // restore focus + move cursor after inserted mention
        requestAnimationFrame(() => {
            if (el) {
                el.focus()
                const newPos = lastAt + id.length + 2
                el.setSelectionRange(newPos, newPos)
            }
        })
    }, [composer])

    const syncComposerAttachmentFromPending = useCallback((
        pending: PendingAttachment,
        sessionId: string
    ) => {
        const pendingStatus = pending.status.type
        const path = (pending as { path?: unknown }).path
        const previewUrl = (pending as { previewUrl?: unknown }).previewUrl
        const nextAttachment: GroupComposerAttachment = {
            id: pending.id,
            filename: pending.name,
            mimeType: pending.contentType ?? 'application/octet-stream',
            size: pending.file?.size ?? 0,
            uploadSessionId: sessionId,
            status: 'uploading'
        }

        if (pendingStatus === 'requires-action') {
            if (typeof path === 'string' && path.length > 0) {
                nextAttachment.status = 'complete'
                nextAttachment.path = path
                if (typeof previewUrl === 'string' && previewUrl.length > 0) {
                    nextAttachment.previewUrl = previewUrl
                }
            } else {
                nextAttachment.status = 'error'
                nextAttachment.error = 'Upload failed'
            }
        } else if (pendingStatus === 'incomplete') {
            nextAttachment.status = 'error'
            nextAttachment.error = 'Upload failed'
        }

        setComposerAttachments((current) => {
            const index = current.findIndex((attachment) => attachment.id === nextAttachment.id)
            if (index === -1) {
                return [...current, nextAttachment]
            }
            const updated = [...current]
            updated[index] = { ...updated[index], ...nextAttachment }
            return updated
        })
    }, [])

    const uploadComposerAttachment = useCallback(async (
        file: File,
        adapter: ReturnType<typeof createAttachmentAdapter>,
        sessionId: string
    ) => {
        try {
            const addResult = adapter.add({ file })
            if (isPendingAttachmentAsyncGenerator(addResult)) {
                for await (const pending of addResult) {
                    const attachment = pending as unknown as Attachment
                    composerAttachmentRuntimeRef.current.set(attachment.id, { adapter, attachment })
                    syncComposerAttachmentFromPending(pending, sessionId)
                }
                return
            }

            const pending = await addResult
            const attachment = pending as unknown as Attachment
            composerAttachmentRuntimeRef.current.set(attachment.id, { adapter, attachment })
            syncComposerAttachmentFromPending(pending, sessionId)
        } catch {
            // Adapter yields error states in normal paths; unexpected failures are ignored.
        }
    }, [syncComposerAttachmentFromPending])

    const removeComposerAttachment = useCallback(async (id: string) => {
        const runtime = composerAttachmentRuntimeRef.current.get(id)
        composerAttachmentRuntimeRef.current.delete(id)
        setComposerAttachments((current) => current.filter((attachment) => attachment.id !== id))
        if (runtime) {
            try {
                await runtime.adapter.remove(runtime.attachment)
            } catch {
                // Best effort cleanup
            }
        }
    }, [])

    const handleAttachmentInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? [])
        event.target.value = ''
        if (files.length === 0) {
            return
        }
        if (!uploadSessionId || !uploadAdapter) {
            setActionError('No online group member available for uploads')
            return
        }

        setActionError(null)
        for (const file of files) {
            void uploadComposerAttachment(file, uploadAdapter, uploadSessionId)
        }
    }, [uploadAdapter, uploadComposerAttachment, uploadSessionId])

    const handleComposerPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        const imageFiles = files.filter((file) => file.type.startsWith('image/'))
        if (imageFiles.length === 0) {
            return
        }

        event.preventDefault()
        if (!uploadSessionId || !uploadAdapter) {
            setActionError('No online group member available for uploads')
            return
        }

        setActionError(null)
        for (const file of imageFiles) {
            void uploadComposerAttachment(file, uploadAdapter, uploadSessionId)
        }
    }, [uploadAdapter, uploadComposerAttachment, uploadSessionId])

    const openAttachmentPicker = useCallback(() => {
        if (!uploadSessionId) {
            setActionError('No online group member available for uploads')
            return
        }
        composerAttachmentInputRef.current?.click()
    }, [uploadSessionId])

    const handleQuoteMessage = useCallback((message: GroupTimelineMessage) => {
        setQuotedMessage(message)
        requestAnimationFrame(() => {
            const textarea = composerRef.current
            if (!textarea) {
                return
            }
            try {
                textarea.focus({ preventScroll: true })
            } catch {
                textarea.focus()
            }
            const cursor = textarea.value.length
            textarea.setSelectionRange(cursor, cursor)
        })
    }, [])

    const handleSend = useCallback(async (e?: FormEvent) => {
        e?.preventDefault()
        const rawText = composer.trim()
        const hasAttachments = readyComposerAttachments.length > 0
        if (!rawText && !hasAttachments) return
        if (hasUploadingAttachments) {
            setActionError('Please wait for uploads to finish')
            return
        }
        const type = rawText
            ? (rawText.startsWith('/') || /\B@/.test(rawText) ? 'command' : 'chat')
            : 'chat'
        setActionError(null)
        if (type === 'command') {
            const mentionedSessionIds = Array.from(rawText.matchAll(/\B@([A-Za-z0-9._:-]+)/g))
                .map((match) => match[1])
                .filter((value) => value !== 'all')
            const offlineMentions = Array.from(new Set(
                mentionedSessionIds.filter(
                    (sessionId) => existingMemberSessionIds.has(sessionId)
                        && !mentionableMemberSessionIdSet.has(sessionId)
                )
            ))
            if (offlineMentions.length > 0) {
                setActionError(`Offline members cannot be mentioned: ${offlineMentions.join(', ')}`)
                return
            }
        }
        try {
            await postMessage({
                type,
                text: rawText || undefined,
                attachments: readyComposerAttachments.length > 0 ? readyComposerAttachments : undefined,
                source: 'user:web',
                quotedMessageId: quotedMessage?.id
            })
            setComposer('')
            setComposerAttachments([])
            composerAttachmentRuntimeRef.current.clear()
            setMentionQuery(null)
            setQuotedMessage(null)
            requestAnimationFrame(() => {
                timelineRef.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' })
            })
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Failed to send')
        }
    }, [
        composer,
        postMessage,
        existingMemberSessionIds,
        hasUploadingAttachments,
        mentionableMemberSessionIdSet,
        quotedMessage,
        readyComposerAttachments
    ])

    const handleLoadOlderMessages = useCallback(() => {
        if (messagesLoading || messagesLoadingMore || !messagesHasMore) {
            return
        }
        void loadMoreMessages()
    }, [loadMoreMessages, messagesHasMore, messagesLoading, messagesLoadingMore])

    const handleComposerKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
        if (mentionQuery !== null && mentionCandidates.length > 0) {
            if (e.key === 'ArrowDown') {
                e.preventDefault()
                setMentionIndex((i) => (i + 1) % mentionCandidates.length)
                return
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault()
                setMentionIndex((i) => (i - 1 + mentionCandidates.length) % mentionCandidates.length)
                return
            }
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                insertMention(mentionCandidates[mentionIndex].id)
                return
            }
            if (e.key === 'Escape') {
                setMentionQuery(null)
                return
            }
        }

        if (e.key === 'Enter' && !e.shiftKey) {
            if (e.nativeEvent.isComposing) {
                return
            }
            e.preventDefault()
            if (isPending) {
                return
            }
            void handleSend()
        }

    }, [mentionQuery, mentionCandidates, mentionIndex, insertMention, isPending, handleSend])

    const handleSaveNote = async () => {
        setActionError(null)
        try {
            await updateNote({ content: noteDraft, updatedBy: 'user:web' })
            const savedPrompt = group?.group?.notePrompt ?? ''
            if (notePromptDraft !== savedPrompt) {
                await updateGroup({ notePrompt: notePromptDraft.trim() || null })
            }
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Failed to save note')
        }
    }

    const handleRefreshNote = async () => {
        setActionError(null)
        try {
            const notePrompt = group?.group?.notePrompt?.trim()
            await refreshNote({ source: 'user:web', ...(notePrompt ? { command: notePrompt } : {}) })
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Failed to refresh note')
        }
    }

    const handleBroadcastNote = async () => {
        if (!note?.content) return

        setActionError(null)
        try {
            await broadcastNote()
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Failed to broadcast note')
        }
    }

    const handleUpdateNoteExecutor = async (sessionId: string | null) => {
        setActionError(null)
        try {
            await updateGroup({ noteSessionId: sessionId })
        } catch (err) {
            setActionError(err instanceof Error ? err.message : 'Failed to update note executor')
        }
    }

    const handleOpenMemberActions = (member: GroupMember, point: { x: number; y: number }) => {
        if (!member.sessionId) {
            return
        }
        setMemberActionSessionId(member.sessionId)
        setMemberActionAnchorPoint(point)
        setMemberActionMenuOpen(true)
    }

    const handleRequestRemoveMember = () => {
        if (!memberActionTarget?.sessionId) {
            return
        }
        setMemberActionMenuOpen(false)
        setMemberRemoveSessionId(memberActionTarget.sessionId)
    }

    const handleConfirmRemoveMember = async () => {
        const targetSessionId = memberRemoveTarget?.sessionId
        if (!targetSessionId) {
            throw new Error('Member unavailable')
        }
        await removeMember(targetSessionId)
        setMemberActionMenuOpen(false)
        setMemberActionSessionId(null)
        setMemberRemoveSessionId(null)
    }
    const handleOpenPendingQuickModal = useCallback((sessionId: string) => {
        setPendingQuickSessionId(sessionId)
        setPendingQuickActionError(null)
        setPendingQuickActiveRequestId(null)
    }, [])

    const handleClosePendingQuickModal = useCallback(() => {
        setPendingQuickSessionId(null)
        setPendingQuickActionError(null)
        setPendingQuickActiveRequestId(null)
    }, [])

    const refreshPendingQuickContext = useCallback(async (sessionId: string) => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.group(groupId) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.groups })
        ])
        await refetchPendingQuickSession()
    }, [groupId, queryClient, refetchPendingQuickSession])

    const handleApprovePendingQuickRequest = useCallback(async (requestId: string) => {
        if (!pendingQuickSessionId) {
            return
        }
        setPendingQuickActionError(null)
        setPendingQuickActiveRequestId(requestId)
        try {
            await api.approvePermission(pendingQuickSessionId, requestId)
            await refreshPendingQuickContext(pendingQuickSessionId)
        } catch (err) {
            setPendingQuickActionError(err instanceof Error ? err.message : 'Failed to approve request')
        } finally {
            setPendingQuickActiveRequestId(null)
        }
    }, [api, pendingQuickSessionId, refreshPendingQuickContext])

    const handleDenyPendingQuickRequest = useCallback(async (requestId: string) => {
        if (!pendingQuickSessionId) {
            return
        }
        setPendingQuickActionError(null)
        setPendingQuickActiveRequestId(requestId)
        try {
            await api.denyPermission(pendingQuickSessionId, requestId)
            await refreshPendingQuickContext(pendingQuickSessionId)
        } catch (err) {
            setPendingQuickActionError(err instanceof Error ? err.message : 'Failed to deny request')
        } finally {
            setPendingQuickActiveRequestId(null)
        }
    }, [api, pendingQuickSessionId, refreshPendingQuickContext])

    const canSendComposer = !isPending
        && !hasUploadingAttachments
        && (composer.trim().length > 0 || readyComposerAttachments.length > 0)
    const pendingQuickSessionTitle = getSessionTitle(
        pendingQuickSessionSummary ?? pendingQuickSession,
        {
            fallbackSessionId: pendingQuickSessionId,
            fallbackIdLength: 12
        }
    )

    if (groupLoading) {
        return (
            <div className="flex h-full items-center justify-center">
                <LoadingState label="Loading group..." className="text-sm" />
            </div>
        )
    }

    if (!group || groupError) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-4">
                <div className="text-sm text-red-600">{groupError ?? 'Group not found'}</div>
            </div>
        )
    }

    return (
        <div className="flex h-full flex-col bg-[var(--app-bg)]">
            {/* B. Members (collapsible) */}
            <div className="border-b border-[var(--app-divider)]">
                <div className="flex items-center gap-2 pl-3.5 pr-3 py-2 text-xs text-[var(--app-hint)]">
                    <button
                        type="button"
                        onClick={() => setMembersExpanded(!membersExpanded)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-[var(--app-fg)] transition-colors"
                    >
                        {membersExpanded ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" /> : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />}
                        <span className="font-medium">{t('groups.detail.members')}</span>
                        <span className="text-[10px]">{members.length}</span>
                        {members.some(m => {
                            const s = m.sessionId ? sessionMap.get(m.sessionId) : undefined
                            return getMemberWorkStatus(s) !== 'offline'
                        }) && (
                            <span className="text-[10px]">
                                {members.filter(m => {
                                    const s = m.sessionId ? sessionMap.get(m.sessionId) : undefined
                                    return getMemberWorkStatus(s) !== 'offline'
                                }).length} {t('groups.detail.onlineSuffix')}
                            </span>
                        )}

                        {/* Show preview avatars when collapsed */}
                        {!membersExpanded && (
                            <div className="flex items-center gap-1 ml-2">
                                {members
                                    .filter(m => {
                                        const s = m.sessionId ? sessionMap.get(m.sessionId) : undefined
                                        return getMemberWorkStatus(s) !== 'offline'
                                    })
                                    .slice(0, 4)
                                    .map((member) => {
                                        const s = member.sessionId ? sessionMap.get(member.sessionId) : undefined
                                        const title = getSessionTitle(s, { fallbackSessionId: member.sessionId, fallbackIdLength: 12 })
                                        const avatarInitial = getAvatarInitial(title)
                                        const avatarTone = getSessionAvatarTone(s)
                                        const status = getMemberWorkStatus(s)
                                        const dotClass = getMemberStatusDotClass(status)
                                        return (
                                            <div key={member.id} className="relative">
                                                <span className={`flex h-4 w-4 items-center justify-center rounded-full border text-[9px] font-semibold ${avatarTone}`}>
                                                    {avatarInitial}
                                                </span>
                                                <div className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ${dotClass}`} />
                                            </div>
                                        )
                                    })}
                                {members.filter(m => {
                                    const s = m.sessionId ? sessionMap.get(m.sessionId) : undefined
                                    return getMemberWorkStatus(s) !== 'offline'
                                }).length > 4 && (
                                    <span className="text-[9px] text-[var(--app-hint)]">
                                        +{members.filter(m => {
                                            const s = m.sessionId ? sessionMap.get(m.sessionId) : undefined
                                            return getMemberWorkStatus(s) !== 'offline'
                                        }).length - 4}
                                    </span>
                                )}
                            </div>
                        )}
                    </button>
                    <div className="ml-auto flex gap-1">
                        <button
                            type="button"
                            onClick={() => setShowAddMember(true)}
                            disabled={isPending}
                            className="rounded border border-[var(--app-divider)] px-2 py-0.5 text-[10px] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                            title={t('groups.detail.addMember')}
                        >
                            {t('groups.detail.add')}
                        </button>
                    </div>
                </div>
                {membersExpanded ? (
                    <div className="flex flex-wrap items-center gap-1.5 pl-3.5 pr-3 pb-2">
                        {members.map((member) => {
                            const s = member.sessionId ? sessionMap.get(member.sessionId) : undefined
                            const status = getMemberWorkStatus(s)
                            const sessionId = member.sessionId
                            const pendingCount = s?.pendingRequestsCount ?? 0
                            return (
                                <div key={member.id} className="flex items-center gap-1.5">
                                    <MemberPill
                                        member={member}
                                        session={s}
                                        status={status}
                                        onClick={() => {
                                            if (sessionId) {
                                                navigate({ to: '/sessions/$sessionId', params: { sessionId } })
                                            }
                                        }}
                                        onOpenActions={(point) => {
                                            handleOpenMemberActions(member, point)
                                        }}
                                    />
                                    {sessionId && pendingCount > 0 ? (
                                        <button
                                            type="button"
                                            onClick={() => handleOpenPendingQuickModal(sessionId)}
                                            className="rounded-md border border-[var(--app-badge-warning-text)] bg-[var(--app-badge-warning-bg)] px-2 py-1 text-[10px] font-medium text-[var(--app-badge-warning-text)] hover:opacity-80"
                                            title="Handle pending permission requests"
                                        >
                                            Pending {pendingCount}
                                        </button>
                                    ) : null}
                                </div>
                            )
                        })}
                    </div>
                ) : null}
            </div>

            {/* C. Group Note (collapsible) */}
            <div className="border-b border-[var(--app-divider)]">
                <div className="flex items-center gap-2 pl-3.5 pr-3 py-2 text-xs text-[var(--app-hint)]">
                    <button
                        type="button"
                        onClick={() => setNoteOpen((o) => !o)}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-[var(--app-fg)] transition-colors"
                    >
                        {noteOpen ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0" /> : <ChevronRightIcon className="h-3.5 w-3.5 shrink-0" />}
                        <span className="font-medium">{t('groups.detail.note')}</span>
                        {note ? <span className="text-[10px]">v{note.version}</span> : null}
                    </button>
                    <div className="ml-auto flex gap-1">
                        <button
                            type="button"
                            onClick={() => { void handleSaveNote() }}
                            disabled={isPending}
                            className="rounded border border-[var(--app-divider)] px-2 py-0.5 text-[10px] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                            title={t('groups.detail.saveHint')}
                        >
                            {t('button.save')}
                        </button>
                        <button
                            type="button"
                            onClick={() => { void handleRefreshNote() }}
                            disabled={isPending}
                            className="rounded border border-[var(--app-divider)] px-2 py-0.5 text-[10px] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                        >
                            {t('groups.detail.generate')}
                        </button>
                        <button
                            type="button"
                            onClick={() => { void handleBroadcastNote() }}
                            disabled={isPending || !note?.content}
                            className="rounded border border-[var(--app-divider)] px-2 py-0.5 text-[10px] text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] disabled:opacity-50"
                            title={t('groups.detail.broadcastHint')}
                        >
                            {t('groups.detail.broadcast')}
                        </button>
                    </div>
                </div>
                {noteOpen ? (
                    <div className="pl-3.5 pr-3 pb-3 pt-1">
                        {noteLoading ? (
                            <LoadingState label="Loading note..." className="text-sm py-2" />
                        ) : (
                            <>
                                <textarea
                                    value={noteDraft}
                                    onChange={(e) => setNoteDraft(e.target.value)}
                                    placeholder={t('groups.detail.notePlaceholder')}
                                    rows={5}
                                    className="w-full rounded-md border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--app-link)] resize-y"
                                />
                                <div className="mt-2 grid grid-cols-[auto_1fr] items-start gap-x-2 gap-y-1.5">
                                    <span className="self-center text-[11px] text-[var(--app-hint)]">{t('groups.detail.executor')}</span>
                                    <select
                                        value={group.group.noteSessionId ?? ''}
                                        onChange={(e) => {
                                            const next = e.target.value.trim()
                                            void handleUpdateNoteExecutor(next.length > 0 ? next : null)
                                        }}
                                        disabled={isPending}
                                        className="w-full rounded border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-2 py-1 text-[11px] text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] disabled:opacity-60"
                                    >
                                        <option value="">{t('groups.detail.notConfigured')}</option>
                                        {members
                                            .filter((member) => typeof member.sessionId === 'string' && member.sessionId.length > 0)
                                            .map((member) => {
                                                const sessionId = member.sessionId as string
                                                const session = sessionMap.get(sessionId)
                                                const title = getSessionTitle(session, { fallbackSessionId: sessionId, fallbackIdLength: 12 })
                                                return (
                                                    <option key={sessionId} value={sessionId}>
                                                        {`${title} (${sessionId.slice(0, 8)})`}
                                                    </option>
                                                )
                                            })}
                                    </select>
                                    <span className="pt-1 text-[11px] text-[var(--app-hint)]">{t('groups.detail.prompt')}</span>
                                    <textarea
                                        value={notePromptDraft}
                                        onChange={(e) => setNotePromptDraft(e.target.value)}
                                        placeholder={t('groups.detail.promptPlaceholder')}
                                        rows={2}
                                        className="w-full resize-y rounded border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-2 py-1 text-[11px] text-[var(--app-fg)] outline-none focus:border-[var(--app-link)]"
                                    />
                                </div>
                            </>
                        )}
                    </div>
                ) : null}
            </div>

            {/* D. Timeline */}
            <div className="flex-1 min-h-0 flex flex-col">
                <div className="px-3 pb-2 pt-1">
                    <div className="mx-auto flex w-full max-w-content items-center justify-end gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)]/40 p-1">
                        <button
                            type="button"
                            className={`rounded px-2.5 py-1 text-xs transition-colors ${viewMode === 'normal'
                                ? 'bg-[var(--app-bg)] text-[var(--app-fg)]'
                                : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                            onClick={() => setViewMode('normal')}
                        >
                            {t('mobile.chat.view.normal')}
                        </button>
                        <button
                            type="button"
                            className={`rounded px-2.5 py-1 text-xs transition-colors ${viewMode === 'brief'
                                ? 'bg-[var(--app-bg)] text-[var(--app-fg)]'
                                : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                            onClick={() => setViewMode('brief')}
                        >
                            {t('mobile.chat.view.brief')}
                        </button>
                        <button
                            type="button"
                            className={`rounded px-2.5 py-1 text-xs font-mono transition-colors ${viewMode === 'cli'
                                ? 'bg-[var(--app-bg)] text-[var(--app-fg)]'
                                : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'}`}
                            onClick={() => setViewMode('cli')}
                        >
                            CLI
                        </button>
                    </div>
                </div>

                <div className="min-h-0 flex-1">
                    {viewMode === 'brief' ? (
                        api ? (
                            <GroupBriefTurnList
                                api={api}
                                groupId={groupId}
                                turns={groupTurns}
                                warning={groupTurnsWarning}
                                isLoading={turnsLoading}
                                isLoadingMore={turnsLoadingMore}
                                hasMore={turnsHasMore}
                                onLoadMoreTurns={loadMoreTurns}
                                sessionMap={sessionMap}
                                onOpenSession={(sessionId) => {
                                    navigate({ to: '/sessions/$sessionId', params: { sessionId } })
                                }}
                            />
                        ) : (
                            <div className="flex items-center justify-center py-8 text-sm text-[var(--app-hint)]">
                                Group unavailable.
                            </div>
                        )
                    ) : /* CLI mode falls through to Normal rendering below.
                         The groups page uses GroupTimelineMessage[] (multi-session interleaved
                         messages) which is incompatible with the ChatBlock[] model that CliThread
                         expects. A dedicated groups-to-ChatBlock adapter would be needed to
                         support CliThread here. */ messagesLoading && visibleMessages.length === 0 ? (
                        <div className="flex items-center justify-center py-8">
                            <LoadingState label="Loading messages..." className="text-sm" />
                        </div>
                    ) : visibleMessages.length === 0 ? (
                        <div className="flex items-center justify-center py-8 text-sm text-[var(--app-hint)]">
                            No messages yet. Start the conversation below.
                        </div>
                    ) : (
                        <Virtuoso
                            ref={timelineRef}
                            data={visibleMessages}
                            style={{ height: '100%' }}
                            firstItemIndex={timelineFirstItemIndex}
                            increaseViewportBy={{ top: 400, bottom: 400 }}
                            startReached={() => {
                                handleLoadOlderMessages()
                            }}
                            followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
                            components={{
                                Scroller: TimelineScroller,
                                Header: () => (
                                    <TimelineHistoryControl
                                        isLoading={messagesLoadingMore}
                                        hasMore={messagesHasMore}
                                        onLoadMore={handleLoadOlderMessages}
                                    />
                                ),
                                Footer: () => <div className="h-2" />
                            }}
                            itemContent={(_index, message) => (
                                <TimelineBubble
                                    key={message.id}
                                    message={message}
                                    sessionMap={sessionMap}
                                    onOpenSession={(sessionId) => {
                                        navigate({ to: '/sessions/$sessionId', params: { sessionId } })
                                    }}
                                    onQuote={handleQuoteMessage}
                                    taskStates={message.type === 'command' && message.traceId
                                        ? taskStateMap.get(message.traceId)
                                        : undefined
                                    }
                                />
                            )}
                        />
                    )}
                </div>
            </div>

            {/* E. Composer */}
            <div className="border-t border-[var(--app-divider)] bg-[var(--app-bg)] pb-[env(safe-area-inset-bottom)]">
                {actionError ? (
                    <div className="pl-3.5 pr-3 pt-2 text-xs text-red-600">{actionError}</div>
                ) : null}
                <form onSubmit={(e) => { void handleSend(e) }} className="relative px-3 pt-2">
                    <input
                        ref={composerAttachmentInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleAttachmentInputChange}
                    />
                    {/* @ mention popup */}
                    {mentionQuery !== null && mentionCandidates.length > 0 ? (
                        <MentionPopup
                            candidates={mentionCandidates}
                            activeIndex={mentionIndex}
                            onSelect={insertMention}
                            position={mentionPosition}
                        />
                    ) : null}
                    <div className={`overflow-hidden rounded-[20px] bg-[var(--app-secondary-bg)] transition-colors ${quotedMessage ? 'ring-1 ring-[var(--app-link)]/40' : ''}`}>
                        <ComposerAttachmentList
                            attachments={composerAttachments}
                            disabled={isPending}
                            onRemove={removeComposerAttachment}
                        />
                        {quotedMessage && (
                            <div className="flex items-start gap-1.5 border-b border-[var(--app-border)] px-4 py-2">
                                <div className="h-3 w-0.5 shrink-0 rounded-full bg-[var(--app-link)]" />
                                <QuoteIcon className="mt-0.5 h-3 w-3 shrink-0 text-[var(--app-link)]" />
                                <span className="min-w-0 flex-1 text-[11px] leading-4 text-[var(--app-hint)]">
                                    <span className="font-medium text-[var(--app-link)]">
                                        {quotedMessage.actorName || getActorSessionId(quotedMessage) || 'Unknown'}
                                    </span>
                                    {' · '}
                                    <span className="break-all">
                                        {truncateText(extractBubbleText(quotedMessage), 96)}
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setQuotedMessage(null)}
                                    className="mt-0.5 shrink-0 rounded p-0.5 text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]"
                                    title={t('groups.detail.cancelReply')}
                                >
                                    <CloseIcon className="h-3 w-3" />
                                </button>
                            </div>
                        )}
                        <div className="px-4 py-3">
                            <textarea
                                ref={composerRef}
                                value={composer}
                                onChange={handleComposerChange}
                                onPaste={handleComposerPaste}
                                onKeyDown={handleComposerKeyDown}
                                placeholder={t('groups.detail.composerPlaceholder')}
                                rows={1}
                                className="app-scrollbar w-full resize-none bg-transparent text-sm outline-none"
                                style={{ minHeight: '38px', maxHeight: '120px' }}
                            />
                        </div>
                        <div className="flex items-center justify-between px-2 pb-2">
                            <button
                                type="button"
                                onClick={openAttachmentPicker}
                                disabled={isPending || !uploadSessionId}
                                className="flex h-8 w-8 items-center justify-center rounded-full text-[var(--app-fg)]/60 transition-colors hover:bg-[var(--app-bg)] hover:text-[var(--app-fg)] disabled:cursor-not-allowed disabled:opacity-50"
                                title={uploadSessionId ? 'Attach files' : 'No online member available for uploads'}
                            >
                                <AttachmentIcon className="h-[18px] w-[18px]" />
                            </button>
                            <button
                                type="submit"
                                disabled={!canSendComposer}
                                className={`flex h-8 w-8 items-center justify-center rounded-full text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${canSendComposer ? 'bg-black' : 'bg-[#C0C0C0]'}`}
                                title={t('composer.send')}
                            >
                                <SendIcon className="h-4 w-4" />
                            </button>
                        </div>
                    </div>
                </form>
            </div>

            <MemberActionMenu
                isOpen={memberActionMenuOpen && Boolean(memberActionTarget)}
                onClose={() => {
                    setMemberActionMenuOpen(false)
                    setMemberActionSessionId(null)
                }}
                onRemove={handleRequestRemoveMember}
                anchorPoint={memberActionAnchorPoint}
            />

            <ConfirmDialog
                isOpen={Boolean(memberRemoveTarget)}
                onClose={() => {
                    setMemberRemoveSessionId(null)
                    setMemberActionSessionId(null)
                }}
                title={t('groups.member.remove')}
                description={memberRemoveTarget
                    ? `Remove ${memberRemoveTarget.title} from this group?`
                    : 'Remove this member from the group?'
                }
                confirmLabel="Remove"
                confirmingLabel="Removing..."
                onConfirm={handleConfirmRemoveMember}
                isPending={isPending}
                destructive
            />

            {/* F. Pending quick modal */}
            {pendingQuickSessionId ? (
                <PendingRequestsQuickModal
                    sessionId={pendingQuickSessionId}
                    sessionTitle={pendingQuickSessionTitle}
                    isLoading={pendingQuickSessionLoading}
                    requests={pendingQuickRequests}
                    loadError={pendingQuickSessionError}
                    actionError={pendingQuickActionError}
                    activeRequestId={pendingQuickActiveRequestId}
                    onApprove={handleApprovePendingQuickRequest}
                    onDeny={handleDenyPendingQuickRequest}
                    onRefresh={() => {
                        void refreshPendingQuickContext(pendingQuickSessionId)
                    }}
                    onOpenSession={() => {
                        navigate({ to: '/sessions/$sessionId', params: { sessionId: pendingQuickSessionId } })
                    }}
                    onClose={handleClosePendingQuickModal}
                />
            ) : null}

            {/* G. AddMemberModal */}
            {showAddMember ? (
                <AddMemberModal
                    existingMemberSessionIds={existingMemberSessionIds}
                    onAdd={addMember}
                    onClose={() => setShowAddMember(false)}
                    isPending={isPending}
                />
            ) : null}
        </div>
    )
}
