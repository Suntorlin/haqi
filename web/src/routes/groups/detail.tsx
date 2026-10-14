import { forwardRef, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type ClipboardEvent, type ComponentProps, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
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
import { ChatTimeSeparator } from '@/components/AssistantChat/messages/SocialMessages'
import { FileIcon } from '@/components/FileIcon'
import { Spinner } from '@/components/Spinner'
import { HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { cn } from '@/lib/utils'
import { createAttachmentAdapter } from '@/lib/attachmentAdapter'
import { isImageMimeType } from '@/lib/fileAttachments'
import { safeCopyToClipboard } from '@/lib/clipboard'
import { NewSession } from '@/components/NewSession'
import { useTranslation } from '@/lib/use-translation'
import { getSessionTitle } from '@/lib/session-title'
import { matchesSessionSearch } from '@/lib/session-search'
import { useLongPress } from '@/hooks/useLongPress'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button, buttonVariants } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { FormField, SegmentedControl, SelectInput } from '@/components/ui/FormControls'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { queryKeys } from '@/lib/query-keys'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { useChatViewMode, type ChatViewMode } from '@/hooks/useChatViewMode'
import { ContextMenu, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { BottomSheet, SheetNote, SheetRow, SheetSection } from '@/components/mobile/BottomSheet'
import { MobileSearchField } from '@/components/mobile/MobileSearchField'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'
import { TIME_SEPARATOR_GAP_MS } from '@/components/mobile/chatTimeline'
import { GroupAvatar, SessionAvatar, getProjectName, getSessionProjectPath, type AvatarRing } from '@/components/mobile/SessionAvatar'
import {
    ChatBubbleIcon,
    ChevronRightIcon,
    DuplicateIcon,
    MegaphoneIcon,
    MoreHorizontalIcon,
    NewSessionIcon,
    PaperclipIcon,
    PencilIcon,
    PlusIcon,
    ReplyIcon,
    SendArrowIcon,
    ShieldCheckIcon,
    SparklesIcon,
    TrashIcon
} from '@/components/mobile/icons'
import { useGroupInfoPanel } from './group-info'

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

function CloseIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function taskStatusDotClass(status: GroupTaskStatus): string {
    if (status === 'completed' || status === 'manual_done') return 'bg-[var(--social-success)]'
    if (status === 'failed' || status === 'canceled' || status === 'expired') return 'bg-[var(--social-danger)]'
    if (status === 'running' || status === 'enqueued') return 'bg-[var(--social-warning)] animate-pulse'
    return 'bg-[var(--social-fg-subtle)]'
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

type MemberWorkStatus = 'offline' | 'pending' | 'working' | 'online'

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
    return 'online'
}

/** Same ring rules as the session list: pending approvals first, then live work; offline orbs fade. */
function getMemberRing(status: MemberWorkStatus): AvatarRing {
    if (status === 'pending') return 'pending'
    if (status === 'working') return 'live'
    return null
}

/** "2 项待批准" / "正在思考…" / "在线", then agent · project, like the session list preview line. */
function MemberStatusLine(props: { session: SessionSummary | undefined; status: MemberWorkStatus }) {
    const { t } = useTranslation()
    const { session, status } = props
    const meta = [
        session?.metadata?.flavor ?? null,
        session ? getProjectName(getSessionProjectPath(session)) : null
    ].filter(Boolean).join(' · ')

    return (
        <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[13px] leading-snug text-[var(--social-fg-muted)]">
            {status === 'pending' ? (
                <span className="shrink-0 font-semibold text-[var(--social-badge)]">
                    {t('mobile.feed.pending', { n: session?.pendingRequestsCount ?? 0 })}
                </span>
            ) : status === 'working' ? (
                <span className="inline-flex shrink-0 items-center font-semibold text-[var(--social-fg)]">
                    {t('mobile.feed.thinking')}
                    <span className="typing-dots ml-0.5 inline-flex items-center" aria-hidden="true">
                        <span /><span /><span />
                    </span>
                </span>
            ) : (
                <span className="shrink-0">{status === 'online' ? t('misc.online') : t('misc.offline')}</span>
            )}
            {meta ? <span className="min-w-0 truncate">{`· ${meta}`}</span> : null}
        </span>
    )
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
        return '—'
    }

    try {
        return JSON.stringify(value, null, 2)
    } catch {
        return String(value)
    }
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

function isSystemMessage(message: GroupTimelineMessage): boolean {
    return message.type === 'system' || message.type === 'note_state'
}

/** Messages from the same sender close together are drawn as one run (one name line). */
function getMessageActorKey(message: GroupTimelineMessage): string {
    return getActorSessionId(message) ?? message.source
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
    let actorName = ''

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

/** Command text with @session mentions shown as the member's title (tap opens that chat). */
function CommandText(props: {
    content: string
    sessionMap: Map<string, SessionSummary>
    onOpenSession: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const parts = splitCommandTextByMention(props.content)

    return (
        <>
            {parts.map((part, index) => {
                const key = `${part.type}:${index}`
                if (part.type === 'text') {
                    return <span key={key}>{part.value}</span>
                }

                if (part.sessionId === 'all') {
                    return <span key={key} className="font-semibold">{part.raw}</span>
                }

                const session = props.sessionMap.get(part.sessionId)
                if (!session) {
                    return <span key={key}>{part.raw}</span>
                }

                const sessionTitle = getSessionTitle(session, {
                    fallbackSessionId: part.sessionId,
                    fallbackIdLength: 12
                })

                return (
                    <button
                        key={key}
                        type="button"
                        onClick={() => props.onOpenSession(part.sessionId)}
                        className="font-semibold underline decoration-dotted underline-offset-2"
                        title={t('groups.message.openSession', { name: sessionTitle })}
                    >
                        {`@${sessionTitle}`}
                    </button>
                )
            })}
        </>
    )
}

function BubbleMarkdown(props: { content: string }) {
    return (
        <div className="aui-md min-w-0 max-w-full break-words [overflow-wrap:anywhere]">
            <ReactMarkdown
                remarkPlugins={MARKDOWN_PLUGINS}
                components={defaultComponents}
            >
                {props.content}
            </ReactMarkdown>
        </div>
    )
}

/** Grows the composer with its text, between the textarea's CSS min-height and max-height. */
function resizeComposerTextarea(el: HTMLTextAreaElement | null): void {
    if (!el) return

    // Empty: rest at the CSS min-height (a long placeholder must not stretch the box).
    if (!el.value) {
        el.style.height = ''
        el.style.overflowY = 'hidden'
        return
    }

    const style = window.getComputedStyle(el)
    const minHeight = Number.parseFloat(style.minHeight) || 0
    const maxHeight = Number.parseFloat(style.maxHeight) || 120
    const selectionStart = el.selectionStart
    const selectionEnd = el.selectionEnd

    el.style.height = 'auto'
    const scrollHeight = el.scrollHeight
    const nextHeight = Math.min(Math.max(scrollHeight, minHeight), maxHeight)
    el.style.height = `${nextHeight}px`

    const shouldScroll = scrollHeight > maxHeight
    el.style.overflowY = shouldScroll ? 'auto' : 'hidden'

    // Re-apply selection to keep caret visible after internal textarea resize.
    if (shouldScroll && selectionStart !== null && selectionEnd !== null) {
        el.setSelectionRange(selectionStart, selectionEnd)
    } else if (!shouldScroll && el.scrollTop !== 0) {
        el.scrollTop = 0
    }
}

// ─── Add member ──────────────────────────────────────────────────────────────

const OFFLINE_PICK_LIMIT = 100

function SessionPickRow(props: { session: SessionSummary; disabled: boolean; onPick: () => void }) {
    const { session } = props
    return (
        <button
            type="button"
            disabled={props.disabled}
            onClick={props.onPick}
            className="social-pressable flex min-h-[56px] w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-50 [&+&]:border-t [&+&]:border-[var(--social-border)]"
        >
            <SessionAvatar session={session} size={36} muted={!session.active} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-[var(--social-fg)]">
                    {getSessionTitle(session, { fallbackIdLength: 12 })}
                </span>
                <span className="block truncate text-[13px] text-[var(--social-fg-muted)]">
                    {[session.metadata?.flavor, getProjectName(getSessionProjectPath(session))].filter(Boolean).join(' · ')}
                </span>
            </span>
        </button>
    )
}

function AddMemberSheet(props: {
    open: boolean
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

    useEffect(() => {
        if (props.open) {
            setSearch('')
            setError(null)
            setOfflineExpanded(false)
            setMode('select')
        }
    }, [props.open])

    const { online, offline } = useMemo(() => {
        const available = sessions
            .filter((s) => !props.existingMemberSessionIds.has(s.id) && matchesSessionSearch(s, search))
            .sort((a, b) => b.updatedAt - a.updatedAt)
        return {
            online: available.filter((s) => s.active),
            offline: available.filter((s) => !s.active)
        }
    }, [sessions, props.existingMemberSessionIds, search])

    const addAndClose = async (sessionId: string) => {
        setError(null)
        try {
            await props.onAdd(sessionId)
            props.onClose()
        } catch (err) {
            setError(err instanceof Error ? err.message : t('groups.member.addFailed'))
        }
    }

    const handleAdd = async (sessionId: string) => {
        setAddingId(sessionId)
        try {
            await addAndClose(sessionId)
        } finally {
            setAddingId(null)
        }
    }

    const handleOpenChange = (open: boolean) => {
        if (!open) props.onClose()
    }

    if (mode === 'create') {
        return (
            <BottomSheet open={props.open} onOpenChange={handleOpenChange} title={t('groups.member.createTitle')}>
                {error ? <SheetNote tone="error">{error}</SheetNote> : null}
                <NewSession
                    api={api}
                    machines={machines}
                    onSuccess={addAndClose}
                    onCancel={() => setMode('select')}
                />
            </BottomSheet>
        )
    }

    const rowDisabled = addingId !== null || props.isPending
    const visibleOffline = offlineExpanded || search ? offline.slice(0, OFFLINE_PICK_LIMIT) : []

    return (
        <BottomSheet open={props.open} onOpenChange={handleOpenChange} title={t('groups.detail.addMember')}>
            <div className="px-4 pb-3 pt-1">
                <MobileSearchField value={search} onChange={setSearch} placeholder={t('sessions.search.placeholder')} />
            </div>
            <SheetSection>
                <SheetRow icon={<NewSessionIcon />} label={t('groups.member.createNew')} chevron onClick={() => setMode('create')} />
            </SheetSection>
            {error ? <SheetNote tone="error">{error}</SheetNote> : null}
            {sessionsLoading ? (
                <SheetNote>{t('mobile.feed.loading')}</SheetNote>
            ) : online.length === 0 && offline.length === 0 ? (
                <SheetNote>{search ? t('groups.member.noMatch') : t('groups.member.noneAvailable')}</SheetNote>
            ) : (
                <>
                    {online.length > 0 ? (
                        <SheetSection title={`${t('misc.online')} · ${online.length}`}>
                            {online.map((session) => (
                                <SessionPickRow key={session.id} session={session} disabled={rowDisabled} onPick={() => { void handleAdd(session.id) }} />
                            ))}
                        </SheetSection>
                    ) : null}
                    {offline.length > 0 ? (
                        <SheetSection title={`${t('misc.offline')} · ${offline.length}`}>
                            {visibleOffline.length > 0 ? visibleOffline.map((session) => (
                                <SessionPickRow key={session.id} session={session} disabled={rowDisabled} onPick={() => { void handleAdd(session.id) }} />
                            )) : (
                                <SheetRow label={t('groups.member.showOffline')} chevron onClick={() => setOfflineExpanded(true)} />
                            )}
                        </SheetSection>
                    ) : null}
                    {visibleOffline.length > 0 && offline.length > visibleOffline.length ? (
                        <SheetNote>{t('groups.member.offlineLimit', { n: OFFLINE_PICK_LIMIT })}</SheetNote>
                    ) : null}
                </>
            )}
            <div className="h-2" />
        </BottomSheet>
    )
}

// ─── Group info panel ────────────────────────────────────────────────────────

function MemberRow(props: {
    member: GroupMember
    session?: SessionSummary
    onOpen: () => void
    onMore: () => void
}) {
    const { t } = useTranslation()
    const { member, session } = props
    const status = getMemberWorkStatus(session)
    const title = getSessionTitle(session, { fallbackSessionId: member.sessionId, fallbackIdLength: 12 })
    const hasSession = Boolean(member.sessionId)
    const longPressHandlers = useLongPress({
        onLongPress: props.onMore,
        onClick: props.onOpen,
        threshold: 500,
        disabled: !hasSession
    })

    return (
        <div className="flex items-center gap-1 pr-2 [&+&]:border-t [&+&]:border-[var(--social-border)]">
            <button
                type="button"
                {...longPressHandlers}
                disabled={!hasSession}
                className="social-pressable flex min-w-0 flex-1 select-none items-center gap-3 py-2 pl-4 pr-1 text-left"
                style={{ WebkitTouchCallout: 'none' }}
            >
                <SessionAvatar
                    session={{ id: member.sessionId ?? `member:${member.id}` }}
                    size={40}
                    ring={getMemberRing(status)}
                    muted={status === 'offline'}
                    badgeCount={status === 'pending' ? session?.pendingRequestsCount : 0}
                />
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] text-[var(--social-fg)]">{title}</span>
                    <MemberStatusLine session={session} status={status} />
                </span>
            </button>
            {hasSession ? (
                <IconButton label={t('groups.member.actions')} onClick={props.onMore}>
                    <MoreHorizontalIcon className="h-5 w-5" />
                </IconButton>
            ) : null}
        </div>
    )
}

type GroupNoteSummary = { content: string; version: number } | null

/** WeChat "聊天信息": who is in the group, the shared note and how the chat is shown. */
function GroupInfoSheet(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    groupId: string
    name: string
    description: string | null
    members: GroupMember[]
    sessionMap: Map<string, SessionSummary>
    note: GroupNoteSummary
    viewMode: ChatViewMode
    onViewModeChange: (mode: ChatViewMode) => void
    isPending: boolean
    onOpenMember: (sessionId: string) => void
    onMemberMore: (sessionId: string) => void
    onAddMember: () => void
    onEditNote: () => void
    onGenerateNote: () => void
    onBroadcastNote: () => void
}) {
    const { t } = useTranslation()
    const memberSessions = props.members
        .map((member) => (member.sessionId ? props.sessionMap.get(member.sessionId) : undefined))
        .filter((session): session is SessionSummary => Boolean(session))
    const onlineCount = props.members
        .filter((member) => getMemberWorkStatus(member.sessionId ? props.sessionMap.get(member.sessionId) : undefined) !== 'offline')
        .length
    const closeThen = (action: () => void) => () => {
        props.onOpenChange(false)
        action()
    }
    const noteContent = props.note?.content.trim() ?? ''

    return (
        <BottomSheet open={props.open} onOpenChange={props.onOpenChange} title={t('groups.info.title')} hideTitle>
            <div className="flex items-center gap-3.5 px-5 pb-5 pt-2">
                <GroupAvatar seed={props.groupId} members={memberSessions} size={48} />
                <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-[var(--social-fg)]">{props.name}</div>
                    <div className="mt-1 truncate text-[13px] text-[var(--social-fg-muted)]">
                        {t('groups.info.summary', { n: props.members.length, m: onlineCount })}
                    </div>
                    {props.description ? (
                        <div className="mt-0.5 line-clamp-2 text-[13px] text-[var(--social-fg-muted)]">{props.description}</div>
                    ) : null}
                </div>
            </div>

            <SheetSection title={t('mobile.chat.view')}>
                <SegmentedControl
                    framed={false}
                    label={t('mobile.chat.view')}
                    value={props.viewMode}
                    options={[
                        { value: 'normal', label: t('mobile.chat.view.normal') },
                        { value: 'brief', label: t('mobile.chat.view.brief') },
                        { value: 'cli', label: t('mobile.chat.view.cli') }
                    ]}
                    onChange={(mode) => {
                        props.onViewModeChange(mode)
                        props.onOpenChange(false)
                    }}
                />
            </SheetSection>

            <SheetSection title={`${t('groups.detail.members')} · ${props.members.length}`}>
                {props.members.map((member) => (
                    <MemberRow
                        key={member.id}
                        member={member}
                        session={member.sessionId ? props.sessionMap.get(member.sessionId) : undefined}
                        onOpen={() => {
                            if (member.sessionId) closeThen(() => props.onOpenMember(member.sessionId as string))()
                        }}
                        onMore={() => {
                            if (member.sessionId) props.onMemberMore(member.sessionId)
                        }}
                    />
                ))}
                <button
                    type="button"
                    onClick={closeThen(props.onAddMember)}
                    disabled={props.isPending}
                    className={cn(
                        'social-pressable flex w-full items-center gap-3 px-4 py-2 text-left disabled:opacity-50',
                        props.members.length > 0 ? 'border-t border-[var(--social-border)]' : ''
                    )}
                >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--social-muted)] text-[var(--social-fg)]">
                        <PlusIcon className="h-5 w-5" />
                    </span>
                    <span className="text-[15px] text-[var(--social-fg)]">{t('groups.detail.addMember')}</span>
                </button>
            </SheetSection>

            <SheetSection title={props.note ? `${t('groups.detail.note')} · v${props.note.version}` : t('groups.detail.note')}>
                <button
                    type="button"
                    onClick={closeThen(props.onEditNote)}
                    className="social-pressable block w-full border-b border-[var(--social-border)] px-4 py-3 text-left"
                >
                    {noteContent ? (
                        <BriefCardMarkdownPreview content={noteContent} className="max-h-[132px] text-[var(--social-fg-muted)]" />
                    ) : (
                        <span className="text-[15px] text-[var(--social-fg-muted)]">{t('groups.note.empty')}</span>
                    )}
                </button>
                <SheetRow icon={<PencilIcon />} label={t('groups.note.edit')} chevron onClick={closeThen(props.onEditNote)} />
                <SheetRow icon={<SparklesIcon />} label={t('groups.note.generate')} disabled={props.isPending} onClick={closeThen(props.onGenerateNote)} />
                <SheetRow icon={<MegaphoneIcon />} label={t('groups.note.broadcast')} disabled={props.isPending || !noteContent} onClick={closeThen(props.onBroadcastNote)} />
            </SheetSection>
            <div className="h-2" />
        </BottomSheet>
    )
}

/** Opened from a member row: open its chat, handle its approvals, or remove it from the group. */
function MemberActionsSheet(props: {
    member: GroupMember | null
    session?: SessionSummary
    onOpenChange: (open: boolean) => void
    onOpenSession: () => void
    onHandlePending: () => void
    onRemove: () => void
}) {
    const { t } = useTranslation()
    const { member, session } = props
    const status = getMemberWorkStatus(session)
    const title = member ? getSessionTitle(session, { fallbackSessionId: member.sessionId, fallbackIdLength: 12 }) : ''

    return (
        <BottomSheet open={Boolean(member)} onOpenChange={props.onOpenChange} title={title || t('groups.member.actions')} hideTitle>
            {member ? (
                <>
                    <div className="flex items-center gap-3.5 px-5 pb-4 pt-2">
                        <SessionAvatar session={{ id: member.sessionId ?? `member:${member.id}` }} size={44} ring={getMemberRing(status)} muted={status === 'offline'} />
                        <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-[16px] font-semibold leading-snug text-[var(--social-fg)]">{title}</div>
                            <MemberStatusLine session={session} status={status} />
                        </div>
                    </div>
                    <SheetSection>
                        <SheetRow icon={<ChatBubbleIcon />} label={t('groups.member.openSession')} chevron onClick={props.onOpenSession} />
                        {status === 'pending' ? (
                            <SheetRow icon={<ShieldCheckIcon />} label={t('groups.pending.title')} chevron onClick={props.onHandlePending} />
                        ) : null}
                        <SheetRow icon={<TrashIcon />} label={t('groups.member.remove')} destructive onClick={props.onRemove} />
                    </SheetSection>
                    <div className="h-2" />
                </>
            ) : null}
        </BottomSheet>
    )
}

type NoteDraft = { content: string; prompt: string; executorSessionId: string }

function NoteEditorSheet(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    loading: boolean
    initial: NoteDraft
    executorOptions: Array<{ id: string; label: string }>
    isPending: boolean
    onSave: (draft: NoteDraft) => Promise<void>
}) {
    const { t } = useTranslation()
    const [draft, setDraft] = useState<NoteDraft>(props.initial)
    const [error, setError] = useState<string | null>(null)
    const contentId = useId()
    const executorId = useId()
    const promptId = useId()

    // Start from the saved note each time the editor opens; later server updates do not clobber typing.
    useEffect(() => {
        if (props.open) {
            setDraft(props.initial)
            setError(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.open])

    const handleSave = async () => {
        setError(null)
        try {
            await props.onSave(draft)
            props.onOpenChange(false)
        } catch (err) {
            setError(err instanceof Error ? err.message : t('groups.note.saveFailed'))
        }
    }

    return (
        <BottomSheet open={props.open} onOpenChange={props.onOpenChange} title={t('groups.note.edit')}>
            {props.loading ? (
                <SheetNote>{t('groups.note.loading')}</SheetNote>
            ) : (
                <div className="flex flex-col gap-4 px-4 pb-4 pt-1">
                    <FormField label={t('groups.detail.note')} htmlFor={contentId}>
                        <textarea
                            id={contentId}
                            value={draft.content}
                            onChange={(event) => setDraft((value) => ({ ...value, content: event.target.value }))}
                            placeholder={t('groups.detail.notePlaceholder')}
                            rows={10}
                            className={cn(DIALOG_INPUT_CLASS, 'min-h-[180px] resize-y leading-relaxed')}
                        />
                    </FormField>
                    <FormField label={t('groups.detail.executor')} htmlFor={executorId} hint={t('groups.note.executorHint')}>
                        <SelectInput
                            id={executorId}
                            value={draft.executorSessionId}
                            onChange={(event) => setDraft((value) => ({ ...value, executorSessionId: event.target.value }))}
                        >
                            <option value="">{t('groups.detail.notConfigured')}</option>
                            {props.executorOptions.map((option) => (
                                <option key={option.id} value={option.id}>{option.label}</option>
                            ))}
                        </SelectInput>
                    </FormField>
                    <FormField label={t('groups.detail.prompt')} htmlFor={promptId} optional>
                        <textarea
                            id={promptId}
                            value={draft.prompt}
                            onChange={(event) => setDraft((value) => ({ ...value, prompt: event.target.value }))}
                            placeholder={t('groups.detail.promptPlaceholder')}
                            rows={3}
                            className={cn(DIALOG_INPUT_CLASS, 'resize-y')}
                        />
                    </FormField>
                    {error ? <div className="px-1 text-[13px] text-[var(--social-danger)]">{error}</div> : null}
                    <div className="flex justify-end gap-2 pt-1">
                        <Button type="button" variant="secondary" onClick={() => props.onOpenChange(false)}>
                            {t('button.cancel')}
                        </Button>
                        <Button type="button" onClick={() => { void handleSave() }} disabled={props.isPending}>
                            {t('button.save')}
                        </Button>
                    </div>
                </div>
            )}
        </BottomSheet>
    )
}

/** Approve or deny a member's pending tool requests without leaving the group. */
function PendingRequestsSheet(props: {
    sessionId: string | null
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
    const busy = props.activeRequestId !== null

    return (
        <BottomSheet open={Boolean(props.sessionId)} onOpenChange={(open) => { if (!open) props.onClose() }} title={t('groups.pending.title')}>
            {props.sessionId ? (
                <div className="flex items-center gap-3 px-5 pb-4 pt-1">
                    <SessionAvatar session={{ id: props.sessionId }} size={40} ring={props.requests.length > 0 ? 'pending' : null} />
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-[15px] font-semibold text-[var(--social-fg)]">{props.sessionTitle}</div>
                        <div className="text-[13px] text-[var(--social-fg-muted)]">
                            {props.requests.length > 0 ? t('mobile.feed.pending', { n: props.requests.length }) : t('groups.pending.none')}
                        </div>
                    </div>
                </div>
            ) : null}
            {props.loadError ? <SheetNote tone="error">{props.loadError}</SheetNote> : null}
            {props.actionError ? <SheetNote tone="error">{props.actionError}</SheetNote> : null}
            {props.isLoading ? (
                <SheetNote>{t('groups.pending.loading')}</SheetNote>
            ) : props.requests.map((request) => (
                <section key={request.id} className="px-4 pb-3">
                    <div className="overflow-hidden rounded-2xl border border-[var(--social-border)]">
                        <div className="flex items-baseline gap-2 px-4 pt-3">
                            <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[var(--social-fg)]">{request.tool}</span>
                            {request.createdAt ? (
                                <span className="shrink-0 text-[12px] text-[var(--social-fg-subtle)]">{formatTime(request.createdAt)}</span>
                            ) : null}
                        </div>
                        <pre className="mx-4 mb-3 mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-[var(--social-muted)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--social-fg)]">
                            {formatPermissionArguments(request.arguments)}
                        </pre>
                        <div className="flex justify-end gap-2 border-t border-[var(--social-border)] px-3 py-2.5">
                            <Button
                                type="button"
                                variant="secondary"
                                className="text-[var(--social-danger)]"
                                disabled={busy}
                                onClick={() => { void props.onDeny(request.id) }}
                            >
                                {t('groups.detail.deny')}
                            </Button>
                            <Button
                                type="button"
                                disabled={busy}
                                onClick={() => { void props.onApprove(request.id) }}
                            >
                                {props.activeRequestId === request.id ? t('groups.detail.processing') : t('groups.detail.approve')}
                            </Button>
                        </div>
                    </div>
                </section>
            ))}
            <SheetSection>
                <SheetRow label={t('groups.pending.refresh')} disabled={props.isLoading || busy} onClick={props.onRefresh} />
                <SheetRow label={t('groups.member.openSession')} chevron onClick={props.onOpenSession} />
            </SheetSection>
            <div className="h-2" />
        </BottomSheet>
    )
}

/** Shown above the chat only while a member is waiting for an approval. */
function PendingBanner(props: {
    items: Array<{ sessionId: string; title: string; count: number }>
    onOpen: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    return (
        <div className="shrink-0 border-b border-[var(--social-border)] px-4 py-2">
            {props.items.map((item) => (
                <button
                    key={item.sessionId}
                    type="button"
                    onClick={() => props.onOpen(item.sessionId)}
                    className="mx-auto flex min-h-11 w-full max-w-content items-center gap-3 py-1 text-left [-webkit-tap-highlight-color:transparent]"
                >
                    <SessionAvatar session={{ id: item.sessionId }} size={32} ring="pending" />
                    <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-[var(--social-fg)]">{item.title}</span>
                        <span className="block text-[13px] text-[var(--social-badge)]">{t('mobile.feed.pending', { n: item.count })}</span>
                    </span>
                    <span aria-hidden className={buttonVariants({ size: 'sm' })}>
                        {t('groups.pending.handle')}
                    </span>
                </button>
            ))}
        </div>
    )
}

// ─── TaskStateList ─────────────────────────────────────────────────────────────
// Collapsible task detail shown under a command bubble

type LatestTaskStates = Map<string, GroupTimelineMessage>  // taskId → latest msg

function TaskStateList(props: { taskStates: LatestTaskStates; sessionMap: Map<string, SessionSummary> }) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const tasks = Array.from(props.taskStates.values())
    if (tasks.length === 0) return null

    const allDone = tasks.every((task) => {
        const p = task.payload as { status?: unknown } | null
        return isTerminalStatus((p?.status ?? 'pending') as GroupTaskStatus)
    })

    return (
        <div className="mt-1 max-w-[88%] px-1 lg:max-w-[75%]">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="relative flex items-center gap-1 text-[12px] text-[var(--social-fg-subtle)] transition-colors before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:text-[var(--social-fg-muted)]"
            >
                <ChevronRightIcon className={cn('h-3 w-3 transition-transform', open ? 'rotate-90' : '')} />
                {allDone ? t('groups.task.summaryDone', { n: tasks.length }) : t('groups.task.summary', { n: tasks.length })}
            </button>
            {open ? (
                <div className="mt-1.5 flex flex-col gap-1">
                    {tasks.map((task) => {
                        const p = task.payload as { status?: unknown; targetSessionId?: unknown; error?: unknown } | null
                        const status = (p?.status ?? 'pending') as GroupTaskStatus
                        const targetId = typeof p?.targetSessionId === 'string' ? p.targetSessionId : ''
                        const target = targetId
                            ? getSessionTitle(props.sessionMap.get(targetId), { fallbackSessionId: targetId, fallbackIdLength: 12 })
                            : ''
                        const error = typeof p?.error === 'string' ? p.error : null
                        return (
                            <div key={task.taskId ?? task.id} className="flex min-w-0 items-center gap-2 text-[12px]">
                                <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', taskStatusDotClass(status))} />
                                <span className="shrink-0 text-[var(--social-fg)]">{t(`groups.task.status.${status}`)}</span>
                                {target ? <span className="min-w-0 truncate text-[var(--social-fg-muted)]">{target}</span> : null}
                                {error ? <span className="min-w-0 truncate text-[var(--social-danger)]">{error}</span> : null}
                            </div>
                        )
                    })}
                </div>
            ) : null}
        </div>
    )
}

// ─── TimelineBubble ───────────────────────────────────────────────────────────

/**
 * One group message in the social chat look: others in white cards with a small name line,
 * mine in dark bubbles; a centered time after quiet gaps; consecutive messages from one
 * sender share the name line. Phones long-press for reply / copy, desktop hovers a reply button.
 */
function TimelineBubble(props: {
    message: GroupTimelineMessage
    previous?: GroupTimelineMessage
    sessionMap: Map<string, SessionSummary>
    onOpenSession: (sessionId: string) => void
    onQuote?: (message: GroupTimelineMessage) => void
    taskStates?: LatestTaskStates
}) {
    const { t } = useTranslation()
    const isMobileLayout = useIsMobileLayout()
    const { message, previous } = props
    const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
    const text = getDisplayText(message)
    const attachments = extractBubbleAttachments(message)
    const isUser = message.source.startsWith('user:')
    const isSystem = isSystemMessage(message)
    const isCommand = message.type === 'command'
    const canQuote = canQuoteMessage(message) && Boolean(props.onQuote)
    const longPressHandlers = useLongPress({
        onLongPress: (point) => setMenuPoint(point),
        threshold: 450,
        disabled: !isMobileLayout || isSystem
    })
    const showSeparator = !previous || message.createdAt - previous.createdAt >= TIME_SEPARATOR_GAP_MS
    const grouped = !showSeparator
        && previous !== undefined
        && !isSystem
        && !isSystemMessage(previous)
        && getMessageActorKey(previous) === getMessageActorKey(message)
    const separator = showSeparator ? <ChatTimeSeparator at={message.createdAt} /> : null

    if (isSystem) {
        return (
            <div className="mx-auto w-full max-w-content px-4 pt-3">
                {separator}
                <div className="flex justify-center">
                    <span className="max-w-[88%] rounded-full bg-[var(--social-muted)] px-3 py-1 text-center text-[12px] leading-[18px] text-[var(--social-fg-muted)]">
                        {text}
                    </span>
                </div>
            </div>
        )
    }

    // Get quote information either from message.quotedMessage or parse from text
    const quoteInfo = message.quotedMessage
        ? { actorName: message.quotedMessage.actorName ?? '', quotedText: message.quotedMessage.text }
        : parseQuoteFromText(extractBubbleText(message))

    const actorSessionId = getActorSessionId(message)
    const actorSession = actorSessionId ? props.sessionMap.get(actorSessionId) : undefined
    const actorTitle = actorSessionId
        ? getSessionTitle(actorSession, { fallbackSessionId: actorSessionId, fallbackIdLength: 12 })
        : (message.actorName || message.source)

    const closeMenuThen = (action: () => void) => () => {
        setMenuPoint(null)
        action()
    }

    return (
        <div className={cn('group/message mx-auto w-full max-w-content px-4', grouped ? 'pt-1' : 'pt-3')}>
            {separator}
            <div className={cn('flex min-w-0 flex-col', isUser ? 'items-end' : 'items-start')}>
                {!isUser && !grouped ? (
                    actorSessionId ? (
                        <button
                            type="button"
                            onClick={() => props.onOpenSession(actorSessionId)}
                            className="relative mb-1 flex max-w-[88%] items-center gap-1.5 px-1 text-left before:absolute before:-inset-y-3 before:inset-x-0 before:content-['']"
                            title={t('groups.message.openSession', { name: actorTitle })}
                        >
                            <SessionAvatar session={{ id: actorSessionId }} size={18} muted={!actorSession?.active} />
                            <span className="truncate text-[13px] font-semibold text-[var(--social-fg-muted)]">{actorTitle}</span>
                        </button>
                    ) : (
                        <div className="mb-1 max-w-[88%] truncate px-1 text-[13px] font-semibold text-[var(--social-fg-muted)]">{actorTitle}</div>
                    )
                ) : null}
                <div className={cn('flex min-w-0 max-w-[88%] items-end gap-1 lg:max-w-[75%]', isUser ? 'flex-row-reverse' : 'flex-row')}>
                    <div
                        {...(isMobileLayout ? longPressHandlers : {})}
                        style={isMobileLayout ? { WebkitTouchCallout: 'none' } : undefined}
                        className={cn(
                            'min-w-0 max-w-full rounded-2xl px-4 py-2.5 text-[15px] leading-[1.55] break-words [overflow-wrap:anywhere]',
                            isUser ? 'social-bubble-self rounded-br-md' : 'social-card rounded-tl-md',
                            isMobileLayout ? 'select-none' : '',
                            isCommand ? 'whitespace-pre-wrap font-mono text-[13px]' : ''
                        )}
                    >
                        {quoteInfo ? (
                            <div
                                className={cn(
                                    'mb-2 border-l-2 pl-2.5 font-sans text-[13px] leading-snug',
                                    isUser ? 'border-[var(--social-primary-fg)]/40 opacity-80' : 'border-[var(--social-border)] text-[var(--social-fg-muted)]'
                                )}
                            >
                                <span className="font-semibold">{quoteInfo.actorName || t('groups.message.unknownActor')}</span>
                                <span className="line-clamp-2 break-words">{truncateText(quoteInfo.quotedText, 120)}</span>
                            </div>
                        ) : null}
                        {text ? (
                            isCommand
                                ? <CommandText content={text} sessionMap={props.sessionMap} onOpenSession={props.onOpenSession} />
                                : <BubbleMarkdown content={text} />
                        ) : null}
                        {attachments.length > 0 ? (
                            <MessageAttachments attachments={attachments} />
                        ) : null}
                    </div>
                    {canQuote && !isMobileLayout ? (
                        <IconButton
                            size="sm"
                            label={t('groups.detail.reply')}
                            onClick={() => props.onQuote?.(message)}
                            className="opacity-0 focus-visible:opacity-100 group-hover/message:opacity-100"
                        >
                            <ReplyIcon className="h-4 w-4" />
                        </IconButton>
                    ) : null}
                </div>
                {isCommand && props.taskStates && props.taskStates.size > 0 ? (
                    <TaskStateList taskStates={props.taskStates} sessionMap={props.sessionMap} />
                ) : null}
            </div>
            {menuPoint ? (
                <ContextMenu open anchorPoint={menuPoint} onClose={() => setMenuPoint(null)} label={t('session.more')}>
                    {canQuote ? (
                        <ContextMenuItem icon={<ReplyIcon />} label={t('groups.detail.reply')} onSelect={closeMenuThen(() => props.onQuote?.(message))} />
                    ) : null}
                    <ContextMenuItem
                        icon={<DuplicateIcon />}
                        label={t('button.copy')}
                        disabled={!text}
                        onSelect={closeMenuThen(() => { void safeCopyToClipboard(text).catch(() => {}) })}
                    />
                </ContextMenu>
            ) : null}
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
    className?: string
}) {
    const { t } = useTranslation()
    if (props.attachments.length === 0) {
        return null
    }

    return (
        <div className={cn('flex flex-wrap gap-2', props.className)}>
            {props.attachments.map((attachment) => {
                const isImage = isImageMimeType(attachment.mimeType) && Boolean(attachment.previewUrl)
                const statusText = attachment.status === 'uploading'
                    ? t('groups.detail.uploading')
                    : attachment.status === 'error'
                        ? (attachment.error ?? t('groups.composer.uploadFailed'))
                        : formatFileSize(attachment.size)

                return (
                    <div key={attachment.id} className="flex min-w-[168px] max-w-full items-center gap-2 rounded-xl border border-[var(--social-border)] bg-[var(--social-surface)] px-2.5 py-2">
                        {attachment.status === 'uploading' ? (
                            <Spinner size="sm" label={null} className="text-[var(--social-fg-subtle)]" />
                        ) : null}
                        {attachment.status === 'error' ? (
                            <span className="text-[var(--social-danger)]">
                                <AttachmentErrorIcon className="h-4 w-4" />
                            </span>
                        ) : null}
                        {isImage ? (
                            <img
                                src={attachment.previewUrl}
                                alt={attachment.filename}
                                className="h-8 w-8 shrink-0 rounded-md object-cover"
                            />
                        ) : (
                            <span className="shrink-0">
                                <FileIcon fileName={attachment.filename} size={20} />
                            </span>
                        )}
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-[13px] text-[var(--social-fg)]">
                                {attachment.filename}
                            </div>
                            <div className={cn('truncate text-[12px]', attachment.status === 'error' ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg-subtle)]')}>
                                {statusText}
                            </div>
                        </div>
                        <IconButton
                            size="sm"
                            label={t('groups.detail.removeAttachment')}
                            onClick={() => { void props.onRemove(attachment.id) }}
                            disabled={props.disabled}
                            className={cn('-my-1.5 -mr-1.5', HIT_AREA_CLASS)}
                        >
                            <CloseIcon className="h-3.5 w-3.5" />
                        </IconButton>
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
    const { t } = useTranslation()
    if (!props.isLoading && !props.hasMore) {
        return null
    }

    return (
        <div className="flex justify-center pb-1 pt-3">
            {props.isLoading ? (
                <span className="inline-flex items-center gap-2 text-[12px] text-[var(--social-fg-subtle)]">
                    <span className="social-spinner" aria-hidden="true" />
                    {t('groups.timeline.loadingOlder')}
                </span>
            ) : (
                <Button type="button" variant="outline" onClick={props.onLoadMore}>
                    {t('groups.timeline.loadOlder')}
                </Button>
            )}
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

/** "12 条消息" / "1 message" / "12 messages". */
function formatMessageCount(count: number, t: (key: string, params?: Record<string, string | number>) => string): string {
    return count === 1 ? t('groups.brief.messageOne') : t('groups.brief.messages', { n: count })
}

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
            itemContent={(index, message) => (
                <TimelineBubble
                    key={message.id}
                    message={message}
                    previous={visibleMessages[index - 1]}
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
            const message = error instanceof Error ? error.message : t('groups.brief.loadFailed')
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
    }, [props.api, props.groupId, t])

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

    const turnTitle = activeTurn ? t('groups.brief.turnTitle', { n: activeTurn.turnIndex }) : t('groups.brief.turnDetails')
    const turnSubtitle = activeTurn ? formatMessageCount(activeTurn.messageCount, t) : null
    const turnDetailBody = (
        <>
            {activeTurn && activeDetail?.error ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
                    <div className="text-[15px] text-[var(--social-danger)]">{activeDetail.error}</div>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                            void fetchTurnMessages(activeTurn.id, null, false)
                        }}
                    >
                        {t('groups.brief.retry')}
                    </Button>
                </div>
            ) : activeTurn && activeDetail ? (
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
            ) : (
                <div className="flex h-full items-center justify-center text-[15px] text-[var(--social-fg-muted)]">
                    {activeTurn && activeDetail?.isLoading ? t('groups.brief.loadingTurn') : t('groups.brief.noDetail')}
                </div>
            )}
        </>
    )

    return (
        <>
            <div className="relative flex h-full min-h-0 flex-col">
                {props.warning ? (
                    <div className="mx-4 mt-2 rounded-xl bg-[var(--app-badge-warning-bg)] px-3 py-2 text-[12px] text-[var(--app-badge-warning-text)]">
                        {props.warning}
                    </div>
                ) : null}

                {props.isLoading && props.turns.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-8">
                        <LoadingState label={t('groups.brief.loading')} className="text-[15px]" />
                    </div>
                ) : props.turns.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center py-8 text-[15px] text-[var(--social-fg-muted)]">
                        {t('groups.brief.empty')}
                    </div>
                ) : (
                    <div className="min-h-0 flex-1">
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
                                Scroller: TimelineScroller,
                                Header: () => (
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
                                ),
                                Footer: () => <div className="h-3" />
                            }}
                            itemContent={(_index, turn) => {
                                const isOpen = turn.status === 'open'
                                const initiatorPreview = normalizeBriefPreview(turn.initiatorPreview, t('groups.brief.emptyPreview'))
                                const responderPreview = normalizeBriefPreview(
                                    turn.responderPreview,
                                    isOpen ? t('groups.brief.generating') : t('groups.brief.emptyPreview')
                                )
                                const initiatorIsUser = (turn.initiatorSource ?? '').startsWith('user:')
                                const footer = (
                                    <div className="mt-2 flex items-center gap-1.5 px-1 text-[12px] text-[var(--social-fg-subtle)]">
                                        <span>{formatMessageCount(turn.messageCount, t)}</span>
                                        <span aria-hidden="true">·</span>
                                        <button
                                            type="button"
                                            className="relative transition-colors before:absolute before:-inset-x-2 before:-inset-y-3 before:content-[''] hover:text-[var(--social-fg-muted)]"
                                            onClick={() => openTurnDetails(turn.id)}
                                        >
                                            {t('groups.brief.openDetails')}
                                        </button>
                                        {isOpen ? (
                                            <span className="ml-auto inline-flex items-center gap-1.5 text-[var(--social-fg-muted)]">
                                                <span className="social-spinner" aria-hidden="true" />
                                                {t('groups.brief.generating')}
                                            </span>
                                        ) : null}
                                    </div>
                                )

                                return (
                                    <div className="mx-auto w-full max-w-content space-y-2 px-4 pt-3">
                                        <div className={cn('flex', initiatorIsUser ? 'justify-end' : 'justify-start')}>
                                            <div
                                                className={cn(
                                                    'max-w-[88%] rounded-2xl px-4 py-2.5 text-[15px] lg:max-w-[75%]',
                                                    initiatorIsUser ? 'social-bubble-self rounded-br-md' : 'social-card rounded-tl-md'
                                                )}
                                            >
                                                <BriefCardMarkdownPreview content={initiatorPreview} />
                                            </div>
                                        </div>

                                        <div className="flex flex-col items-start">
                                            {isOpen ? (
                                                <button
                                                    type="button"
                                                    className="social-card w-full max-w-[88%] rounded-2xl rounded-tl-md px-4 py-3 text-left lg:max-w-[75%]"
                                                    onClick={() => openTurnDetails(turn.id)}
                                                    aria-label={t('groups.detail.openTurn')}
                                                >
                                                    <BriefCardMarkdownPreview content={responderPreview} className="text-[var(--social-fg)]" />
                                                </button>
                                            ) : (
                                                <div className="social-card w-full max-w-[88%] rounded-2xl rounded-tl-md px-4 py-3 lg:max-w-[75%]">
                                                    <BriefFullMarkdownContent content={responderPreview} />
                                                </div>
                                            )}
                                            {footer}
                                        </div>
                                    </div>
                                )
                            }}
                        />
                    </div>
                )}
            </div>

            {isMobileViewport ? (
                activeTurnId ? (
                    <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--social-surface)]">
                        <SubPageHeader title={turnTitle} subtitle={turnSubtitle} onBack={closeTurnDetails} />
                        <div className="social-chat min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)]">
                            {turnDetailBody}
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
                        <div className="border-b border-[var(--social-border)] px-5 py-3.5">
                            <DialogHeader>
                                <DialogTitle>{turnTitle}</DialogTitle>
                            </DialogHeader>
                            {turnSubtitle ? (
                                <div className="mt-0.5 text-[12px] text-[var(--social-fg-muted)]">{turnSubtitle}</div>
                            ) : null}
                        </div>
                        <div className="social-chat min-h-0 flex-1 overflow-hidden">
                            {turnDetailBody}
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
    const isMobileLayout = useIsMobileLayout()
    const { open: infoOpen, setOpen: setInfoOpen } = useGroupInfoPanel()

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
    const [noteEditorOpen, setNoteEditorOpen] = useState(false)
    const [showAddMember, setShowAddMember] = useState(false)
    const [memberActionSessionId, setMemberActionSessionId] = useState<string | null>(null)
    const [memberRemoveSessionId, setMemberRemoveSessionId] = useState<string | null>(null)
    const [actionError, setActionError] = useState<string | null>(null)
    const [quotedMessage, setQuotedMessage] = useState<GroupTimelineMessage | null>(null)
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
            setMemberActionSessionId(null)
        }
    }, [memberActionSessionId, members])

    // The info panel belongs to one group; close it when switching groups.
    useEffect(() => {
        setInfoOpen(false)
        setNoteEditorOpen(false)
        setMemberActionSessionId(null)
    }, [groupId, setInfoOpen])

    // Build map: sessionId → session (for status dots)
    const sessionMap = useMemo(() => {
        const m = new Map<string, (typeof sessions)[0]>()
        for (const s of sessions) m.set(s.id, s)
        return m
    }, [sessions])
    const memberActionMember = useMemo(
        () => (memberActionSessionId ? members.find((item) => item.sessionId === memberActionSessionId) ?? null : null),
        [memberActionSessionId, members]
    )
    // Members waiting for an approval, for the banner above the chat.
    const pendingMembers = useMemo(() => members.flatMap((member) => {
        const session = member.sessionId ? sessionMap.get(member.sessionId) : undefined
        if (!member.sessionId || getMemberWorkStatus(session) !== 'pending') {
            return []
        }
        return [{
            sessionId: member.sessionId,
            title: getSessionTitle(session, { fallbackSessionId: member.sessionId, fallbackIdLength: 12 }),
            count: session?.pendingRequestsCount ?? 0
        }]
    }), [members, sessionMap])
    const noteExecutorOptions = useMemo(() => {
        const options = members
            .filter((member) => typeof member.sessionId === 'string' && member.sessionId.length > 0)
            .map((member) => {
                const sessionId = member.sessionId as string
                return { id: sessionId, title: getSessionTitle(sessionMap.get(sessionId), { fallbackSessionId: sessionId, fallbackIdLength: 12 }) }
            })
        // Same-named members get a short id so they can be told apart.
        return options.map((option) => ({
            id: option.id,
            label: options.filter((other) => other.title === option.title).length > 1
                ? `${option.title} · ${option.id.slice(0, 8)}`
                : option.title
        }))
    }, [members, sessionMap])
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
            candidates.push({ id: 'all', label: 'all', sublabel: t('groups.mention.all') })
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
    }, [members, sessionMap, mentionableMemberSessionIds.length, mentionableMemberSessionIdSet, t])

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
                nextAttachment.error = t('groups.composer.uploadFailed')
            }
        } else if (pendingStatus === 'incomplete') {
            nextAttachment.status = 'error'
            nextAttachment.error = t('groups.composer.uploadFailed')
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
    }, [t])

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
            setActionError(t('groups.composer.noUploader'))
            return
        }

        setActionError(null)
        for (const file of files) {
            void uploadComposerAttachment(file, uploadAdapter, uploadSessionId)
        }
    }, [t, uploadAdapter, uploadComposerAttachment, uploadSessionId])

    const handleComposerPaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.clipboardData?.files ?? [])
        const imageFiles = files.filter((file) => file.type.startsWith('image/'))
        if (imageFiles.length === 0) {
            return
        }

        event.preventDefault()
        if (!uploadSessionId || !uploadAdapter) {
            setActionError(t('groups.composer.noUploader'))
            return
        }

        setActionError(null)
        for (const file of imageFiles) {
            void uploadComposerAttachment(file, uploadAdapter, uploadSessionId)
        }
    }, [t, uploadAdapter, uploadComposerAttachment, uploadSessionId])

    const openAttachmentPicker = useCallback(() => {
        if (!uploadSessionId) {
            setActionError(t('groups.composer.noUploader'))
            return
        }
        composerAttachmentInputRef.current?.click()
    }, [t, uploadSessionId])

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
            setActionError(t('groups.composer.waitUploads'))
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
                setActionError(t('groups.composer.offlineMention', { names: offlineMentions.map((id) => getSessionTitle(sessionMap.get(id), { fallbackSessionId: id, fallbackIdLength: 12 })).join(', ') }))
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
            setActionError(err instanceof Error ? err.message : t('groups.composer.sendFailed'))
        }
    }, [
        composer,
        postMessage,
        existingMemberSessionIds,
        hasUploadingAttachments,
        mentionableMemberSessionIdSet,
        quotedMessage,
        readyComposerAttachments,
        sessionMap,
        t
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

    // Saves what changed in the note editor: content, the note prompt and the executor.
    const handleSaveNote = async (draft: NoteDraft) => {
        setActionError(null)
        if (draft.content !== (note?.content ?? '')) {
            await updateNote({ content: draft.content, updatedBy: 'user:web' })
        }
        const patch: { notePrompt?: string | null; noteSessionId?: string | null } = {}
        if (draft.prompt.trim() !== (group?.group?.notePrompt ?? '').trim()) {
            patch.notePrompt = draft.prompt.trim() || null
        }
        if (draft.executorSessionId !== (group?.group?.noteSessionId ?? '')) {
            patch.noteSessionId = draft.executorSessionId || null
        }
        if (Object.keys(patch).length > 0) {
            await updateGroup(patch)
        }
    }

    const handleRefreshNote = async () => {
        setActionError(null)
        try {
            const notePrompt = group?.group?.notePrompt?.trim()
            await refreshNote({ source: 'user:web', ...(notePrompt ? { command: notePrompt } : {}) })
        } catch (err) {
            setActionError(err instanceof Error ? err.message : t('groups.note.generateFailed'))
        }
    }

    const handleBroadcastNote = async () => {
        if (!note?.content) return

        setActionError(null)
        try {
            await broadcastNote()
        } catch (err) {
            setActionError(err instanceof Error ? err.message : t('groups.note.broadcastFailed'))
        }
    }

    const closeMemberSheetsThen = (action: () => void) => {
        setMemberActionSessionId(null)
        setInfoOpen(false)
        action()
    }

    const handleConfirmRemoveMember = async () => {
        const targetSessionId = memberRemoveTarget?.sessionId
        if (!targetSessionId) {
            throw new Error(t('groups.member.unavailable'))
        }
        await removeMember(targetSessionId)
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
            setPendingQuickActionError(err instanceof Error ? err.message : t('groups.pending.approveFailed'))
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
            setPendingQuickActionError(err instanceof Error ? err.message : t('groups.pending.denyFailed'))
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
                <LoadingState label={t('groups.loading')} className="text-[15px]" />
            </div>
        )
    }

    if (!group || groupError) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-[15px] text-[var(--social-fg-muted)]">
                {groupError ?? t('groups.notFound')}
            </div>
        )
    }

    const openSession = (sessionId: string) => {
        navigate({ to: '/sessions/$sessionId', params: { sessionId } })
    }
    const memberActionSession = memberActionMember?.sessionId ? sessionMap.get(memberActionMember.sessionId) : undefined

    const timeline = viewMode === 'brief' ? (
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
                onOpenSession={openSession}
            />
        ) : (
            <div className="flex h-full items-center justify-center text-[15px] text-[var(--social-fg-muted)]">
                {t('groups.unavailable')}
            </div>
        )
    ) : /* CLI mode falls through to Normal rendering below.
         The groups page uses GroupTimelineMessage[] (multi-session interleaved
         messages) which is incompatible with the ChatBlock[] model that CliThread
         expects. A dedicated groups-to-ChatBlock adapter would be needed to
         support CliThread here. */ messagesLoading && visibleMessages.length === 0 ? (
        <div className="flex h-full items-center justify-center">
            <LoadingState label={t('groups.timeline.loading')} className="text-[15px]" />
        </div>
    ) : visibleMessages.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 px-8 text-center">
            <div className="text-[15px] font-semibold text-[var(--social-fg)]">{t('groups.timeline.emptyTitle')}</div>
            <div className="text-[13px] text-[var(--social-fg-muted)]">{t('groups.timeline.emptyHint')}</div>
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
                Footer: () => <div className="h-3" />
            }}
            itemContent={(index, message) => (
                <TimelineBubble
                    key={message.id}
                    message={message}
                    previous={visibleMessages[index - timelineFirstItemIndex - 1]}
                    sessionMap={sessionMap}
                    onOpenSession={openSession}
                    onQuote={handleQuoteMessage}
                    taskStates={message.type === 'command' && message.traceId
                        ? taskStateMap.get(message.traceId)
                        : undefined
                    }
                />
            )}
        />
    )

    const quotedPreview = quotedMessage ? (
        <div className="flex items-start gap-2 border-l-2 border-[var(--social-fg-subtle)] pl-2.5">
            <span className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--social-fg-muted)]">
                <span className="font-semibold text-[var(--social-fg)]">
                    {t('groups.composer.replyingTo', {
                        name: quotedMessage.actorName
                            || getSessionTitle(sessionMap.get(getActorSessionId(quotedMessage) ?? ''), {
                                fallbackSessionId: getActorSessionId(quotedMessage) ?? undefined,
                                fallbackIdLength: 12
                            })
                            || t('groups.message.unknownActor')
                    })}
                </span>
                <span className="line-clamp-2 break-all">{truncateText(extractBubbleText(quotedMessage), 96)}</span>
            </span>
            <IconButton
                size="sm"
                label={t('groups.detail.cancelReply')}
                onClick={() => setQuotedMessage(null)}
                className={cn('-my-2 -mr-1.5', HIT_AREA_CLASS)}
            >
                <CloseIcon className="h-3.5 w-3.5" />
            </IconButton>
        </div>
    ) : null

    const attachButton = (compact: boolean) => (
        <IconButton
            variant={compact ? 'ghost' : 'muted'}
            size={compact ? 'sm' : 'default'}
            label={uploadSessionId ? t('mobile.composer.attach') : t('groups.composer.noUploader')}
            onClick={openAttachmentPicker}
            disabled={isPending || !uploadSessionId}
        >
            <PaperclipIcon className="h-[18px] w-[18px]" />
        </IconButton>
    )

    const sendButton = (compact: boolean) => (
        <IconButton
            type="submit"
            variant="filled"
            size={compact ? 'sm' : 'default'}
            label={t('composer.send')}
            disabled={!canSendComposer}
        >
            {isPending ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" />
            ) : (
                <SendArrowIcon className="h-[18px] w-[18px]" />
            )}
        </IconButton>
    )

    const composerTextarea = (className: string) => (
        <textarea
            ref={composerRef}
            value={composer}
            onChange={handleComposerChange}
            onPaste={handleComposerPaste}
            onKeyDown={handleComposerKeyDown}
            placeholder={t('groups.detail.composerPlaceholder')}
            aria-label={t('groups.detail.composerPlaceholder')}
            rows={1}
            className={cn('app-scrollbar block w-full resize-none bg-transparent text-[16px] leading-[22px] text-[var(--social-fg)] placeholder-[var(--social-fg-subtle)] outline-none', className)}
        />
    )

    const composerOverlays = (
        <>
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
            {actionError ? (
                <div className="px-4 pb-1.5 pt-2 text-[13px] text-[var(--social-danger)]">{actionError}</div>
            ) : null}
        </>
    )

    // Same composer as one-to-one chats: a pill with attach / send on phones, a card on desktop.
    const composerArea = isMobileLayout ? (
        <div
            className="social-bar relative z-10 shrink-0 border-t border-[var(--social-border)]"
            style={{ paddingBottom: 'max(var(--safe-bottom), 0.5rem)' }}
        >
            <form onSubmit={(e) => { void handleSend(e) }} className="relative mx-auto w-full max-w-content">
                {composerOverlays}
                <ComposerAttachmentList
                    attachments={composerAttachments}
                    disabled={isPending}
                    onRemove={removeComposerAttachment}
                    className="px-3 pt-2"
                />
                {quotedPreview ? <div className="px-4 pt-2">{quotedPreview}</div> : null}
                <div className="flex items-end gap-2 px-3 pt-2">
                    {attachButton(false)}
                    <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)] px-4 py-[10px] transition-colors focus-within:border-[var(--social-fg-subtle)]">
                        {composerTextarea('max-h-[132px] min-h-[22px]')}
                    </div>
                    {sendButton(false)}
                </div>
            </form>
        </div>
    ) : (
        <div className="shrink-0 bg-[var(--social-surface)] px-6 pb-5 pt-1">
            <form onSubmit={(e) => { void handleSend(e) }} className="relative mx-auto w-full max-w-content">
                {composerOverlays}
                <div className="relative overflow-hidden rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)] shadow-[var(--shadow-card)] transition-colors focus-within:border-[var(--social-fg-subtle)]">
                    <ComposerAttachmentList
                        attachments={composerAttachments}
                        disabled={isPending}
                        onRemove={removeComposerAttachment}
                        className="px-4 pt-3"
                    />
                    {quotedPreview ? <div className="px-4 pt-3">{quotedPreview}</div> : null}
                    <div className="px-4 pt-3">
                        {composerTextarea('max-h-[220px] min-h-[44px]')}
                    </div>
                    <div className="flex items-center gap-0.5 px-2 pb-2 pt-1">
                        {attachButton(true)}
                        <div className="ml-auto flex shrink-0 items-center pl-2">
                            {sendButton(true)}
                        </div>
                    </div>
                </div>
            </form>
        </div>
    )

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
            {pendingMembers.length > 0 ? (
                <PendingBanner items={pendingMembers} onOpen={handleOpenPendingQuickModal} />
            ) : null}

            <div className="social-chat min-h-0 flex-1">
                {timeline}
            </div>

            {composerArea}

            <GroupInfoSheet
                open={infoOpen}
                onOpenChange={setInfoOpen}
                groupId={groupId}
                name={group.group.name}
                description={group.group.description?.trim() || null}
                members={members}
                sessionMap={sessionMap}
                note={note ? { content: note.content ?? '', version: note.version } : null}
                viewMode={viewMode}
                onViewModeChange={setViewMode}
                isPending={isPending}
                onOpenMember={openSession}
                onMemberMore={setMemberActionSessionId}
                onAddMember={() => setShowAddMember(true)}
                onEditNote={() => setNoteEditorOpen(true)}
                onGenerateNote={() => { void handleRefreshNote() }}
                onBroadcastNote={() => { void handleBroadcastNote() }}
            />

            <MemberActionsSheet
                member={memberActionMember}
                session={memberActionSession}
                onOpenChange={(open) => {
                    if (!open) setMemberActionSessionId(null)
                }}
                onOpenSession={() => {
                    const sessionId = memberActionMember?.sessionId
                    if (sessionId) closeMemberSheetsThen(() => openSession(sessionId))
                }}
                onHandlePending={() => {
                    const sessionId = memberActionMember?.sessionId
                    if (sessionId) closeMemberSheetsThen(() => handleOpenPendingQuickModal(sessionId))
                }}
                onRemove={() => {
                    const sessionId = memberActionMember?.sessionId
                    if (sessionId) closeMemberSheetsThen(() => setMemberRemoveSessionId(sessionId))
                }}
            />

            <NoteEditorSheet
                open={noteEditorOpen}
                onOpenChange={setNoteEditorOpen}
                loading={noteLoading}
                initial={{
                    content: note?.content ?? '',
                    prompt: group.group.notePrompt ?? '',
                    executorSessionId: group.group.noteSessionId ?? ''
                }}
                executorOptions={noteExecutorOptions}
                isPending={isPending}
                onSave={handleSaveNote}
            />

            <ConfirmDialog
                isOpen={Boolean(memberRemoveTarget)}
                onClose={() => {
                    setMemberRemoveSessionId(null)
                    setMemberActionSessionId(null)
                }}
                title={t('groups.member.remove')}
                description={t('groups.member.removeConfirm', { name: memberRemoveTarget?.title ?? '' })}
                confirmLabel={t('groups.member.removeShort')}
                confirmingLabel={t('groups.member.removing')}
                onConfirm={handleConfirmRemoveMember}
                isPending={isPending}
                destructive
            />

            <PendingRequestsSheet
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
                    if (pendingQuickSessionId) void refreshPendingQuickContext(pendingQuickSessionId)
                }}
                onOpenSession={() => {
                    if (pendingQuickSessionId) openSession(pendingQuickSessionId)
                }}
                onClose={handleClosePendingQuickModal}
            />

            <AddMemberSheet
                open={showAddMember}
                existingMemberSessionIds={existingMemberSessionIds}
                onAdd={addMember}
                onClose={() => setShowAddMember(false)}
                isPending={isPending}
            />
        </div>
    )
}
