import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { ClaudeAccountsSettings } from './Settings'
import { AccountQuota } from './Quota'

const empty = { pool: { initialAccount: '', autoSwitch: false, profiles: [] }, revision: 'revision' }
afterEach(cleanup)
const machine = { id: 'machine', active: true, metadata: { host: 'test-host' } } as Machine
const wrap = (children: ReactNode) => <I18nProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
</I18nProvider>
function setup(machines: Machine[] = [machine]) {
    const api = { getClaudeAccounts: vi.fn().mockResolvedValue(empty), saveClaudeAccounts: vi.fn().mockImplementation(async (_id, view) => ({ ...view, revision: 'new' })), checkClaudeAccount: vi.fn() }
    render(wrap(<ClaudeAccountsSettings api={api as unknown as ApiClient} machines={machines} />))
    return api
}
describe('Claude account management settings', () => {
    it('shows a hint instead of the editor without an online runner', () => {
        setup([])
        expect(screen.getByText(/No online machine/)).toBeTruthy()
    })
    it('adds an account, validates email and saves metadata only', async () => {
        const api = setup()
        fireEvent.click(await screen.findByRole('button', { name: 'Add account' }))
        fireEvent.change(screen.getByLabelText('Account 1 email'), { target: { value: 'test@example.com' } })
        fireEvent.click(screen.getByRole('button', { name: 'Save' }))
        await waitFor(() => expect(api.saveClaudeAccounts).toHaveBeenCalledTimes(1))
        expect(api.saveClaudeAccounts.mock.calls[0][1].pool.profiles[0].email).toBe('test@example.com')
        expect(JSON.stringify(api.saveClaudeAccounts.mock.calls[0])).not.toMatch(/token|configDir/)
        expect(await screen.findByText(/Saved\./)).toBeTruthy()
    })
    it('reports unknown quota instead of showing a fake 0%', () => {
        render(wrap(<AccountQuota />))
        expect(screen.getByText(/Quota unknown/)).toBeTruthy()
        expect(screen.queryByRole('progressbar')).toBeNull()
    })
    it('shows observed utilization rather than guaranteed remaining credit', () => {
        render(wrap(<AccountQuota snapshot={{ five_hour: { status: 'allowed', utilization: 0.4, observedAt: Date.now() } }} />))
        expect(screen.getByText(/used 40%/)).toBeTruthy()
    })
})
