import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@/lib/i18n-context'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { NewSession } from './index'

function renderWithProviders(ui: React.ReactElement) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false
            }
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

describe('NewSession initial directory preset', () => {
    afterEach(() => {
        cleanup()
    })

    beforeEach(() => {
        localStorage.clear()
        localStorage.setItem('hapi-lang', 'en')
        localStorage.setItem('hapi:lastMachineId', 'machine-1')
        localStorage.setItem('hapi:recentPaths', JSON.stringify({
            'machine-1': ['/recent/path']
        }))
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation(() => ({
                matches: false,
                media: '',
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        })
    })

    it('keeps initialDirectory instead of overriding with recent path', async () => {
        const getSessions = vi.fn(async () => ({ sessions: [] }))
        const checkMachinePathsExists = vi.fn(async (_machineId: string, paths: string[]) => ({
            exists: Object.fromEntries(paths.map((path) => [path, true]))
        }))

        const api = {
            getSessions,
            checkMachinePathsExists,
            spawnSession: vi.fn()
        } as unknown as ApiClient

        const machines: Machine[] = [
            {
                id: 'machine-1',
                active: true,
                metadata: {
                    host: 'devbox',
                    platform: 'linux',
                    happyCliVersion: '0.15.2'
                }
            }
        ]

        renderWithProviders(
            <NewSession
                api={api}
                machines={machines}
                initialDirectory="/preset/project"
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        await waitFor(() => {
            expect(checkMachinePathsExists).toHaveBeenCalled()
        })

        expect(screen.getByPlaceholderText('/path/to/project')).toHaveValue('/preset/project')
    })

    it('fills the directory from the recent-paths dropdown', async () => {
        const api = {
            getSessions: vi.fn(async () => ({ sessions: [] })),
            checkMachinePathsExists: vi.fn(async (_machineId: string, paths: string[]) => ({
                exists: Object.fromEntries(paths.map((path) => [path, true]))
            })),
            spawnSession: vi.fn()
        } as unknown as ApiClient
        const machines: Machine[] = [
            { id: 'machine-1', active: true, metadata: { host: 'devbox', platform: 'linux', happyCliVersion: '0.15.2' } }
        ]

        renderWithProviders(
            <NewSession api={api} machines={machines} initialDirectory="/preset/project" onSuccess={vi.fn()} onCancel={vi.fn()} />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Recent paths' }))
        fireEvent.click(await screen.findByRole('menuitem', { name: '/recent/path' }))

        // The picked path is now one of the project rows: the field folds away and the start button names it.
        expect(screen.queryByRole('menuitem', { name: '/recent/path' })).toBeNull()
        expect(screen.getByRole('button', { name: 'Start in path' })).toBeEnabled()
    })

    it('creates session on command + enter', async () => {
        const getSessions = vi.fn(async () => ({ sessions: [] }))
        const checkMachinePathsExists = vi.fn(async (_machineId: string, paths: string[]) => ({
            exists: Object.fromEntries(paths.map((path) => [path, true]))
        }))
        const spawnSession = vi.fn(async (machineId: string, directory: string) => ({
            type: 'success',
            sessionId: 'session-1' as const,
            machineId,
            directory
        }))
        const onSuccess = vi.fn()

        const api = {
            getSessions,
            checkMachinePathsExists,
            spawnSession
        } as unknown as ApiClient

        const machines: Machine[] = [
            {
                id: 'machine-1',
                active: true,
                metadata: {
                    host: 'devbox',
                    platform: 'linux',
                    happyCliVersion: '0.15.2'
                }
            }
        ]

        renderWithProviders(
            <NewSession
                api={api}
                machines={machines}
                onSuccess={onSuccess}
                onCancel={vi.fn()}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Another folder…' }))
        const directoryInput = screen.getByPlaceholderText('/path/to/project')
        fireEvent.change(directoryInput, { target: { value: '/tmp/project' } })
        fireEvent.keyDown(directoryInput, { key: 'Enter', metaKey: true })

        await waitFor(() => {
            expect(spawnSession).toHaveBeenCalledTimes(1)
        })

        const [calledMachineId, calledDirectory] = spawnSession.mock.calls[0]
        expect(calledMachineId).toBe('machine-1')
        expect(calledDirectory).toBe('/tmp/project')
        expect(onSuccess).toHaveBeenCalledWith('session-1')
    })

    it('stores last successful config and restores it on next create form open', async () => {
        const getSessions = vi.fn(async () => ({ sessions: [] }))
        const checkMachinePathsExists = vi.fn(async (_machineId: string, paths: string[]) => ({
            exists: Object.fromEntries(paths.map((path) => [path, true]))
        }))
        const spawnSession = vi.fn(async (machineId: string, directory: string) => ({
            type: 'success',
            sessionId: 'session-2' as const,
            machineId,
            directory
        }))

        const api = {
            getSessions,
            checkMachinePathsExists,
            spawnSession
        } as unknown as ApiClient

        const machines: Machine[] = [
            {
                id: 'machine-1',
                active: true,
                metadata: {
                    host: 'devbox',
                    platform: 'linux',
                    happyCliVersion: '0.15.2'
                }
            }
        ]

        renderWithProviders(
            <NewSession
                api={api}
                machines={machines}
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        fireEvent.click(screen.getByRole('button', { name: 'Another folder…' }))
        fireEvent.change(screen.getByPlaceholderText('/path/to/project'), { target: { value: '/tmp/project' } })
        fireEvent.click(screen.getByRole('radio', { name: 'codex' }))
        fireEvent.click(screen.getByRole('button', { name: /More options/ }))
        fireEvent.change(screen.getByPlaceholderText('http://localhost:3000'), { target: { value: 'http://localhost:4173' } })
        fireEvent.keyDown(screen.getByPlaceholderText('/path/to/project'), { key: 'Enter', metaKey: true })

        await waitFor(() => {
            expect(spawnSession).toHaveBeenCalledTimes(1)
        })

        const savedRaw = localStorage.getItem('hapi:newSession:lastConfig')
        expect(savedRaw).not.toBeNull()
        const saved = JSON.parse(savedRaw ?? '{}')
        expect(saved.agent).toBe('codex')
        expect(saved.previewUrl).toBe('http://localhost:4173/')

        cleanup()

        renderWithProviders(
            <NewSession
                api={api}
                machines={machines}
                onSuccess={vi.fn()}
                onCancel={vi.fn()}
            />
        )

        expect(screen.getByRole('radio', { name: 'codex' })).toBeChecked()
        expect(screen.getByPlaceholderText('http://localhost:3000')).toHaveValue('http://localhost:4173/')
    })
})

describe('NewSession settings shared through the hub', () => {
    const machines: Machine[] = [
        { id: 'machine-1', active: true, metadata: { host: 'devbox', platform: 'linux', happyCliVersion: '0.15.2' } }
    ]

    function apiWith(overrides: Partial<Record<keyof ApiClient, unknown>>): ApiClient {
        return {
            getSessions: vi.fn(async () => ({ sessions: [] })),
            checkMachinePathsExists: vi.fn(async (_machineId: string, paths: string[]) => ({
                exists: Object.fromEntries(paths.map((path) => [path, true]))
            })),
            spawnSession: vi.fn(),
            ...overrides
        } as unknown as ApiClient
    }

    afterEach(() => {
        cleanup()
    })

    beforeEach(() => {
        localStorage.clear()
        localStorage.setItem('hapi-lang', 'en')
        localStorage.setItem('hapi:lastMachineId', 'machine-1')
        localStorage.setItem('hapi:recentPaths', JSON.stringify({ 'machine-1': ['/recent/path'] }))
        // This browser last created a Sonnet / High session.
        localStorage.setItem('hapi:newSession:lastConfig', JSON.stringify({
            agent: 'claude', model: 'sonnet', customModel: '', thinkEffort: 'high', yoloMode: true, sessionType: 'simple', savedAt: 1000
        }))
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation(() => ({
                matches: false,
                media: '',
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn(),
            })),
        })
    })

    it('opens with the model picked later on another device or in a chat', async () => {
        const api = apiWith({
            getNewSessionDefaults: vi.fn(async () => ({
                defaults: { agent: 'claude', model: 'claude-opus-5-5', customModel: '', thinkEffort: 'max', updatedAt: 2000 }
            }))
        })

        renderWithProviders(<NewSession api={api} machines={machines} onSuccess={vi.fn()} onCancel={vi.fn()} />)

        // This browser's copy shows first, then the newer shared choice replaces it.
        expect(screen.getByRole('button', { name: /^Model\s*Sonnet/ })).toBeInTheDocument()
        expect(await screen.findByRole('button', { name: /^Model\s*Opus 5\.5/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /^Think level\s*Max/ })).toBeInTheDocument()
    })

    it('keeps this browser\'s choice when it is newer than the shared one', async () => {
        const getNewSessionDefaults = vi.fn(async () => ({
            defaults: { agent: 'claude', model: 'claude-opus-5-5', updatedAt: 500 }
        }))
        renderWithProviders(<NewSession api={apiWith({ getNewSessionDefaults })} machines={machines} onSuccess={vi.fn()} onCancel={vi.fn()} />)

        await waitFor(() => expect(getNewSessionDefaults).toHaveBeenCalled())
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 50))
        })
        expect(screen.getByRole('button', { name: /^Model\s*Sonnet/ })).toBeInTheDocument()
    })

    it('does not undo a change the user already made when the hub answers late', async () => {
        let answer: (value: unknown) => void = () => {}
        const api = apiWith({
            getNewSessionDefaults: vi.fn(() => new Promise((resolve) => { answer = resolve }))
        })
        renderWithProviders(<NewSession api={api} machines={machines} onSuccess={vi.fn()} onCancel={vi.fn()} />)

        fireEvent.click(screen.getByRole('radio', { name: 'codex' }))
        await act(async () => {
            answer({ defaults: { agent: 'claude', model: 'claude-opus-5-5', updatedAt: 2000 } })
            await new Promise((resolve) => setTimeout(resolve, 50))
        })

        expect(screen.getByRole('radio', { name: 'codex' })).toBeChecked()
    })

    it('shares the settings it created with to the hub', async () => {
        const saveNewSessionDefaults = vi.fn(async (payload: Record<string, unknown>) => ({ defaults: { ...payload, updatedAt: 3000 } }))
        const api = apiWith({
            getNewSessionDefaults: vi.fn(async () => ({ defaults: null })),
            saveNewSessionDefaults,
            spawnSession: vi.fn(async (machineId: string, directory: string) => ({ type: 'success', sessionId: 'session-3', machineId, directory }))
        })
        const onSuccess = vi.fn()
        renderWithProviders(<NewSession api={api} machines={machines} onSuccess={onSuccess} onCancel={vi.fn()} />)

        fireEvent.click(screen.getByRole('button', { name: 'Another folder…' }))
        const directoryInput = screen.getByPlaceholderText('/path/to/project')
        fireEvent.change(directoryInput, { target: { value: '/tmp/project' } })
        fireEvent.keyDown(directoryInput, { key: 'Enter', metaKey: true })

        await waitFor(() => expect(saveNewSessionDefaults).toHaveBeenCalledTimes(1))
        expect(saveNewSessionDefaults).toHaveBeenCalledWith({
            agent: 'claude', model: 'sonnet', customModel: '', thinkEffort: 'high', serviceTier: 'auto', yoloMode: true, claudeAccountId: ''
        })
        expect(onSuccess).toHaveBeenCalledWith('session-3')
        // The local copy takes the hub's time, so the two copies compare on one clock.
        await waitFor(() => expect(JSON.parse(localStorage.getItem('hapi:newSession:lastConfig') ?? '{}').savedAt).toBe(3000))
    })

    it('still creates the session when sharing the settings fails', async () => {
        const onSuccess = vi.fn()
        const api = apiWith({
            getNewSessionDefaults: vi.fn(async () => { throw new Error('offline') }),
            saveNewSessionDefaults: vi.fn(() => { throw new Error('offline') }),
            spawnSession: vi.fn(async (machineId: string, directory: string) => ({ type: 'success', sessionId: 'session-4', machineId, directory }))
        })
        renderWithProviders(<NewSession api={api} machines={machines} onSuccess={onSuccess} onCancel={vi.fn()} />)

        fireEvent.click(screen.getByRole('button', { name: 'Another folder…' }))
        const directoryInput = screen.getByPlaceholderText('/path/to/project')
        fireEvent.change(directoryInput, { target: { value: '/tmp/project' } })
        fireEvent.keyDown(directoryInput, { key: 'Enter', metaKey: true })

        await waitFor(() => expect(onSuccess).toHaveBeenCalledWith('session-4'))
    })
})
