import type { Database } from 'bun:sqlite'

import {
    addGroupMember,
    addGroupMessage,
    addGroupTask,
    createGroup,
    deleteGroup,
    getAllGroups,
    getGroup,
    getGroupByNamespace,
    getGroupMembersByNamespace,
    getGroupMessageByNamespace,
    getGroupMessages,
    getGroupTasks,
    getGroupsByNamespace,
    getActiveTaskNamespaces,
    getGroupNote,
    getGroupTaskByDedupeKey,
    hasGroupTaskForTargetSession,
    getGroupTaskByNamespace,
    removeGroupMember,
    replaceGroupSession,
    updateGroup,
    updateGroupNote,
    updateGroupTaskStatus,
    updateTaskFields,
    type TaskFieldsPatch
} from './groups'
import {
    appendGroupMessageToConversationTurns,
    getGroupConversationTurnById,
    getGroupConversationTurnMessagesPage,
    getGroupConversationTurns,
    rebuildAllGroupConversationTurns,
    rebuildGroupConversationTurns
} from './groupTurns'
import type {
    StoredGroup,
    StoredGroupKind,
    StoredTaskStatus,
    StoredGroupConversationTurn,
    StoredGroupMember,
    StoredGroupMessage,
    StoredGroupNote,
    StoredGroupTask
} from './types'

export class GroupStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    createGroup(options: {
        namespace: string
        name: string
        description?: string | null
        noteSessionId?: string | null
        members?: Array<{
            memberType: 'session' | 'human'
            sessionId?: string | null
            userId?: number | null
            role?: string
        }>
        task?: { id: string; tag: string; status: StoredTaskStatus; repoPath?: string | null; machineId?: string | null; employeeId?: string | null }
    }): StoredGroup {
        return createGroup(this.db, options)
    }

    updateTaskFields(options: { groupId: string; namespace: string; patch: TaskFieldsPatch }): StoredGroup | null {
        return updateTaskFields(this.db, options)
    }

    deleteGroup(options: {
        groupId: string
        namespace: string
    }): boolean {
        return deleteGroup(this.db, options)
    }

    getGroupsByNamespace(namespace: string, kind?: StoredGroupKind): StoredGroup[] {
        return getGroupsByNamespace(this.db, namespace, kind)
    }

    getActiveTaskNamespaces(): string[] {
        return getActiveTaskNamespaces(this.db)
    }

    getAllGroups(): StoredGroup[] {
        return getAllGroups(this.db)
    }

    getGroup(groupId: string): StoredGroup | null {
        return getGroup(this.db, groupId)
    }

    getGroupByNamespace(groupId: string, namespace: string): StoredGroup | null {
        return getGroupByNamespace(this.db, groupId, namespace)
    }

    getGroupMembersByNamespace(groupId: string, namespace: string): StoredGroupMember[] {
        return getGroupMembersByNamespace(this.db, groupId, namespace)
    }

    addGroupMember(options: {
        groupId: string
        namespace: string
        sessionId: string
        role?: string
    }): StoredGroupMember {
        return addGroupMember(this.db, options)
    }

    removeGroupMember(options: {
        groupId: string
        namespace: string
        sessionId: string
    }): boolean {
        return removeGroupMember(this.db, options)
    }

    replaceSession(options: { namespace: string; fromSessionId: string; toSessionId: string }): string[] {
        return replaceGroupSession(this.db, options)
    }

    updateGroup(options: {
        groupId: string
        namespace: string
        name?: string
        description?: string | null
        noteSessionId?: string | null
        archived?: boolean
    }): StoredGroup | null {
        return updateGroup(this.db, options)
    }

    addGroupMessage(options: {
        groupId: string
        namespace: string
        type: 'chat' | 'command' | 'task_state' | 'note_state' | 'system'
        traceId?: string | null
        taskId?: string | null
        source: string
        actorSessionId?: string | null
        actorName?: string | null
        targetSessionIds?: string[] | null
        quotedMessageId?: string | null
        payload: unknown
    }): StoredGroupMessage {
        try {
            this.db.exec('BEGIN')
            const message = addGroupMessage(this.db, options)
            appendGroupMessageToConversationTurns(this.db, message)
            this.db.exec('COMMIT')
            return message
        } catch (error) {
            this.db.exec('ROLLBACK')
            throw error
        }
    }

    getGroupMessageByNamespace(groupId: string, namespace: string, messageId: string): StoredGroupMessage | null {
        return getGroupMessageByNamespace(this.db, groupId, namespace, messageId)
    }

    getGroupMessages(groupId: string, namespace: string, limit?: number, beforeSeq?: number): StoredGroupMessage[] {
        return getGroupMessages(this.db, groupId, namespace, limit, beforeSeq)
    }

    getGroupTasks(groupId: string, namespace: string, limit?: number): StoredGroupTask[] {
        return getGroupTasks(this.db, groupId, namespace, limit)
    }

    getGroupNote(groupId: string, namespace: string): StoredGroupNote | null {
        return getGroupNote(this.db, groupId, namespace)
    }

    updateGroupNote(options: {
        groupId: string
        namespace: string
        content: string
        updatedBy?: string | null
    }): StoredGroupNote {
        return updateGroupNote(this.db, options)
    }

    addGroupTask(options: {
        groupId: string
        namespace: string
        traceId: string
        source: string
        targetSessionId: string
        command: string
        status?: 'pending' | 'enqueued' | 'running' | 'completed' | 'failed' | 'expired' | 'canceled' | 'manual_done'
        dedupeKey?: string | null
        expiresAt?: number | null
    }): StoredGroupTask {
        return addGroupTask(this.db, options)
    }

    getGroupTaskByNamespace(groupId: string, taskId: string, namespace: string): StoredGroupTask | null {
        return getGroupTaskByNamespace(this.db, groupId, taskId, namespace)
    }

    getGroupTaskByDedupeKey(groupId: string, namespace: string, dedupeKey: string): StoredGroupTask | null {
        return getGroupTaskByDedupeKey(this.db, groupId, namespace, dedupeKey)
    }

    hasGroupTaskForTargetSession(
        groupId: string,
        namespace: string,
        targetSessionId: string,
        excludeTaskId?: string
    ): boolean {
        return hasGroupTaskForTargetSession(this.db, {
            groupId,
            namespace,
            targetSessionId,
            ...(excludeTaskId ? { excludeTaskId } : {})
        })
    }

    updateGroupTaskStatus(options: {
        groupId: string
        taskId: string
        namespace: string
        status: 'pending' | 'enqueued' | 'running' | 'completed' | 'failed' | 'expired' | 'canceled' | 'manual_done'
        error?: string | null
    }): StoredGroupTask | null {
        return updateGroupTaskStatus(this.db, options)
    }

    getConversationTurns(
        groupId: string,
        namespace: string,
        limit: number = 200,
        beforeTurnIndex?: number
    ): StoredGroupConversationTurn[] {
        return getGroupConversationTurns(this.db, groupId, namespace, limit, beforeTurnIndex)
    }

    getConversationTurnById(groupId: string, namespace: string, turnId: string): StoredGroupConversationTurn | null {
        return getGroupConversationTurnById(this.db, groupId, namespace, turnId)
    }

    getConversationTurnMessagesPage(
        groupId: string,
        namespace: string,
        turnId: string,
        options: { limit: number; beforeSeq: number | null }
    ): {
        turn: StoredGroupConversationTurn
        messages: StoredGroupMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
            startSeq: number | null
            endSeq: number | null
        }
    } | null {
        return getGroupConversationTurnMessagesPage(this.db, groupId, namespace, turnId, options)
    }

    rebuildGroupConversationTurns(groupId: string, namespace: string): number {
        return rebuildGroupConversationTurns(this.db, groupId, namespace)
    }

    rebuildAllGroupConversationTurns(): number {
        return rebuildAllGroupConversationTurns(this.db)
    }
}
