import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

        fireEvent.change(screen.getByPlaceholderText('/path/to/project'), { target: { value: '/tmp/project' } })
        fireEvent.click(screen.getByRole('radio', { name: 'codex' }))
        fireEvent.click(screen.getByRole('button', { name: 'More options' }))
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
