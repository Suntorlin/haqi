import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { ClaudeAccountsSettings } from './Settings'
import { AccountQuota } from './Quota'

const empty = { pool: { initialAccount: '', autoSwitch: false, profiles: [] }, revision: 'revision' }
afterEach(cleanup)
const machine = { id: 'machine', active: true, metadata: { host: '隔离测试机器' } } as Machine
function setup(machines: Machine[] = [machine]) {
    const api = { getClaudeAccounts: vi.fn().mockResolvedValue(empty), saveClaudeAccounts: vi.fn().mockImplementation(async (_id, view) => ({ ...view, revision: 'new' })), checkClaudeAccount: vi.fn() }
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ClaudeAccountsSettings api={api as unknown as ApiClient} machines={machines} /></QueryClientProvider>)
    return api
}
describe('Claude account management settings', () => {
    it('always exposes the section even without an online runner', () => {
        setup([])
        expect(screen.getByRole('heading', { name: 'Claude 账号管理' })).toBeTruthy()
        expect(screen.getByText(/尚无在线机器/)).toBeTruthy()
    })
    it('adds an account, validates email and saves metadata only', async () => {
        const api = setup()
        fireEvent.click(await screen.findByRole('button', { name: '添加账号' }))
        fireEvent.change(screen.getByLabelText('账号 1 邮箱'), { target: { value: 'test@example.com' } })
        fireEvent.click(screen.getByRole('button', { name: '保存账号设置' }))
        await waitFor(() => expect(api.saveClaudeAccounts).toHaveBeenCalledTimes(1))
        expect(api.saveClaudeAccounts.mock.calls[0][1].pool.profiles[0].email).toBe('test@example.com')
        expect(JSON.stringify(api.saveClaudeAccounts.mock.calls[0])).not.toMatch(/token|configDir/)
        expect(await screen.findByText(/已保存。/)).toBeTruthy()
    })
    it('reports unknown quota instead of showing a fake 0%', () => {
        render(<AccountQuota />)
        expect(screen.getByText(/额度未知/)).toBeTruthy()
        expect(screen.queryByRole('progressbar')).toBeNull()
    })
    it('shows observed utilization rather than guaranteed remaining credit', () => {
        render(<AccountQuota snapshot={{ five_hour: { status: 'allowed', utilization: 0.4, observedAt: Date.now() } }} />)
        expect(screen.getByText(/已用 40%/)).toBeTruthy()
    })
})
