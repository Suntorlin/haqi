import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { AttachmentMetadata } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useGroupActions(api: ApiClient | null, groupId: string | null): {
    createGroup: (payload: {
        name: string
        description?: string
        noteSessionId?: string
        sessionMemberIds?: string[]
    }) => Promise<string>
    postMessage: (payload: {
        type: 'chat' | 'command' | 'task_state' | 'note_state' | 'system'
        text?: string
        attachments?: AttachmentMetadata[]
        payload?: unknown
        traceId?: string
        taskId?: string
        source?: string
        actorSessionId?: string
        actorName?: string
        targetSessionIds?: string[]
        quotedMessageId?: string
    }) => Promise<void>
    updateNote: (payload: { content: string; updatedBy?: string }) => Promise<void>
    refreshNote: (payload?: { source?: string; command?: string }) => Promise<void>
    broadcastNote: () => Promise<void>
    claimTask: (taskId: string) => Promise<void>
    doneTask: (taskId: string) => Promise<void>
    cancelTask: (taskId: string) => Promise<void>
    addMember: (sessionId: string) => Promise<void>
    removeMember: (sessionId: string) => Promise<void>
    updateGroup: (payload: { name?: string; description?: string | null; noteSessionId?: string | null; notePrompt?: string | null; archived?: boolean }) => Promise<void>
    deleteGroup: () => Promise<void>
    isPending: boolean
} {
    const queryClient = useQueryClient()

    const invalidateGroup = async (targetGroupId?: string | null) => {
        const id = targetGroupId ?? groupId
        await queryClient.invalidateQueries({ queryKey: queryKeys.groups })
        if (!id) {
            return
        }
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: queryKeys.group(id) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.groupMessages(id) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.groupTasks(id) }),
            queryClient.invalidateQueries({ queryKey: queryKeys.groupNote(id) })
        ])
    }

    const createGroupMutation = useMutation({
        mutationFn: async (payload: {
            name: string
            description?: string
            noteSessionId?: string
            sessionMemberIds?: string[]
        }) => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const result = await api.createGroup(payload)
            return result.group.group.id
        },
        onSuccess: async (createdGroupId) => {
            await invalidateGroup(createdGroupId)
        }
    })

    const postMessageMutation = useMutation({
        mutationFn: async (payload: {
            type: 'chat' | 'command' | 'task_state' | 'note_state' | 'system'
            text?: string
            attachments?: AttachmentMetadata[]
            payload?: unknown
            traceId?: string
            taskId?: string
            source?: string
            actorSessionId?: string
            actorName?: string
            targetSessionIds?: string[]
            quotedMessageId?: string
        }) => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.postGroupMessage(groupId, payload)
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    const updateNoteMutation = useMutation({
        mutationFn: async (payload: { content: string; updatedBy?: string }) => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.updateGroupNote(groupId, payload)
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    const refreshNoteMutation = useMutation({
        mutationFn: async (payload?: { source?: string; command?: string }) => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.refreshGroupNote(groupId, payload)
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    const broadcastNoteMutation = useMutation({
        mutationFn: async () => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.broadcastGroupNote(groupId)
        },
        onSuccess: async () => {
            // 刷新消息列表以显示广播消息
            if (groupId) {
                await queryClient.invalidateQueries({ queryKey: queryKeys.groupMessages(groupId) })
            }
        }
    })

    const claimTaskMutation = useMutation({
        mutationFn: async (taskId: string) => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.claimGroupTask(groupId, taskId)
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    const doneTaskMutation = useMutation({
        mutationFn: async (taskId: string) => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.doneGroupTask(groupId, taskId)
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    const cancelTaskMutation = useMutation({
        mutationFn: async (taskId: string) => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.cancelGroupTask(groupId, taskId)
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    const addMemberMutation = useMutation({
        mutationFn: async (sessionId: string) => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.addGroupMember(groupId, { sessionId })
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    const removeMemberMutation = useMutation({
        mutationFn: async (sessionId: string) => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.removeGroupMember(groupId, sessionId)
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    const updateGroupMutation = useMutation({
        mutationFn: async (payload: { name?: string; description?: string | null; noteSessionId?: string | null; notePrompt?: string | null; archived?: boolean }) => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.updateGroup(groupId, payload)
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    const deleteGroupMutation = useMutation({
        mutationFn: async () => {
            if (!api || !groupId) {
                throw new Error('Group unavailable')
            }
            await api.deleteGroup(groupId)
        },
        onSuccess: async () => {
            await invalidateGroup(groupId)
        }
    })

    return {
        createGroup: createGroupMutation.mutateAsync,
        postMessage: postMessageMutation.mutateAsync,
        updateNote: updateNoteMutation.mutateAsync,
        refreshNote: refreshNoteMutation.mutateAsync,
        broadcastNote: broadcastNoteMutation.mutateAsync,
        claimTask: claimTaskMutation.mutateAsync,
        doneTask: doneTaskMutation.mutateAsync,
        cancelTask: cancelTaskMutation.mutateAsync,
        addMember: addMemberMutation.mutateAsync,
        removeMember: removeMemberMutation.mutateAsync,
        updateGroup: updateGroupMutation.mutateAsync,
        deleteGroup: deleteGroupMutation.mutateAsync,
        isPending: createGroupMutation.isPending
            || postMessageMutation.isPending
            || updateNoteMutation.isPending
            || refreshNoteMutation.isPending
            || broadcastNoteMutation.isPending
            || claimTaskMutation.isPending
            || doneTaskMutation.isPending
            || cancelTaskMutation.isPending
            || addMemberMutation.isPending
            || removeMemberMutation.isPending
            || updateGroupMutation.isPending
            || deleteGroupMutation.isPending
    }
}
