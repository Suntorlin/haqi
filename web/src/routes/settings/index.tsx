import { ClaudeAccountsSettings } from '@/components/ClaudeAccounts/Settings'
import { MachinesSettings } from '@/components/Machines/MachinesSettings'
import { useState, useEffect, useMemo, useCallback, type ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation, type Locale } from '@/lib/use-translation'
import { getElevenLabsSupportedLanguages, getLanguageDisplayName, type Language } from '@/lib/languages'
import { getFontScaleOptions, useFontScale, type FontScale } from '@/hooks/useFontScale'
import { useArchiveConfirmation } from '@/hooks/useArchiveConfirmation'
import { useEnterBehavior } from '@/hooks/useEnterBehavior'
import { useQueueInlinePanel, type QueueInlinePanelMode } from '@/hooks/useQueueInlinePanel'
import { useCodexSendModePreference } from '@/hooks/useCodexSendModePreference'
import { useMobileQueueEmptyStatePreference } from '@/hooks/useMobileQueueEmptyStatePreference'
import {
    useSessionReopenPositionPreference,
    type SessionReopenPositionPreference
} from '@/hooks/useSessionReopenPositionPreference'
import { useProjectQuickCreate } from '@/hooks/useProjectQuickCreate'
import { useSessionQuickArchive } from '@/hooks/useSessionQuickArchive'
import {
    useImageUploadCompression,
    type ImageUploadCompressionLevel,
    type ImageUploadCompressionTargetSize
} from '@/hooks/useImageUploadCompression'
import { useThemePreference, type ThemePreference } from '@/hooks/useTheme'
import { useAppContext } from '@/lib/app-context'
import { useMemory } from '@/hooks/queries/useMemory'
import { useMachines } from '@/hooks/queries/useMachines'
import { queryKeys } from '@/lib/query-keys'
import { PROTOCOL_VERSION } from '@hapi/protocol'
import { MobilePageHeader, MobileTabBar } from '@/components/mobile/MobileTabBar'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import type { CodexCredentialProfile, CodexCredentialStateResponse } from '@/types/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SelectInput } from '@/components/ui/FormControls'
import { TextField } from '@/components/ui/TextField'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import {
    SettingsBlock,
    SettingsCard,
    SettingsGroup,
    SettingsNotice,
    SettingsPanel,
    SettingsSelectRow,
    SettingsStat,
    SettingsSwitchRow,
    SettingsValueRow
} from '@/components/settings/SettingsParts'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/ui/EmptyState'
import { FitText } from '@/components/ui/FitText'

const locales: { value: Locale; nativeLabel: string }[] = [
    { value: 'en', nativeLabel: 'English' },
    { value: 'zh-CN', nativeLabel: '简体中文' },
]

const voiceLanguages = getElevenLabsSupportedLanguages()
const themePreferences: ThemePreference[] = ['light', 'dark', 'system']
const queueInlinePanelModes: QueueInlinePanelMode[] = ['off', 'compact', 'full']
const codexSendModes = ['direct', 'queue'] as const
const sessionReopenPositionModes: SessionReopenPositionPreference[] = ['bottom', 'restore', 'bottom-if-unread']
const imageUploadCompressionLevels: ImageUploadCompressionLevel[] = ['light', 'balanced', 'aggressive']
const imageUploadCompressionTargetSizes: ImageUploadCompressionTargetSize[] = ['auto', '500kb', '1mb', '2mb', '5mb']
const SETTINGS_GROUP_EXPANDED_STORAGE_KEY = 'hapi-settings-group-expanded-v1'

type SettingsGroupExpandedState = {
    claudeAccounts: boolean
    machines: boolean
    general: boolean
    interaction: boolean
    dataDiagnostics: boolean
    about: boolean
}

function getDefaultSettingsGroupExpandedState(): SettingsGroupExpandedState {
    return {
        claudeAccounts: false,
        machines: false,
        general: true,
        interaction: true,
        dataDiagnostics: false,
        about: false
    }
}

function readSettingsGroupExpandedState(): SettingsGroupExpandedState {
    if (typeof window === 'undefined') {
        return getDefaultSettingsGroupExpandedState()
    }
    const defaults = getDefaultSettingsGroupExpandedState()
    try {
        const rawValue = window.localStorage.getItem(SETTINGS_GROUP_EXPANDED_STORAGE_KEY)
        if (!rawValue) {
            return defaults
        }
        const parsed = JSON.parse(rawValue)
        if (!parsed || typeof parsed !== 'object') {
            return defaults
        }
        return {
            claudeAccounts: typeof parsed.claudeAccounts === 'boolean' ? parsed.claudeAccounts : defaults.claudeAccounts,
            machines: typeof parsed.machines === 'boolean' ? parsed.machines : defaults.machines,
            general: typeof parsed.general === 'boolean' ? parsed.general : defaults.general,
            interaction: typeof parsed.interaction === 'boolean' ? parsed.interaction : defaults.interaction,
            dataDiagnostics: typeof parsed.dataDiagnostics === 'boolean' ? parsed.dataDiagnostics : defaults.dataDiagnostics,
            about: typeof parsed.about === 'boolean' ? parsed.about : defaults.about
        }
    } catch {
        return defaults
    }
}

function persistSettingsGroupExpandedState(state: SettingsGroupExpandedState) {
    if (typeof window === 'undefined') {
        return
    }
    window.localStorage.setItem(SETTINGS_GROUP_EXPANDED_STORAGE_KEY, JSON.stringify(state))
}

type TranslationFn = (key: string, params?: Record<string, string | number>) => string

function formatCodexCredentialSummary(
    summary: CodexCredentialStateResponse['current']['summary'],
    t: TranslationFn
): string[] {
    if (!summary) {
        return []
    }

    const rows: string[] = []
    if (summary.authMode) {
        rows.push(`${t('settings.codexCredentials.summary.authMode')}: ${summary.authMode}`)
    }
    if (summary.email) {
        rows.push(`${t('settings.codexCredentials.summary.email')}: ${summary.email}`)
    }
    if (summary.organizationTitle) {
        rows.push(`${t('settings.codexCredentials.summary.organization')}: ${summary.organizationTitle}`)
    }
    if (summary.planType) {
        rows.push(`${t('settings.codexCredentials.summary.plan')}: ${summary.planType}`)
    }
    rows.push(`${t('settings.codexCredentials.summary.apiKey')}: ${summary.hasOpenAiApiKey ? t('settings.codexCredentials.summary.present') : t('settings.codexCredentials.summary.absent')}`)
    rows.push(`${t('settings.codexCredentials.summary.tokens')}: ${summary.hasTokens ? t('settings.codexCredentials.summary.present') : t('settings.codexCredentials.summary.absent')}`)
    if (summary.lastRefresh) {
        rows.push(`${t('settings.codexCredentials.summary.lastRefresh')}: ${summary.lastRefresh}`)
    }
    return rows
}

function downloadTextFile(filename: string, content: string): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
        return
    }

    const blob = new Blob([content], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
}

export default function SettingsPage() {
    const { t, locale, setLocale } = useTranslation()
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const isMobileLayout = useIsMobileLayout()
    const [groupExpandedState, setGroupExpandedState] = useState<SettingsGroupExpandedState>(() => readSettingsGroupExpandedState())
    const isClaudeAccountsGroupExpanded = groupExpandedState.claudeAccounts
    const isGeneralGroupExpanded = groupExpandedState.general
    const isInteractionGroupExpanded = groupExpandedState.interaction
    const isDataDiagnosticsGroupExpanded = groupExpandedState.dataDiagnostics
    const isAboutGroupExpanded = groupExpandedState.about
    const { fontScale, setFontScale } = useFontScale()
    const { themePreference, setThemePreference } = useThemePreference()
    const { queueInlinePanelMode, setQueueInlinePanelMode } = useQueueInlinePanel()
    const { mobileQueueEmptyStatePreference, setMobileQueueEmptyStatePreference } = useMobileQueueEmptyStatePreference()
    const { codexSendModeDefault, setCodexSendModeDefault } = useCodexSendModePreference()
    const { sessionReopenPosition, setSessionReopenPosition } = useSessionReopenPositionPreference()
    const {
        imageUploadCompressionEnabled,
        imageUploadCompressionLevel,
        imageUploadCompressionTargetSize,
        setImageUploadCompressionEnabled,
        setImageUploadCompressionLevel,
        setImageUploadCompressionTargetSize
    } = useImageUploadCompression()

    // Voice language state - read from localStorage
    const [voiceLanguage, setVoiceLanguage] = useState<string | null>(() => {
        if (typeof window === 'undefined') {
            return null
        }
        return window.localStorage.getItem('hapi-voice-lang')
    })
    const [usageLoading, setUsageLoading] = useState(false)
    const [usageError, setUsageError] = useState<string | null>(null)
    const [usageOverview, setUsageOverview] = useState<Awaited<ReturnType<typeof api.getUsageOverview>>['overview'] | null>(null)
    const { memory, isLoading: memoryLoading, error: memoryError, refetch: refetchMemory } = useMemory(api)
    const [memoryDraft, setMemoryDraft] = useState('')
    const [memorySavedContent, setMemorySavedContent] = useState('')
    const [memoryStatusMessage, setMemoryStatusMessage] = useState<string | null>(null)
    const [experimentalClaudeLoginShellEnabled, setExperimentalClaudeLoginShellEnabled] = useState(false)
    const [experimentalCodexReportPromptEnabled, setExperimentalCodexReportPromptEnabled] = useState(false)
    const [experimentalPreviewEnabled, setExperimentalPreviewEnabled] = useState(true)
    const [alwaysYolo, setAlwaysYolo] = useState(true)
    const [yoloStatusMessage, setYoloStatusMessage] = useState<string | null>(null)
    const [experimentalSettingsLoading, setExperimentalSettingsLoading] = useState(false)
    const [experimentalStatusMessage, setExperimentalStatusMessage] = useState<string | null>(null)
    const isMemoryDirty = memoryDraft !== memorySavedContent
    const [pendingConfirm, setPendingConfirm] = useState<{
        title: string
        description: string
        confirmLabel: string
        confirmingLabel: string
        destructive: boolean
        run: () => Promise<void>
    } | null>(null)
    const [isConfirmPending, setIsConfirmPending] = useState(false)
    const [reportDomainDraft, setReportDomainDraft] = useState('')
    const [reportDomainSaved, setReportDomainSaved] = useState('')
    const [reportDomainSource, setReportDomainSource] = useState<'env' | 'file' | 'default'>('default')
    const [reportDomainEnvOverride, setReportDomainEnvOverride] = useState(false)
    const [reportDomainLoading, setReportDomainLoading] = useState(false)
    const [reportDomainStatusMessage, setReportDomainStatusMessage] = useState<string | null>(null)
    const isReportDomainDirty = reportDomainDraft.trim() !== reportDomainSaved.trim()
    const memoryInjectionEnabled = memory?.enabled ?? false
    const pureContextModeEnabled = memory?.pureContextMode ?? false
    const { machines } = useMachines(api, true)
    const activeMachines = useMemo(() => machines.filter((machine) => machine.active), [machines])
    const [selectedCodexMachineId, setSelectedCodexMachineId] = useState('')
    const [codexCredentialState, setCodexCredentialState] = useState<CodexCredentialStateResponse | null>(null)
    const [codexCredentialLoading, setCodexCredentialLoading] = useState(false)
    const [codexCredentialExporting, setCodexCredentialExporting] = useState(false)
    const [codexCredentialActionPendingId, setCodexCredentialActionPendingId] = useState<string | null>(null)
    const [codexCredentialStatusMessage, setCodexCredentialStatusMessage] = useState<string | null>(null)
    const [codexCredentialError, setCodexCredentialError] = useState<string | null>(null)
    const [codexCredentialNameDraft, setCodexCredentialNameDraft] = useState('')
    const [codexCredentialImportDraft, setCodexCredentialImportDraft] = useState('')

    const fontScaleOptions = getFontScaleOptions()
    const currentLocale = locales.find((loc) => loc.value === locale)
    const currentThemeLabel = t(`settings.display.theme.${themePreference}`)
    const currentFontScaleLabel = fontScaleOptions.find((opt) => opt.value === fontScale)?.label ?? '100%'
    const currentVoiceLanguage = voiceLanguages.find((lang) => lang.code === voiceLanguage)
    const currentQueuePanelLabel = t(`settings.behavior.queueInlinePanel.${queueInlinePanelMode}`)
    const currentCodexSendModeLabel = t(`queue.mode.${codexSendModeDefault}`)
    const currentSessionReopenPositionLabel = t(`settings.behavior.sessionReopenPosition.${sessionReopenPosition}`)
    const currentQueuePanelModeDescription = t(`settings.behavior.queueInlinePanel.${queueInlinePanelMode}.description`)
    const currentImageCompressionLevelLabel = t(
        `settings.behavior.imageCompression.level.${imageUploadCompressionLevel}`
    )
    const currentImageCompressionTargetSizeLabel = t(
        `settings.behavior.imageCompression.targetSize.${imageUploadCompressionTargetSize}`
    )
    const { skipArchiveConfirmation, setSkipArchiveConfirmation } = useArchiveConfirmation()
    const { enterBehavior, setEnterBehavior } = useEnterBehavior()
    const { projectQuickCreateEnabled, setProjectQuickCreateEnabled } = useProjectQuickCreate()
    const { sessionQuickArchiveEnabled, setSessionQuickArchiveEnabled } = useSessionQuickArchive()
    const selectedCodexMachine = activeMachines.find((machine) => machine.id === selectedCodexMachineId) ?? null
    const codexCurrentSummaryRows = useMemo(
        () => formatCodexCredentialSummary(codexCredentialState?.current.summary ?? null, t),
        [codexCredentialState?.current.summary, t]
    )
    const numberFormatter = useMemo(() => new Intl.NumberFormat(locale), [locale])
    const currencyFormatter = useMemo(() => new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'USD',
        maximumFractionDigits: 2
    }), [locale])

    const formatNumber = useCallback((value: number): string => {
        return numberFormatter.format(value)
    }, [numberFormatter])

    const formatDateTime = useCallback((value: number): string => {
        return new Date(value).toLocaleString(locale)
    }, [locale])

    const formatUsd = useCallback((value: number): string => {
        return currencyFormatter.format(value)
    }, [currencyFormatter])

    const loadUsageOverview = useCallback(async (forceRefresh = false) => {
        setUsageLoading(true)
        setUsageError(null)
        try {
            const result = await api.getUsageOverview({ refresh: forceRefresh })
            if (!result.success || !result.overview) {
                setUsageOverview(null)
                setUsageError(result.error ?? t('settings.usage.loadError'))
                return
            }
            setUsageOverview(result.overview)
        } catch (error) {
            setUsageOverview(null)
            setUsageError(error instanceof Error ? error.message : t('settings.usage.loadError'))
        } finally {
            setUsageLoading(false)
        }
    }, [api, t])

    const loadReportDomainSettings = useCallback(async () => {
        setReportDomainLoading(true)
        setReportDomainStatusMessage(null)
        try {
            const result = await api.getReportDomainSettings()
            setReportDomainDraft(result.settings.value)
            setReportDomainSaved(result.settings.value)
            setReportDomainSource(result.settings.source)
            setReportDomainEnvOverride(result.settings.envOverride)
        } catch (error) {
            setReportDomainStatusMessage(
                error instanceof Error ? error.message : t('settings.reportDomain.status.loadFailed')
            )
        } finally {
            setReportDomainLoading(false)
        }
    }, [api, t])

    const loadExperimentalSettings = useCallback(async () => {
        setExperimentalSettingsLoading(true)
        setExperimentalStatusMessage(null)
        try {
            const result = await api.getExperimentalSettings()
            setExperimentalClaudeLoginShellEnabled(result.settings.claudeLoginShell)
            setExperimentalCodexReportPromptEnabled(result.settings.codexReportPromptEnabled)
            setExperimentalPreviewEnabled(result.settings.previewEnabled)
            setAlwaysYolo(result.settings.alwaysYolo)
        } catch (error) {
            setExperimentalStatusMessage(
                error instanceof Error ? error.message : t('settings.experimental.status.loadFailed')
            )
        } finally {
            setExperimentalSettingsLoading(false)
        }
    }, [api, t])

    const loadCodexCredentialState = useCallback(async (machineId: string) => {
        if (!machineId) {
            setCodexCredentialState(null)
            setCodexCredentialError(null)
            return
        }

        setCodexCredentialLoading(true)
        setCodexCredentialError(null)
        try {
            const result = await api.getMachineCodexCredentials(machineId)
            setCodexCredentialState(result)
        } catch (error) {
            setCodexCredentialState(null)
            setCodexCredentialError(
                error instanceof Error ? error.message : t('settings.codexCredentials.status.loadFailed')
            )
        } finally {
            setCodexCredentialLoading(false)
        }
    }, [api, t])

    useEffect(() => {
        void loadUsageOverview(false)
    }, [loadUsageOverview])

    useEffect(() => {
        void loadReportDomainSettings()
    }, [loadReportDomainSettings])

    useEffect(() => {
        void loadExperimentalSettings()
    }, [loadExperimentalSettings])

    useEffect(() => {
        if (activeMachines.length === 0) {
            setSelectedCodexMachineId('')
            setCodexCredentialState(null)
            return
        }

        const currentExists = activeMachines.some((machine) => machine.id === selectedCodexMachineId)
        if (!currentExists) {
            setSelectedCodexMachineId(activeMachines[0]!.id)
        }
    }, [activeMachines, selectedCodexMachineId])

    useEffect(() => {
        if (!selectedCodexMachineId) {
            return
        }
        void loadCodexCredentialState(selectedCodexMachineId)
    }, [loadCodexCredentialState, selectedCodexMachineId])

    useEffect(() => {
        if (!memory) {
            return
        }
        if (!isMemoryDirty) {
            setMemoryDraft(memory.content)
            setMemorySavedContent(memory.content)
        }
    }, [memory, isMemoryDirty])

    useEffect(() => {
        persistSettingsGroupExpandedState(groupExpandedState)
    }, [groupExpandedState])

    const saveMemoryMutation = useMutation({
        mutationFn: async (content: string) => {
            return await api.updateMemory({ content, updatedBy: 'user:web:settings' })
        },
        onSuccess: async (result) => {
            setMemorySavedContent(result.memory.content)
            setMemoryDraft(result.memory.content)
            setMemoryStatusMessage(t('settings.memory.status.saved'))
            await queryClient.invalidateQueries({ queryKey: queryKeys.memory })
        },
        onError: (error) => {
            setMemoryStatusMessage(error instanceof Error ? error.message : t('settings.memory.status.saveFailed'))
        }
    })

    const saveReportDomainMutation = useMutation({
        mutationFn: async (domain: string) => {
            return await api.updateReportDomainSettings({
                domain: domain.trim().length > 0 ? domain.trim() : null
            })
        },
        onSuccess: (result) => {
            setReportDomainDraft(result.settings.value)
            setReportDomainSaved(result.settings.value)
            setReportDomainSource(result.settings.source)
            setReportDomainEnvOverride(result.settings.envOverride)
            setReportDomainStatusMessage(t('settings.reportDomain.status.saved'))
        },
        onError: (error) => {
            setReportDomainStatusMessage(
                error instanceof Error ? error.message : t('settings.reportDomain.status.saveFailed')
            )
        }
    })

    const toggleMemoryInjectionMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            return await api.updateMemory({ enabled, updatedBy: 'user:web:settings' })
        },
        onSuccess: async (_result, enabled) => {
            setMemoryStatusMessage(
                enabled
                    ? t('settings.memory.status.injectionEnabled')
                    : t('settings.memory.status.injectionDisabled')
            )
            await queryClient.invalidateQueries({ queryKey: queryKeys.memory })
        },
        onError: (error) => {
            setMemoryStatusMessage(error instanceof Error ? error.message : t('settings.memory.status.toggleFailed'))
        }
    })

    const togglePureContextModeMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            return await api.updateMemory({ pureContextMode: enabled, updatedBy: 'user:web:settings' })
        },
        onSuccess: async (_result, enabled) => {
            setMemoryStatusMessage(
                enabled
                    ? t('settings.memory.status.pureContextModeEnabled')
                    : t('settings.memory.status.pureContextModeDisabled')
            )
            await queryClient.invalidateQueries({ queryKey: queryKeys.memory })
        },
        onError: (error) => {
            setMemoryStatusMessage(error instanceof Error ? error.message : t('settings.memory.status.toggleFailed'))
        }
    })

    const toggleAlwaysYoloMutation = useMutation({
        mutationFn: async (enabled: boolean) => await api.updateExperimentalSettings({ alwaysYolo: enabled }),
        onSuccess: async (result, enabled) => {
            setAlwaysYolo(result.settings.alwaysYolo)
            setYoloStatusMessage(enabled
                ? t('settings.behavior.alwaysYolo.on', { n: result.switched ?? 0 })
                : t('settings.behavior.alwaysYolo.off'))
            await queryClient.invalidateQueries({ queryKey: queryKeys.experimentalSettings })
        },
        onError: (error) => {
            setYoloStatusMessage(error instanceof Error ? error.message : t('settings.experimental.status.saveFailed'))
        }
    })

    const toggleExperimentalClaudeLoginShellMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            return await api.updateExperimentalSettings({ claudeLoginShell: enabled })
        },
        onSuccess: async (result, enabled) => {
            setExperimentalClaudeLoginShellEnabled(result.settings.claudeLoginShell)
            setExperimentalCodexReportPromptEnabled(result.settings.codexReportPromptEnabled)
            setExperimentalPreviewEnabled(result.settings.previewEnabled)
            setExperimentalStatusMessage(
                enabled
                    ? t('settings.experimental.status.claudeLoginShellEnabled')
                    : t('settings.experimental.status.claudeLoginShellDisabled')
            )
            await queryClient.invalidateQueries({ queryKey: queryKeys.experimentalSettings })
        },
        onError: (error) => {
            setExperimentalStatusMessage(
                error instanceof Error ? error.message : t('settings.experimental.status.saveFailed')
            )
        }
    })

    const toggleExperimentalCodexReportPromptMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            return await api.updateExperimentalSettings({ codexReportPromptEnabled: enabled })
        },
        onSuccess: async (result, enabled) => {
            setExperimentalClaudeLoginShellEnabled(result.settings.claudeLoginShell)
            setExperimentalCodexReportPromptEnabled(result.settings.codexReportPromptEnabled)
            setExperimentalPreviewEnabled(result.settings.previewEnabled)
            setExperimentalStatusMessage(
                enabled
                    ? t('settings.experimental.status.codexReportPromptEnabled')
                    : t('settings.experimental.status.codexReportPromptDisabled')
            )
            await queryClient.invalidateQueries({ queryKey: queryKeys.experimentalSettings })
        },
        onError: (error) => {
            setExperimentalStatusMessage(
                error instanceof Error ? error.message : t('settings.experimental.status.saveFailed')
            )
        }
    })

    const toggleExperimentalPreviewMutation = useMutation({
        mutationFn: async (enabled: boolean) => {
            return await api.updateExperimentalSettings({ previewEnabled: enabled })
        },
        onSuccess: async (result, enabled) => {
            setExperimentalClaudeLoginShellEnabled(result.settings.claudeLoginShell)
            setExperimentalCodexReportPromptEnabled(result.settings.codexReportPromptEnabled)
            setExperimentalPreviewEnabled(result.settings.previewEnabled)
            setExperimentalStatusMessage(
                enabled
                    ? t('settings.experimental.status.previewEnabled')
                    : t('settings.experimental.status.previewDisabled')
            )
            await queryClient.invalidateQueries({ queryKey: queryKeys.experimentalSettings })
        },
        onError: (error) => {
            setExperimentalStatusMessage(
                error instanceof Error ? error.message : t('settings.experimental.status.saveFailed')
            )
        }
    })

    const handleSkipArchiveConfirmToggle = (value: boolean) => {
        setSkipArchiveConfirmation(value)
    }

    const handleSessionQuickArchiveToggle = (value: boolean) => {
        setSessionQuickArchiveEnabled(value)
    }

    const handleProjectQuickCreateToggle = (value: boolean) => {
        setProjectQuickCreateEnabled(value)
    }

    const handleVoiceLanguageChange = (language: Language) => {
        setVoiceLanguage(language.code)
        if (typeof window === 'undefined') {
            return
        }
        if (language.code === null) {
            window.localStorage.removeItem('hapi-voice-lang')
        } else {
            window.localStorage.setItem('hapi-voice-lang', language.code)
        }
    }

    const handleMachinesGroupToggle = () => {
        setGroupExpandedState((previousState) => ({
            ...previousState,
            machines: !previousState.machines
        }))
    }

    const handleClaudeAccountsGroupToggle = () => {
        setGroupExpandedState((previousState) => ({
            ...previousState,
            claudeAccounts: !previousState.claudeAccounts
        }))
    }

    const handleGeneralGroupToggle = () => {
        setGroupExpandedState((previousState) => ({
            ...previousState,
            general: !previousState.general
        }))
    }

    const handleInteractionGroupToggle = () => {
        setGroupExpandedState((previousState) => ({
            ...previousState,
            interaction: !previousState.interaction
        }))
    }

    const handleDataDiagnosticsGroupToggle = () => {
        setGroupExpandedState((previousState) => ({
            ...previousState,
            dataDiagnostics: !previousState.dataDiagnostics
        }))
    }

    const handleAboutGroupToggle = () => {
        setGroupExpandedState((previousState) => ({
            ...previousState,
            about: !previousState.about
        }))
    }

    const handleReloadMemory = async () => {
        if (isMemoryDirty) {
            setPendingConfirm({
                title: t('settings.memory.confirmReloadTitle'),
                description: t('settings.memory.confirmReload'),
                confirmLabel: t('settings.memory.actions.reload'),
                confirmingLabel: t('settings.memory.actions.reloading'),
                destructive: true,
                run: reloadMemory
            })
            return
        }
        await reloadMemory()
    }

    const reloadMemory = async () => {
        const result = await refetchMemory()
        const nextMemory = result.data?.memory
        if (nextMemory) {
            setMemoryDraft(nextMemory.content)
            setMemorySavedContent(nextMemory.content)
        }
        setMemoryStatusMessage(t('settings.memory.status.reloaded'))
    }

    const handleSaveMemory = async () => {
        setMemoryStatusMessage(null)
        await saveMemoryMutation.mutateAsync(memoryDraft)
    }

    const handleMemoryInjectionToggle = async (value: boolean) => {
        setMemoryStatusMessage(null)
        await toggleMemoryInjectionMutation.mutateAsync(value)
    }

    const handlePureContextModeToggle = async (value: boolean) => {
        setMemoryStatusMessage(null)
        await togglePureContextModeMutation.mutateAsync(value)
    }

    const handleReloadReportDomain = async () => {
        await loadReportDomainSettings()
        setReportDomainStatusMessage(t('settings.reportDomain.status.reloaded'))
    }

    const handleSaveReportDomain = async () => {
        setReportDomainStatusMessage(null)
        await saveReportDomainMutation.mutateAsync(reportDomainDraft)
    }

    const handleCodexMachineChange = (machineId: string) => {
        setSelectedCodexMachineId(machineId)
        setCodexCredentialStatusMessage(null)
        setCodexCredentialError(null)
    }

    const handleReloadCodexCredentials = async () => {
        setCodexCredentialStatusMessage(null)
        await loadCodexCredentialState(selectedCodexMachineId)
    }

    const handleExportCodexCredentials = async () => {
        if (!selectedCodexMachineId) {
            return
        }

        setCodexCredentialExporting(true)
        setCodexCredentialError(null)
        setCodexCredentialStatusMessage(null)
        try {
            const result = await api.exportMachineCodexCredentials(selectedCodexMachineId)
            downloadTextFile(`codex-auth-${selectedCodexMachineId}.json`, result.content)
            setCodexCredentialStatusMessage(t('settings.codexCredentials.status.exported'))
        } catch (error) {
            setCodexCredentialError(
                error instanceof Error ? error.message : t('settings.codexCredentials.status.exportFailed')
            )
        } finally {
            setCodexCredentialExporting(false)
        }
    }

    const handleSaveCurrentCodexCredentials = async () => {
        if (!selectedCodexMachineId) {
            return
        }

        setCodexCredentialActionPendingId('save-current')
        setCodexCredentialError(null)
        setCodexCredentialStatusMessage(null)
        try {
            const result = await api.saveCurrentMachineCodexCredentials(selectedCodexMachineId, {
                name: codexCredentialNameDraft.trim() || undefined
            })
            setCodexCredentialState(result)
            setCodexCredentialStatusMessage(t('settings.codexCredentials.status.savedCurrent'))
        } catch (error) {
            setCodexCredentialError(
                error instanceof Error ? error.message : t('settings.codexCredentials.status.actionFailed')
            )
        } finally {
            setCodexCredentialActionPendingId(null)
        }
    }

    const handleImportCodexCredentials = async () => {
        if (!selectedCodexMachineId || !codexCredentialImportDraft.trim()) {
            return
        }

        setCodexCredentialActionPendingId('import')
        setCodexCredentialError(null)
        setCodexCredentialStatusMessage(null)
        try {
            const result = await api.importMachineCodexCredentials(selectedCodexMachineId, {
                content: codexCredentialImportDraft,
                name: codexCredentialNameDraft.trim() || undefined
            })
            setCodexCredentialState(result)
            setCodexCredentialImportDraft('')
            setCodexCredentialStatusMessage(t('settings.codexCredentials.status.imported'))
        } catch (error) {
            setCodexCredentialError(
                error instanceof Error ? error.message : t('settings.codexCredentials.status.actionFailed')
            )
        } finally {
            setCodexCredentialActionPendingId(null)
        }
    }

    const handleActivateCodexCredential = async (profileId: string) => {
        if (!selectedCodexMachineId) {
            return
        }

        setCodexCredentialActionPendingId(profileId)
        setCodexCredentialError(null)
        setCodexCredentialStatusMessage(null)
        try {
            const result = await api.activateMachineCodexCredential(selectedCodexMachineId, profileId)
            setCodexCredentialState(result)
            setCodexCredentialStatusMessage(t('settings.codexCredentials.status.activated'))
        } catch (error) {
            setCodexCredentialError(
                error instanceof Error ? error.message : t('settings.codexCredentials.status.actionFailed')
            )
        } finally {
            setCodexCredentialActionPendingId(null)
        }
    }

    const handleDeleteCodexCredential = async (profile: CodexCredentialProfile) => {
        if (!selectedCodexMachineId) {
            return
        }

        setPendingConfirm({
            title: t('settings.codexCredentials.confirmDeleteTitle'),
            description: t('settings.codexCredentials.confirmDelete', { name: profile.name }),
            confirmLabel: t('settings.codexCredentials.actions.delete'),
            confirmingLabel: t('settings.codexCredentials.actions.deleting'),
            destructive: true,
            run: () => deleteCodexCredential(selectedCodexMachineId, profile)
        })
    }

    const deleteCodexCredential = async (machineId: string, profile: CodexCredentialProfile) => {
        setCodexCredentialActionPendingId(profile.id)
        setCodexCredentialError(null)
        setCodexCredentialStatusMessage(null)
        try {
            const result = await api.deleteMachineCodexCredential(machineId, profile.id)
            setCodexCredentialState(result)
            setCodexCredentialStatusMessage(t('settings.codexCredentials.status.deleted'))
        } catch (error) {
            setCodexCredentialError(
                error instanceof Error ? error.message : t('settings.codexCredentials.status.actionFailed')
            )
        } finally {
            setCodexCredentialActionPendingId(null)
        }
    }

    const handleCodexCredentialFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        if (!file) {
            return
        }

        try {
            setCodexCredentialImportDraft(await file.text())
            setCodexCredentialStatusMessage(t('settings.codexCredentials.status.fileLoaded'))
            setCodexCredentialError(null)
        } catch (error) {
            setCodexCredentialError(
                error instanceof Error ? error.message : t('settings.codexCredentials.status.fileReadFailed')
            )
        } finally {
            event.target.value = ''
        }
    }

    const languageOptions = locales.map((loc) => ({ value: loc.value, label: loc.nativeLabel }))
    const themeOptions = themePreferences.map((preference) => ({
        value: preference,
        label: t(`settings.display.theme.${preference}`)
    }))
    const fontOptions = fontScaleOptions.map((opt) => ({ value: String(opt.value), label: opt.label }))
    const voiceOptions = voiceLanguages.map((lang) => ({
        value: lang.code ?? 'auto',
        label: lang.code === null ? t('settings.voice.autoDetect') : getLanguageDisplayName(lang)
    }))
    const sendModeOptions = codexSendModes.map((mode) => ({
        value: mode,
        label: t(`queue.mode.${mode}`),
        description: t(`queue.mode.${mode}Hint`)
    }))
    const queuePanelOptions = queueInlinePanelModes.map((mode) => ({
        value: mode,
        label: t(`settings.behavior.queueInlinePanel.${mode}`),
        description: t(`settings.behavior.queueInlinePanel.${mode}.description`)
    }))
    const sessionReopenPositionOptions = sessionReopenPositionModes.map((mode) => ({
        value: mode,
        label: t(`settings.behavior.sessionReopenPosition.${mode}`),
        description: t(`settings.behavior.sessionReopenPosition.${mode}.description`)
    }))
    const imageCompressionLevelOptions = imageUploadCompressionLevels.map((level) => ({
        value: level,
        label: t(`settings.behavior.imageCompression.level.${level}`)
    }))
    const imageCompressionTargetSizeOptions = imageUploadCompressionTargetSizes.map((targetSize) => ({
        value: targetSize,
        label: t(`settings.behavior.imageCompression.targetSize.${targetSize}`)
    }))
    const currentVoiceLanguageLabel = currentVoiceLanguage?.code
        ? getLanguageDisplayName(currentVoiceLanguage)
        : t('settings.voice.autoDetect')

    return (
        <div className="flex h-full flex-col">
            <MobilePageHeader title={t('settings.title')} contentWidth />

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    <SettingsGroup
                        title={t('settings.group.claudeAccounts.title')}
                        description={t('settings.group.claudeAccounts.description')}
                        isExpanded={isClaudeAccountsGroupExpanded}
                        onToggle={handleClaudeAccountsGroupToggle}
                    >
                        <ClaudeAccountsSettings api={api} machines={machines} />
                    </SettingsGroup>

                    <SettingsGroup
                        title={t('settings.group.machines.title')}
                        description={t('settings.group.machines.description')}
                        isExpanded={groupExpandedState.machines}
                        onToggle={handleMachinesGroupToggle}
                    >
                        <MachinesSettings api={api} />
                    </SettingsGroup>

                    <SettingsGroup
                        title={t('settings.group.general.title')}
                        description={t('settings.group.general.description')}
                        isExpanded={isGeneralGroupExpanded}
                        onToggle={handleGeneralGroupToggle}
                    >
                        <SettingsBlock title={t('settings.language.title')}>
                            <SettingsSelectRow
                                title={t('settings.language.label')}
                                valueLabel={currentLocale?.nativeLabel ?? ''}
                                options={languageOptions}
                                value={locale}
                                onChange={setLocale}
                            />
                        </SettingsBlock>

                        <SettingsBlock title={t('settings.display.title')}>
                            <SettingsSelectRow
                                title={t('settings.display.theme')}
                                valueLabel={currentThemeLabel}
                                options={themeOptions}
                                value={themePreference}
                                onChange={setThemePreference}
                            />
                            <SettingsSelectRow
                                title={t('settings.display.fontSize')}
                                valueLabel={currentFontScaleLabel}
                                options={fontOptions}
                                value={String(fontScale)}
                                onChange={(value) => {
                                    const next = fontScaleOptions.find((opt) => String(opt.value) === value)
                                    if (next) {
                                        setFontScale(next.value)
                                    }
                                }}
                            />
                        </SettingsBlock>

                        <SettingsBlock title={t('settings.voice.title')}>
                            <SettingsSelectRow
                                title={t('settings.voice.language')}
                                valueLabel={currentVoiceLanguageLabel}
                                options={voiceOptions}
                                value={voiceLanguage ?? 'auto'}
                                onChange={(value) => {
                                    const next = voiceLanguages.find((lang) => (lang.code ?? 'auto') === value)
                                    if (next) {
                                        handleVoiceLanguageChange(next)
                                    }
                                }}
                            />
                        </SettingsBlock>
                    </SettingsGroup>

                    <SettingsGroup
                        title={t('settings.group.interaction.title')}
                        description={t('settings.group.interaction.description')}
                        isExpanded={isInteractionGroupExpanded}
                        onToggle={handleInteractionGroupToggle}
                    >
                        <SettingsBlock title={t('settings.behavior.title')} hint={yoloStatusMessage}>
                            <SettingsSwitchRow
                                title={t('settings.behavior.alwaysYolo')}
                                subtitle={t('settings.behavior.alwaysYolo.description')}
                                label={t('settings.behavior.alwaysYolo')}
                                checked={alwaysYolo}
                                onCheckedChange={(enabled) => {
                                    setYoloStatusMessage(null)
                                    void toggleAlwaysYoloMutation.mutateAsync(enabled)
                                }}
                                disabled={experimentalSettingsLoading || toggleAlwaysYoloMutation.isPending}
                            />
                            <SettingsSelectRow
                                title={t('settings.behavior.defaultSendMode')}
                                subtitle={t('settings.behavior.defaultSendMode.description')}
                                valueLabel={currentCodexSendModeLabel}
                                options={sendModeOptions}
                                value={codexSendModeDefault}
                                onChange={setCodexSendModeDefault}
                            />
                            <SettingsSelectRow
                                title={t('settings.behavior.queueInlinePanel')}
                                subtitle={`${t('settings.behavior.queueInlinePanel.description')} · ${currentQueuePanelModeDescription}`}
                                valueLabel={currentQueuePanelLabel}
                                options={queuePanelOptions}
                                value={queueInlinePanelMode}
                                onChange={setQueueInlinePanelMode}
                            />
                            <SettingsSelectRow
                                title={t('settings.behavior.sessionReopenPosition')}
                                subtitle={t('settings.behavior.sessionReopenPosition.description')}
                                valueLabel={currentSessionReopenPositionLabel}
                                options={sessionReopenPositionOptions}
                                value={sessionReopenPosition}
                                onChange={setSessionReopenPosition}
                            />
                            <SettingsSwitchRow
                                title={t('settings.behavior.mobileQueueEmptyState')}
                                subtitle={t('settings.behavior.mobileQueueEmptyState.description')}
                                label={t('settings.behavior.mobileQueueEmptyState')}
                                checked={mobileQueueEmptyStatePreference === 'show'}
                                onCheckedChange={(checked) => setMobileQueueEmptyStatePreference(checked ? 'show' : 'hide')}
                            />
                            <SettingsSwitchRow
                                title={t('settings.behavior.projectQuickCreate')}
                                subtitle={t('settings.behavior.projectQuickCreate.description')}
                                label={t('settings.behavior.projectQuickCreate')}
                                checked={projectQuickCreateEnabled}
                                onCheckedChange={handleProjectQuickCreateToggle}
                            />
                            <SettingsSwitchRow
                                title={t('settings.behavior.imageCompression')}
                                subtitle={t('settings.behavior.imageCompression.description')}
                                label={t('settings.behavior.imageCompression')}
                                checked={imageUploadCompressionEnabled}
                                onCheckedChange={setImageUploadCompressionEnabled}
                            />
                            <SettingsSelectRow
                                title={t('settings.behavior.imageCompression.level')}
                                subtitle={t('settings.behavior.imageCompression.level.description')}
                                valueLabel={currentImageCompressionLevelLabel}
                                options={imageCompressionLevelOptions}
                                value={imageUploadCompressionLevel}
                                onChange={setImageUploadCompressionLevel}
                                disabled={!imageUploadCompressionEnabled}
                            />
                            <SettingsSelectRow
                                title={t('settings.behavior.imageCompression.targetSize')}
                                subtitle={t('settings.behavior.imageCompression.targetSize.description')}
                                valueLabel={currentImageCompressionTargetSizeLabel}
                                options={imageCompressionTargetSizeOptions}
                                value={imageUploadCompressionTargetSize}
                                onChange={setImageUploadCompressionTargetSize}
                                disabled={!imageUploadCompressionEnabled}
                            />
                            <SettingsSwitchRow
                                title={t('settings.behavior.enterBehavior')}
                                subtitle={(
                                    <>
                                        {t('settings.behavior.enterBehavior.description')}
                                        <br />
                                        {enterBehavior === 'send'
                                            ? t('settings.behavior.enterBehavior.send')
                                            : t('settings.behavior.enterBehavior.newline')}
                                    </>
                                )}
                                label={t('settings.behavior.enterBehavior')}
                                checked={enterBehavior === 'newline'}
                                onCheckedChange={(checked) => setEnterBehavior(checked ? 'newline' : 'send')}
                            />
                            <SettingsSwitchRow
                                title={t('settings.behavior.sessionQuickArchive')}
                                subtitle={t('settings.behavior.sessionQuickArchive.description')}
                                label={t('settings.behavior.sessionQuickArchive')}
                                checked={sessionQuickArchiveEnabled}
                                onCheckedChange={handleSessionQuickArchiveToggle}
                            />
                            <SettingsSwitchRow
                                title={t('settings.behavior.archiveConfirm')}
                                subtitle={t('settings.behavior.archiveConfirm.description')}
                                label={t('settings.behavior.archiveConfirm')}
                                checked={skipArchiveConfirmation}
                                onCheckedChange={handleSkipArchiveConfirmToggle}
                            />
                        </SettingsBlock>

                        <SettingsBlock title={t('settings.experimental.title')} hint={experimentalStatusMessage}>
                            <SettingsSwitchRow
                                title={t('settings.experimental.preview.title')}
                                subtitle={t('settings.experimental.preview.description')}
                                label={t('settings.experimental.preview.title')}
                                checked={experimentalPreviewEnabled}
                                onCheckedChange={(enabled) => {
                                    setExperimentalStatusMessage(null)
                                    void toggleExperimentalPreviewMutation.mutateAsync(enabled)
                                }}
                                disabled={experimentalSettingsLoading || toggleExperimentalPreviewMutation.isPending}
                            />
                            <SettingsSwitchRow
                                title={t('settings.experimental.claudeLoginShell.title')}
                                subtitle={t('settings.experimental.claudeLoginShell.description')}
                                label={t('settings.experimental.claudeLoginShell.title')}
                                checked={experimentalClaudeLoginShellEnabled}
                                onCheckedChange={(enabled) => {
                                    setExperimentalStatusMessage(null)
                                    void toggleExperimentalClaudeLoginShellMutation.mutateAsync(enabled)
                                }}
                                disabled={experimentalSettingsLoading || toggleExperimentalClaudeLoginShellMutation.isPending}
                            />
                            <SettingsSwitchRow
                                title={t('settings.experimental.codexReportPrompt.title')}
                                subtitle={t('settings.experimental.codexReportPrompt.description')}
                                label={t('settings.experimental.codexReportPrompt.title')}
                                checked={experimentalCodexReportPromptEnabled}
                                onCheckedChange={(enabled) => {
                                    setExperimentalStatusMessage(null)
                                    void toggleExperimentalCodexReportPromptMutation.mutateAsync(enabled)
                                }}
                                disabled={experimentalSettingsLoading || toggleExperimentalCodexReportPromptMutation.isPending}
                            />
                        </SettingsBlock>
                    </SettingsGroup>

                    <SettingsGroup
                        title={t('settings.group.dataDiagnostics.title')}
                        description={t('settings.group.dataDiagnostics.description')}
                        isExpanded={isDataDiagnosticsGroupExpanded}
                        onToggle={handleDataDiagnosticsGroupToggle}
                    >
                        <SettingsPanel title={t('settings.usage.title')} description={t('settings.usage.description')}>
                            <div className="px-4">
                                <Button
                                    variant="secondary"
                                    onClick={() => void loadUsageOverview(true)}
                                    disabled={usageLoading}
                                >
                                    {usageLoading ? t('settings.usage.loading') : t('settings.usage.refresh')}
                                </Button>
                            </div>

                            {usageError ? <SettingsNotice tone="error">{usageError}</SettingsNotice> : null}

                            {usageOverview ? (
                                <>
                                    {([usageOverview.claude, usageOverview.codex] as const).map((provider) => (
                                        <SettingsCard
                                            key={provider.provider}
                                            title={t(`settings.usage.provider.${provider.provider}`)}
                                            trailing={`${t('settings.usage.files')}: ${formatNumber(provider.filesScanned)}`}
                                        >
                                            {provider.available ? (
                                                <div className="flex flex-col gap-1.5">
                                                    <SettingsStat
                                                        label={t('settings.usage.allTimeTotalTokens')}
                                                        value={formatNumber(provider.allTime.totalTokens)}
                                                        strong
                                                    />
                                                    <SettingsStat
                                                        label={t('settings.usage.last30DaysTotalTokens')}
                                                        value={formatNumber(provider.last30Days.totalTokens)}
                                                    />
                                                    <SettingsStat
                                                        label={t('settings.usage.allTimeEvents')}
                                                        value={formatNumber(provider.eventCount)}
                                                    />
                                                    {provider.estimatedCost ? (
                                                        <>
                                                            <SettingsStat
                                                                label={t('settings.usage.allTimeEstimatedCost')}
                                                                value={`≈${formatUsd(provider.estimatedCost.allTimeUsd)}`}
                                                                strong
                                                            />
                                                            <SettingsStat
                                                                label={t('settings.usage.last30DaysEstimatedCost')}
                                                                value={`≈${formatUsd(provider.estimatedCost.last30DaysUsd)}`}
                                                            />
                                                            <div className="text-caption text-[var(--social-fg-subtle)]">
                                                                {t('settings.usage.estimateHint')} {formatUsd(provider.estimatedCost.usdPerMillionTokens)}/1M tokens
                                                                {' · '}
                                                                {t(`settings.usage.rateSource.${provider.estimatedCost.rateSource}`)}
                                                                {provider.estimatedCost.pricingModel ? ` · ${provider.estimatedCost.pricingModel}` : ''}
                                                            </div>
                                                        </>
                                                    ) : null}
                                                    {provider.parseErrors > 0 ? (
                                                        <SettingsStat
                                                            label={t('settings.usage.parseErrors')}
                                                            value={formatNumber(provider.parseErrors)}
                                                        />
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div className="text-footnote text-[var(--social-fg-muted)]">
                                                    {t('settings.usage.unavailable')}
                                                </div>
                                            )}

                                            {provider.roots.length > 0 ? (
                                                <div className="break-all text-caption text-[var(--social-fg-subtle)]">
                                                    {provider.roots.join(', ')}
                                                </div>
                                            ) : null}
                                        </SettingsCard>
                                    ))}
                                    <div className="px-4 text-caption text-[var(--social-fg-subtle)]">
                                        {t('settings.usage.updatedAt')}: {formatDateTime(usageOverview.generatedAt)}
                                    </div>
                                </>
                            ) : null}
                        </SettingsPanel>

                        <SettingsPanel
                            title={t('settings.codexCredentials.title')}
                            description={t('settings.codexCredentials.description')}
                        >
                            {activeMachines.length > 0 ? (
                                <>
                                    <div className="flex flex-col gap-2 md:flex-row md:items-center">
                                        <div className="min-w-0 md:flex-1">
                                            <SelectInput
                                                value={selectedCodexMachineId}
                                                onChange={(event) => handleCodexMachineChange(event.target.value)}
                                                aria-label={t('settings.codexCredentials.machine')}
                                            >
                                                {activeMachines.map((machine) => (
                                                    <option key={machine.id} value={machine.id}>
                                                        {machine.metadata?.displayName ?? machine.metadata?.host ?? machine.id}
                                                    </option>
                                                ))}
                                            </SelectInput>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 md:flex">
                                            <Button
                                                variant="secondary"
                                                onClick={() => { void handleReloadCodexCredentials() }}
                                                disabled={!selectedCodexMachineId || codexCredentialLoading}
                                            >
                                                {t('settings.codexCredentials.actions.refresh')}
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                onClick={() => { void handleExportCodexCredentials() }}
                                                disabled={!codexCredentialState?.current.exists || codexCredentialExporting}
                                            >
                                                {t('settings.codexCredentials.actions.export')}
                                            </Button>
                                        </div>
                                    </div>

                                    <SettingsCard
                                        title={t('settings.codexCredentials.current.title')}
                                        trailing={selectedCodexMachine?.metadata?.host ?? selectedCodexMachine?.id}
                                    >
                                        {codexCredentialState?.current.exists ? (
                                            <div className="flex flex-col gap-1 text-body text-[var(--social-fg)]">
                                                {codexCurrentSummaryRows.map((row) => (
                                                    <div key={row}>{row}</div>
                                                ))}
                                                <div className="text-caption text-[var(--social-fg-subtle)]">
                                                    {codexCredentialState.current.activeProfileId
                                                        ? t('settings.codexCredentials.current.managed')
                                                        : t('settings.codexCredentials.current.unmanaged')}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-footnote text-[var(--social-fg-muted)]">
                                                {t('settings.codexCredentials.current.missing')}
                                            </div>
                                        )}
                                    </SettingsCard>

                                    {codexCredentialError ? <SettingsNotice tone="error">{codexCredentialError}</SettingsNotice> : null}
                                    {codexCredentialStatusMessage ? (
                                        <SettingsNotice tone="success">{codexCredentialStatusMessage}</SettingsNotice>
                                    ) : null}

                                    <div className="grid gap-3 lg:grid-cols-2">
                                        <SettingsCard title={t('settings.codexCredentials.actions.saveCurrent')} className="gap-3">
                                            <TextField
                                                value={codexCredentialNameDraft}
                                                onChange={(event) => setCodexCredentialNameDraft(event.target.value)}
                                                placeholder={t('settings.codexCredentials.name.placeholder')}
                                                aria-label={t('settings.codexCredentials.name.placeholder')}
                                            />
                                            <div>
                                                <Button
                                                    onClick={() => { void handleSaveCurrentCodexCredentials() }}
                                                    disabled={!codexCredentialState?.current.exists || codexCredentialActionPendingId !== null}
                                                >
                                                    {t('settings.codexCredentials.actions.saveCurrent')}
                                                </Button>
                                            </div>
                                        </SettingsCard>

                                        <SettingsCard title={t('settings.codexCredentials.import.title')} className="gap-3">
                                            <input
                                                type="file"
                                                accept="application/json,.json"
                                                onChange={(event) => { void handleCodexCredentialFileChange(event) }}
                                                className="block w-full text-footnote text-[var(--social-fg-muted)] file:mr-3 file:h-11 file:cursor-pointer file:rounded-full file:border-0 file:bg-[var(--social-muted)] file:px-5 file:text-body file:font-semibold file:text-[var(--social-fg)]"
                                            />
                                            <textarea
                                                value={codexCredentialImportDraft}
                                                onChange={(event) => setCodexCredentialImportDraft(event.target.value)}
                                                placeholder={t('settings.codexCredentials.import.placeholder')}
                                                className={cn(DIALOG_INPUT_CLASS, 'h-36 font-mono')}
                                                spellCheck={false}
                                            />
                                            <div>
                                                <Button
                                                    onClick={() => { void handleImportCodexCredentials() }}
                                                    disabled={!codexCredentialImportDraft.trim() || codexCredentialActionPendingId !== null}
                                                >
                                                    {t('settings.codexCredentials.actions.import')}
                                                </Button>
                                            </div>
                                        </SettingsCard>
                                    </div>

                                    <div className="flex flex-col gap-2">
                                        <div className="px-1 text-body font-semibold text-[var(--social-fg)]">
                                            {t('settings.codexCredentials.profiles.title')}
                                        </div>
                                        {codexCredentialState?.profiles.length ? (
                                            codexCredentialState.profiles.map((profile) => (
                                                <SettingsCard key={profile.id}>
                                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <FitText kind="title" text={profile.name} className="text-body font-semibold text-[var(--social-fg)]" />
                                                                {profile.isActive ? (
                                                                    <Badge variant="success" dot>
                                                                        {t('settings.codexCredentials.profile.active')}
                                                                    </Badge>
                                                                ) : null}
                                                            </div>
                                                            <div className="mt-0.5 text-caption text-[var(--social-fg-subtle)]">
                                                                {profile.importSource === 'current-auth'
                                                                    ? t('settings.codexCredentials.profile.sourceCurrent')
                                                                    : t('settings.codexCredentials.profile.sourceImported')}
                                                                {' · '}
                                                                {formatDateTime(profile.updatedAt)}
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            <Button
                                                                variant="secondary"
                                                                onClick={() => { void handleActivateCodexCredential(profile.id) }}
                                                                disabled={profile.isActive || codexCredentialActionPendingId !== null}
                                                            >
                                                                {profile.isActive
                                                                    ? t('settings.codexCredentials.profile.active')
                                                                    : t('settings.codexCredentials.actions.activate')}
                                                            </Button>
                                                            <Button
                                                                variant="secondary"
                                                                onClick={() => { void handleDeleteCodexCredential(profile) }}
                                                                disabled={profile.isActive || codexCredentialActionPendingId !== null}
                                                                className="text-[var(--social-danger)]"
                                                            >
                                                                {t('settings.codexCredentials.actions.delete')}
                                                            </Button>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col gap-1 text-footnote text-[var(--social-fg-muted)]">
                                                        {formatCodexCredentialSummary(profile.summary, t).map((row) => (
                                                            <div key={`${profile.id}:${row}`}>{row}</div>
                                                        ))}
                                                    </div>
                                                </SettingsCard>
                                            ))
                                        ) : (
                                            <EmptyState title={t('settings.codexCredentials.profiles.empty')} />
                                        )}
                                        <div className="px-1 text-caption text-[var(--social-fg-subtle)]">
                                            {t('settings.codexCredentials.futureSessionsHint')}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <EmptyState title={t('settings.codexCredentials.noMachines')} />
                            )}
                        </SettingsPanel>

                        <SettingsPanel
                            title={t('settings.reportDomain.title')}
                            description={t('settings.reportDomain.description')}
                        >
                            <TextField
                                value={reportDomainDraft}
                                onChange={(event) => setReportDomainDraft(event.target.value)}
                                placeholder={t('settings.reportDomain.placeholder')}
                                aria-label={t('settings.reportDomain.title')}
                                spellCheck={false}
                                disabled={reportDomainLoading || reportDomainEnvOverride}
                            />
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="min-w-0 px-1 text-caption text-[var(--social-fg-subtle)]">
                                    {reportDomainEnvOverride
                                        ? t('settings.reportDomain.status.envLocked')
                                        : isReportDomainDirty
                                            ? t('settings.reportDomain.status.unsaved')
                                            : reportDomainStatusMessage ?? t('settings.reportDomain.status.synced')}
                                    {' · '}
                                    {t(`settings.reportDomain.source.${reportDomainSource}`)}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={() => { void handleReloadReportDomain() }}
                                        disabled={reportDomainLoading || saveReportDomainMutation.isPending}
                                    >
                                        {t('settings.reportDomain.actions.reload')}
                                    </Button>
                                    <Button
                                        onClick={() => { void handleSaveReportDomain() }}
                                        disabled={
                                            reportDomainLoading
                                            || reportDomainEnvOverride
                                            || !isReportDomainDirty
                                            || saveReportDomainMutation.isPending
                                        }
                                    >
                                        {saveReportDomainMutation.isPending
                                            ? t('settings.reportDomain.actions.saving')
                                            : t('settings.reportDomain.actions.save')}
                                    </Button>
                                </div>
                            </div>
                        </SettingsPanel>

                        <div className="flex flex-col gap-3">
                            <SettingsBlock hint={memory?.path ?? t('settings.memory.pathLoading')}>
                                <SettingsSwitchRow
                                    title={t('settings.memory.pureContextMode.title')}
                                    subtitle={t('settings.memory.pureContextMode.description')}
                                    label={t('settings.memory.pureContextMode.title')}
                                    checked={pureContextModeEnabled}
                                    onCheckedChange={(value) => { void handlePureContextModeToggle(value) }}
                                    disabled={memoryLoading || togglePureContextModeMutation.isPending}
                                />
                                <SettingsSwitchRow
                                    title={t('settings.memory.injection.title')}
                                    subtitle={t('settings.memory.description')}
                                    label={t('settings.memory.injection.title')}
                                    checked={memoryInjectionEnabled}
                                    onCheckedChange={(value) => { void handleMemoryInjectionToggle(value) }}
                                    disabled={memoryLoading || toggleMemoryInjectionMutation.isPending || pureContextModeEnabled}
                                />
                            </SettingsBlock>

                            {memoryError ? <SettingsNotice tone="error">{memoryError}</SettingsNotice> : null}

                            <textarea
                                value={memoryDraft}
                                onChange={(event) => setMemoryDraft(event.target.value)}
                                placeholder={memoryLoading ? t('settings.memory.placeholder.loading') : t('settings.memory.placeholder.edit')}
                                aria-label={t('settings.memory.placeholder.edit')}
                                className={cn(DIALOG_INPUT_CLASS, 'h-56 leading-relaxed')}
                                spellCheck={false}
                            />
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className="min-w-0 px-1 text-caption text-[var(--social-fg-subtle)]">
                                    {isMemoryDirty ? t('settings.memory.status.unsaved') : memoryStatusMessage ?? t('settings.memory.status.synced')}
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="secondary"
                                        onClick={() => { void handleReloadMemory() }}
                                        disabled={saveMemoryMutation.isPending}
                                    >
                                        {t('settings.memory.actions.reload')}
                                    </Button>
                                    <Button
                                        onClick={() => { void handleSaveMemory() }}
                                        disabled={!isMemoryDirty || saveMemoryMutation.isPending}
                                    >
                                        {saveMemoryMutation.isPending ? t('settings.memory.actions.saving') : t('settings.memory.actions.save')}
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </SettingsGroup>

                    <SettingsGroup
                        title={t('settings.group.about.title')}
                        description={t('settings.group.about.description')}
                        isExpanded={isAboutGroupExpanded}
                        onToggle={handleAboutGroupToggle}
                    >
                        <SettingsBlock>
                            <SettingsValueRow
                                title={t('settings.about.website')}
                                value={(
                                    <a
                                        href="https://hapi.run"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="-my-3 inline-flex min-h-11 items-center text-[var(--social-fg)] underline-offset-2 hover:underline"
                                    >
                                        hapi.run
                                    </a>
                                )}
                            />
                            <SettingsValueRow title={t('settings.about.appVersion')} value={__APP_VERSION__} />
                            <SettingsValueRow title={t('settings.about.protocolVersion')} value={PROTOCOL_VERSION} />
                        </SettingsBlock>
                    </SettingsGroup>
                </div>
            </div>
            {isMobileLayout ? <MobileTabBar active="settings" /> : null}
            <ConfirmDialog
                isOpen={pendingConfirm !== null}
                onClose={() => setPendingConfirm(null)}
                title={pendingConfirm?.title ?? ''}
                description={pendingConfirm?.description ?? ''}
                confirmLabel={pendingConfirm?.confirmLabel ?? ''}
                confirmingLabel={pendingConfirm?.confirmingLabel ?? ''}
                destructive={pendingConfirm?.destructive}
                isPending={isConfirmPending}
                onConfirm={async () => {
                    if (!pendingConfirm) return
                    setIsConfirmPending(true)
                    try {
                        await pendingConfirm.run()
                    } finally {
                        setIsConfirmPending(false)
                    }
                }}
            />
        </div>
    )
}
