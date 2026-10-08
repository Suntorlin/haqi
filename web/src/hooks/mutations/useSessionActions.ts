import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import type { ApiClient } from '@/api/client'
import type { PermissionMode } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { clearMessageWindow } from '@/lib/message-window-store'
import { removeCachedSessionDetail } from '@/lib/session-detail-cache'
import { isKnownFlavor } from '@/lib/agentFlavorUtils'

type SessionThinkEffort = 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
type SessionServiceTier = 'auto' | 'fast' | 'flex'

export function useSessionActions(
    api: ApiClient | null,
    sessionId: string | null,
    agentFlavor?: string | null
): {
    abortSession: () => Promise<void>
    stopAndPreserveCodexQueue: () => Promise<void>
    archiveSession: () => Promise<void>
    switchSession: () => Promise<void>
    setPermissionMode: (mode: PermissionMode) => Promise<void>
    setModel: (model: string) => Promise<void>
    setThinkEffort: (thinkEffort: SessionThinkEffort) => Promise<void>
    setServiceTier: (serviceTier: SessionServiceTier) => Promise<void>
    setCollaborationMode: (mode: 'default' | 'plan') => Promise<void>
    renameSession: (name: string) => Promise<void>
    setTags: (tags: string[]) => Promise<void>
    deleteSession: () => Promise<void>
    spawnSameConfigSession: () => Promise<string>
    duplicateSession: () => Promise<string>
    resumeSession: () => Promise<string>
    isPending: boolean
} {
    const queryClient = useQueryClient()

    const invalidateSession = async () => {
        if (!sessionId) return
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    }

    const abortMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.abortSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const stopAndPreserveCodexQueueMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            const result = await api.stopAndPreserveCodexQueue(sessionId)
            if (!result.success) {
                throw new Error(result.error || 'Failed to stop Codex while preserving queue')
            }
        },
        onSuccess: () => void invalidateSession(),
    })

    const archiveMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.archiveSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const switchMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.switchSession(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    const permissionMutation = useMutation({
        mutationFn: async (mode: PermissionMode) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            if (isKnownFlavor(agentFlavor) && !isPermissionModeAllowedForFlavor(mode, agentFlavor)) {
                throw new Error('Invalid permission mode for session flavor')
            }
            await api.setPermissionMode(sessionId, mode)
        },
        onSuccess: () => void invalidateSession(),
    })

    const modelMutation = useMutation({
        mutationFn: async (model: string) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setModel(sessionId, model)
        },
        onSuccess: () => void invalidateSession(),
    })

    const thinkEffortMutation = useMutation({
        mutationFn: async (thinkEffort: SessionThinkEffort) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setThinkEffort(sessionId, thinkEffort)
        },
        onSuccess: () => void invalidateSession(),
    })

    const collaborationModeMutation = useMutation({
        mutationFn: async (mode: 'default' | 'plan') => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setCollaborationMode(sessionId, mode)
        },
        onSuccess: () => void invalidateSession(),
    })

    const serviceTierMutation = useMutation({
        mutationFn: async (serviceTier: SessionServiceTier) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.setServiceTier(sessionId, serviceTier)
        },
        onSuccess: () => void invalidateSession(),
    })

    const renameMutation = useMutation({
        mutationFn: async (name: string) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.renameSession(sessionId, name)
        },
        onSuccess: () => void invalidateSession(),
    })

    const tagsMutation = useMutation({
        mutationFn: async (tags: string[]) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.updateSessionTags(sessionId, tags)
        },
        onSuccess: () => void invalidateSession(),
    })

    const deleteMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            await api.deleteSession(sessionId)
        },
        onSuccess: async () => {
            if (!sessionId) return
            queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
            clearMessageWindow(sessionId)
            removeCachedSessionDetail(sessionId)
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    const resumeMutation = useMutation({
        mutationFn: async () => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.resumeSession(sessionId)
        },
        onSuccess: async (resumedSessionId) => {
            if (!sessionId) return
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) }),
                resumedSessionId === sessionId
                    ? Promise.resolve()
                    : queryClient.invalidateQueries({ queryKey: queryKeys.session(resumedSessionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
            ])
        },
    })

    const spawnFromExistingMutation = useMutation({
        mutationFn: async (inheritHistory: boolean) => {
            if (!api || !sessionId) {
                throw new Error('Session unavailable')
            }
            return await api.spawnSessionFromExisting(sessionId, inheritHistory)
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    const spawnFromExistingSession = async (inheritHistory: boolean): Promise<string> => {
        const result = await spawnFromExistingMutation.mutateAsync(inheritHistory)
        if (result.type !== 'success') {
            throw new Error(result.message || 'Failed to spawn session from existing')
        }
        return result.sessionId
    }

    return {
        abortSession: abortMutation.mutateAsync,
        stopAndPreserveCodexQueue: stopAndPreserveCodexQueueMutation.mutateAsync,
        archiveSession: archiveMutation.mutateAsync,
        switchSession: switchMutation.mutateAsync,
        setPermissionMode: permissionMutation.mutateAsync,
        setModel: modelMutation.mutateAsync,
        setThinkEffort: thinkEffortMutation.mutateAsync,
        setServiceTier: serviceTierMutation.mutateAsync,
        setCollaborationMode: collaborationModeMutation.mutateAsync,
        renameSession: renameMutation.mutateAsync,
        setTags: tagsMutation.mutateAsync,
        deleteSession: deleteMutation.mutateAsync,
        spawnSameConfigSession: async () => await spawnFromExistingSession(false),
        duplicateSession: async () => await spawnFromExistingSession(true),
        resumeSession: resumeMutation.mutateAsync,
        isPending: abortMutation.isPending
            || stopAndPreserveCodexQueueMutation.isPending
            || archiveMutation.isPending
            || switchMutation.isPending
            || permissionMutation.isPending
            || modelMutation.isPending
            || thinkEffortMutation.isPending
            || serviceTierMutation.isPending
            || collaborationModeMutation.isPending
            || renameMutation.isPending
            || tagsMutation.isPending
            || deleteMutation.isPending
            || resumeMutation.isPending
            || spawnFromExistingMutation.isPending,
    }
}
