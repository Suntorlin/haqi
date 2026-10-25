import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ScheduledRun, ScheduledTask } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { accountsKey } from '@/components/ClaudeAccounts/Settings'

function errorText(error: unknown, fallback: string): string | null {
    if (!error) return null
    return error instanceof Error ? error.message : fallback
}

/** Every scheduled task of the namespace; schedule-updated events keep it fresh. */
export function useSchedules(api: ApiClient | null) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: queryKeys.schedules,
        queryFn: async () => {
            if (!api) {
                throw new Error('No API client')
            }
            return await api.getSchedules()
        },
        enabled: Boolean(api),
    })

    return {
        schedules: (data?.schedules ?? []) as ScheduledTask[],
        isLoading,
        error: errorText(error, 'Failed to load scheduled tasks'),
        refetch,
    }
}

/** One task and its recent runs, newest first. */
export function useSchedule(api: ApiClient | null, scheduleId: string | null) {
    const { data, isLoading, error, refetch } = useQuery({
        queryKey: queryKeys.schedule(scheduleId ?? ''),
        queryFn: async () => {
            if (!api || !scheduleId) {
                throw new Error('No API client or schedule ID')
            }
            return await api.getSchedule(scheduleId)
        },
        enabled: Boolean(api && scheduleId),
    })

    return {
        schedule: (data?.schedule ?? null) as ScheduledTask | null,
        runs: (data?.runs ?? []) as ScheduledRun[],
        isLoading,
        error: errorText(error, 'Failed to load scheduled task'),
        refetch,
    }
}

/** The machine's Claude accounts, for the task's start account; shares the cache with the account settings. */
export function useClaudeAccountPool(api: ApiClient | null, machineId: string | null, enabled: boolean) {
    const query = useQuery({
        queryKey: accountsKey(machineId ?? ''),
        queryFn: async () => {
            if (!api || !machineId) {
                throw new Error('No API client or machine ID')
            }
            return await api.getClaudeAccounts(machineId)
        },
        enabled: Boolean(api && machineId && enabled),
        retry: false,
    })
    return query.data?.pool ?? null
}
