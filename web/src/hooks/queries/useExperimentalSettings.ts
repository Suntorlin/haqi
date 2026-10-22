import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export function useExperimentalSettings(api: ApiClient | null, enabled: boolean): {
    settings: {
        claudeLoginShell: boolean
        codexReportPromptEnabled: boolean
        previewEnabled: boolean
        alwaysYolo: boolean
    }
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const query = useQuery({
        queryKey: queryKeys.experimentalSettings,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            return await api.getExperimentalSettings()
        },
        enabled: Boolean(api && enabled),
        staleTime: 30_000
    })

    return {
        settings: {
            claudeLoginShell: query.data?.settings.claudeLoginShell ?? false,
            codexReportPromptEnabled: query.data?.settings.codexReportPromptEnabled ?? false,
            previewEnabled: query.data?.settings.previewEnabled ?? true,
            alwaysYolo: query.data?.settings.alwaysYolo ?? true
        },
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load experimental settings' : null,
        refetch: query.refetch
    }
}
