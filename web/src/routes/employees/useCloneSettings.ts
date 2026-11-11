import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'
import type { ApiClient } from '@/api/client'
import { loadLastSessionConfig, pickRememberedConfig, resolveSessionModelParams } from '@/components/NewSession/preferences'
import { resolveSpawnModel, resolveSpawnServiceTier, resolveSpawnThinkEffort } from '@/components/NewSession/spawnPayload'
import type { AgentType, ServiceTier, ThinkEffort } from '@/components/NewSession/types'
import { useExperimentalSettings } from '@/hooks/queries/useExperimentalSettings'
import { queryKeys } from '@/lib/query-keys'
import type { Employee } from '@/types/api'

export type CloneSpawnSettings = {
    model?: string
    thinkEffort?: ThinkEffort
    serviceTier?: 'fast' | 'flex'
    yolo: boolean
    claudeAccountId?: string
}

type CloneParams = {
    model: string
    customModel: string
    thinkEffort: ThinkEffort
    serviceTier: ServiceTier
    yoloMode: boolean
    claudeAccount?: ClaudeAccountSelection
}

/**
 * The settings a clone starts with, picked with the new-session form's rows. They open on the choices last used for
 * a new session (on any device), with YOLO on when the employee runs in bypassPermissions.
 */
export function useCloneSettings(api: ApiClient | null, employee: Employee | null | undefined) {
    const agent: AgentType = employee?.agent ?? 'claude'
    const sharedDefaults = useQuery({
        queryKey: queryKeys.newSessionDefaults,
        queryFn: () => api!.getNewSessionDefaults(),
        enabled: Boolean(api),
        staleTime: 0,
        retry: false
    }).data?.defaults
    const { settings: experimentalSettings } = useExperimentalSettings(api, true)
    const [params, setParams] = useState<CloneParams | null>(null)
    // Once a row is changed by hand, a late answer from the hub must not undo it.
    const editedRef = useRef(false)

    useEffect(() => {
        if (!employee || editedRef.current) return
        const remembered = resolveSessionModelParams(agent, pickRememberedConfig(loadLastSessionConfig(), sharedDefaults))
        setParams({ ...remembered, yoloMode: employee.permissionMode === 'bypassPermissions' })
    }, [employee?.id, employee?.permissionMode, agent, sharedDefaults])

    const edit = <K extends keyof CloneParams>(key: K) => (value: CloneParams[K]) => {
        editedRef.current = true
        setParams((current) => current ? { ...current, [key]: value } : current)
    }

    const spawnSettings = (): CloneSpawnSettings => {
        if (!params) return { yolo: false }
        const model = resolveSpawnModel(agent, params.model, params.customModel)
        const thinkEffort = resolveSpawnThinkEffort(agent, params.thinkEffort)
        const serviceTier = resolveSpawnServiceTier(agent, params.serviceTier)
        return {
            ...(model ? { model } : {}),
            ...(thinkEffort ? { thinkEffort } : {}),
            ...(serviceTier ? { serviceTier } : {}),
            yolo: params.yoloMode,
            ...(agent === 'claude' && params.claudeAccount ? { claudeAccountId: params.claudeAccount.accountId } : {})
        }
    }

    return { agent, params, alwaysYolo: experimentalSettings.alwaysYolo, edit, spawnSettings }
}
