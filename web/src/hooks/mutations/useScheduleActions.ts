import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ScheduledTaskInput, ScheduledTaskPatch } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

function requireApi(api: ApiClient | null): ApiClient {
    if (!api) throw new Error('No API client')
    return api
}

/** Create, edit, pause / resume, delete and run-now for scheduled tasks. Each refreshes the list and the detail. */
export function useScheduleActions(api: ApiClient | null) {
    const queryClient = useQueryClient()
    const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.schedules })

    const create = useMutation({
        mutationFn: async (input: ScheduledTaskInput) => (await requireApi(api).createSchedule(input)).schedule,
        onSuccess: invalidate,
    })

    const update = useMutation({
        mutationFn: async (args: { id: string; patch: ScheduledTaskPatch }) => (await requireApi(api).updateSchedule(args.id, args.patch)).schedule,
        onSuccess: invalidate,
    })

    const remove = useMutation({
        mutationFn: async (id: string) => {
            await requireApi(api).deleteSchedule(id)
        },
        onSuccess: (_data, id) => {
            queryClient.removeQueries({ queryKey: queryKeys.schedule(id) })
            return invalidate()
        },
    })

    const runNow = useMutation({
        mutationFn: async (id: string) => (await requireApi(api).runScheduleNow(id)).run,
        // A 409 can mean the last run is still open: refresh so the page shows it.
        onSettled: invalidate,
    })

    return { create, update, remove, runNow }
}
