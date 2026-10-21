import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { TaskConfirmInput, TaskStatus, TaskView, TasksResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

/** Every task. The hub pushes `task-updated`, so there is no polling. */
export function useTasks(api: ApiClient | null): { tasks: TaskView[]; isLoading: boolean } {
    const { data, isLoading } = useQuery({
        queryKey: queryKeys.tasks,
        queryFn: async () => {
            if (!api) {
                throw new Error('No API client')
            }
            return await api.getTasks()
        },
        enabled: Boolean(api)
    })
    return { tasks: data?.tasks ?? [], isLoading }
}

/** Task actions; the list in the cache takes the server's answer at once. */
export function useTaskActions(api: ApiClient | null) {
    const queryClient = useQueryClient()

    const writeTask = useCallback((task: TaskView) => {
        queryClient.setQueryData<TasksResponse>(queryKeys.tasks, (previous) => {
            const tasks = previous?.tasks ?? []
            return {
                tasks: tasks.some((item) => item.id === task.id)
                    ? tasks.map((item) => item.id === task.id ? task : item)
                    : [task, ...tasks]
            }
        })
        return task
    }, [queryClient])

    const need = useCallback(() => {
        if (!api) throw new Error('No API client')
        return api
    }, [api])

    const createTask = useCallback(async (input: { text: string; tag: string; fromSessionId?: string }) => writeTask(await need().createTask(input)), [need, writeTask])
    const updateTask = useCallback(async (taskId: string, patch: { name?: string; tag?: string; status?: TaskStatus }) => writeTask(await need().updateTask(taskId, patch)), [need, writeTask])
    const reviseDraft = useCallback(async (taskId: string, text: string) => writeTask(await need().reviseTaskDraft(taskId, text)), [need, writeTask])
    const confirmTask = useCallback(async (taskId: string, input: TaskConfirmInput) => writeTask(await need().confirmTask(taskId, input)), [need, writeTask])
    const retryGuide = useCallback(async (taskId: string) => writeTask(await need().retryTaskGuide(taskId)), [need, writeTask])
    const linkSession = useCallback(async (taskId: string, sessionId: string, linked: boolean) => writeTask(linked
        ? await need().addTaskMember(taskId, sessionId)
        : await need().removeTaskMember(taskId, sessionId)), [need, writeTask])

    const deleteTask = useCallback(async (taskId: string) => {
        await need().deleteTask(taskId)
        queryClient.setQueryData<TasksResponse>(queryKeys.tasks, (previous) => previous
            ? { tasks: previous.tasks.filter((item) => item.id !== taskId) }
            : previous)
    }, [need, queryClient])

    return { createTask, updateTask, deleteTask, reviseDraft, confirmTask, retryGuide, linkSession }
}
