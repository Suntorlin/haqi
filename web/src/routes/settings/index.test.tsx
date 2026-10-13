import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nContext, I18nProvider } from '@/lib/i18n-context'
import { en } from '@/lib/locales'
import { PROTOCOL_VERSION } from '@hapi/protocol'
import SettingsPage from './index'

const SETTINGS_GROUP_EXPANDED_STORAGE_KEY = 'hapi-settings-group-expanded-v1'

const localStorageState = new Map<string, string>()
const mockLocalStorage = {
    getItem: vi.fn((key: string) => localStorageState.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
        localStorageState.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
        localStorageState.delete(key)
    }),
    clear: vi.fn(() => {
        localStorageState.clear()
    }),
    key: vi.fn((index: number) => Array.from(localStorageState.keys())[index] ?? null),
    get length() {
        return localStorageState.size
    }
}

const getUsageOverviewMock = vi.fn(async () => ({
    success: true,
    overview: {
        generatedAt: Date.now(),
        windowDays: 30,
        claude: {
            provider: 'claude',
            available: false,
            roots: [],
            filesScanned: 0,
            parseErrors: 0,
            eventCount: 0,
            last30DaysEventCount: 0,
            allTime: {
                inputTokens: 0,
                cachedInputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                outputTokens: 0,
                reasoningOutputTokens: 0,
                totalTokens: 0
            },
            last30Days: {
                inputTokens: 0,
                cachedInputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                outputTokens: 0,
                reasoningOutputTokens: 0,
                totalTokens: 0
            }
        },
        codex: {
            provider: 'codex',
            available: false,
            roots: [],
            filesScanned: 0,
            parseErrors: 0,
            eventCount: 0,
            last30DaysEventCount: 0,
            allTime: {
                inputTokens: 0,
                cachedInputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                outputTokens: 0,
                reasoningOutputTokens: 0,
                totalTokens: 0
            },
            last30Days: {
                inputTokens: 0,
                cachedInputTokens: 0,
                cacheReadTokens: 0,
                cacheCreationTokens: 0,
                outputTokens: 0,
                reasoningOutputTokens: 0,
                totalTokens: 0
            }
        }
    }
}))

const getMemoryMock = vi.fn(async () => ({
    memory: {
        path: '/tmp/MEMORY.md',
        content: '# MEMORY.md\n',
        updatedAt: Date.now(),
        bytes: 12,
        enabled: true,
        pureContextMode: false
    }
}))

const updateMemoryMock = vi.fn(async (payload: {
    content?: string
    enabled?: boolean
    pureContextMode?: boolean
}) => ({
    memory: {
        path: '/tmp/MEMORY.md',
        content: payload.content ?? '# MEMORY.md\n',
        updatedAt: Date.now(),
        bytes: (payload.content ?? '# MEMORY.md\n').length,
        enabled: payload.enabled ?? true,
        pureContextMode: payload.pureContextMode ?? false
    }
}))

const getExperimentalSettingsMock = vi.fn(async () => ({
    settings: {
        claudeLoginShell: false,
        codexReportPromptEnabled: false,
        previewEnabled: true
    }
}))

const updateExperimentalSettingsMock = vi.fn(async (payload: {
    claudeLoginShell?: boolean
    codexReportPromptEnabled?: boolean
    previewEnabled?: boolean
}) => ({
    settings: {
        claudeLoginShell: payload.claudeLoginShell ?? false,
        codexReportPromptEnabled: payload.codexReportPromptEnabled ?? false,
        previewEnabled: payload.previewEnabled ?? true
    }
}))

const getReportDomainSettingsMock = vi.fn(async () => ({
    settings: {
        value: 'http://localhost:3006',
        source: 'default',
        envOverride: false
    }
}))

const updateReportDomainSettingsMock = vi.fn(async (payload: { domain: string | null }) => ({
    settings: {
        value: payload.domain ?? 'http://localhost:3006',
        source: payload.domain ? 'file' : 'default',
        envOverride: false
    }
}))

const getMachinesMock = vi.fn(async () => ({
    machines: []
}))

const getMachineCodexCredentialsMock = vi.fn(async () => ({
    current: {
        exists: false,
        activeProfileId: null,
        summary: null
    },
    profiles: []
}))

const exportMachineCodexCredentialsMock = vi.fn(async () => ({
    content: '{}',
    summary: {
        hasOpenAiApiKey: false,
        hasTokens: false
    }
}))

const importMachineCodexCredentialsMock = vi.fn(async () => ({
    current: {
        exists: false,
        activeProfileId: null,
        summary: null
    },
    profiles: []
}))

const saveCurrentMachineCodexCredentialsMock = vi.fn(async () => ({
    current: {
        exists: false,
        activeProfileId: null,
        summary: null
    },
    profiles: []
}))

const activateMachineCodexCredentialMock = vi.fn(async () => ({
    current: {
        exists: true,
        activeProfileId: 'profile-1',
        summary: {
            authMode: 'chatgpt',
            hasOpenAiApiKey: false,
            hasTokens: true
        }
    },
    profiles: []
}))

const deleteMachineCodexCredentialMock = vi.fn(async () => ({
    current: {
        exists: false,
        activeProfileId: null,
        summary: null
    },
    profiles: []
}))

const mockApi = {
    getUsageOverview: getUsageOverviewMock,
    getMachines: getMachinesMock,
    getMemory: getMemoryMock,
    updateMemory: updateMemoryMock,
    getExperimentalSettings: getExperimentalSettingsMock,
    updateExperimentalSettings: updateExperimentalSettingsMock,
    getReportDomainSettings: getReportDomainSettingsMock,
    updateReportDomainSettings: updateReportDomainSettingsMock,
    getMachineCodexCredentials: getMachineCodexCredentialsMock,
    exportMachineCodexCredentials: exportMachineCodexCredentialsMock,
    importMachineCodexCredentials: importMachineCodexCredentialsMock,
    saveCurrentMachineCodexCredentials: saveCurrentMachineCodexCredentialsMock,
    activateMachineCodexCredential: activateMachineCodexCredentialMock,
    deleteMachineCodexCredential: deleteMachineCodexCredentialMock
}

// Mock the router hooks
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useRouter: () => ({ history: { back: vi.fn() } }),
    useLocation: () => '/settings',
}))

// Mock useFontScale hook
vi.mock('@/hooks/useFontScale', () => ({
    useFontScale: () => ({ fontScale: 1, setFontScale: vi.fn() }),
    getFontScaleOptions: () => [
        { value: 0.875, label: '87.5%' },
        { value: 1, label: '100%' },
        { value: 1.125, label: '112.5%' },
    ],
}))

vi.mock('@/hooks/useTheme', () => ({
    useThemePreference: () => ({ themePreference: 'system', setThemePreference: vi.fn() }),
}))

// Mock languages
vi.mock('@/lib/languages', () => ({
    getElevenLabsSupportedLanguages: () => [
        { code: null, name: 'Auto-detect' },
        { code: 'en', name: 'English' },
    ],
    getLanguageDisplayName: (lang: { code: string | null; name: string }) => lang.name,
}))

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api: mockApi
    })
}))

function renderWithProviders(ui: React.ReactElement) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>
                {ui}
            </I18nProvider>
        </QueryClientProvider>
    )
}

function renderWithSpyT(ui: React.ReactElement) {
    const translations = en as Record<string, string>
    const spyT = vi.fn((key: string) => translations[key] ?? key)
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false }
        }
    })
    render(
        <QueryClientProvider client={queryClient}>
            <I18nContext.Provider value={{ t: spyT, locale: 'en', setLocale: vi.fn() }}>
                {ui}
            </I18nContext.Provider>
        </QueryClientProvider>
    )
    return spyT
}

function expandGroup(name: RegExp | string) {
    const button = screen.getAllByRole('button', { name })[0]
    fireEvent.click(button)
}

describe('SettingsPage', () => {
    afterEach(() => {
        cleanup()
    })

    beforeEach(() => {
        vi.clearAllMocks()
        Object.defineProperty(window, 'localStorage', {
            value: mockLocalStorage,
            configurable: true
        })
        window.localStorage.clear()
    })

    it('renders the About section', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getByText('About')).toBeInTheDocument()
    })

    it('keeps collapsed-by-default groups hidden initially', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.queryByRole('button', { name: 'Refresh usage' })).not.toBeInTheDocument()
        expect(screen.queryByText('App version')).not.toBeInTheDocument()
    })

    it('restores persisted section expanded state', () => {
        window.localStorage.setItem(SETTINGS_GROUP_EXPANDED_STORAGE_KEY, JSON.stringify({
            general: false,
            interaction: false,
            dataDiagnostics: true,
            about: true
        }))

        renderWithProviders(<SettingsPage />)

        expect(screen.queryByText('Theme')).not.toBeInTheDocument()
        expect(screen.getByText('Usage')).toBeInTheDocument()
        expect(screen.getAllByText('App version').length).toBeGreaterThanOrEqual(1)
    })

    it('persists section expanded state changes', () => {
        renderWithProviders(<SettingsPage />)
        expandGroup(/About/)

        const persistedState = JSON.parse(window.localStorage.getItem(SETTINGS_GROUP_EXPANDED_STORAGE_KEY) ?? '{}')
        expect(persistedState).toMatchObject({
            general: true,
            interaction: true,
            dataDiagnostics: false,
            about: true
        })
    })

    it('persists default send mode preference', () => {
        renderWithProviders(<SettingsPage />)

        fireEvent.click(screen.getByRole('button', { name: /Default Send Mode/i }))
        fireEvent.click(screen.getByRole('option', { name: /Queue/i }))

        expect(window.localStorage.getItem('hapi:codexSendModeDefault')).toBe('queue')
    })

    it('persists session reopen position preference', () => {
        renderWithProviders(<SettingsPage />)

        fireEvent.click(screen.getByRole('button', { name: /Session Reopen Position/i }))
        fireEvent.click(screen.getByRole('option', { name: /Restore last position/i }))

        expect(window.localStorage.getItem('hapi:sessionReopenPosition:v1')).toBe('restore')
    })

    it('persists mobile empty queue row preference', () => {
        renderWithProviders(<SettingsPage />)

        fireEvent.click(screen.getByRole('switch', { name: /Show Empty Mobile Queue Row/i }))

        expect(window.localStorage.getItem('hapi:mobileQueueEmptyState')).toBe('show')
    })

    it('displays the App Version with correct value', () => {
        renderWithProviders(<SettingsPage />)
        expandGroup(/About/)
        expect(screen.getAllByText('App version').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText(__APP_VERSION__).length).toBeGreaterThanOrEqual(1)
    })

    it('displays the Protocol Version with correct value', () => {
        renderWithProviders(<SettingsPage />)
        expandGroup(/About/)
        expect(screen.getAllByText('Protocol version').length).toBeGreaterThanOrEqual(1)
        expect(screen.getAllByText(String(PROTOCOL_VERSION)).length).toBeGreaterThanOrEqual(1)
    })

    it('displays the Theme setting', () => {
        renderWithProviders(<SettingsPage />)
        expect(screen.getAllByText('Theme').length).toBeGreaterThanOrEqual(1)
    })

    it('displays the website link with correct URL and security attributes', () => {
        renderWithProviders(<SettingsPage />)
        expandGroup(/About/)
        expect(screen.getAllByText('Website').length).toBeGreaterThanOrEqual(1)
        const links = screen.getAllByRole('link', { name: 'hapi.run' })
        expect(links.length).toBeGreaterThanOrEqual(1)
        const link = links[0]
        expect(link).toHaveAttribute('href', 'https://hapi.run')
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('uses correct i18n keys for About section', () => {
        const spyT = renderWithSpyT(<SettingsPage />)
        expandGroup(/Data & diagnostics/)
        expandGroup(/About/)
        const calledKeys = spyT.mock.calls.map((call) => call[0])
        expect(calledKeys).toContain('settings.group.general.title')
        expect(calledKeys).toContain('settings.group.interaction.title')
        expect(calledKeys).toContain('settings.group.dataDiagnostics.title')
        expect(calledKeys).toContain('settings.group.about.title')
        expect(calledKeys).toContain('settings.display.theme')
        expect(calledKeys).toContain('settings.display.theme.system')
        expect(calledKeys).toContain('settings.behavior.imageCompression')
        expect(calledKeys).toContain('settings.behavior.defaultSendMode')
        expect(calledKeys).toContain('settings.behavior.projectQuickCreate')
        expect(calledKeys).toContain('settings.behavior.mobileQueueEmptyState')
        expect(calledKeys).toContain('settings.behavior.sessionQuickArchive')
        expect(calledKeys).toContain('settings.behavior.imageCompression.level')
        expect(calledKeys).toContain('settings.behavior.imageCompression.targetSize')
        expect(calledKeys).toContain('settings.memory.injection.title')
        expect(calledKeys).toContain('settings.memory.pureContextMode.title')
        expect(calledKeys).toContain('settings.memory.pureContextMode.description')
        expect(calledKeys).toContain('settings.experimental.title')
        expect(calledKeys).toContain('settings.experimental.preview.title')
        expect(calledKeys).toContain('settings.experimental.preview.description')
        expect(calledKeys).toContain('settings.experimental.claudeLoginShell.title')
        expect(calledKeys).toContain('settings.experimental.claudeLoginShell.description')
        expect(calledKeys).toContain('settings.experimental.codexReportPrompt.title')
        expect(calledKeys).toContain('settings.experimental.codexReportPrompt.description')
        expect(calledKeys).toContain('settings.reportDomain.title')
        expect(calledKeys).toContain('settings.memory.actions.save')
        expect(calledKeys).toContain('settings.about.website')
        expect(calledKeys).toContain('settings.about.appVersion')
        expect(calledKeys).toContain('settings.about.protocolVersion')
    })

    it('updates Claude login shell experimental setting', async () => {
        renderWithProviders(<SettingsPage />)

        await waitFor(() => {
            expect(getExperimentalSettingsMock).toHaveBeenCalled()
        })

        await waitFor(() => {
            expect(screen.getByRole('switch', { name: 'Claude login shell' })).not.toBeDisabled()
        })

        fireEvent.click(screen.getByRole('switch', { name: 'Claude login shell' }))

        await waitFor(() => {
            expect(updateExperimentalSettingsMock).toHaveBeenCalledWith({ claudeLoginShell: true })
        })
    })

    it('updates Preview experimental setting', async () => {
        renderWithProviders(<SettingsPage />)

        await waitFor(() => {
            expect(getExperimentalSettingsMock).toHaveBeenCalled()
        })

        await waitFor(() => {
            expect(screen.getByRole('switch', { name: 'Preview feature' })).not.toBeDisabled()
        })

        fireEvent.click(screen.getByRole('switch', { name: 'Preview feature' }))

        await waitFor(() => {
            expect(updateExperimentalSettingsMock).toHaveBeenCalledWith({ previewEnabled: false })
        })
    })

    it('updates Codex report prompt experimental setting', async () => {
        renderWithProviders(<SettingsPage />)

        await waitFor(() => {
            expect(getExperimentalSettingsMock).toHaveBeenCalled()
        })

        await waitFor(() => {
            expect(screen.getByRole('switch', { name: 'Codex report prompt injection' })).not.toBeDisabled()
        })

        fireEvent.click(screen.getByRole('switch', { name: 'Codex report prompt injection' }))

        await waitFor(() => {
            expect(updateExperimentalSettingsMock).toHaveBeenCalledWith({ codexReportPromptEnabled: true })
        })
    })

})
