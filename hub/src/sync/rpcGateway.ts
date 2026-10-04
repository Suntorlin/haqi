import type { ClaudeAccountSelection, ClaudeAccountPoolView } from '@hapi/protocol/schemas'
import type {
    CodexCredentialExportResponse,
    CodexCredentialStateResponse,
    ModelMode,
    PermissionMode
} from '@hapi/protocol/types'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'

export type RpcCommandResponse = {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

export type RpcReadFileResponse = {
    success: boolean
    content?: string
    size?: number
    truncated?: boolean
    error?: string
}

export type RpcUploadFileResponse = {
    success: boolean
    path?: string
    error?: string
}

export type RpcDeleteUploadResponse = {
    success: boolean
    error?: string
}

export type RpcDirectoryEntry = {
    name: string
    type: 'file' | 'directory' | 'other'
    size?: number
    modified?: number
}

export type RpcListDirectoryResponse = {
    success: boolean
    entries?: RpcDirectoryEntry[]
    error?: string
}

export type RpcPathExistsResponse = {
    exists: Record<string, boolean>
}

export type RpcCodexCredentialStateResponse = CodexCredentialStateResponse
export type RpcCodexCredentialExportRpcResponse = CodexCredentialExportResponse

export type RpcCodexStatusResponse = {
    success: boolean
    message?: string
    error?: string
    queue?: RpcCodexQueueSummary
}

export type RpcCodexQueueSummary = {
    pendingCount: number
    inQueue: boolean
    taskRunning: boolean
    nextPreview?: string
}

export type RpcCodexQueueEntry = {
    id: string
    index: number
    preview: string
    fullText?: string
    modeHash: string
    isolate: boolean
    deferredUserMessage?: boolean
    enqueuedAt: number
}

export type RpcCodexQueueState = RpcCodexQueueSummary & {
    entries: RpcCodexQueueEntry[]
}

export type RpcCodexQueueResponse = {
    success: boolean
    error?: string
    queue?: RpcCodexQueueState
    removedId?: string
    movedId?: string
    clearedCount?: number
}

export type RpcMcpServerResponse = {
    name: string
    status: string
    available: boolean
    enabled?: boolean
    connected?: boolean
    transport?: 'http' | 'stdio' | 'sse' | 'unknown'
    target?: string
    auth?: string
    source?: 'cli-config' | 'runtime-bridge' | 'combined'
}

export type RpcMcpServersResponse = {
    success: boolean
    flavor?: string
    servers?: RpcMcpServerResponse[]
    checkedAt?: number
    warning?: string
    error?: string
}

export class RpcGateway {
    constructor(
        private readonly io: Server,
        private readonly rpcRegistry: RpcRegistry
    ) {
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        allowTools?: string[],
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        reason?: string,
        answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: true,
            mode,
            allowTools,
            decision,
            reason,
            answers
        })
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        reason?: string
    ): Promise<void> {
        await this.sessionRpc(sessionId, 'permission', {
            id: requestId,
            approved: false,
            decision,
            reason
        })
    }

    async abortSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'abort', { reason: 'User aborted via Telegram Bot' })
    }

    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.sessionRpc(sessionId, 'switch', { to })
    }

    async requestSessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            modelMode?: ModelMode
            model?: string
            thinkEffort?: 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
            serviceTier?: 'fast' | 'flex'
            collaborationMode?: string | null
        }
    ): Promise<unknown> {
        return await this.sessionRpc(sessionId, 'set-session-config', config)
    }

    async killSession(sessionId: string): Promise<void> {
        await this.sessionRpc(sessionId, 'killSession', {})
    }

    async claudeAccounts(machineId: string, operation: 'get' | 'save' | 'check', payload: unknown = {}): Promise<unknown> {
        return this.machineRpc(machineId, `claude-accounts-${operation}`, payload)
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
        claudeAccount?: ClaudeAccountSelection,
        sourceClaudeAccountId?: string
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        try {
            const result = await this.machineRpc(
                machineId,
                'spawn-happy-session',
                { type: 'spawn-in-directory', directory, agent, model, thinkEffort, serviceTier, yolo, sessionType, worktreeName, resumeSessionId, claudeAccount, sourceClaudeAccountId }
            )
            if (result && typeof result === 'object') {
                const obj = result as Record<string, unknown>
                if (obj.type === 'success' && typeof obj.sessionId === 'string') {
                    return { type: 'success', sessionId: obj.sessionId }
                }
                if (obj.type === 'error' && typeof obj.errorMessage === 'string') {
                    return { type: 'error', message: obj.errorMessage }
                }
                if (obj.type === 'requestToApproveDirectoryCreation' && typeof obj.directory === 'string') {
                    return { type: 'error', message: `Directory creation requires approval: ${obj.directory}` }
                }
                if (typeof obj.error === 'string') {
                    return { type: 'error', message: obj.error }
                }
                if (obj.type !== 'success' && typeof obj.message === 'string') {
                    return { type: 'error', message: obj.message }
                }
            }
            const details = typeof result === 'string'
                ? result
                : (() => {
                    try {
                        return JSON.stringify(result)
                    } catch {
                        return String(result)
                    }
                })()
            return { type: 'error', message: `Unexpected spawn result: ${details}` }
        } catch (error) {
            return { type: 'error', message: error instanceof Error ? error.message : String(error) }
        }
    }

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        const result = await this.machineRpc(machineId, 'path-exists', { paths }) as RpcPathExistsResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const existsValue = (result as RpcPathExistsResponse).exists
        if (!existsValue || typeof existsValue !== 'object') {
            throw new Error('Unexpected path-exists result')
        }

        const exists: Record<string, boolean> = {}
        for (const [key, value] of Object.entries(existsValue)) {
            exists[key] = value === true
        }
        return exists
    }

    async getMachineCodexCredentials(machineId: string): Promise<RpcCodexCredentialStateResponse> {
        const result = await this.machineRpc(machineId, 'codex-credentials-status', {}) as RpcCodexCredentialStateResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected codex-credentials-status result')
        }
        return result as RpcCodexCredentialStateResponse
    }

    async exportMachineCodexCredentials(machineId: string): Promise<RpcCodexCredentialExportRpcResponse> {
        const result = await this.machineRpc(machineId, 'codex-credentials-export-current', {}) as RpcCodexCredentialExportRpcResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected codex-credentials-export-current result')
        }
        return result as RpcCodexCredentialExportRpcResponse
    }

    async importMachineCodexCredentials(
        machineId: string,
        payload: { content: string; name?: string }
    ): Promise<RpcCodexCredentialStateResponse> {
        const result = await this.machineRpc(machineId, 'codex-credentials-import', payload) as RpcCodexCredentialStateResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected codex-credentials-import result')
        }
        return result as RpcCodexCredentialStateResponse
    }

    async saveCurrentMachineCodexCredentials(
        machineId: string,
        payload: { name?: string }
    ): Promise<RpcCodexCredentialStateResponse> {
        const result = await this.machineRpc(machineId, 'codex-credentials-save-current', payload) as RpcCodexCredentialStateResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected codex-credentials-save-current result')
        }
        return result as RpcCodexCredentialStateResponse
    }

    async activateMachineCodexCredential(
        machineId: string,
        profileId: string
    ): Promise<RpcCodexCredentialStateResponse> {
        const result = await this.machineRpc(machineId, 'codex-credentials-activate', { profileId }) as RpcCodexCredentialStateResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected codex-credentials-activate result')
        }
        return result as RpcCodexCredentialStateResponse
    }

    async deleteMachineCodexCredential(
        machineId: string,
        profileId: string
    ): Promise<RpcCodexCredentialStateResponse> {
        const result = await this.machineRpc(machineId, 'codex-credentials-delete', { profileId }) as RpcCodexCredentialStateResponse | unknown
        if (!result || typeof result !== 'object') {
            throw new Error('Unexpected codex-credentials-delete result')
        }
        return result as RpcCodexCredentialStateResponse
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-status', { cwd }) as RpcCommandResponse
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-numstat', options) as RpcCommandResponse
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'git-diff-file', options) as RpcCommandResponse
    }

    async readGitSnapshot(
        sessionId: string,
        options: { cwd?: string; filePath: string; source: 'head' | 'index' }
    ): Promise<RpcReadFileResponse> {
        return await this.sessionRpc(sessionId, 'git-read-snapshot', options) as RpcReadFileResponse
    }

    async getCodexStatus(sessionId: string): Promise<RpcCodexStatusResponse> {
        return await this.sessionRpc(sessionId, 'get-codex-status', {}) as RpcCodexStatusResponse
    }

    async getCodexQueue(sessionId: string): Promise<RpcCodexQueueResponse> {
        try {
            return await this.sessionRpc(sessionId, 'get-codex-queue', {}) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'get-codex-queue')) {
                throw error
            }

            const fallbackStatus = await this.getCodexStatus(sessionId).catch(() => null)
            const summary = fallbackStatus?.queue
            return {
                success: false,
                error: 'Queue management is unavailable for this session. Please restart the session.',
                queue: summary
                    ? {
                        pendingCount: summary.pendingCount,
                        inQueue: summary.inQueue,
                        taskRunning: summary.taskRunning,
                        nextPreview: summary.nextPreview,
                        entries: []
                    }
                    : undefined
            }
        }
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
                appendSystemPrompt?: string
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
        try {
            return await this.sessionRpc(sessionId, 'enqueue-codex-message', payload) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'enqueue-codex-message')) {
                throw error
            }
            return {
                success: false,
                error: 'Queue enqueue is unavailable for this session. Please restart the session.'
            }
        }
    }

    async removeCodexQueueItem(sessionId: string, id: string): Promise<RpcCodexQueueResponse> {
        try {
            return await this.sessionRpc(sessionId, 'remove-codex-queue-item', { id }) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'remove-codex-queue-item')) {
                throw error
            }
            return {
                success: false,
                error: 'Queue mutation is unavailable for this session. Please restart the session.'
            }
        }
    }

    async moveCodexQueueItem(sessionId: string, id: string, toIndex: number): Promise<RpcCodexQueueResponse> {
        try {
            return await this.sessionRpc(sessionId, 'move-codex-queue-item', { id, toIndex }) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'move-codex-queue-item')) {
                throw error
            }
            return {
                success: false,
                error: 'Queue mutation is unavailable for this session. Please restart the session.'
            }
        }
    }

    async clearCodexQueue(sessionId: string): Promise<RpcCodexQueueResponse> {
        try {
            return await this.sessionRpc(sessionId, 'clear-codex-queue', {}) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'clear-codex-queue')) {
                throw error
            }
            return {
                success: false,
                error: 'Queue mutation is unavailable for this session. Please restart the session.'
            }
        }
    }

    async stopAndPreserveCodexQueue(sessionId: string): Promise<RpcCodexQueueResponse> {
        try {
            return await this.sessionRpc(sessionId, 'stop-and-preserve-codex-queue', {}) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'stop-and-preserve-codex-queue')) {
                throw error
            }
            return {
                success: false,
                error: 'Queue-preserving stop is unavailable for this session. Please restart the session.'
            }
        }
    }

    async getClaudeQueue(sessionId: string): Promise<RpcCodexQueueResponse> {
        try {
            return await this.sessionRpc(sessionId, 'get-claude-queue', {}) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'get-claude-queue')) {
                throw error
            }
            return {
                success: false,
                error: 'Claude queue management is unavailable for this session. Please restart the session.'
            }
        }
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
                appendSystemPrompt?: string
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
        try {
            return await this.sessionRpc(sessionId, 'enqueue-claude-message', payload) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'enqueue-claude-message')) {
                throw error
            }
            return {
                success: false,
                error: 'Claude queue enqueue is unavailable for this session. Please restart the session.'
            }
        }
    }

    async removeClaudeQueueItem(sessionId: string, id: string): Promise<RpcCodexQueueResponse> {
        try {
            return await this.sessionRpc(sessionId, 'remove-claude-queue-item', { id }) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'remove-claude-queue-item')) {
                throw error
            }
            return {
                success: false,
                error: 'Queue mutation is unavailable for this session. Please restart the session.'
            }
        }
    }

    async moveClaudeQueueItem(sessionId: string, id: string, toIndex: number): Promise<RpcCodexQueueResponse> {
        try {
            return await this.sessionRpc(sessionId, 'move-claude-queue-item', { id, toIndex }) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'move-claude-queue-item')) {
                throw error
            }
            return {
                success: false,
                error: 'Queue mutation is unavailable for this session. Please restart the session.'
            }
        }
    }

    async clearClaudeQueue(sessionId: string): Promise<RpcCodexQueueResponse> {
        try {
            return await this.sessionRpc(sessionId, 'clear-claude-queue', {}) as RpcCodexQueueResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'clear-claude-queue')) {
                throw error
            }
            return {
                success: false,
                error: 'Queue mutation is unavailable for this session. Please restart the session.'
            }
        }
    }

    async readSessionFile(
        sessionId: string,
        path: string,
        options?: { maxBytes?: number; allowOutsideWorkingDirectory?: boolean }
    ): Promise<RpcReadFileResponse> {
        return await this.sessionRpc(sessionId, 'readFile', {
            path,
            maxBytes: options?.maxBytes,
            allowOutsideWorkingDirectory: options?.allowOutsideWorkingDirectory
        }) as RpcReadFileResponse
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.sessionRpc(sessionId, 'listDirectory', { path }) as RpcListDirectoryResponse
    }

    async uploadFile(sessionId: string, filename: string, content: string, mimeType: string): Promise<RpcUploadFileResponse> {
        return await this.sessionRpc(sessionId, 'uploadFile', { sessionId, filename, content, mimeType }) as RpcUploadFileResponse
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.sessionRpc(sessionId, 'deleteUpload', { sessionId, path }) as RpcDeleteUploadResponse
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.sessionRpc(sessionId, 'ripgrep', { args, cwd }) as RpcCommandResponse
    }

    async listSlashCommands(sessionId: string, agent: string): Promise<{
        success: boolean
        commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSlashCommands', { agent }) as {
            success: boolean
            commands?: Array<{ name: string; description?: string; source: 'builtin' | 'user' | 'plugin' | 'project' }>
            error?: string
        }
    }

    async listSkills(sessionId: string): Promise<{
        success: boolean
        skills?: Array<{ name: string; description?: string }>
        error?: string
    }> {
        return await this.sessionRpc(sessionId, 'listSkills', {}) as {
            success: boolean
            skills?: Array<{ name: string; description?: string }>
            error?: string
        }
    }

    async listMcpServers(sessionId: string): Promise<RpcMcpServersResponse> {
        try {
            return await this.sessionRpc(sessionId, 'listMcpServers', {}) as RpcMcpServersResponse
        } catch (error) {
            if (!this.isMissingRpcHandler(error, 'listMcpServers')) {
                throw error
            }
            return {
                success: false,
                error: 'MCP availability check is unavailable for this session. Please restart the session.'
            }
        }
    }

    private async sessionRpc(sessionId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${sessionId}:${method}`, params)
    }

    private async machineRpc(machineId: string, method: string, params: unknown): Promise<unknown> {
        return await this.rpcCall(`${machineId}:${method}`, params)
    }

    private async rpcCall(method: string, params: unknown): Promise<unknown> {
        const socketId = this.rpcRegistry.getSocketIdForMethod(method)
        if (!socketId) {
            throw new Error(`RPC handler not registered: ${method}`)
        }

        const socket = this.io.of('/cli').sockets.get(socketId)
        if (!socket) {
            throw new Error(`RPC socket disconnected: ${method}`)
        }

        const response = await socket.timeout(30_000).emitWithAck('rpc-request', {
            method,
            params: JSON.stringify(params)
        }) as unknown

        if (typeof response !== 'string') {
            return response
        }

        try {
            return JSON.parse(response) as unknown
        } catch {
            return response
        }
    }

    private isMissingRpcHandler(error: unknown, method: string): boolean {
        const message = error instanceof Error ? error.message : String(error)
        return message.includes('RPC handler not registered')
            && message.includes(`:${method}`)
    }
}
