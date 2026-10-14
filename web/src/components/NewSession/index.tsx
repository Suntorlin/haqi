import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent as ReactFormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { usePlatform } from '@/hooks/usePlatform'
import { useSpawnSession } from '@/hooks/mutations/useSpawnSession'
import { useExperimentalSettings } from '@/hooks/queries/useExperimentalSettings'
import { useSessions } from '@/hooks/queries/useSessions'
import { useActiveSuggestions, type Suggestion } from '@/hooks/useActiveSuggestions'
import { useDirectorySuggestions } from '@/hooks/useDirectorySuggestions'
import { useRecentPaths } from '@/hooks/useRecentPaths'
import { queryKeys } from '@/lib/query-keys'
import { normalizePreviewUrlInput } from '@/lib/preview-url'
import {
    CLAUDE_THINK_EFFORT_OPTIONS,
    CODEX_THINK_EFFORT_OPTIONS,
    MODEL_OPTIONS,
    getModelOptionsForAgent,
    getThinkEffortOptions,
    type AgentType,
    type ThinkEffort,
    type SessionType
} from './types'
import { ActionButtons } from './ActionButtons'
import { AgentSelector } from './AgentSelector'
import { MachineSelector, getMachineTitle } from './MachineSelector'
import { ProjectPicker } from './ProjectPicker'
import {
    loadLastSessionConfig,
    loadPreferredAgent,
    loadPreferredCustomModel,
    loadPreferredModel,
    loadPreferredSessionType,
    loadPreferredServiceTier,
    loadPreferredThinkEffort,
    loadPreferredYoloMode,
    saveLastSessionConfig,
    savePreferredAgent,
    savePreferredCustomModel,
    savePreferredModel,
    savePreferredSessionType,
    savePreferredServiceTier,
    savePreferredThinkEffort,
    savePreferredYoloMode,
} from './preferences'
import { SessionParams } from './SessionParams'
import { SessionTypeSelector } from './SessionTypeSelector'
import { resolveSpawnModel, resolveSpawnServiceTier, resolveSpawnSessionSettings, resolveSpawnThinkEffort } from './spawnPayload'
import { formatRunnerSpawnError } from '@/utils/formatRunnerSpawnError'
import { useTranslation } from '@/lib/use-translation'
import { TextField } from '@/components/ui/TextField'
import { FormField } from '@/components/ui/FormControls'
import { InputHistory } from '@/components/ui/InputHistory'
import { ChevronDownIcon, SlidersIcon } from '@/components/mobile/icons'
import { getProjectName } from '@/components/mobile/SessionAvatar'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { modelOptionText, thinkEffortText } from '@/lib/option-labels'
import { cn } from '@/lib/utils'

function getDefaultThinkEffort(agent: AgentType): ThinkEffort {
    if (agent === 'claude') {
        return CLAUDE_THINK_EFFORT_OPTIONS[0]?.value ?? 'auto'
    }
    if (agent === 'codex') {
        return CODEX_THINK_EFFORT_OPTIONS[0]?.value ?? 'auto'
    }
    return 'auto'
}

export function NewSession(props: {
    api: ApiClient
    machines: Machine[]
    isLoading?: boolean
    initialDirectory?: string
    initialMachineId?: string
    formId?: string
    onSuccess: (sessionId: string) => void | Promise<void>
    onCancel: () => void
}) {
    const { haptic } = usePlatform()
    const { spawnSession, isPending, error: spawnError } = useSpawnSession(props.api)
    const { settings: experimentalSettings } = useExperimentalSettings(props.api, true)
    const { sessions } = useSessions(props.api)
    const isFormDisabled = Boolean(isPending || props.isLoading)
    const { getRecentPaths, addRecentPath, getLastUsedMachineId, setLastUsedMachineId } = useRecentPaths()
    const lastSessionConfig = loadLastSessionConfig()
    const initialAgent = lastSessionConfig?.agent ?? loadPreferredAgent()
    const initialModel = (
        lastSessionConfig?.model && getModelOptionsForAgent(initialAgent).some((option) => option.value === lastSessionConfig.model)
            ? lastSessionConfig.model
            : (loadPreferredModel(initialAgent) ?? (getModelOptionsForAgent(initialAgent)[0]?.value ?? 'auto'))
    )
    const initialThinkEffort = (
        lastSessionConfig?.thinkEffort && getThinkEffortOptions(initialAgent).some((option) => option.value === lastSessionConfig.thinkEffort)
            ? lastSessionConfig.thinkEffort
            : (loadPreferredThinkEffort(initialAgent) ?? getDefaultThinkEffort(initialAgent))
    )

    const { t } = useTranslation()
    const previewUrlId = useId()
    const [machineId, setMachineId] = useState<string | null>(props.initialMachineId ?? null)
    const [claudeAccount, setClaudeAccount] = useState<ClaudeAccountSelection | undefined>()
    useEffect(() => { setClaudeAccount(undefined) }, [machineId])
    const [directory, setDirectory] = useState(props.initialDirectory ?? '')
    const [suppressSuggestions, setSuppressSuggestions] = useState(false)
    const [isDirectoryFocused, setIsDirectoryFocused] = useState(false)
    const [pathExistence, setPathExistence] = useState<Record<string, boolean>>({})
    const [agent, setAgent] = useState<AgentType>(initialAgent)
    const [model, setModel] = useState(initialModel)
    const [customModel, setCustomModel] = useState(() => lastSessionConfig?.customModel ?? loadPreferredCustomModel(initialAgent))
    const [thinkEffort, setThinkEffort] = useState<ThinkEffort>(initialThinkEffort)
    const [serviceTier, setServiceTier] = useState(() => (
        lastSessionConfig?.serviceTier
        ?? loadPreferredServiceTier(initialAgent)
        ?? 'auto'
    ))
    const [yoloMode, setYoloMode] = useState(() => lastSessionConfig?.yoloMode ?? loadPreferredYoloMode())
    const [sessionType, setSessionType] = useState<SessionType>(() => lastSessionConfig?.sessionType ?? loadPreferredSessionType())
    const [worktreeName, setWorktreeName] = useState(() => lastSessionConfig?.worktreeName ?? '')
    const [previewUrlInput, setPreviewUrlInput] = useState(() => lastSessionConfig?.previewUrl ?? '')
    const [error, setError] = useState<string | null>(null)
    // Machine, preview URL and session type are rarely changed: folded away unless a saved value is in play.
    const [showAdvanced, setShowAdvanced] = useState(() => sessionType === 'worktree' || previewUrlInput.trim().length > 0)
    const worktreeInputRef = useRef<HTMLInputElement>(null)
    const hasPresetDirectory = Boolean(props.initialDirectory?.trim())

    useEffect(() => {
        setMachineId(props.initialMachineId ?? null)
    }, [props.initialMachineId])

    useEffect(() => {
        setDirectory(props.initialDirectory ?? '')
    }, [props.initialDirectory])

    useEffect(() => {
        if (sessionType === 'worktree') {
            worktreeInputRef.current?.focus()
        }
    }, [sessionType])

    useEffect(() => {
        setModel(loadPreferredModel(agent) ?? (getModelOptionsForAgent(agent)[0]?.value ?? 'auto'))
        setCustomModel(loadPreferredCustomModel(agent))
        setThinkEffort(loadPreferredThinkEffort(agent) ?? getDefaultThinkEffort(agent))
        setServiceTier(loadPreferredServiceTier(agent) ?? 'auto')
    }, [agent])

    useEffect(() => {
        if (props.machines.length === 0) return
        if (machineId && props.machines.find((m) => m.id === machineId)) return

        const lastUsed = getLastUsedMachineId()
        const foundLast = lastUsed ? props.machines.find((m) => m.id === lastUsed) : null

        if (foundLast) {
            setMachineId(foundLast.id)
            if (!hasPresetDirectory) {
                const paths = getRecentPaths(foundLast.id)
                if (paths[0]) setDirectory(paths[0])
            }
        } else if (props.machines[0]) {
            setMachineId(props.machines[0].id)
        }
    }, [props.machines, machineId, getLastUsedMachineId, getRecentPaths, hasPresetDirectory])

    const selectedMachine = useMemo(
        () => (machineId ? props.machines.find((machine) => machine.id === machineId) ?? null : null),
        [machineId, props.machines]
    )
    const runnerSpawnError = useMemo(
        () => formatRunnerSpawnError(selectedMachine),
        [selectedMachine]
    )

    const recentPaths = useMemo(
        () => getRecentPaths(machineId),
        [getRecentPaths, machineId]
    )

    const modelOptions = useMemo(() => {
        return getModelOptionsForAgent(agent)
    }, [agent])
    const defaultModelValue = modelOptions[0]?.value ?? 'auto'

    useEffect(() => {
        if (customModel.trim() || model === defaultModelValue) {
            return
        }
        if (modelOptions.some((option) => option.value === model)) {
            return
        }
        setModel(defaultModelValue)
    }, [customModel, model, modelOptions, defaultModelValue])

    const previewUrlHistoryQuery = useQuery({
        queryKey: queryKeys.previewUrlHistory,
        queryFn: async () => {
            if (!props.api) {
                throw new Error('API unavailable')
            }
            return await props.api.getPreviewUrlHistory(20)
        },
        enabled: Boolean(props.api && experimentalSettings.previewEnabled),
        staleTime: 30_000
    })

    const previewUrlHistory = previewUrlHistoryQuery.data?.urls ?? []

    const allPaths = useDirectorySuggestions(machineId, sessions, recentPaths)

    const pathsToCheck = useMemo(
        () => Array.from(new Set(allPaths)).slice(0, 1000),
        [allPaths]
    )

    useEffect(() => {
        let cancelled = false

        if (!machineId || pathsToCheck.length === 0) {
            setPathExistence({})
            return () => { cancelled = true }
        }

        void props.api.checkMachinePathsExists(machineId, pathsToCheck)
            .then((result) => {
                if (cancelled) return
                setPathExistence(result.exists ?? {})
            })
            .catch(() => {
                if (cancelled) return
                setPathExistence({})
            })

        return () => {
            cancelled = true
        }
    }, [machineId, pathsToCheck, props.api])

    const verifiedPaths = useMemo(
        () => allPaths.filter((path) => pathExistence[path]),
        [allPaths, pathExistence]
    )

    const getSuggestions = useCallback(async (query: string): Promise<Suggestion[]> => {
        const lowered = query.toLowerCase()
        return verifiedPaths
            .filter((path) => path.toLowerCase().includes(lowered))
            .slice(0, 8)
            .map((path) => ({
                key: path,
                text: path,
                label: path
            }))
    }, [verifiedPaths])

    const activeQuery = (!isDirectoryFocused || suppressSuggestions) ? null : directory

    const [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions] = useActiveSuggestions(
        activeQuery,
        getSuggestions,
        { allowEmptyQuery: true, autoSelectFirst: false }
    )

    const handleMachineChange = useCallback((newMachineId: string) => {
        setMachineId(newMachineId)
        const paths = getRecentPaths(newMachineId)
        if (paths[0]) {
            setDirectory(paths[0])
        } else {
            setDirectory('')
        }
    }, [getRecentPaths])

    const handlePathClick = useCallback((path: string) => {
        setDirectory(path)
    }, [])

    const handleSuggestionSelect = useCallback((index: number) => {
        const suggestion = suggestions[index]
        if (suggestion) {
            setDirectory(suggestion.text)
            clearSuggestions()
            setSuppressSuggestions(true)
        }
    }, [suggestions, clearSuggestions])

    const handleDirectoryChange = useCallback((value: string) => {
        setSuppressSuggestions(false)
        setDirectory(value)
    }, [])

    const handleDirectoryFocus = useCallback(() => {
        setSuppressSuggestions(false)
        setIsDirectoryFocused(true)
    }, [])

    const handleDirectoryBlur = useCallback(() => {
        setIsDirectoryFocused(false)
    }, [])

    const handleDirectoryKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            return
        }

        if (suggestions.length === 0) return

        if (event.key === 'ArrowUp') {
            event.preventDefault()
            moveUp()
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault()
            moveDown()
        }

        if (event.key === 'Enter' || event.key === 'Tab') {
            if (selectedIndex >= 0) {
                event.preventDefault()
                handleSuggestionSelect(selectedIndex)
            }
        }

        if (event.key === 'Escape') {
            clearSuggestions()
        }
    }, [suggestions, selectedIndex, moveUp, moveDown, clearSuggestions, handleSuggestionSelect])

    async function handleCreate() {
        if (!machineId || !directory.trim()) return

        setError(null)
        try {
            const normalizedPreviewUrl = normalizePreviewUrlInput(
                experimentalSettings.previewEnabled ? previewUrlInput : ''
            )
            if (normalizedPreviewUrl.error) {
                setError(t(`preview.error.${normalizedPreviewUrl.error}`))
                return
            }

            const customModelValue = customModel.trim()
            const resolvedModel = resolveSpawnModel(agent, model, customModelValue)
            const resolvedThinkEffort = resolveSpawnThinkEffort(agent, thinkEffort)
            const resolvedServiceTier = resolveSpawnServiceTier(agent, serviceTier)
            const sessionSettings = resolveSpawnSessionSettings(
                sessionType,
                worktreeName,
                normalizedPreviewUrl.value ?? ''
            )
            const result = await spawnSession({
                machineId,
                directory: directory.trim(),
                agent,
                model: resolvedModel,
                thinkEffort: resolvedThinkEffort,
                serviceTier: resolvedServiceTier,
                yolo: yoloMode,
                sessionType: sessionSettings.sessionType,
                worktreeName: sessionSettings.worktreeName,
                previewUrl: sessionSettings.previewUrl,
                ...(agent === 'claude' && claudeAccount ? { claudeAccount } : {})
            })

            if (result.type === 'success') {
                haptic.notification('success')
                setLastUsedMachineId(machineId)
                addRecentPath(machineId, directory.trim())
                savePreferredAgent(agent)
                savePreferredModel(agent, model)
                savePreferredCustomModel(agent, customModelValue)
                savePreferredThinkEffort(agent, thinkEffort)
                savePreferredServiceTier(agent, serviceTier)
                savePreferredYoloMode(yoloMode)
                savePreferredSessionType(sessionType)
                saveLastSessionConfig({
                    agent,
                    model,
                    customModel: customModelValue,
                    thinkEffort,
                    serviceTier,
                    yoloMode,
                    sessionType,
                    worktreeName: worktreeName.trim(),
                    previewUrl: normalizedPreviewUrl.value ?? ''
                })
                await props.onSuccess(result.sessionId)
                return
            }

            haptic.notification('error')
            setError(result.message)
        } catch (e) {
            haptic.notification('error')
            setError(e instanceof Error ? e.message : t('newSession.createFailed'))
        }
    }

    const canCreate = Boolean(machineId && directory.trim() && !isFormDisabled)

    const handleSubmit = (event: ReactFormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (!canCreate) return
        void handleCreate()
    }

    const handleFormKeyDown = (event: ReactKeyboardEvent<HTMLFormElement>) => {
        if (event.key !== 'Enter') return
        if (!(event.metaKey || event.ctrlKey)) return
        if (event.nativeEvent.isComposing) return

        event.preventDefault()
        if (!canCreate) return
        void handleCreate()
    }

    const projectName = directory.trim() ? getProjectName(directory.trim()) : undefined
    const summary = useMemo(() => {
        const parts: string[] = []
        const customModelValue = customModel.trim()
        const modelOption = modelOptions.find((option) => option.value === model)
        if (customModelValue) {
            parts.push(customModelValue)
        } else if (modelOption) {
            parts.push(modelOptionText(modelOption.value, modelOption.label, t))
        }
        const thinkOption = getThinkEffortOptions(agent).find((option) => option.value === thinkEffort)
        if (thinkOption) {
            parts.push(t('composer.chip.think', { value: thinkEffortText(thinkOption.value, thinkOption.label, t) }))
        }
        if (yoloMode) parts.push(t('newSession.yolo'))
        if (sessionType === 'worktree') parts.push(t('newSession.type.worktree'))
        if (experimentalSettings.previewEnabled && previewUrlInput.trim()) parts.push(t('newSession.previewUrl'))
        if (props.machines.length > 1 && selectedMachine) parts.push(getMachineTitle(selectedMachine))
        return parts.join(' · ')
    }, [agent, customModel, model, modelOptions, thinkEffort, yoloMode, sessionType,
        experimentalSettings.previewEnabled, previewUrlInput, props.machines.length, selectedMachine, t])

    return (
        <form
            id={props.formId}
            className="mx-auto flex min-h-full w-full max-w-[560px] flex-col gap-6 px-4 pt-3"
            onKeyDown={handleFormKeyDown}
            onSubmit={handleSubmit}
        >
            {runnerSpawnError ? (
                <div className="px-1 text-[13px] text-[var(--social-danger)]">
                    {t('newSession.runnerError', { error: runnerSpawnError })}
                </div>
            ) : null}
            {!props.isLoading && props.machines.length === 0 ? (
                <div className="rounded-2xl bg-[var(--app-badge-warning-bg)] px-4 py-3 text-[13px] text-[var(--app-badge-warning-text)]">
                    {t('misc.noMachines')}
                </div>
            ) : null}
            <ProjectPicker
                directory={directory}
                suggestions={suggestions}
                selectedIndex={selectedIndex}
                isDisabled={isFormDisabled}
                recentPaths={recentPaths}
                onDirectoryChange={handleDirectoryChange}
                onDirectoryFocus={handleDirectoryFocus}
                onDirectoryBlur={handleDirectoryBlur}
                onDirectoryKeyDown={handleDirectoryKeyDown}
                onSuggestionSelect={handleSuggestionSelect}
                onPathClick={handlePathClick}
            />
            <AgentSelector
                agent={agent}
                isDisabled={isFormDisabled}
                onAgentChange={setAgent}
            />
            <div className="flex flex-col gap-4">
                <ListGroup>
                    <ListRow
                        icon={<SlidersIcon className="h-[18px] w-[18px]" />}
                        title={t('newSession.customize')}
                        subtitle={summary}
                        trailing={<ChevronDownIcon className={cn('h-4 w-4 text-[var(--social-fg-subtle)] transition-transform duration-150', showAdvanced && 'rotate-180')} />}
                        chevron={false}
                        aria-expanded={showAdvanced}
                        onClick={() => setShowAdvanced((open) => !open)}
                    />
                </ListGroup>
                {showAdvanced ? (
                    <div className="flex flex-col gap-5">
                        <SessionParams
                            key={agent}
                            api={props.api}
                            agent={agent}
                            machineId={machineId}
                            model={model}
                            customModel={customModel}
                            thinkEffort={thinkEffort}
                            serviceTier={serviceTier}
                            yoloMode={yoloMode}
                            claudeAccount={claudeAccount}
                            isDisabled={isFormDisabled}
                            onModelChange={setModel}
                            onCustomModelChange={setCustomModel}
                            onThinkEffortChange={setThinkEffort}
                            onServiceTierChange={setServiceTier}
                            onYoloChange={setYoloMode}
                            onClaudeAccountChange={setClaudeAccount}
                        />
                        <SessionTypeSelector
                            sessionType={sessionType}
                            worktreeName={worktreeName}
                            worktreeInputRef={worktreeInputRef}
                            isDisabled={isFormDisabled}
                            onSessionTypeChange={setSessionType}
                            onWorktreeNameChange={setWorktreeName}
                        />
                        {experimentalSettings.previewEnabled ? (
                            <FormField label={t('newSession.previewUrl')} htmlFor={previewUrlId} optional>
                                <InputHistory
                                    items={previewUrlHistory.slice(0, 8)}
                                    label={t('preview.history')}
                                    disabled={isFormDisabled}
                                    format={(url) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                                    onPick={setPreviewUrlInput}
                                >
                                    {({ trailing }) => (
                                        <TextField
                                            id={previewUrlId}
                                            type="text"
                                            placeholder="http://localhost:3000"
                                            value={previewUrlInput}
                                            onChange={(event) => setPreviewUrlInput(event.target.value)}
                                            disabled={isFormDisabled}
                                            trailing={trailing}
                                        />
                                    )}
                                </InputHistory>
                            </FormField>
                        ) : null}
                        {props.machines.length > 1 ? (
                            <MachineSelector
                                machines={props.machines}
                                machineId={machineId}
                                isLoading={props.isLoading}
                                isDisabled={isFormDisabled}
                                onChange={handleMachineChange}
                            />
                        ) : null}
                    </div>
                ) : null}
            </div>

            {(error ?? spawnError) ? (
                <div className="px-1 text-[13px] text-[var(--social-danger)]">
                    {error ?? spawnError}
                </div>
            ) : null}

            <ActionButtons
                isPending={isPending}
                canCreate={canCreate}
                projectName={projectName}
            />
        </form>
    )
}
