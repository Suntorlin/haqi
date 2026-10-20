import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionTask, SessionTasksResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function useSessionTasks(api: ApiClient | null): { tasks: SessionTask[]; isLoading: boolean } {
    const { data, isLoading } = useQuery({
        queryKey: queryKeys.sessionTasks,
        queryFn: async () => {
            if (!api) {
                throw new Error('No API client')
            }
            return await api.getSessionTasks()
        },
        enabled: Boolean(api),
        // Tasks change rarely and only by hand; other devices catch up on focus or within a minute.
        refetchInterval: 60_000
    })
    return { tasks: data?.tasks ?? [], isLoading }
}

/** Create / edit / delete tasks; the list in the cache updates as soon as the server answers. */
export function useSessionTaskActions(api: ApiClient | null) {
    const queryClient = useQueryClient()

    const writeTask = useCallback((task: SessionTask) => {
        queryClient.setQueryData<SessionTasksResponse>(queryKeys.sessionTasks, (previous) => {
            const tasks = previous?.tasks ?? []
            return {
                tasks: tasks.some((item) => item.id === task.id)
                    ? tasks.map((item) => item.id === task.id ? task : item)
                    : [...tasks, task]
            }
        })
    }, [queryClient])

    const createTask = useCallback(async (input: { tag: string; title: string }) => {
        if (!api) return
        writeTask(await api.createSessionTask(input))
    }, [api, writeTask])

    const updateTask = useCallback(async (taskId: string, patch: { title?: string; status?: SessionTask['status'] }) => {
        if (!api) return
        writeTask(await api.updateSessionTask(taskId, patch))
    }, [api, writeTask])

    const deleteTask = useCallback(async (taskId: string) => {
        if (!api) return
        await api.deleteSessionTask(taskId)
        queryClient.setQueryData<SessionTasksResponse>(queryKeys.sessionTasks, (previous) => previous
            ? { tasks: previous.tasks.filter((item) => item.id !== taskId) }
            : previous)
    }, [api, queryClient])

    return { createTask, updateTask, deleteTask }
}
