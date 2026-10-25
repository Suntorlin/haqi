import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { AttachmentMetadata, ClaudeAccountSelection, ClaudeAccountPoolView, MachineLoad } from '@hapi/protocol/schemas'
import { ClaudeAccountPoolSchema } from '@hapi/protocol/schemas'
/**
 * Sync Engine for HAPI Telegram Bot (Direct Connect)
 *
 * In the direct-connect architecture:
 * - hapi-hub is the hub (Socket.IO + REST)
 * - hapi CLI connects directly to the hub (no relay)
 * - No E2E encryption; data is stored as JSON in SQLite
 */

import { inferClaudeModelModeFromModel, isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import type { DecryptedMessage, ModelMode, PermissionMode, Session, SyncEvent } from '@hapi/protocol/types'
import type { Server } from 'socket.io'
import type { PreviewUrlHistoryEntry, Store } from '../store'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { SSEManager } from '../sse/sseManager'
import { EventPublisher, type SyncEventListener } from './eventPublisher'
import { GroupService, type GroupWithDetails } from './groupService'
import { ReviewLoopService, type ReviewLoopWithRounds, type ReviewVerdictInput } from './reviewLoopService'
import { MachineCache, type Machine, type MachineSettingsPatch, type RegisterRunnerResult } from './machineCache'
import { MachineOfflineMonitor } from './machineOfflineMonitor'
import { MessageService } from './messageService'
import {
    type RpcCodexCredentialExportRpcResponse,
    type RpcCodexCredentialStateResponse,
    type RpcCodexQueueState,
    type RpcCodexQueueResponse,
    type RpcCodexStatusResponse,
    type RpcMcpServersResponse,
    RpcGateway,
    type RpcCommandResponse,
    type RpcDeleteUploadResponse,
    type RpcListDirectoryResponse,
    type RpcPathExistsResponse,
    type RpcReadFileResponse,
    type RpcUploadFileResponse
} from './rpcGateway'
import { MachineProbeService } from './machineProbeService'
import { SessionCache } from './sessionCache'
import { MemoryService, type MemoryNotice } from '../memory/service'
import { TaskService, type TaskSession, type TaskSessionSettings } from '../tasks/taskService'
import { ACCOUNT_NOTE, SCHEDULE_TICK_MS, ScheduleService, type ScheduleAlert, type ScheduleSpawnInput, type ScheduleSpawnResult } from '../schedules/scheduleService'
import { TaskFiles, type TaskFileContent } from '../tasks/taskFiles'
import { LoadService } from '../tasks/loadService'
import { sessionActivity } from '../tasks/sessionActivity'
import { resolveJevApiKey } from '../memory/jev'
import { configuration } from '../configuration'
import { readSettings } from '../config/settings'

export type { Session, SyncEvent } from '@hapi/protocol/types'
export type { Machine } from './machineCache'
export type { SyncEventListener } from './eventPublisher'
export type {
    RpcCodexCredentialExportRpcResponse,
    RpcCodexCredentialStateResponse,
    RpcCodexQueueResponse,
    RpcCodexStatusResponse,
    RpcCommandResponse,
    RpcDeleteUploadResponse,
    RpcMcpServersResponse,
    RpcListDirectoryResponse,
    RpcPathExistsResponse,
    RpcReadFileResponse,
    RpcUploadFileResponse
} from './rpcGateway'

export type ResumeSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string; code: 'session_not_found' | 'access_denied' | 'no_machine_online' | 'resume_unavailable' | 'resume_failed' }

export type SpawnFromExistingSessionResult =
    | { type: 'success'; sessionId: string }
    | {
        type: 'error'
        message: string
        code: 'session_not_found' | 'access_denied' | 'no_machine_online' | 'spawn_unavailable' | 'spawn_failed' | 'history_copy_failed'
    }

type GroupRouteContext = {
    groupId: string
    taskId?: string
    traceId?: string
    source: string
    targetSessionIds?: string[]
}

type MessageEnvelope = {
    role: string
    contentType: string | null
    data: unknown
    meta: Record<string, unknown> | null
}

type MirroredPayload = {
    sessionId: string
    contentType: string
    text: string
    codexType?: string
    isCodexExecutionDetail?: boolean
    merged?: boolean
    chunkCount?: number
}

type BufferedCodexGroupMirror = {
    route: GroupRouteContext
    chunks: string[]
}

const NOTE_REFRESH_TASK_PREFIX = 'note-refresh:'
const MAX_NOTE_REFRESH_CONTENT_LENGTH = 20_000
const MAX_GROUP_MIRROR_TEXT_LENGTH = 8_000
const GROUP_NOTE_FILE_SYNC_INTERVAL_MS = 3 * 60 * 1000
const MEMORY_HARVEST_INTERVAL_MS = 15 * 60 * 1000
/** How often the task observer looks at running tasks. */
const TASK_OBSERVER_INTERVAL_MS = 20 * 1000
/** A task file's first message shows an inline preview for images up to this size; larger ones show as a file. */
const PREVIEW_MAX_BYTES = 1024 * 1024
const MEMORY_HARVEST_FIRST_DELAY_MS = 60 * 1000
const CODEX_TOOL_PROCESS_EVENT_TYPES = new Set([
    'tool-call',
    'tool-call-result',
    'reasoning',
    'reasoning-delta',
    'token_count',
    'plan-update'
])

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') {
        return null
    }
    return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
    return typeof value === 'string' ? value : null
}

function asStringArray(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
        return null
    }
    const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    return items
}

function parseRouteContext(value: unknown): GroupRouteContext | null {
    const record = asRecord(value)
    if (!record) {
        return null
    }

    const groupId = asString(record.groupId)?.trim()
    const source = asString(record.source)?.trim()
    if (!groupId || !source) {
        return null
    }

    const taskId = asString(record.taskId)?.trim()
    const traceId = asString(record.traceId)?.trim()
    const targetSessionIds = asStringArray(record.targetSessionIds) ?? undefined

    return {
        groupId,
        ...(taskId ? { taskId } : {}),
        ...(traceId ? { traceId } : {}),
        source,
        ...(targetSessionIds ? { targetSessionIds } : {})
    }
}

function parseMessageEnvelope(content: unknown): MessageEnvelope | null {
    const root = asRecord(content)
    if (!root) {
        return null
    }

    const role = asString(root.role)?.trim()
    if (!role) {
        return null
    }

    const messageContent = asRecord(root.content)
    const contentType = messageContent ? asString(messageContent.type) : null
    const data = messageContent ? messageContent.data : undefined
    const meta = asRecord(root.meta)

    return {
        role,
        contentType,
        data,
        meta
    }
}

function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text
    }
    return `${text.slice(0, maxLength)}...`
}

function extractClaudeText(
    data: unknown,
    options: { allowSummary?: boolean } = {}
): string | null {
    const record = asRecord(data)
    if (!record) {
        return null
    }
    const type = asString(record.type)
    if (type === 'summary') {
        if (!options.allowSummary) {
            // Summary payloads are metadata updates (e.g. title sync), not timeline chat content.
            return null
        }
        const summary = asString(record.summary)?.trim()
        return summary && summary.length > 0 ? summary : null
    }
    if (type !== 'assistant') {
        return null
    }

    const message = asRecord(record.message)
    const content = message?.content
    if (typeof content === 'string') {
        const text = content.trim()
        return text.length > 0 ? text : null
    }
    if (!Array.isArray(content)) {
        return null
    }

    const texts: string[] = []
    for (const block of content) {
        const item = asRecord(block)
        if (!item || item.type !== 'text') {
            continue
        }
        const text = asString(item.text)?.trim()
        if (text) {
            texts.push(text)
        }
    }

    if (texts.length === 0) {
        return null
    }
    return texts.join('\n')
}

function extractCodexText(data: unknown): string | null {
    const record = asRecord(data)
    if (!record) {
        return null
    }
    const type = asString(record.type)
    if (!type) {
        return null
    }

    const message = asString(record.message)?.trim()
    if (message && message.length > 0) {
        return message
    }
    const error = asString(record.error)?.trim()
    if (error && error.length > 0) {
        return `${type}: ${error}`
    }
    return null
}

function isCodexExecutionDetailText(text: string): boolean {
    const normalized = text.trim().toLowerCase()
    if (!normalized) {
        return true
    }

    const isTitleToolProgress = /\b(changing|updating|setting|calling|initiating)\b.*\b(task title|chat title|session title|title change|change_title)\b/.test(normalized)
        || /\b(task title|chat title|session title|title change|change_title)\b.*\b(changing|updating|setting|calling|initiating)\b/.test(normalized)
        || normalized.includes('change_title')

    return normalized.startsWith('[model rerouted]')
        || normalized.startsWith('[context compacted]')
        || normalized === 'starting task...'
        || normalized === 'task completed'
        || normalized === 'turn aborted'
        || normalized.startsWith('task failed')
        || normalized.startsWith('title changed')
        || normalized.startsWith('title updated')
        || normalized.startsWith('chat title changed')
        || normalized.startsWith('session title changed')
        || isTitleToolProgress
}

function isTitleMutationNoiseText(text: string): boolean {
    const normalized = text.trim().toLowerCase()
    if (!normalized) {
        return false
    }

    return normalized.startsWith('title changed')
        || normalized.startsWith('title updated')
        || normalized.startsWith('chat title changed')
        || normalized.startsWith('session title changed')
        || normalized.startsWith('successfully changed chat title')
        || normalized.startsWith('failed to change chat title')
}

function isCodexToolProcessEventType(type: string): boolean {
    return CODEX_TOOL_PROCESS_EVENT_TYPES.has(type)
}

function extractCodexMirrorPayload(data: unknown): {
    text: string
    codexType: string
    isCodexExecutionDetail: boolean
} | null {
    const record = asRecord(data)
    if (!record) {
        return null
    }

    const codexType = asString(record.type)
    if (!codexType) {
        return null
    }
    if (isCodexToolProcessEventType(codexType)) {
        return null
    }

    const message = asString(record.message)?.trim()
    if (message && message.length > 0) {
        return {
            text: message,
            codexType,
            isCodexExecutionDetail: codexType !== 'message' || isCodexExecutionDetailText(message)
        }
    }

    const error = asString(record.error)?.trim()
    if (error && error.length > 0) {
        return {
            text: `${codexType}: ${error}`,
            codexType,
            isCodexExecutionDetail: true
        }
    }

    return null
}

function isReadyEvent(envelope: MessageEnvelope): boolean {
    if (envelope.contentType !== 'event') {
        return false
    }
    const eventData = asRecord(envelope.data)
    return asString(eventData?.type) === 'ready'
}

function buildMirroredPayload(
    sessionId: string,
    envelope: MessageEnvelope,
    route?: GroupRouteContext
): MirroredPayload | null {
    const contentType = envelope.contentType
    if (!contentType) {
        return null
    }

    let text: string | null = null
    let codexType: string | undefined
    let isCodexExecutionDetail: boolean | undefined
    if (contentType === 'output') {
        text = extractClaudeText(envelope.data, {
            allowSummary: isNoteRefreshTaskId(route?.taskId)
        })
    } else if (contentType === 'codex') {
        const codexPayload = extractCodexMirrorPayload(envelope.data)
        if (!codexPayload) {
            return null
        }
        text = codexPayload.text
        codexType = codexPayload.codexType
        isCodexExecutionDetail = codexPayload.isCodexExecutionDetail
    } else if (contentType === 'event') {
        const eventData = asRecord(envelope.data)
        if (asString(eventData?.type) !== 'message') {
            return null
        }
        text = asString(eventData?.message)?.trim() ?? null
    }

    if (!text || text.length === 0) {
        return null
    }

    return {
        sessionId,
        contentType,
        text: truncateText(text, MAX_GROUP_MIRROR_TEXT_LENGTH),
        ...(codexType ? { codexType } : {}),
        ...(isCodexExecutionDetail !== undefined ? { isCodexExecutionDetail } : {})
    }
}

function isNoteRefreshTaskId(taskId: string | undefined): boolean {
    return typeof taskId === 'string' && taskId.startsWith(NOTE_REFRESH_TASK_PREFIX)
}

function stripMarkdownCodeFence(content: string): string {
    const trimmed = content.trim()
    const fenced = trimmed.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i)
    if (!fenced) {
        return trimmed
    }
    const inner = fenced[1]?.trim()
    return inner && inner.length > 0 ? inner : trimmed
}

function normalizeNoteRefreshContent(content: string): string {
    const normalized = stripMarkdownCodeFence(content).trim()
    if (!normalized) {
        return ''
    }
    return truncateText(normalized, MAX_NOTE_REFRESH_CONTENT_LENGTH)
}

function shouldSkipAutoApproveForTool(toolName: unknown): boolean {
    if (typeof toolName !== 'string') {
        return false
    }

    const normalized = toolName.trim().toLowerCase()
    return normalized === 'exitplanmode'
        || normalized === 'exit_plan_mode'
        || normalized === 'request_user_input'
        || normalized === 'requestuserinput'
        || normalized === 'askuserquestion'
        || normalized === 'ask_user_question'
}

type PermissionApprovalSource = 'user' | 'auto';

function isManualApprovalRequiredTool(toolName: unknown): boolean {
    if (typeof toolName !== 'string') {
        return false;
    }

    const normalized = toolName.trim().toLowerCase();
    return normalized === 'exitplanmode' || normalized === 'exit_plan_mode';
}

const YOLO_PERMISSION_MODES: ReadonlySet<string> = new Set(['yolo', 'bypassPermissions', 'auto-approve'])

/** The permission mode the CLI ends up in when it is started with --yolo (Codex: --auto-approve). */
function yoloPermissionModeForFlavor(flavor: string): PermissionMode {
    if (flavor === 'claude') return 'bypassPermissions'
    if (flavor === 'codex') return 'auto-approve'
    return 'yolo'
}

export class SyncEngine {
    private readonly store: Store
    private readonly eventPublisher: EventPublisher
    private readonly sessionCache: SessionCache
    private readonly machineCache: MachineCache
    private readonly io: Server
    /** Always-on machines that stay offline: alert on every channel. HAPI_MACHINE_OFFLINE_ALERT_MINUTES=0 turns it off. */
    private readonly machineOfflineMonitor = new MachineOfflineMonitor(
        Number(process.env.HAPI_MACHINE_OFFLINE_ALERT_MINUTES ?? 5) * 60_000
    )
    private readonly messageService: MessageService
    private readonly groupService: GroupService
    private readonly reviewLoopService: ReviewLoopService
    private readonly rpcGateway: RpcGateway
    /** Repositories on the online machines, read from the folders sessions ran in. */
    readonly machineProbe: MachineProbeService
    private readonly autoApprovalInFlight: Set<string> = new Set()
    private readonly activeGroupRoutesBySession: Map<string, GroupRouteContext> = new Map()
    // Routes registered at queue-dispatch time for flavors (claude/gemini) that don't
    // echo routeContext in their user-message echo. Prevents the echo from clearing the route.
    private readonly queuePendingRoutes: Map<string, GroupRouteContext> = new Map()
    private readonly bufferedCodexMirrorsBySession: Map<string, BufferedCodexGroupMirror> = new Map()
    private readonly pendingNoteRefreshDraftByTaskKey: Map<string, string> = new Map()
    private readonly pendingNoteRefreshMirroredByTaskKey: Set<string> = new Set()
    private readonly localQueueTextBySession: Map<string, Map<string, string>> = new Map()
    private readonly localQueueTextBySessionPreview: Map<string, Map<string, string>> = new Map()
    private inactivityTimer: NodeJS.Timeout | null = null
    private groupNoteFileSyncTimer: NodeJS.Timeout | null = null
    private memoryHarvestTimer: NodeJS.Timeout | null = null
    private memoryHarvestKickoff: NodeJS.Timeout | null = null
    private readonly memoryService: MemoryService
    private readonly taskService: TaskService
    private readonly loadService: LoadService
    private memoryNotifier: ((namespace: string, notice: MemoryNotice) => Promise<void>) | null = null
    private pushNotifier: ((namespace: string, notice: { title: string; body: string; url: string; tag: string }) => Promise<void>) | null = null
    private reportShareBase: string | null = null
    private alertNotifier: ((namespace: string, alert: ScheduleAlert) => Promise<void>) | null = null
    private taskObserverTimer: NodeJS.Timeout | null = null
    private readonly scheduleService: ScheduleService
    private scheduleTimer: NodeJS.Timeout | null = null

    constructor(
        store: Store,
        io: Server,
        rpcRegistry: RpcRegistry,
        sseManager: SSEManager
    ) {
        this.store = store
        this.io = io
        this.eventPublisher = new EventPublisher(sseManager, (event) => this.resolveNamespace(event))
        this.sessionCache = new SessionCache(store, this.eventPublisher)
        this.machineCache = new MachineCache(store, this.eventPublisher)
        this.messageService = new MessageService(store, io, this.eventPublisher)
        this.groupService = new GroupService(
            store,
            this.eventPublisher,
            async (payload) => this.dispatchGroupTask(payload),
            async (payload) => this.executeNoteRefresh(payload),
            (sessionId, namespace) => {
                const session = this.getSessionByNamespace(sessionId, namespace)
                if (!session) {
                    return null
                }
                return { active: session.active }
            }
        )
        this.reviewLoopService = new ReviewLoopService(
            store,
            this.eventPublisher,
            async (payload) => this.dispatchReviewLoopToWorker(payload),
            async (payload) => this.dispatchReviewLoopToReviewer(payload),
            async (payload) => this.notifyReviewLoopUser(payload)
        )
        this.rpcGateway = new RpcGateway(io, rpcRegistry)
        this.machineProbe = new MachineProbeService({
            machines: (namespace) => this.machineCache.getOnlineMachinesByNamespace(namespace)
                .map((machine) => ({ id: machine.id, repos: machine.metadata?.repos })),
            sessions: (namespace) => this.getSessionsByNamespace(namespace)
                .map((session) => ({ machineId: session.metadata?.machineId ?? null, path: session.metadata?.path ?? null, updatedAt: session.updatedAt })),
            probe: (machineId, request) => this.rpcGateway.probeMachine(machineId, request)
        })
        this.reloadAll()
        this.syncGroupNoteMarkdownFiles()
        this.inactivityTimer = setInterval(() => this.expireInactive(), 5_000)
        this.groupNoteFileSyncTimer = setInterval(
            () => this.syncGroupNoteMarkdownFiles(),
            GROUP_NOTE_FILE_SYNC_INTERVAL_MS
        )
        this.memoryService = new MemoryService(store, {
            paths: () => ({ dataDir: configuration.dataDir, settingsFile: configuration.settingsFile }),
            onChange: (namespace) => this.eventPublisher.emit({ type: 'memories-updated', namespace }),
            notify: async (namespace, notice) => { await this.memoryNotifier?.(namespace, notice) }
        })
        this.loadService = new LoadService(store, {
            jevKey: async () => resolveJevApiKey((await this.memoryService.getSettings()).jevApiKey),
            goals: (namespace) => {
                const goals = new Map<string, string>()
                for (const task of this.taskService.list(namespace)) {
                    if (!task.goal) continue
                    for (const member of task.members) goals.set(member.sessionId, task.goal)
                }
                return goals
            }
        })
        this.taskService = new TaskService(store, this.memoryService, {
            planner: {
                spawnAndPrompt: async (input) => {
                    const task = this.taskSpawn(input.meta, input.machineId)
                    const result = await this.spawnAndPrompt(input.machineId, input.directory, task.options({}), task.prompt(input))
                    if (result.type === 'error') return { error: result.message }
                    await this.renameSession(result.sessionId, input.name).catch(() => {})
                    await this.setSessionTags(result.sessionId, input.tags).catch(() => {})
                    return { sessionId: result.sessionId }
                },
                send: async (sessionId, text, meta) => {
                    if (!this.getSession(sessionId)?.active) return false
                    await this.sendMessage(sessionId, { text, sentFrom: 'webapp', meta })
                    return true
                }
            },
            session: (namespace, sessionId) => {
                const session = this.getSessionByNamespace(sessionId, namespace)
                return session ? toTaskSession(session) : null
            },
            sessions: (namespace) => this.getSessionsByNamespace(namespace).map(toTaskSession),
            machineOnline: (namespace, machineId) => this.machineCache.getOnlineMachinesByNamespace(namespace).some((machine) => machine.id === machineId),
            machinePortable: (namespace, machineId) => this.machineCache.getMachineByNamespace(machineId, namespace)?.metadata?.role === 'portable',
            changed: (namespace, taskId) => this.eventPublisher.emit({ type: 'task-updated', namespace, groupId: taskId }),
            files: new TaskFiles(() => join(configuration.dataDir, 'task-files')),
            stopSession: async (_namespace, sessionId) => { await this.archiveSession(sessionId) },
            run: {
                spawnWorker: async (input) => {
                    const task = this.taskSpawn(input.meta, input.machineId)
                    const result = await this.spawnAndPrompt(input.machineId, input.directory, task.options({
                        yolo: true, sessionType: input.worktreeName ? 'worktree' : 'simple', worktreeName: input.worktreeName
                    }), task.prompt(input))
                    if (result.type === 'error') return { error: result.message }
                    await this.renameSession(result.sessionId, input.name).catch(() => {})
                    await this.setSessionTags(result.sessionId, input.tags).catch(() => {})
                    return { sessionId: result.sessionId }
                },
                spawnLead: async (input) => {
                    const task = this.taskSpawn(input.meta, input.machineId)
                    const result = await this.spawnAndPrompt(input.machineId, input.directory, task.options({}), task.prompt(input))
                    if (result.type === 'error') return { error: result.message }
                    await this.renameSession(result.sessionId, input.name).catch(() => {})
                    await this.setSessionTags(result.sessionId, input.tags).catch(() => {})
                    return { sessionId: result.sessionId }
                },
                send: async (sessionId, text, meta) => {
                    if (!this.getSession(sessionId)?.active) return false
                    await this.sendMessage(sessionId, { text, sentFrom: 'webapp', meta })
                    return true
                },
                resume: async (namespace, sessionId) => {
                    const result = await this.resumeSession(sessionId, namespace)
                    return result.type === 'success' ? result.sessionId : null
                },
                session: (namespace, sessionId) => {
                    const session = this.getSessionByNamespace(sessionId, namespace)
                    if (!session) return null
                    const worktree = session.metadata?.worktree
                    return {
                        id: session.id,
                        active: session.active,
                        thinking: session.thinking,
                        path: session.metadata?.path ?? null,
                        worktree: worktree ? { branch: worktree.branch, path: worktree.worktreePath ?? session.metadata?.path ?? null } : null,
                        pendingRequests: Object.entries(session.agentState?.requests ?? {}).map(([id, request]) => {
                            const args = request.arguments as { command?: unknown; file_path?: unknown } | null
                            const detail = typeof args?.command === 'string' ? args.command : typeof args?.file_path === 'string' ? args.file_path : ''
                            return { id, tool: request.tool, detail: detail.slice(0, 200), args: request.arguments }
                        })
                    }
                },
                activity: (sessionId, since) => sessionActivity(this.store.messages.getMessages(sessionId, 60), since),
                approve: async (sessionId, requestId) => { await this.approvePermission(sessionId, requestId, undefined, undefined, 'approved', undefined, undefined, 'auto') },
                push: async (namespace, notice) => { await this.pushNotifier?.(namespace, { ...notice, tag: `task:${notice.url}` }) },
                createReport: (namespace, input) => {
                    const report = this.store.reports.createReport({ namespace, title: input.title, markdown: input.markdown, status: 'final' })
                    const share = this.store.reports.createShare({ reportId: report.id, namespace, createdBy: 'system:task' })
                    return { shareUrl: this.reportShareBase ? `${this.reportShareBase}/share/r/${encodeURIComponent(share.token)}` : null }
                }
            },
            timeline: (namespace, taskId, text, extra) => {
                void this.groupService.addTimelineMessage({ groupId: taskId, namespace, type: 'system', source: 'system:task', payload: { text, ...extra } })
                    .catch((error) => console.error('[Tasks] timeline line failed', error))
            },
            load: (namespace, sessionIds, since) => this.loadService.taskLoad(namespace, sessionIds, since)
        })
        this.scheduleService = new ScheduleService(store, {
            spawn: (input) => this.spawnScheduledRun(input),
            session: (namespace, sessionId) => {
                const session = this.getSessionByNamespace(sessionId, namespace)
                if (!session) return null
                return {
                    active: session.active,
                    thinking: session.thinking,
                    pendingRequests: Object.keys(session.agentState?.requests ?? {}).length
                }
            },
            lastActivity: (sessionId) => {
                const last = sessionActivity(this.store.messages.getMessages(sessionId, 20), 0).lastMessageAt
                return last > 0 ? last : null
            },
            machineOnline: (namespace, machineId) => this.machineCache.getOnlineMachinesByNamespace(namespace).some((machine) => machine.id === machineId),
            archive: async (sessionId) => { await this.archiveSession(sessionId) },
            changed: (namespace, scheduleId) => this.eventPublisher.emit({ type: 'schedule-updated', namespace, scheduleId }),
            alert: async (namespace, alert) => {
                if (this.alertNotifier) {
                    await this.alertNotifier(namespace, alert)
                } else {
                    await this.pushNotifier?.(namespace, { title: alert.title, body: alert.body, url: alert.url, tag: `schedule:${alert.url}` })
                }
            }
        })
        if (store.getDatabasePath() !== ':memory:') {
            this.scheduleTimer = setInterval(() => {
                void this.scheduleService.tick().catch((error: unknown) => console.warn('[Schedules] tick failed', error))
            }, SCHEDULE_TICK_MS)
            this.memoryHarvestKickoff = setTimeout(() => this.harvestMemories(), MEMORY_HARVEST_FIRST_DELAY_MS)
            this.memoryHarvestTimer = setInterval(() => this.harvestMemories(), MEMORY_HARVEST_INTERVAL_MS)
            this.taskObserverTimer = setInterval(() => this.observeTasks(), TASK_OBSERVER_INTERVAL_MS)
        }
    }

    getMemoryService(): MemoryService {
        return this.memoryService
    }

    getTaskService(): TaskService {
        return this.taskService
    }

    getScheduleService(): ScheduleService {
        return this.scheduleService
    }

    getLoadService(): LoadService {
        return this.loadService
    }

    /** The hub hands in push delivery once it exists; the engine is created first. */
    setMemoryNotifier(notifier: (namespace: string, notice: MemoryNotice) => Promise<void>): void {
        this.memoryNotifier = notifier
    }

    /** Push to the user's devices; the task run uses it when the user has to step in. */
    setPushNotifier(notifier: (namespace: string, notice: { title: string; body: string; url: string; tag: string }) => Promise<void>): void {
        this.pushNotifier = notifier
    }

    /** Scheduled-run results: a failure goes to every channel (push, Telegram, webhook), a success to push only. */
    setAlertNotifier(notifier: (namespace: string, alert: ScheduleAlert) => Promise<void>): void {
        this.alertNotifier = notifier
    }

    /** Public base URL of report share links (task reports). */
    setReportShareBase(base: string): void {
        this.reportShareBase = base.replace(/\/$/, '')
    }

    private observeTasks(): void {
        const runs = this.taskService.runs
        if (!runs) return
        for (const namespace of this.store.groups.getActiveTaskNamespaces()) {
            void runs.tick(namespace).catch((error: unknown) => console.warn('[Tasks] observer failed', error))
        }
    }

    private harvestMemories(): void {
        void this.memoryService.harvestClaude()
            .then(() => this.memoryService.readUserMessages())
            .then(() => this.memoryService.maintain())
            .then(() => this.loadService.classifyRecent())
            .catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(`[SyncEngine] Memory harvest failed: ${message}`)
            })
    }

    stop(): void {
        if (this.inactivityTimer) {
            clearInterval(this.inactivityTimer)
            this.inactivityTimer = null
        }
        if (this.groupNoteFileSyncTimer) {
            clearInterval(this.groupNoteFileSyncTimer)
            this.groupNoteFileSyncTimer = null
        }
        if (this.memoryHarvestKickoff) {
            clearTimeout(this.memoryHarvestKickoff)
            this.memoryHarvestKickoff = null
        }
        if (this.memoryHarvestTimer) {
            clearInterval(this.memoryHarvestTimer)
            this.memoryHarvestTimer = null
        }
        if (this.taskObserverTimer) {
            clearInterval(this.taskObserverTimer)
            this.taskObserverTimer = null
        }
        if (this.scheduleTimer) {
            clearInterval(this.scheduleTimer)
            this.scheduleTimer = null
        }
    }

    subscribe(listener: SyncEventListener): () => void {
        return this.eventPublisher.subscribe(listener)
    }

    private resolveNamespace(event: SyncEvent): string | undefined {
        if (event.namespace) {
            return event.namespace
        }
        if ('sessionId' in event) {
            return this.getSession(event.sessionId)?.namespace
        }
        if ('machineId' in event) {
            return this.machineCache.getMachine(event.machineId)?.namespace
        }
        if ('groupId' in event) {
            return this.store.groups.getGroup(event.groupId)?.namespace
        }
        return undefined
    }

    getSessions(): Session[] {
        return this.sessionCache.getSessions()
    }

    getSessionsByNamespace(namespace: string): Session[] {
        return this.sessionCache.getSessionsByNamespace(namespace)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId) ?? undefined
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessionCache.getSessionByNamespace(sessionId, namespace)
            ?? this.sessionCache.refreshSession(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    resolveSessionAccess(
        sessionId: string,
        namespace: string
    ): { ok: true; sessionId: string; session: Session } | { ok: false; reason: 'not-found' | 'access-denied' } {
        return this.sessionCache.resolveSessionAccess(sessionId, namespace)
    }

    getActiveSessions(): Session[] {
        return this.sessionCache.getActiveSessions()
    }

    getMachines(): Machine[] {
        return this.machineCache.getMachines()
    }

    getMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getMachinesByNamespace(namespace)
    }

    getMachine(machineId: string): Machine | undefined {
        return this.machineCache.getMachine(machineId)
    }

    getMachineByNamespace(machineId: string, namespace: string): Machine | undefined {
        return this.machineCache.getMachineByNamespace(machineId, namespace)
    }

    getOnlineMachines(): Machine[] {
        return this.machineCache.getOnlineMachines()
    }

    getOnlineMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getOnlineMachinesByNamespace(namespace)
    }

    getGroupsByNamespace(namespace: string): GroupWithDetails[] {
        return this.groupService.getGroupsByNamespace(namespace)
    }

    getGroupByNamespace(groupId: string, namespace: string): GroupWithDetails | null {
        return this.groupService.getGroupByNamespace(groupId, namespace)
    }

    createGroup(options: {
        namespace: string
        name: string
        description?: string | null
        noteSessionId?: string | null
        sessionMemberIds?: string[]
    }): GroupWithDetails {
        return this.groupService.createGroup(options)
    }

    getGroupMessagesPage(
        groupId: string,
        namespace: string,
        options: { limit: number; beforeSeq: number | null }
    ) {
        return this.groupService.getMessagesPage(groupId, namespace, options)
    }

    getGroupConversationTurnsPage(
        groupId: string,
        namespace: string,
        options: { limit: number; beforeTurnIndex: number | null }
    ) {
        return this.groupService.getConversationTurnsPage(groupId, namespace, options)
    }

    getGroupConversationTurnMessagesPage(
        groupId: string,
        namespace: string,
        turnId: string,
        options: { limit: number; beforeSeq: number | null }
    ) {
        return this.groupService.getConversationTurnMessagesPage(groupId, namespace, turnId, options)
    }

    async addGroupMessage(options: {
        groupId: string
        namespace: string
        type: 'chat' | 'command' | 'task_state' | 'note_state' | 'system'
        payload: unknown
        source?: string
        actorSessionId?: string | null
        actorName?: string | null
        traceId?: string | null
        taskId?: string | null
        targetSessionIds?: string[] | null
        quotedMessageId?: string | null
    }) {
        const result = await this.groupService.addTimelineMessage(options)
        await this.taskFromChat(options)
        return result
    }

    /**
     * What the user says in a task's group without an @ goes to the task, so the task page's composer always reaches
     * someone: in the guide step to the planner as a change request, while it runs to the sessions working now.
     */
    private async taskFromChat(options: { groupId: string; namespace: string; type: string; payload: unknown; source?: string; actorSessionId?: string | null }): Promise<void> {
        if (options.type !== 'chat' || options.actorSessionId || !(options.source ?? 'user:web').startsWith('user:')) return
        const text = options.payload && typeof options.payload === 'object' && typeof (options.payload as { text?: unknown }).text === 'string'
            ? (options.payload as { text: string }).text.trim()
            : ''
        if (!text) return
        const task = this.taskService.kernel.get(options.namespace, options.groupId)
        if (task?.status === 'guiding') {
            await this.taskService.revise(options.namespace, options.groupId, text)
            return
        }
        // An @ already routes the message to the named sessions.
        if (task?.status === 'active' && !/\B@[A-Za-z0-9._:-]+/.test(text)) {
            await this.taskService.runs?.userMessage(options.namespace, options.groupId, text).catch(() => {})
        }
    }

    /** A resumed session that came back under a new id takes over the old one's rows and task roles. */
    private async mergeSessions(oldSessionId: string, newSessionId: string, namespace: string): Promise<void> {
        this.taskService.sessionReplaced(namespace, oldSessionId, newSessionId)
        await this.sessionCache.mergeSessions(oldSessionId, newSessionId, namespace)
    }

    getGroupNote(groupId: string, namespace: string) {
        return this.groupService.getGroupNote(groupId, namespace)
    }

    getGroupTasks(groupId: string, namespace: string, limit?: number) {
        return this.groupService.getGroupTasks(groupId, namespace, limit)
    }

    updateGroupNote(options: {
        groupId: string
        namespace: string
        content: string
        updatedBy?: string | null
    }) {
        return this.groupService.updateGroupNote(options)
    }

    refreshGroupNote(options: {
        groupId: string
        namespace: string
        source?: string
        command?: string
    }): Promise<{ triggered: boolean; reason?: string }> {
        return this.groupService.refreshGroupNote(options)
    }

    claimGroupTask(groupId: string, taskId: string, namespace: string) {
        return this.groupService.claimTask(groupId, taskId, namespace)
    }

    doneGroupTask(groupId: string, taskId: string, namespace: string) {
        return this.groupService.doneTask(groupId, taskId, namespace)
    }

    cancelGroupTask(groupId: string, taskId: string, namespace: string) {
        return this.groupService.cancelTask(groupId, taskId, namespace)
    }

    addGroupMember(groupId: string, namespace: string, sessionId: string): GroupWithDetails {
        return this.groupService.addMember({ groupId, namespace, sessionId })
    }

    removeGroupMember(groupId: string, namespace: string, sessionId: string): GroupWithDetails {
        return this.groupService.removeMember({ groupId, namespace, sessionId })
    }

    updateGroup(options: {
        groupId: string
        namespace: string
        name?: string
        description?: string | null
        noteSessionId?: string | null
        archived?: boolean
    }): GroupWithDetails {
        const updated = this.groupService.updateGroup(options)
        // An archived task stops its sessions; the observer leaves it alone until it is brought back.
        if (options.archived && updated.group.kind === 'task') void this.taskService.archived(options.namespace, options.groupId)
        return updated
    }

    deleteGroup(namespace: string, groupId: string, actorMachineId?: string): void {
        this.groupService.deleteGroup(namespace, groupId, actorMachineId)
    }

    getMessagesPage(sessionId: string, options: { limit: number; beforeSeq: number | null }): {
        messages: DecryptedMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
        }
    } {
        return this.messageService.getMessagesPage(sessionId, options)
    }

    getMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        return this.messageService.getMessagesAfter(sessionId, options)
    }

    getConversationTurnsPage(sessionId: string, options: { limit: number; beforeTurnIndex: number | null }): {
        turns: Array<{
            id: string
            sessionId: string
            turnIndex: number
            status: 'open' | 'closed'
            userMessageId: string | null
            userSeq: number | null
            agentStartSeq: number | null
            agentEndSeq: number | null
            messageCount: number
            userPreview: string | null
            assistantPreview: string | null
            createdAt: number
            updatedAt: number
        }>
        page: {
            limit: number
            beforeTurnIndex: number | null
            nextBeforeTurnIndex: number | null
            hasMore: boolean
        }
    } {
        return this.messageService.getConversationTurnsPage(sessionId, options)
    }

    getConversationTurnMessagesPage(
        sessionId: string,
        turnId: string,
        options: { limit: number; beforeSeq: number | null }
    ): {
        turn: {
            id: string
            sessionId: string
            turnIndex: number
            status: 'open' | 'closed'
            userMessageId: string | null
            userSeq: number | null
            agentStartSeq: number | null
            agentEndSeq: number | null
            messageCount: number
            userPreview: string | null
            assistantPreview: string | null
            createdAt: number
            updatedAt: number
        }
        messages: DecryptedMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
            startSeq: number | null
            endSeq: number | null
        }
    } | null {
        return this.messageService.getConversationTurnMessagesPage(sessionId, turnId, options)
    }

    handleRealtimeEvent(event: SyncEvent): void {
        if (event.type === 'session-updated' && event.sessionId) {
            const refreshed = this.sessionCache.refreshSession(event.sessionId)
            if (refreshed?.permissionMode === 'auto-approve') {
                void this.maybeAutoApprovePendingRequests(event.sessionId)
            }
            return
        }

        if (event.type === 'machine-updated' && event.machineId) {
            this.machineCache.refreshMachine(event.machineId)
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            const session = this.getSession(event.sessionId) ?? this.sessionCache.refreshSession(event.sessionId)
            if (session) {
                this.handleGroupRoutedMessage(event.sessionId, session.namespace, event.message)
            }
        }

        this.eventPublisher.emit(event)
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        thinking?: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        modelMode?: ModelMode
    }): void {
        this.sessionCache.handleSessionAlive(payload)
        const session = this.getSession(payload.sid)
        if (session?.permissionMode === 'auto-approve') {
            void this.maybeAutoApprovePendingRequests(payload.sid)
        }
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        this.sessionCache.handleSessionEnd(payload)
        const activeRoute = this.activeGroupRoutesBySession.get(payload.sid)
        if (activeRoute) {
            this.clearPendingNoteRefreshDraft(activeRoute)
        }
        const pendingRoute = this.queuePendingRoutes.get(payload.sid)
        if (pendingRoute) {
            this.clearPendingNoteRefreshDraft(pendingRoute)
        }
        this.activeGroupRoutesBySession.delete(payload.sid)
        this.queuePendingRoutes.delete(payload.sid)
    }

    handleMachineAlive(payload: { machineId: string; time: number; load?: MachineLoad }): void {
        this.machineCache.handleMachineAlive(payload)
    }

    private expireInactive(): void {
        this.sessionCache.expireInactive()
        this.machineCache.expireInactive()
        this.alertOfflineMachines()
    }

    private alertOfflineMachines(): void {
        const now = Date.now()
        for (const alert of this.machineOfflineMonitor.check(this.machineCache.getMachines(), now)) {
            void this.alertNotifier?.(alert.namespace, {
                runId: `machine:${alert.machineId}:${now}`,
                title: alert.title,
                body: alert.body,
                url: '/settings',
                everywhere: true
            }).catch((error: unknown) => console.warn('[machines] offline alert failed', error))
        }
    }

    private syncGroupNoteMarkdownFiles(): void {
        try {
            const result = this.groupService.syncGroupNoteMarkdownFiles()
            if (result.errors > 0) {
                console.warn(
                    `[SyncEngine] Group note markdown sync completed with ${result.errors} error(s)`
                )
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`[SyncEngine] Failed to run group note markdown sync: ${message}`)
        }
    }

    private reloadAll(): void {
        this.sessionCache.reloadAll()
        this.machineCache.reloadAll()
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string): Session {
        return this.sessionCache.getOrCreateSession(tag, metadata, agentState, namespace)
    }

    getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): Machine {
        return this.machineCache.getOrCreateMachine(id, metadata, runnerState, namespace)
    }

    registerRunnerMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): RegisterRunnerResult {
        return this.machineCache.registerRunner(id, metadata, runnerState, namespace)
    }

    /** Name, role and env from the web. The runner gets the new metadata at once, so the next spawn uses the env. */
    updateMachineSettings(id: string, namespace: string, patch: MachineSettingsPatch): Machine | null {
        const machine = this.machineCache.updateSettings(id, namespace, patch)
        if (!machine) return null
        const stored = this.store.machines.getMachine(id)
        if (stored) {
            this.io.of('/cli').to(`machine:${id}`).emit('update', {
                id: randomUUID(),
                seq: Date.now(),
                createdAt: Date.now(),
                body: {
                    t: 'update-machine' as const,
                    machineId: id,
                    metadata: { version: stored.metadataVersion, value: stored.metadata },
                    runnerState: null
                }
            })
        }
        return machine
    }

    async sendMessage(
        sessionId: string,
        payload: {
            text: string
            localId?: string | null
            attachments?: Array<{
                id: string
                filename: string
                mimeType: string
                size: number
                path: string
                previewUrl?: string
            }>
            sentFrom?: 'telegram-bot' | 'webapp'
            meta?: Record<string, unknown>
        }
    ): Promise<void> {
        await this.messageService.sendMessage(sessionId, payload)
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        reason?: string,
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>,
        source: PermissionApprovalSource = 'user'
    ): Promise<void> {
        const session = this.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId);
        const request = session?.agentState?.requests?.[requestId];
        if (source !== 'user' && isManualApprovalRequiredTool(request?.tool)) {
            throw new Error(`Permission for ${String(request?.tool)} requires explicit user approval`);
        }
        await this.rpcGateway.approvePermission(sessionId, requestId, mode, allowTools, decision, reason, answers)
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        reason?: string
    ): Promise<void> {
        await this.rpcGateway.denyPermission(sessionId, requestId, decision, reason)
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.rpcGateway.abortSession(sessionId)
    }

    async stopAndPreserveCodexQueue(sessionId: string) {
        return await this.rpcGateway.stopAndPreserveCodexQueue(sessionId)
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.rpcGateway.killSession(sessionId)
        this.handleSessionEnd({ sid: sessionId, time: Date.now() })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.rpcGateway.switchSession(sessionId, to)
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.sessionCache.renameSession(sessionId, name)
    }

    async setSessionTags(sessionId: string, tags: string[]): Promise<void> {
        await this.sessionCache.setSessionTags(sessionId, tags)
    }

    async setSessionPreviewUrl(sessionId: string, previewUrl: string | null): Promise<void> {
        await this.sessionCache.setPreviewUrl(sessionId, previewUrl)
    }

    getPreviewUrlHistory(namespace: string, limit?: number): PreviewUrlHistoryEntry[] {
        return this.sessionCache.getPreviewUrlHistory(namespace, limit)
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.sessionCache.deleteSession(sessionId)
    }

    async applySessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            modelMode?: ModelMode
            model?: string
            thinkEffort?: 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
            serviceTier?: 'fast' | 'flex'
            collaborationMode?: string | null
        }
    ): Promise<void> {
        let applied: {
            permissionMode?: Session['permissionMode']
            modelMode?: Session['modelMode']
            model?: string
            thinkEffort?: 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
            serviceTier?: 'fast' | 'flex'
            collaborationMode?: string
        } | undefined

        try {
            const result = await this.rpcGateway.requestSessionConfig(sessionId, config)
            if (!result || typeof result !== 'object') {
                throw new Error('Invalid response from session config RPC')
            }
            const obj = result as {
                applied?: {
                    permissionMode?: Session['permissionMode']
                    modelMode?: Session['modelMode']
                    model?: string
                    thinkEffort?: 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
                    serviceTier?: 'fast' | 'flex'
                    collaborationMode?: string
                }
            }
            const fromRpc = obj.applied
            if (!fromRpc || typeof fromRpc !== 'object') {
                throw new Error('Missing applied session config')
            }
            applied = fromRpc
        } catch (error) {
            if (!this.shouldFallbackSessionConfig(sessionId, config, error)) {
                throw error
            }
            applied = {
                permissionMode: config.permissionMode,
                modelMode: config.modelMode,
                model: config.model,
                thinkEffort: config.thinkEffort,
                serviceTier: config.serviceTier,
                collaborationMode: config.collaborationMode ?? undefined
            }
        }

        const session = this.getSession(sessionId)
        const flavor = session?.metadata?.flavor ?? null
        const resolvedModelMode = applied.modelMode
            ?? (flavor === 'claude' ? inferClaudeModelModeFromModel(applied.model) : undefined)

        this.sessionCache.applySessionConfig(sessionId, {
            permissionMode: applied.permissionMode,
            modelMode: resolvedModelMode
        })

        const shouldUpdateModelMetadata = flavor === 'claude' && (applied.model !== undefined || config.model !== undefined)
        const shouldUpdateThinkEffortMetadata = (flavor === 'claude' || flavor === 'codex')
            && (applied.thinkEffort !== undefined || config.thinkEffort !== undefined)
        const shouldUpdateServiceTierMetadata = flavor === 'codex'
            && (applied.serviceTier !== undefined || config.serviceTier !== undefined)
        const shouldUpdateCollaborationModeMetadata = flavor === 'codex'
            && (applied.collaborationMode !== undefined || config.collaborationMode !== undefined)

        if (shouldUpdateModelMetadata || shouldUpdateThinkEffortMetadata || shouldUpdateServiceTierMetadata || shouldUpdateCollaborationModeMetadata) {
            const rawModel = applied.model ?? config.model
            const model = (() => {
                if (typeof rawModel !== 'string') return undefined
                const trimmed = rawModel.trim()
                if (!trimmed) return undefined
                const lowered = trimmed.toLowerCase()
                return lowered === 'default' || lowered === 'auto' ? undefined : trimmed
            })()
            const thinkEffort = this.normalizeThinkEffortForFlavor(
                applied.thinkEffort ?? config.thinkEffort,
                flavor
            )
            const collaborationMode = this.normalizeCollaborationModeForFlavor(
                applied.collaborationMode ?? config.collaborationMode,
                flavor
            )
            const serviceTier = this.normalizeServiceTierForFlavor(
                applied.serviceTier ?? config.serviceTier,
                flavor
            )
            const fallbackMetadata = session?.metadata ?? { path: '', host: '' }
            await this.sessionCache.updateSessionMetadata(sessionId, (metadata) => {
                const source = metadata ?? fallbackMetadata
                const next: typeof source = { ...source }

                if (shouldUpdateModelMetadata) {
                    if (model) {
                        next.model = model
                    } else {
                        delete next.model
                    }
                }

                if (shouldUpdateThinkEffortMetadata) {
                    if (thinkEffort) {
                        next.thinkEffort = thinkEffort
                    } else {
                        delete next.thinkEffort
                    }
                }

                if (shouldUpdateServiceTierMetadata) {
                    if (serviceTier) {
                        next.serviceTier = serviceTier
                    } else {
                        delete next.serviceTier
                    }
                }

                if (shouldUpdateCollaborationModeMetadata) {
                    if (collaborationMode) {
                        next.collaborationMode = collaborationMode
                    } else {
                        delete next.collaborationMode
                    }
                }

                return next
            })
        }

        if (applied.permissionMode === 'auto-approve') {
            void this.maybeAutoApprovePendingRequests(sessionId)
        }
    }

    private shouldFallbackSessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            modelMode?: ModelMode
            model?: string
            thinkEffort?: 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
            serviceTier?: 'fast' | 'flex'
            collaborationMode?: string | null
        },
        error: unknown
    ): boolean {
        if (config.permissionMode !== 'auto-approve') {
            return false
        }

        const message = error instanceof Error ? error.message : ''
        if (message !== 'Missing applied session config' && message !== 'Invalid response from session config RPC') {
            return false
        }

        const session = this.getSession(sessionId)
        return session?.metadata?.flavor === 'codex'
    }

    private normalizeThinkEffortForFlavor(
        value: string | undefined,
        flavor: string | null
    ): 'low' | 'medium' | 'high' | 'max' | 'xhigh' | undefined {
        if (typeof value !== 'string') {
            return undefined
        }

        const normalized = value.trim().toLowerCase()
        if (!normalized || normalized === 'auto') {
            return undefined
        }
        if (normalized !== 'low' && normalized !== 'medium' && normalized !== 'high' && normalized !== 'max' && normalized !== 'xhigh') {
            return undefined
        }
        if (flavor === 'claude' && normalized === 'xhigh') {
            return undefined
        }
        if (flavor !== 'claude' && flavor !== 'codex') {
            return undefined
        }
        return normalized
    }

    private normalizeCollaborationModeForFlavor(
        value: string | null | undefined,
        flavor: string | null
    ): string | undefined {
        if (flavor !== 'codex') {
            return undefined
        }

        if (typeof value !== 'string') {
            return undefined
        }

        const normalized = value.trim().toLowerCase()
        if (!normalized || normalized === 'default' || normalized === 'code' || normalized === 'normal') {
            return undefined
        }

        return normalized
    }

    private normalizeServiceTierForFlavor(
        value: string | undefined,
        flavor: string | null
    ): 'fast' | 'flex' | undefined {
        if (flavor !== 'codex' || typeof value !== 'string') {
            return undefined
        }
        const normalized = value.trim().toLowerCase()
        if (normalized === 'fast' || normalized === 'flex') {
            return normalized
        }
        return undefined
    }

    private async maybeAutoApprovePendingRequests(sessionId: string): Promise<void> {
        const session = this.getSession(sessionId)
        if (!session || session.permissionMode !== 'auto-approve') {
            return
        }

        const requests = session.agentState?.requests
        if (!requests || typeof requests !== 'object') {
            return
        }
        const completedRequests = session.agentState?.completedRequests

        for (const requestId of Object.keys(requests)) {
            const request = requests[requestId]
            if (shouldSkipAutoApproveForTool(request?.tool)) {
                continue
            }

            if (completedRequests && requestId in completedRequests) {
                continue
            }

            const lockKey = `${sessionId}:${requestId}`
            if (this.autoApprovalInFlight.has(lockKey)) {
                continue
            }

            this.autoApprovalInFlight.add(lockKey)
            try {
                await this.approvePermission(
                    sessionId,
                    requestId,
                    undefined,
                    undefined,
                    'approved',
                    undefined,
                    undefined,
                    'auto'
                )
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(`[SyncEngine] Failed to auto-approve request ${requestId} for ${sessionId}: ${message}`)
            } finally {
                this.autoApprovalInFlight.delete(lockKey)
            }
        }
    }

    private getPendingNoteRefreshTaskKey(route: GroupRouteContext): string | null {
        if (!route.taskId || !isNoteRefreshTaskId(route.taskId)) {
            return null
        }
        return `${route.groupId}:${route.taskId}`
    }

    private clearPendingNoteRefreshDraft(route: GroupRouteContext): void {
        const key = this.getPendingNoteRefreshTaskKey(route)
        if (!key) {
            return
        }
        this.pendingNoteRefreshDraftByTaskKey.delete(key)
        this.pendingNoteRefreshMirroredByTaskKey.delete(key)
    }

    private capturePendingNoteRefreshDraft(route: GroupRouteContext, envelope: MessageEnvelope): void {
        const key = this.getPendingNoteRefreshTaskKey(route)
        if (!key) {
            return
        }

        let text: string | null = null
        if (envelope.contentType === 'output') {
            text = extractClaudeText(envelope.data, { allowSummary: true })
        } else if (envelope.contentType === 'codex') {
            const data = asRecord(envelope.data)
            if (asString(data?.type) !== 'message') {
                return
            }
            text = extractCodexText(envelope.data)
        } else {
            return
        }

        if (!text) {
            return
        }

        const normalized = normalizeNoteRefreshContent(text)
        if (!normalized) {
            return
        }

        const existing = this.pendingNoteRefreshDraftByTaskKey.get(key)
        if (!existing || normalized.length >= existing.length) {
            this.pendingNoteRefreshDraftByTaskKey.set(key, normalized)
        }
    }

    private applyPendingNoteRefreshDraft(route: GroupRouteContext, namespace: string, sessionId: string): void {
        const key = this.getPendingNoteRefreshTaskKey(route)
        if (!key) {
            return
        }

        const content = this.pendingNoteRefreshDraftByTaskKey.get(key)
        this.pendingNoteRefreshDraftByTaskKey.delete(key)
        const hadMirroredTimelineOutput = this.pendingNoteRefreshMirroredByTaskKey.has(key)
        this.pendingNoteRefreshMirroredByTaskKey.delete(key)
        if (!content) {
            return
        }

        const group = this.groupService.getGroupByNamespace(route.groupId, namespace)
        if (!group) {
            return
        }
        if (group.group.noteSessionId !== sessionId) {
            return
        }

        try {
            this.groupService.updateGroupNote({
                groupId: route.groupId,
                namespace,
                content,
                updatedBy: `session:${sessionId}`
            })
            if (!hadMirroredTimelineOutput) {
                this.emitMirroredGroupMessage(route, sessionId, namespace, {
                    sessionId,
                    contentType: 'output',
                    text: truncateText(content, MAX_GROUP_MIRROR_TEXT_LENGTH)
                })
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`[SyncEngine] Failed to update group note from note refresh task ${route.taskId}: ${message}`)
        }
    }

    private isSameGroupRoute(left: GroupRouteContext, right: GroupRouteContext): boolean {
        return left.groupId === right.groupId
            && (left.taskId ?? null) === (right.taskId ?? null)
            && (left.traceId ?? null) === (right.traceId ?? null)
    }

    private isCodexGroupSession(sessionId: string, namespace: string): boolean {
        const session = this.getSessionByNamespace(sessionId, namespace)
        return session?.metadata?.flavor === 'codex'
    }

    private emitMirroredGroupMessage(
        route: GroupRouteContext,
        sessionId: string,
        namespace: string,
        payload: MirroredPayload
    ): void {
        const noteRefreshTaskKey = this.getPendingNoteRefreshTaskKey(route)
        if (noteRefreshTaskKey) {
            this.pendingNoteRefreshMirroredByTaskKey.add(noteRefreshTaskKey)
        }

        void this.groupService.addTimelineMessage({
            groupId: route.groupId,
            namespace,
            type: 'chat',
            source: `session:${sessionId}`,
            actorSessionId: sessionId,
            traceId: route.traceId ?? null,
            taskId: route.taskId ?? null,
            targetSessionIds: route.targetSessionIds ?? null,
            payload
        }).catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            console.warn(`[SyncEngine] Failed to mirror group message for ${sessionId}: ${message}`)
        })
    }

    private flushBufferedCodexMirror(sessionId: string, namespace: string): void {
        const buffered = this.bufferedCodexMirrorsBySession.get(sessionId)
        if (!buffered) {
            return
        }
        this.bufferedCodexMirrorsBySession.delete(sessionId)

        const merged = truncateText(
            buffered.chunks.join('\n\n').trim(),
            MAX_GROUP_MIRROR_TEXT_LENGTH
        )
        if (!merged) {
            return
        }

        this.emitMirroredGroupMessage(
            buffered.route,
            sessionId,
            namespace,
            {
                sessionId,
                contentType: 'codex',
                text: merged,
                merged: true,
                chunkCount: buffered.chunks.length
            }
        )
    }

    private bufferCodexMirror(
        sessionId: string,
        namespace: string,
        route: GroupRouteContext,
        text: string
    ): void {
        const normalized = text.trim()
        if (!normalized) {
            return
        }

        const existing = this.bufferedCodexMirrorsBySession.get(sessionId)
        if (existing && !this.isSameGroupRoute(existing.route, route)) {
            this.flushBufferedCodexMirror(sessionId, namespace)
        }

        const active = this.bufferedCodexMirrorsBySession.get(sessionId)
        if (!active) {
            this.bufferedCodexMirrorsBySession.set(sessionId, {
                route,
                chunks: [normalized]
            })
            return
        }

        const lastChunk = active.chunks[active.chunks.length - 1]
        if (lastChunk === normalized) {
            return
        }
        active.chunks.push(normalized)
    }

    private handleGroupRoutedMessage(
        sessionId: string,
        namespace: string,
        message: DecryptedMessage
    ): void {
        const envelope = parseMessageEnvelope(message.content)
        if (!envelope) {
            return
        }

        const routeFromMeta = parseRouteContext(envelope.meta?.routeContext)
        const isCodexSession = this.isCodexGroupSession(sessionId, namespace)
        if (envelope.role === 'user') {
            if (routeFromMeta) {
                const group = this.groupService.getGroupByNamespace(routeFromMeta.groupId, namespace)
                if (!group) {
                    this.clearPendingNoteRefreshDraft(routeFromMeta)
                    if (isCodexSession) {
                        this.flushBufferedCodexMirror(sessionId, namespace)
                    }
                    this.activeGroupRoutesBySession.delete(sessionId)
                    return
                }
                if (isCodexSession) {
                    const activeRoute = this.activeGroupRoutesBySession.get(sessionId)
                    if (activeRoute && !this.isSameGroupRoute(activeRoute, routeFromMeta)) {
                        this.flushBufferedCodexMirror(sessionId, namespace)
                    }
                }
                this.activeGroupRoutesBySession.set(sessionId, routeFromMeta)
                if (routeFromMeta.taskId) {
                    this.groupService.updateTaskExecutionStatus({
                        groupId: routeFromMeta.groupId,
                        taskId: routeFromMeta.taskId,
                        namespace,
                        status: 'running'
                    })
                }
            } else {
                // No routeContext in this user message. If a queue-pending route
                // exists (claude/gemini don't echo routeContext in their user echo),
                // keep the route alive rather than clearing it.
                const pendingRoute = this.queuePendingRoutes.get(sessionId)
                if (pendingRoute) {
                    this.activeGroupRoutesBySession.set(sessionId, pendingRoute)
                } else {
                    const activeRoute = this.activeGroupRoutesBySession.get(sessionId)
                    if (activeRoute) {
                        this.clearPendingNoteRefreshDraft(activeRoute)
                    }
                    if (isCodexSession) {
                        this.flushBufferedCodexMirror(sessionId, namespace)
                    }
                    this.activeGroupRoutesBySession.delete(sessionId)
                }
            }
            return
        }

        if (envelope.role !== 'agent') {
            return
        }

        const route = routeFromMeta ?? this.activeGroupRoutesBySession.get(sessionId)
        if (!route) {
            if (isCodexSession) {
                this.flushBufferedCodexMirror(sessionId, namespace)
            }
            return
        }

        const group = this.groupService.getGroupByNamespace(route.groupId, namespace)
        if (!group) {
            this.clearPendingNoteRefreshDraft(route)
            if (isCodexSession) {
                this.flushBufferedCodexMirror(sessionId, namespace)
            }
            this.activeGroupRoutesBySession.delete(sessionId)
            this.queuePendingRoutes.delete(sessionId)
            return
        }

        if (routeFromMeta) {
            if (isCodexSession) {
                const activeRoute = this.activeGroupRoutesBySession.get(sessionId)
                if (activeRoute && !this.isSameGroupRoute(activeRoute, route)) {
                    this.flushBufferedCodexMirror(sessionId, namespace)
                }
            }
            this.activeGroupRoutesBySession.set(sessionId, route)
        }

        if (route.taskId) {
            this.groupService.updateTaskExecutionStatus({
                groupId: route.groupId,
                taskId: route.taskId,
                namespace,
                status: 'running'
            })
        }

        this.capturePendingNoteRefreshDraft(route, envelope)

        if (isReadyEvent(envelope)) {
            if (isCodexSession) {
                this.flushBufferedCodexMirror(sessionId, namespace)
            }
            this.applyPendingNoteRefreshDraft(route, namespace, sessionId)
            if (route.taskId) {
                this.groupService.updateTaskExecutionStatus({
                    groupId: route.groupId,
                    taskId: route.taskId,
                    namespace,
                    status: 'completed'
                })
            }
            this.activeGroupRoutesBySession.delete(sessionId)
            this.queuePendingRoutes.delete(sessionId)
            return
        }

        const payload = buildMirroredPayload(sessionId, envelope, route)
        if (!payload) {
            return
        }

        if (isTitleMutationNoiseText(payload.text)) {
            return
        }

        if (isCodexSession && payload.contentType === 'codex') {
            if (payload.isCodexExecutionDetail) {
                return
            }
            this.bufferCodexMirror(sessionId, namespace, route, payload.text)
            return
        }

        if (isCodexSession && payload.contentType === 'event' && isCodexExecutionDetailText(payload.text)) {
            return
        }

        this.emitMirroredGroupMessage(route, sessionId, namespace, payload)
    }

    private async dispatchGroupTask(payload: {
        groupId: string
        namespace: string
        taskId: string
        traceId: string
        source: string
        targetSessionId: string
        command: string
    }): Promise<void> {
        const session = this.getSession(payload.targetSessionId)
        if (!session) {
            throw new Error('Target session not found')
        }
        if (session.namespace !== payload.namespace) {
            throw new Error('Target session access denied')
        }
        if (!session.active) {
            throw new Error('Target session is inactive')
        }

        const flavor = session.metadata?.flavor
        const routeContext = {
            groupId: payload.groupId,
            taskId: payload.taskId,
            traceId: payload.traceId,
            source: payload.source,
            targetSessionIds: [payload.targetSessionId]
        }

        if (flavor === 'claude') {
            // Pre-register route in both maps. queuePendingRoutes prevents the
            // user-message echo (which lacks routeContext) from clearing the route.
            this.activeGroupRoutesBySession.set(payload.targetSessionId, routeContext)
            this.queuePendingRoutes.set(payload.targetSessionId, routeContext)
            const result = await this.enqueueClaudeMessage(payload.targetSessionId, {
                text: payload.command,
                meta: { routeContext }
            })
            if (!result.success) {
                this.activeGroupRoutesBySession.delete(payload.targetSessionId)
                this.queuePendingRoutes.delete(payload.targetSessionId)
                throw new Error(result.error ?? 'Failed to enqueue Claude task')
            }
            return
        }

        if (flavor === 'gemini') {
            // Same treatment as claude
            this.activeGroupRoutesBySession.set(payload.targetSessionId, routeContext)
            this.queuePendingRoutes.set(payload.targetSessionId, routeContext)
            const result = await this.enqueueCodexMessage(payload.targetSessionId, {
                text: payload.command,
                meta: { routeContext }
            })
            if (!result.success) {
                this.activeGroupRoutesBySession.delete(payload.targetSessionId)
                this.queuePendingRoutes.delete(payload.targetSessionId)
                throw new Error(result.error ?? 'Failed to enqueue Gemini task')
            }
            return
        }

        if (flavor === 'codex') {
            // Codex echoes routeContext in its messages, so no pre-registration needed
            const result = await this.enqueueCodexMessage(payload.targetSessionId, {
                text: payload.command,
                meta: { routeContext }
            })
            if (!result.success) {
                throw new Error(result.error ?? 'Failed to enqueue Codex task')
            }
            return
        }

        // opencode and unknown flavors: fall back to direct send
        await this.sendMessage(payload.targetSessionId, {
            text: payload.command,
            sentFrom: 'webapp',
            meta: { routeContext }
        })
    }

    private async executeNoteRefresh(payload: {
        groupId: string
        namespace: string
        traceId: string
        noteSessionId: string
        source: string
        command: string
    }): Promise<{ accepted: boolean; reason?: string }> {
        try {
            await this.dispatchGroupTask({
                groupId: payload.groupId,
                namespace: payload.namespace,
                taskId: `note-refresh:${payload.traceId}`,
                traceId: payload.traceId,
                source: payload.source,
                targetSessionId: payload.noteSessionId,
                command: payload.command
            })
            return { accepted: true }
        } catch (error) {
            return {
                accepted: false,
                reason: error instanceof Error ? error.message : String(error)
            }
        }
    }

    async broadcastGroupNote(
        groupId: string,
        namespace: string,
        options: { source: string; broadcastedBy?: string }
    ): Promise<void> {
        const detail = this.groupService.getGroupByNamespace(groupId, namespace)
        const note = detail?.note

        if (!detail || !note?.content) {
            throw new Error('No group note to broadcast')
        }

        const members = detail.members.filter((m: any) => m.sessionId)
        if (members.length === 0) {
            throw new Error('No active members to broadcast to')
        }

        // 并行发送给所有成员
        await Promise.all(members.map(async (member: any) => {
            const traceId = `broadcast-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
            const routeContext = {
                groupId,
                traceId,
                source: options.source,
                targetSessionIds: [member.sessionId!]
            }

            const message = {
                text: `📝 **Group Note Broadcast**

**Group**: ${detail.group.name}
**Broadcasted by**: ${options.broadcastedBy ?? options.source}

## Current Group Note (v${note.version}):

${note.content}

---
*This is a manual broadcast. You can reference this information for current group context.*`,
                meta: { routeContext }
            }

            // 根据session类型选择队列
            const session = this.sessionCache.getSession(member.sessionId!)
            const flavor = session?.metadata?.flavor ?? 'claude'

            if (flavor === 'claude') {
                // Pre-register route for claude (similar to dispatchGroupTask)
                this.activeGroupRoutesBySession.set(member.sessionId!, routeContext)
                this.queuePendingRoutes.set(member.sessionId!, routeContext)
                const result = await this.enqueueClaudeMessage(member.sessionId!, message)
                if (!result.success) {
                    // Clean up on failure
                    this.activeGroupRoutesBySession.delete(member.sessionId!)
                    this.queuePendingRoutes.delete(member.sessionId!)
                    console.warn(`[SyncEngine] Failed to broadcast note to claude session ${member.sessionId}: ${result.error}`)
                }
            } else if (flavor === 'gemini') {
                // Same treatment as claude
                this.activeGroupRoutesBySession.set(member.sessionId!, routeContext)
                this.queuePendingRoutes.set(member.sessionId!, routeContext)
                const result = await this.enqueueCodexMessage(member.sessionId!, message)
                if (!result.success) {
                    // Clean up on failure
                    this.activeGroupRoutesBySession.delete(member.sessionId!)
                    this.queuePendingRoutes.delete(member.sessionId!)
                    console.warn(`[SyncEngine] Failed to broadcast note to gemini session ${member.sessionId}: ${result.error}`)
                }
            } else if (flavor === 'codex') {
                // Codex echoes routeContext in its messages, so no pre-registration needed
                const result = await this.enqueueCodexMessage(member.sessionId!, message)
                if (!result.success) {
                    console.warn(`[SyncEngine] Failed to broadcast note to codex session ${member.sessionId}: ${result.error}`)
                }
            } else {
                // Fallback for other flavors
                try {
                    await this.sendMessage(member.sessionId!, {
                        text: message.text,
                        sentFrom: 'webapp'
                    })
                } catch (error) {
                    console.warn(`[SyncEngine] Failed to broadcast note to session ${member.sessionId}:`, error)
                }
            }
        }))

        // 在timeline中记录广播事件
        this.store.groups.addGroupMessage({
            groupId,
            namespace,
            type: 'system',
            source: options.source,
            payload: {
                action: 'note_broadcasted',
                noteVersion: note.version,
                targetCount: members.length,
                broadcastedBy: options.broadcastedBy
            }
        })
    }

    async claudeAccounts(machineId: string, operation: 'get' | 'save' | 'check', payload: unknown = {}): Promise<unknown> {
        return this.rpcGateway.claudeAccounts(machineId, operation, payload)
    }

    async spawnSession(
        machineId: string,
        directory: string,
        agent: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode' = 'claude',
        model?: string,
        thinkEffort?: 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh',
        serviceTier?: 'fast' | 'flex',
        yolo?: boolean,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        previewUrl?: string | null,
        claudeAccount?: ClaudeAccountSelection,
        sourceClaudeAccountId?: string
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        const resolvedAgent = agent ?? this.inferSpawnFlavor(machineId, directory)
        // The system switch overrides each caller: the task lead, a resume, the new-session form.
        if (await this.alwaysYolo()) yolo = true
        const result = await this.rpcGateway.spawnSession(
            machineId,
            directory,
            resolvedAgent,
            model,
            thinkEffort,
            serviceTier,
            yolo,
            sessionType,
            worktreeName,
            resumeSessionId,
            claudeAccount,
            sourceClaudeAccountId
        )

        // The agent reports its permission mode only once it is running; remember the requested one now so a
        // session that exits at startup (or is woken later) still comes back in YOLO.
        if (result.type === 'success' && yolo === true) {
            const yoloMode = yoloPermissionModeForFlavor(resolvedAgent)
            if (isPermissionModeAllowedForFlavor(yoloMode, resolvedAgent)) {
                this.sessionCache.applySessionConfig(result.sessionId, { permissionMode: yoloMode })
            }
        }

        if (result.type === 'success' && previewUrl) {
            try {
                await this.persistSessionPreviewUrlWithRetry(result.sessionId, previewUrl)
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(`[SyncEngine] Failed to persist preview URL for ${result.sessionId}: ${message}`)
            }
        }

        return result
    }

    /** Stop an active Claude process and resume the same native transcript under another account. */
    async switchClaudeAccount(
        sessionId: string,
        namespace: string,
        claudeAccount: ClaudeAccountSelection
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        const access = this.sessionCache.resolveSessionAccess(sessionId, namespace)
        if (!access.ok) return { type: 'error', message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found' }
        const session = access.session
        const metadata = session.metadata
        if (metadata?.flavor !== 'claude' || typeof metadata.path !== 'string' || typeof metadata.claudeSessionId !== 'string') {
            return { type: 'error', message: '该会话没有可恢复的 Claude 原生历史' }
        }
        if (session.thinking || (session.agentState?.runningAgents?.length ?? 0) > 0) {
            return { type: 'error', message: '会话仍在执行，请等待当前回合完成后再切换账号' }
        }
        const machineId = metadata.machineId
        if (!machineId || !this.machineCache.getOnlineMachinesByNamespace(namespace).some(machine => machine.id === machineId)) {
            return { type: 'error', message: '原会话所在机器不在线' }
        }
        if (session.active) await this.rpcGateway.killSession(session.id)
        const deadline = Date.now() + 15_000
        while (this.getSession(session.id)?.active && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 250))
        if (this.getSession(session.id)?.active) return { type: 'error', message: '旧会话仍在运行，未执行切换' }
        const result = await this.spawnSession(
            machineId,
            metadata.path,
            'claude',
            metadata.model,
            metadata.thinkEffort as 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh' | undefined,
            metadata.serviceTier as 'fast' | 'flex' | undefined,
            session.permissionMode === 'bypassPermissions',
            'simple',
            undefined,
            metadata.claudeSessionId,
            undefined,
            claudeAccount,
            metadata.claudeAccount?.id
        )
        if (result.type !== 'success') return result
        if (!await this.waitForSessionActive(result.sessionId)) return { type: 'error', message: '切换后的会话未能启动' }
        if (result.sessionId !== session.id) await this.mergeSessions(session.id, result.sessionId, namespace)
        return result
    }

    async spawnSessionFromExisting(
        sourceSessionId: string,
        namespace: string,
        options: { inheritHistory: boolean }
    ): Promise<SpawnFromExistingSessionResult> {
        const access = this.sessionCache.resolveSessionAccess(sourceSessionId, namespace)
        if (!access.ok) {
            return {
                type: 'error',
                message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found',
                code: access.reason === 'access-denied' ? 'access_denied' : 'session_not_found'
            }
        }

        const sourceSession = access.session
        const metadata = sourceSession.metadata
        if (!metadata || typeof metadata.path !== 'string' || !metadata.path.trim()) {
            return { type: 'error', message: 'Session metadata missing path', code: 'spawn_unavailable' }
        }

        const onlineMachines = this.machineCache.getOnlineMachinesByNamespace(namespace)
        if (onlineMachines.length === 0) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const machine = (() => {
            if (metadata.machineId) {
                const exactMatch = onlineMachines.find((item) => item.id === metadata.machineId)
                if (exactMatch) return exactMatch
            }
            if (metadata.host) {
                const hostMatch = onlineMachines.find((item) => item.metadata?.host === metadata.host)
                if (hostMatch) return hostMatch
            }
            return onlineMachines[0] ?? null
        })()

        if (!machine) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const flavor = this.normalizeSpawnFlavor(metadata.flavor)
        const { model, thinkEffort, serviceTier } = this.readSpawnPreferences(metadata, flavor)
        const sessionType: 'simple' | 'worktree' = metadata.worktree ? 'worktree' : 'simple'
        const directory = metadata.worktree?.basePath?.trim() || metadata.path.trim()
        if (!directory) {
            return { type: 'error', message: 'Session metadata missing path', code: 'spawn_unavailable' }
        }

        const previewUrl = sourceSession.previewUrl ?? undefined
        const resumeToken = options.inheritHistory
            ? this.resolveResumeToken(flavor, metadata)
            : undefined
        const sourcePermissionMode = sourceSession.permissionMode
            && isPermissionModeAllowedForFlavor(sourceSession.permissionMode, flavor)
            ? sourceSession.permissionMode
            : undefined
        const sourceCollaborationMode = flavor === 'codex' && typeof metadata.collaborationMode === 'string'
            ? (metadata.collaborationMode.trim().toLowerCase() === 'plan' ? 'plan' : undefined)
            : undefined
        const duplicatedName = this.buildDuplicateSessionName(sourceSession)

        // Claude transcripts live in the owning account's config dir. Pin the new session to
        // that account so the runner can resume it (and copy the transcript if needed).
        const sourceClaudeAccount = flavor === 'claude' ? metadata.claudeAccount : undefined

        const spawn = async (resumeSessionId?: string) => await this.spawnSession(
            machine.id,
            directory,
            flavor,
            model,
            thinkEffort,
            serviceTier,
            undefined,
            sessionType,
            undefined,
            resumeSessionId,
            previewUrl,
            resumeSessionId && sourceClaudeAccount
                ? { accountId: sourceClaudeAccount.id, automatic: sourceClaudeAccount.automatic }
                : undefined,
            resumeSessionId ? sourceClaudeAccount?.id : undefined
        )

        let spawnResult = await spawn(resumeToken)
        if (spawnResult.type !== 'success' && resumeToken) {
            spawnResult = await spawn(undefined)
        }

        if (spawnResult.type !== 'success') {
            return { type: 'error', message: spawnResult.message, code: 'spawn_failed' }
        }

        const becameAvailable = await this.waitForSessionAvailable(spawnResult.sessionId)
        if (!becameAvailable) {
            return { type: 'error', message: 'Session failed to initialize', code: 'spawn_failed' }
        }

        if (options.inheritHistory) {
            try {
                await this.sessionCache.copySessionHistory(access.sessionId, spawnResult.sessionId, namespace)
            } catch (error) {
                return {
                    type: 'error',
                    message: error instanceof Error ? error.message : 'Failed to copy history',
                    code: 'history_copy_failed'
                }
            }
        }

        if (duplicatedName) {
            try {
                await this.sessionCache.renameSession(spawnResult.sessionId, duplicatedName)
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                console.warn(`[SyncEngine] Failed to rename duplicated session ${spawnResult.sessionId}: ${message}`)
            }
        }

        if (sourcePermissionMode !== undefined || sourceCollaborationMode !== undefined) {
            const becameActive = await this.waitForSessionActive(spawnResult.sessionId)
            if (!becameActive) {
                console.warn(`[SyncEngine] Skipped copying session config for ${spawnResult.sessionId}: session not active`)
            } else {
                try {
                    await this.applySessionConfig(spawnResult.sessionId, {
                        permissionMode: sourcePermissionMode,
                        collaborationMode: sourceCollaborationMode
                    })
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    console.warn(`[SyncEngine] Failed to copy session config to ${spawnResult.sessionId}: ${message}`)
                }
            }
        }

        return { type: 'success', sessionId: spawnResult.sessionId }
    }

    async waitForSessionAvailable(sessionId: string, timeoutMs: number = 15_000): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const session = this.getSession(sessionId)
            if (session) {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return false
    }

    private inferSpawnFlavor(machineId: string, directory: string): 'claude' | 'codex' | 'gemini' | 'opencode' {
        const normalizedDirectory = directory.trim()
        const sessions = this.sessionCache.getSessions()

        const sameDirectoryFlavor = sessions
            .filter((session) => {
                if (session.metadata?.machineId !== machineId) {
                    return false
                }
                const sessionDirectory = this.resolveSpawnDirectory(session)
                return sessionDirectory.length > 0 && sessionDirectory === normalizedDirectory
            })
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((session) => this.readSessionFlavor(session))
            .find((value): value is 'claude' | 'codex' | 'gemini' | 'opencode' => value !== undefined)
        if (sameDirectoryFlavor) {
            return sameDirectoryFlavor
        }

        const sameMachineFlavor = sessions
            .filter((session) => session.metadata?.machineId === machineId)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((session) => this.readSessionFlavor(session))
            .find((value): value is 'claude' | 'codex' | 'gemini' | 'opencode' => value !== undefined)
        if (sameMachineFlavor) {
            return sameMachineFlavor
        }

        return 'claude'
    }

    private resolveSpawnDirectory(session: Session): string {
        const worktreeBasePath = session.metadata?.worktree?.basePath?.trim()
        if (worktreeBasePath) {
            return worktreeBasePath
        }
        const path = session.metadata?.path?.trim()
        return path ?? ''
    }

    private readSessionFlavor(session: Session): 'claude' | 'codex' | 'gemini' | 'opencode' | undefined {
        const flavor = session.metadata?.flavor
        if (flavor === 'claude' || flavor === 'codex' || flavor === 'gemini' || flavor === 'opencode') {
            return flavor
        }
        return undefined
    }

    /** Model, effort and tier a session was started with, read back from its metadata for a respawn. */
    private readSpawnPreferences(
        metadata: NonNullable<Session['metadata']>,
        flavor: string
    ): {
        model: string | undefined
        thinkEffort: 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | undefined
        serviceTier: 'fast' | 'flex' | undefined
    } {
        const model = typeof metadata.model === 'string' && metadata.model.trim()
            ? metadata.model.trim()
            : undefined
        const effortValue = typeof metadata.thinkEffort === 'string'
            ? metadata.thinkEffort.trim().toLowerCase()
            : ''
        const thinkEffort = (effortValue === 'auto' || effortValue === 'low' || effortValue === 'medium'
            || effortValue === 'high' || effortValue === 'xhigh')
            && !(flavor === 'claude' && effortValue === 'xhigh')
            ? effortValue
            : undefined
        const tierValue = typeof metadata.serviceTier === 'string'
            ? metadata.serviceTier.trim().toLowerCase()
            : ''
        const serviceTier = tierValue === 'fast' || tierValue === 'flex' ? tierValue : undefined
        return { model, thinkEffort, serviceTier }
    }

    private normalizeSpawnFlavor(value: string | null | undefined): 'claude' | 'codex' | 'gemini' | 'opencode' {
        return value === 'codex' || value === 'gemini' || value === 'opencode'
            ? value
            : 'claude'
    }

    private resolveResumeToken(
        flavor: 'claude' | 'codex' | 'gemini' | 'opencode',
        metadata: Session['metadata']
    ): string | undefined {
        if (!metadata) {
            return undefined
        }
        return flavor === 'codex'
            ? metadata.codexSessionId
            : flavor === 'gemini'
                ? metadata.geminiSessionId
                : flavor === 'opencode'
                    ? metadata.opencodeSessionId
                    : metadata.claudeSessionId
    }

    private buildDuplicateSessionName(session: Session): string | undefined {
        const baseName = this.resolveSessionDisplayName(session)
        if (!baseName) {
            return undefined
        }
        return this.withIncrementedDuplicateSuffix(baseName)
    }

    private resolveSessionDisplayName(session: Session): string | undefined {
        const metadata = session.metadata
        if (!metadata) {
            return undefined
        }

        const name = metadata.name?.trim()
        if (name) {
            return name
        }

        const summary = metadata.summary?.text?.trim()
        if (summary) {
            return summary
        }

        const path = metadata.path?.trim()
        if (!path) {
            return undefined
        }
        const normalized = path.replace(/[\\/]+$/, '')
        const parts = normalized.split(/[\\/]+/).filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : normalized
    }

    private withIncrementedDuplicateSuffix(name: string): string {
        const trimmed = name.trim()
        if (!trimmed) {
            return 'Session (1)'
        }

        const asciiMatch = trimmed.match(/^(.*?)(?:\s*)\((\d+)\)\s*$/)
        if (asciiMatch) {
            const next = Number.parseInt(asciiMatch[2], 10)
            if (Number.isFinite(next)) {
                return `${asciiMatch[1].trimEnd()} (${next + 1})`
            }
        }

        const fullWidthMatch = trimmed.match(/^(.*?)(?:\s*)（(\d+)）\s*$/)
        if (fullWidthMatch) {
            const next = Number.parseInt(fullWidthMatch[2], 10)
            if (Number.isFinite(next)) {
                return `${fullWidthMatch[1].trimEnd()}（${next + 1}）`
            }
        }

        return `${trimmed} (1)`
    }

    async resumeSession(sessionId: string, namespace: string): Promise<ResumeSessionResult> {
        const access = this.sessionCache.resolveSessionAccess(sessionId, namespace)
        if (!access.ok) {
            return {
                type: 'error',
                message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found',
                code: access.reason === 'access-denied' ? 'access_denied' : 'session_not_found'
            }
        }

        const session = access.session
        if (session.active) {
            return { type: 'success', sessionId: access.sessionId }
        }

        const metadata = session.metadata
        if (!metadata || typeof metadata.path !== 'string') {
            return { type: 'error', message: 'Session metadata missing path', code: 'resume_unavailable' }
        }

        const flavor = metadata.flavor === 'codex' || metadata.flavor === 'gemini' || metadata.flavor === 'opencode' || metadata.flavor === 'cursor'
            ? metadata.flavor
            : 'claude'
        const resumeToken = flavor === 'codex'
            ? metadata.codexSessionId
            : flavor === 'gemini'
                ? metadata.geminiSessionId
                : flavor === 'opencode'
                    ? metadata.opencodeSessionId
                    : flavor === 'cursor'
                        ? metadata.cursorSessionId
                        : metadata.claudeSessionId

        const onlineMachines = this.machineCache.getOnlineMachinesByNamespace(namespace)
        if (onlineMachines.length === 0) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const targetMachine = (() => {
            if (metadata.machineId) {
                const exact = onlineMachines.find((machine) => machine.id === metadata.machineId)
                if (exact) return exact
            }
            if (metadata.host) {
                const hostMatch = onlineMachines.find((machine) => machine.metadata?.host === metadata.host)
                if (hostMatch) return hostMatch
            }
            return null
        })()

        if (!targetMachine) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        // A woken session must come back with the settings it was started with, not the defaults.
        const { model, thinkEffort, serviceTier } = this.readSpawnPreferences(metadata, flavor)
        const yolo = await this.alwaysYolo() || (session.permissionMode !== undefined
            && YOLO_PERMISSION_MODES.has(session.permissionMode)
            && isPermissionModeAllowedForFlavor(session.permissionMode, flavor))
        // The native transcript lives in the account's config dir, so a pinned session wakes under its account.
        // Both attempts keep it: if the runner lacks the account, the wake fails with the reason instead of
        // silently starting on the default login without the transcript.
        const pinnedAccount = flavor === 'claude' ? metadata.claudeAccount : undefined

        const spawn = async (resumeSessionId?: string) => await this.rpcGateway.spawnSession(
            targetMachine.id,
            metadata.path,
            flavor,
            model,
            thinkEffort,
            serviceTier,
            yolo || undefined,
            undefined,
            undefined,
            resumeSessionId,
            pinnedAccount ? { accountId: pinnedAccount.id, automatic: pinnedAccount.automatic } : undefined,
            resumeSessionId ? pinnedAccount?.id : undefined
        )

        // Sessions that never produced a native transcript have no resume token, and
        // a stale token fails the native resume; fall back to a fresh agent process
        // that inherits the hub-side history via merge (same as copy history).
        let spawnResult = resumeToken ? await spawn(resumeToken) : await spawn(undefined)
        if (spawnResult.type !== 'success' && resumeToken) {
            spawnResult = await spawn(undefined)
        }

        if (spawnResult.type !== 'success') {
            return { type: 'error', message: spawnResult.message, code: 'resume_failed' }
        }

        const becameActive = await this.waitForSessionActive(spawnResult.sessionId)
        if (!becameActive) {
            return { type: 'error', message: 'Session failed to become active', code: 'resume_failed' }
        }

        if (spawnResult.sessionId !== access.sessionId) {
            try {
                await this.mergeSessions(access.sessionId, spawnResult.sessionId, namespace)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to merge resumed session'
                return { type: 'error', message, code: 'resume_failed' }
            }
        }

        return { type: 'success', sessionId: spawnResult.sessionId }
    }

    /**
     * Starts a session and sends it a first message once it runs. The message is stored like one from the web, with
     * `meta`, so memory can tell it is not the user's.
     */
    /** The system switch "every session in YOLO" (settings.json `alwaysYolo`); on unless the user turned it off. */
    async alwaysYolo(): Promise<boolean> {
        try {
            const settings = await readSettings(configuration.settingsFile)
            return settings !== null && settings.alwaysYolo !== false
        } catch {
            // No readable settings (e.g. not configured): each caller's own choice stands.
            return false
        }
    }

    /** The switch was turned on: sessions already running switch to YOLO too. Returns how many did. */
    async yoloRunningSessions(namespace: string): Promise<number> {
        let switched = 0
        for (const session of this.getSessionsByNamespace(namespace)) {
            if (!session.active) continue
            const flavor = session.metadata?.flavor ?? 'claude'
            const mode = yoloPermissionModeForFlavor(flavor)
            if (session.permissionMode === mode || !isPermissionModeAllowedForFlavor(mode, flavor)) continue
            try {
                await this.applySessionConfig(session.id, { permissionMode: mode })
                switched += 1
            } catch {
                // A session that does not answer keeps its mode; it starts in YOLO next time.
            }
        }
        return switched
    }

    async spawnAndPrompt(
        machineId: string,
        directory: string,
        options: {
            agent?: 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode'
            model?: string
            thinkEffort?: 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
            yolo?: boolean
            claudeAccount?: ClaudeAccountSelection
            sessionType?: 'simple' | 'worktree'
            worktreeName?: string
        },
        prompt: { text: string; meta?: Record<string, unknown>; files?: TaskFileContent[]; permissionMode?: PermissionMode }
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        const spawned = await this.spawnSession(
            machineId,
            directory,
            options.agent ?? 'claude',
            options.model,
            options.thinkEffort,
            undefined,
            options.yolo,
            options.sessionType ?? 'simple',
            options.worktreeName,
            undefined,
            undefined,
            options.claudeAccount
        )
        if (spawned.type === 'error') return spawned
        if (!await this.waitForSessionActive(spawned.sessionId)) {
            return { type: 'error', message: '会话没能在 15 秒内启动' }
        }
        // Before the first message, so the agent never acts under another mode.
        if (prompt.permissionMode) await this.applySessionConfig(spawned.sessionId, { permissionMode: prompt.permissionMode }).catch(() => {})
        const attachments = await this.uploadAll(spawned.sessionId, prompt.files ?? [])
        await this.sendMessage(spawned.sessionId, {
            text: prompt.text,
            sentFrom: 'webapp',
            meta: prompt.meta,
            ...(attachments.length > 0 ? { attachments } : {})
        })
        return spawned
    }

    /** Uploads files into a session for its first message. A file that fails is left out; the rest still go. */
    private async uploadAll(sessionId: string, files: TaskFileContent[]): Promise<AttachmentMetadata[]> {
        const attachments: AttachmentMetadata[] = []
        for (const file of files) {
            try {
                const result = await this.rpcGateway.uploadFile(sessionId, file.filename, file.content, file.mimeType)
                if (!result.success || !result.path) continue
                const size = Buffer.byteLength(file.content, 'base64')
                attachments.push({
                    id: randomUUID(),
                    filename: file.filename,
                    mimeType: file.mimeType,
                    size,
                    path: result.path,
                    ...(file.mimeType.startsWith('image/') && size <= PREVIEW_MAX_BYTES ? { previewUrl: `data:${file.mimeType};base64,${file.content}` } : {})
                })
            } catch {
                // The session reads the rest; the user still sees every file on the task page.
            }
        }
        return attachments
    }

    /**
     * What a session started for a task gets from the task: its files, and its default settings (model, thinking,
     * permission). Without settings the sessions start as before: medium thinking, the caller's own permission.
     */
    private taskSpawn(meta: Record<string, unknown>, machineId: string) {
        const owner = (meta.taskGuide ?? meta.taskWork) as { taskId?: unknown } | undefined
        const taskId = typeof owner?.taskId === 'string' ? owner.taskId : null
        const namespace = this.machineCache.getMachine(machineId)?.namespace ?? null
        const settings: TaskSessionSettings = taskId && namespace ? this.taskService.sessionSettings(namespace, taskId) : {}
        const files = taskId ? this.taskService.fileContents(taskId) : []
        return {
            options: <T extends { yolo?: boolean }>(base: T) => ({
                ...base,
                thinkEffort: settings.thinkEffort ?? 'medium' as const,
                ...(settings.model ? { model: settings.model } : {}),
                ...(settings.permissionMode ? { yolo: settings.permissionMode === 'bypassPermissions' } : {})
            }),
            prompt: (input: { text: string; meta: Record<string, unknown> }) => ({
                text: input.text, meta: input.meta, files, ...(settings.permissionMode ? { permissionMode: settings.permissionMode as PermissionMode } : {})
            })
        }
    }

    /**
     * Starts a scheduled run's session. For Claude on a machine with an account pool it tries the default account,
     * then the other enabled accounts of the same trust group, and moves on when an account is logged out (checked
     * before the start, or refused by the runner) or its session does not come up.
     */
    private async spawnScheduledRun(input: ScheduleSpawnInput): Promise<ScheduleSpawnResult> {
        const yolo = input.permissionMode === 'bypassPermissions' || input.permissionMode === 'yolo'
        const options = {
            agent: input.agent,
            ...(input.model ? { model: input.model } : {}),
            ...(input.thinkEffort ? { thinkEffort: input.thinkEffort as 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh' } : {}),
            yolo,
            sessionType: input.worktree ? 'worktree' as const : 'simple' as const,
            ...(input.worktree ? { worktreeName: `scheduled-${Date.now().toString(36)}` } : {})
        }
        const prompt = {
            text: input.text,
            meta: input.meta,
            ...(input.permissionMode ? { permissionMode: input.permissionMode as PermissionMode } : {})
        }
        const pool = input.agent === 'claude' ? await this.scheduledAccountOrder(input.machineId, input.accountId) : null
        const candidates: Array<{ id: string; automatic: boolean } | null> = pool && pool.ids.length > 0
            ? pool.ids.map((id) => ({ id, automatic: pool.autoSwitch }))
            : [null]
        const notes: string[] = []
        let attempts = 0
        for (const candidate of candidates) {
            if (candidate) {
                const check = await this.claudeAccounts(input.machineId, 'check', { id: candidate.id }).catch((error: unknown) => ({ error: String(error) }))
                const checkError = (check as { error?: unknown } | null)?.error
                if (typeof checkError === 'string') {
                    notes.push(`${candidate.id}: ${checkError}`)
                    continue
                }
            }
            attempts += 1
            const result = await this.spawnAndPrompt(input.machineId, input.directory, {
                ...options,
                ...(candidate ? { claudeAccount: { accountId: candidate.id, automatic: candidate.automatic } } : {})
            }, prompt)
            if (result.type === 'success') {
                await this.renameSession(result.sessionId, input.name).catch(() => {})
                const tags = this.getSession(result.sessionId)?.metadata?.tags ?? []
                if (!tags.includes('scheduled')) await this.setSessionTags(result.sessionId, [...tags, 'scheduled']).catch(() => {})
                const accountId = this.getSession(result.sessionId)?.metadata?.claudeAccount?.id ?? candidate?.id ?? null
                return {
                    sessionId: result.sessionId,
                    accountId,
                    attempts,
                    note: notes.length > 0 ? `${ACCOUNT_NOTE}：${notes.join('；')}` : null
                }
            }
            notes.push(`${candidate?.id ?? '默认账号'}: ${result.message}`)
            if (!candidate || !isAccountStartFailure(result.message)) break
        }
        return { error: notes.join('；') || '没有可用的账号', attempts }
    }

    /**
     * The account pool's start order: the task's own account (or the pool's default), then the other enabled accounts
     * of its trust group. Null without a pool.
     */
    private async scheduledAccountOrder(machineId: string, preferred: string | null): Promise<{ ids: string[]; autoSwitch: boolean } | null> {
        const reply = await this.claudeAccounts(machineId, 'get').catch(() => null) as { pool?: unknown } | null
        const parsed = ClaudeAccountPoolSchema.safeParse(reply?.pool)
        if (!parsed.success || parsed.data.profiles.length === 0) return null
        const pool = parsed.data
        const first = pool.profiles.find((profile) => profile.id === preferred && profile.enabled)
            ?? pool.profiles.find((profile) => profile.id === pool.initialAccount && profile.enabled)
        if (!first) return null
        const rest = pool.profiles.filter((profile) => profile.enabled && profile.id !== first.id && profile.trustGroup === first.trustGroup)
        return { ids: [first.id, ...rest.map((profile) => profile.id)], autoSwitch: pool.autoSwitch }
    }

    async waitForSessionActive(sessionId: string, timeoutMs: number = 15_000): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const session = this.getSession(sessionId)
            if (session?.active) {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return false
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        return await this.rpcGateway.checkPathsExist(machineId, paths)
    }

    async getMachineCodexCredentials(machineId: string): Promise<RpcCodexCredentialStateResponse> {
        return await this.rpcGateway.getMachineCodexCredentials(machineId)
    }

    async exportMachineCodexCredentials(machineId: string): Promise<RpcCodexCredentialExportRpcResponse> {
        return await this.rpcGateway.exportMachineCodexCredentials(machineId)
    }

    async importMachineCodexCredentials(
        machineId: string,
        payload: { content: string; name?: string }
    ): Promise<RpcCodexCredentialStateResponse> {
        return await this.rpcGateway.importMachineCodexCredentials(machineId, payload)
    }

    async saveCurrentMachineCodexCredentials(
        machineId: string,
        payload: { name?: string }
    ): Promise<RpcCodexCredentialStateResponse> {
        return await this.rpcGateway.saveCurrentMachineCodexCredentials(machineId, payload)
    }

    async activateMachineCodexCredential(
        machineId: string,
        profileId: string
    ): Promise<RpcCodexCredentialStateResponse> {
        return await this.rpcGateway.activateMachineCodexCredential(machineId, profileId)
    }

    async deleteMachineCodexCredential(
        machineId: string,
        profileId: string
    ): Promise<RpcCodexCredentialStateResponse> {
        return await this.rpcGateway.deleteMachineCodexCredential(machineId, profileId)
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitStatus(sessionId, cwd)
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffNumstat(sessionId, options)
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffFile(sessionId, options)
    }

    async readGitSnapshot(
        sessionId: string,
        options: { cwd?: string; filePath: string; source: 'head' | 'index' }
    ): Promise<RpcReadFileResponse> {
        return await this.rpcGateway.readGitSnapshot(sessionId, options)
    }

    async getCodexStatus(sessionId: string): Promise<RpcCodexStatusResponse> {
        return await this.rpcGateway.getCodexStatus(sessionId)
    }

    private normalizeQueueText(value: string | undefined): string | undefined {
        if (typeof value !== 'string') {
            return undefined
        }
        const normalized = value.trim()
        return normalized.length > 0 ? normalized : undefined
    }

    private normalizeQueuePreview(value: string | undefined): string | undefined {
        if (typeof value !== 'string') {
            return undefined
        }
        const normalized = value.trim()
        return normalized.length > 0 ? normalized : undefined
    }

    private buildQueuePreviewFromText(text: string | undefined): string | undefined {
        const normalized = this.normalizeQueueText(text)
        if (!normalized) {
            return undefined
        }
        const compact = normalized.replace(/\s+/g, ' ')
        return compact.length <= 180 ? compact : `${compact.slice(0, 180)}...`
    }

    private attachLocalQueueText(
        sessionId: string,
        queue: RpcCodexQueueState | undefined,
        enqueuedText?: string
    ): RpcCodexQueueState | undefined {
        if (!queue) {
            this.localQueueTextBySession.delete(sessionId)
            this.localQueueTextBySessionPreview.delete(sessionId)
            return queue
        }

        const previousMap = this.localQueueTextBySession.get(sessionId) ?? new Map<string, string>()
        const previousPreviewMap = this.localQueueTextBySessionPreview.get(sessionId) ?? new Map<string, string>()
        const nextMap = new Map<string, string>()
        const nextPreviewMap = new Map<string, string>()
        const nextEntries = queue.entries.map((entry) => {
            const normalizedFromEntry = this.normalizeQueueText(entry.fullText)
            const normalizedFromLocal = previousMap.get(entry.id)
            const previewKey = this.normalizeQueuePreview(entry.preview)
            const normalizedFromPreview = previewKey ? previousPreviewMap.get(previewKey) : undefined
            const resolvedFullText = normalizedFromEntry ?? normalizedFromLocal ?? normalizedFromPreview
            if (resolvedFullText) {
                nextMap.set(entry.id, resolvedFullText)
                if (previewKey) {
                    nextPreviewMap.set(previewKey, resolvedFullText)
                }
            }
            return resolvedFullText
                ? { ...entry, fullText: resolvedFullText }
                : entry
        })

        const normalizedEnqueuedText = this.normalizeQueueText(enqueuedText)
        if (normalizedEnqueuedText) {
            const previewKeyFromEnqueue = this.buildQueuePreviewFromText(normalizedEnqueuedText)
            if (previewKeyFromEnqueue) {
                nextPreviewMap.set(previewKeyFromEnqueue, normalizedEnqueuedText)
            }
            const unseenCandidates = nextEntries
                .map((entry, index) => ({ entry, index }))
                .filter(({ entry }) => !previousMap.has(entry.id))
            const missingFullTextCandidates = nextEntries
                .map((entry, index) => ({ entry, index }))
                .filter(({ entry }) => !this.normalizeQueueText(entry.fullText))
            const candidates = unseenCandidates.length > 0 ? unseenCandidates : missingFullTextCandidates

            let candidate: { entry: RpcCodexQueueState['entries'][number]; index: number } | null = null
            for (const current of candidates) {
                if (!candidate) {
                    candidate = current
                    continue
                }
                if (current.entry.enqueuedAt > candidate.entry.enqueuedAt) {
                    candidate = current
                    continue
                }
                if (current.entry.enqueuedAt === candidate.entry.enqueuedAt && current.index > candidate.index) {
                    candidate = current
                }
            }

            if (candidate) {
                const target = nextEntries[candidate.index]
                if (target) {
                    nextEntries[candidate.index] = {
                        ...target,
                        fullText: normalizedEnqueuedText
                    }
                    nextMap.set(target.id, normalizedEnqueuedText)
                    const previewKey = this.normalizeQueuePreview(target.preview)
                    if (previewKey) {
                        nextPreviewMap.set(previewKey, normalizedEnqueuedText)
                    }
                }
            }
        }

        if (nextMap.size > 0) {
            this.localQueueTextBySession.set(sessionId, nextMap)
        } else {
            this.localQueueTextBySession.delete(sessionId)
        }
        if (nextPreviewMap.size > 0) {
            this.localQueueTextBySessionPreview.set(sessionId, nextPreviewMap)
        } else {
            this.localQueueTextBySessionPreview.delete(sessionId)
        }

        return {
            ...queue,
            entries: nextEntries
        }
    }

    private attachLocalQueueTextToResponse(
        sessionId: string,
        response: RpcCodexQueueResponse,
        enqueuedText?: string
    ): RpcCodexQueueResponse {
        return {
            ...response,
            queue: this.attachLocalQueueText(sessionId, response.queue, enqueuedText)
        }
    }

    async getCodexQueue(sessionId: string): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.getCodexQueue(sessionId)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async enqueueCodexMessage(
        sessionId: string,
        payload: {
            text: string
            meta?: {
                routeContext?: {
                    groupId: string
                    taskId?: string
                    traceId?: string
                    source: string
                    targetSessionIds?: string[]
                }
            }
            attachments?: Array<{
                id: string
                filename: string
                mimeType: string
                size: number
                path: string
                previewUrl?: string
            }>
        }
    ): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.enqueueCodexMessage(sessionId, payload)
        return this.attachLocalQueueTextToResponse(sessionId, response, payload.text)
    }

    async removeCodexQueueItem(sessionId: string, id: string): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.removeCodexQueueItem(sessionId, id)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async moveCodexQueueItem(sessionId: string, id: string, toIndex: number): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.moveCodexQueueItem(sessionId, id, toIndex)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async updateCodexQueueItem(sessionId: string, id: string, text: string): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.updateCodexQueueItem(sessionId, id, text)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async clearCodexQueue(sessionId: string): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.clearCodexQueue(sessionId)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async getClaudeQueue(sessionId: string): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.getClaudeQueue(sessionId)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async enqueueClaudeMessage(
        sessionId: string,
        payload: {
            text: string
            meta?: {
                routeContext?: {
                    groupId: string
                    taskId?: string
                    traceId?: string
                    source: string
                    targetSessionIds?: string[]
                }
            }
            attachments?: Array<{
                id: string
                filename: string
                mimeType: string
                size: number
                path: string
                previewUrl?: string
            }>
        }
    ): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.enqueueClaudeMessage(sessionId, payload)
        return this.attachLocalQueueTextToResponse(sessionId, response, payload.text)
    }

    async removeClaudeQueueItem(sessionId: string, id: string): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.removeClaudeQueueItem(sessionId, id)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async moveClaudeQueueItem(sessionId: string, id: string, toIndex: number): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.moveClaudeQueueItem(sessionId, id, toIndex)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async updateClaudeQueueItem(sessionId: string, id: string, text: string): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.updateClaudeQueueItem(sessionId, id, text)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async clearClaudeQueue(sessionId: string): Promise<RpcCodexQueueResponse> {
        const response = await this.rpcGateway.clearClaudeQueue(sessionId)
        return this.attachLocalQueueTextToResponse(sessionId, response)
    }

    async readSessionFile(
        sessionId: string,
        path: string,
        options?: { maxBytes?: number; allowOutsideWorkingDirectory?: boolean }
    ): Promise<RpcReadFileResponse> {
        return await this.rpcGateway.readSessionFile(sessionId, path, options)
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.listDirectory(sessionId, path)
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.rpcGateway.uploadFile(sessionId, filename, content, mimeType)
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.rpcGateway.deleteUploadFile(sessionId, path)
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.rpcGateway.runRipgrep(sessionId, args, cwd)
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
        error?: string
    }> {
        return await this.rpcGateway.listSlashCommands(sessionId, agent)
    }

    async listSkills(sessionId: string): Promise<{
        success: boolean
        skills?: Array<{ name: string; description?: string }>
        error?: string
    }> {
        return await this.rpcGateway.listSkills(sessionId)
    }

    async listMcpServers(sessionId: string): Promise<RpcMcpServersResponse> {
        return await this.rpcGateway.listMcpServers(sessionId)
    }

    private async persistSessionPreviewUrlWithRetry(sessionId: string, previewUrl: string): Promise<void> {
        for (let attempt = 0; attempt < 10; attempt += 1) {
            try {
                await this.sessionCache.setPreviewUrl(sessionId, previewUrl)
                return
            } catch (error) {
                if (attempt >= 9) {
                    throw error
                }
                await new Promise((resolve) => setTimeout(resolve, 100))
            }
        }
    }

    // ---- ReviewLoop proxy methods ----

    getReviewLoopsByNamespace(namespace: string) {
        return this.reviewLoopService.getLoopsByNamespace(namespace)
    }

    getReviewLoopByNamespace(loopId: string, namespace: string) {
        return this.reviewLoopService.getLoopByNamespace(loopId, namespace)
    }

    createReviewLoop(options: {
        namespace: string
        workerSessionId: string
        reviewerSessionId: string
        requirement: string
        acceptanceCriteria: string
        maxRounds?: number
        userPreference?: 'auto' | 'verbose' | 'silent'
    }): ReviewLoopWithRounds {
        return this.reviewLoopService.createLoop(options)
    }

    deleteReviewLoop(loopId: string, namespace: string): boolean {
        return this.reviewLoopService.deleteLoop(loopId, namespace)
    }

    cancelReviewLoop(loopId: string, namespace: string) {
        return this.reviewLoopService.cancelLoop(loopId, namespace)
    }

    pauseReviewLoop(loopId: string, namespace: string) {
        return this.reviewLoopService.pauseLoop(loopId, namespace)
    }

    updateReviewLoopPreference(loopId: string, namespace: string, userPreference: 'auto' | 'verbose' | 'silent') {
        return this.reviewLoopService.updateUserPreference(loopId, namespace, userPreference)
    }

    updateReviewLoopMaxRounds(loopId: string, namespace: string, maxRounds: number) {
        return this.reviewLoopService.updateMaxRounds(loopId, namespace, maxRounds)
    }

    async startReviewRound(loopId: string, namespace: string, instruction: string) {
        return this.reviewLoopService.startRound(loopId, namespace, instruction)
    }

    async submitReviewWorkerOutput(loopId: string, namespace: string, roundId: string, workerOutput: unknown) {
        return this.reviewLoopService.submitWorkerOutput(loopId, namespace, roundId, workerOutput)
    }

    async submitReviewVerdict(loopId: string, namespace: string, roundId: string, verdict: ReviewVerdictInput) {
        return this.reviewLoopService.submitVerdict(loopId, namespace, roundId, verdict)
    }

    async userContinueReviewLoop(
        loopId: string,
        namespace: string,
        options?: { userPreference?: 'auto' | 'verbose' | 'silent'; additionalInstruction?: string }
    ) {
        return this.reviewLoopService.userContinue(loopId, namespace, options)
    }

    async initiateReviewLoop(loopId: string, namespace: string) {
        return this.reviewLoopService.initiateLoop(loopId, namespace)
    }

    // ---- ReviewLoop dispatch callbacks ----

    private async dispatchReviewLoopToWorker(payload: {
        loopId: string
        namespace: string
        roundId: string
        workerSessionId: string
        instruction: string
    }): Promise<void> {
        const session = this.getSessionByNamespace(payload.workerSessionId, payload.namespace)
        if (!session) {
            throw new Error(`Worker session ${payload.workerSessionId} not found`)
        }
        if (!session.active) {
            throw new Error(`Worker session ${payload.workerSessionId} is not active`)
        }

        const systemPrompt = `[SYSTEM] You are in a ReviewLoop (loop=${payload.loopId}, round=${payload.roundId}). Execute the instruction below. When done, call the review_loop_worker_submit tool with your results (including raw_response, diff, files_changed, commands, exit_status). The loop_id is "${payload.loopId}" and round_id is "${payload.roundId}".`

        const text = `${systemPrompt}\n\n---\n\n[ReviewLoop:${payload.loopId}] Round instruction:\n\n${payload.instruction}`

        try {
            await this.rpcGateway.enqueueClaudeMessage(payload.workerSessionId, {
                text,
                meta: {
                    routeContext: {
                        groupId: `review-loop:${payload.loopId}`,
                        taskId: payload.roundId,
                        traceId: payload.roundId,
                        source: `review-loop:${payload.loopId}`,
                        targetSessionIds: [payload.workerSessionId]
                    }
                }
            })
        } catch {
            // Fallback: send as regular message
            await this.messageService.sendMessage(payload.workerSessionId, { text })
        }
    }

    private async dispatchReviewLoopToReviewer(payload: {
        loopId: string
        namespace: string
        roundId: string
        reviewerSessionId: string
        workerOutput: unknown
        requirement: string
        acceptanceCriteria: string
        allRounds: unknown[]
        userPreference: string
    }): Promise<void> {
        const session = this.getSessionByNamespace(payload.reviewerSessionId, payload.namespace)
        if (!session) {
            throw new Error(`Reviewer session ${payload.reviewerSessionId} not found`)
        }
        if (!session.active) {
            throw new Error(`Reviewer session ${payload.reviewerSessionId} is not active`)
        }

        const isInitialDispatch = payload.workerOutput === null
        const workerOutputStr = payload.workerOutput
            ? JSON.stringify(payload.workerOutput, null, 2)
            : '(no worker output yet — this is the initial round)'

        const previousRoundsStr = payload.allRounds.length > 0
            ? JSON.stringify(payload.allRounds, null, 2)
            : '(no previous rounds)'

        const systemPrompt = `[SYSTEM] You are a ReviewLoop Reviewer (loop=${payload.loopId}, round=${payload.roundId}). Review the worker's output against the acceptance criteria. When you have formed your assessment, call the review_loop_reviewer_submit tool to provide your verdict.`

        let instructionSection: string
        if (isInitialDispatch) {
            instructionSection = `## Your Task
This is the INITIAL round. No worker output exists yet. You must generate the first instruction for the worker.
Analyze the requirement and acceptance criteria below, then call review_loop_reviewer_submit with:
- action: "continue"
- feedback: A clear, detailed instruction for the worker to begin the task
- progress: 0
- criteriaStatus: Initial assessment of each criterion (all "not_met" at this stage)`
        } else {
            instructionSection = `## Your Task
Review the worker's output below against the acceptance criteria. Then call review_loop_reviewer_submit with your verdict:
- action: "pass" if ALL criteria are met
- action: "continue" with feedback containing the next instruction if more work is needed
- action: "abort" if the task is fundamentally blocked or impossible
- action: "notify_user" if you need human input to proceed`
        }

        const text = `${systemPrompt}

${instructionSection}

## Requirement
${payload.requirement}

## Acceptance Criteria
${payload.acceptanceCriteria}

## Worker Output (Current Round)
${workerOutputStr}

## Previous Rounds History
${previousRoundsStr}

## User Preference
${payload.userPreference}

---
Remember: Call review_loop_reviewer_submit when you have formed your assessment.`

        try {
            await this.rpcGateway.enqueueClaudeMessage(payload.reviewerSessionId, {
                text,
                meta: {
                    routeContext: {
                        groupId: `review-loop:${payload.loopId}`,
                        taskId: payload.roundId,
                        traceId: payload.roundId,
                        source: `review-loop:${payload.loopId}`,
                        targetSessionIds: [payload.reviewerSessionId]
                    }
                }
            })
        } catch {
            await this.messageService.sendMessage(payload.reviewerSessionId, { text })
        }
    }

    private async notifyReviewLoopUser(payload: {
        loopId: string
        namespace: string
        message: string
        loopStatus: string
        round: number
        progress: number
    }): Promise<void> {
        // Emit a toast event to notify the user via web UI
        this.eventPublisher.emit({
            type: 'toast',
            namespace: payload.namespace,
            data: {
                title: `Review Loop [Round ${payload.round}]`,
                body: payload.message,
                sessionId: payload.loopId,
                url: `/review-loops/${payload.loopId}`
            }
        })
    }
}

function toTaskSession(session: Session): TaskSession {
    const metadata = session.metadata
    return {
        id: session.id,
        active: session.active,
        machineId: metadata?.machineId ?? null,
        path: metadata?.path ?? null,
        name: metadata?.name ?? metadata?.summary?.text ?? null,
        tags: metadata?.tags ?? [],
        updatedAt: session.updatedAt
    }
}

/** A start failure that another account may not have: a logged-out account, or a session that never came up. */
function isAccountStartFailure(message: string): boolean {
    return /尚未在隔离目录登录|claude auth login|账号身份检查失败|会话没能在 15 秒内启动|所选账号不存在或已停用|session_stale_relogin|invalid_grant|OAuth/i.test(message)
}
