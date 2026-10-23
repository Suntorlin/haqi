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

/** One task: draft, guide state, acceptance list and load. Refreshed by `task-updated` (its key is under `tasks`). */
export function useTask(api: ApiClient | null, taskId: string | null): { task: TaskView | null; isLoading: boolean } {
    const { data, isLoading } = useQuery({
        queryKey: queryKeys.task(taskId ?? ''),
        queryFn: async () => {
            if (!api || !taskId) throw new Error('No API client')
            return await api.getTask(taskId)
        },
        enabled: Boolean(api && taskId)
    })
    return { task: data ?? null, isLoading }
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
        queryClient.setQueryData(queryKeys.task(task.id), task)
        return task
    }, [queryClient])

    const need = useCallback(() => {
        if (!api) throw new Error('No API client')
        return api
    }, [api])

    const createTask = useCallback(async (input: Parameters<ApiClient['createTask']>[0]) => writeTask(await need().createTask(input)), [need, writeTask])
    const updateTask = useCallback(async (taskId: string, patch: { name?: string; tag?: string; status?: TaskStatus }) => writeTask(await need().updateTask(taskId, patch)), [need, writeTask])
    const reviseDraft = useCallback(async (taskId: string, text: string) => writeTask(await need().reviseTaskDraft(taskId, text)), [need, writeTask])
    const confirmTask = useCallback(async (taskId: string, input: TaskConfirmInput) => writeTask(await need().confirmTask(taskId, input)), [need, writeTask])
    const answerDecision = useCallback(async (taskId: string, decisionId: string, label: string) => writeTask(await need().answerTaskDecision(taskId, decisionId, label)), [need, writeTask])
    const askDecision = useCallback(async (taskId: string, decisionId: string, text: string) => {
        const result = await need().askTaskDecision(taskId, decisionId, text)
        writeTask(result.task)
        return result.to
    }, [need, writeTask])
    const verdict = useCallback(async (taskId: string, input: { approved: boolean; text?: string }) => writeTask(await need().taskVerdict(taskId, input)), [need, writeTask])
    const reopen = useCallback(async (taskId: string) => writeTask(await need().reopenTask(taskId)), [need, writeTask])
    const restartSubtask = useCallback(async (taskId: string, subtaskId: string) => writeTask(await need().restartTaskSubtask(taskId, subtaskId)), [need, writeTask])
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

    return { createTask, updateTask, deleteTask, reviseDraft, confirmTask, retryGuide, linkSession, answerDecision, askDecision, verdict, reopen, restartSubtask }
}
