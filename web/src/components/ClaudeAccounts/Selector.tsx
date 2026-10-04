import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'
import { accountsKey } from './Settings'
import { AccountQuota } from './Quota'

export function ClaudeAccountSelector({ api, machineId, selection, onChange, disabled }: {
    api: ApiClient; machineId: string | null; selection?: ClaudeAccountSelection;
    onChange: (selection?: ClaudeAccountSelection) => void; disabled: boolean
}) {
    const query = useQuery({ queryKey: accountsKey(machineId ?? ''), queryFn: () => api.getClaudeAccounts(machineId!), enabled: !!machineId, retry: false })
    const pool = query.data?.pool
    const current = pool?.profiles.find(p => p.id === selection?.accountId)
    return <div className="space-y-2 rounded-lg border border-[var(--app-border)] p-3 text-sm">
        <label className="block font-medium">Claude 使用账号
            <select aria-label="Claude 使用账号" className="mt-2 w-full rounded border border-[var(--app-border)] bg-[var(--app-bg)] p-2" disabled={disabled || !pool} value={selection?.accountId ?? ''} onChange={e => onChange(e.target.value ? { accountId: e.target.value, automatic: pool?.autoSwitch ?? false } : undefined)}>
                <option value="">机器默认登录（账号未核验，不自动切换）</option>
                {pool?.profiles.filter(p => p.enabled).map(p => <option key={p.id} value={p.id}>{p.email}{pool.initialAccount === p.id ? ' · 推荐默认' : ''}</option>)}
            </select>
        </label>
        {selection && <label className="flex items-center gap-2"><input type="checkbox" checked={selection.automatic} disabled={disabled} onChange={e => onChange({ ...selection, automatic: e.target.checked })} />额度耗尽后按设置顺序自动接管</label>}
        {current && <><p>启动账号：{current.email} · 启动时核验身份</p><AccountQuota snapshot={query.data?.usage?.[current.id]} /></>}
        {query.isError && <p role="status" className="text-xs text-[var(--app-hint)]">账号池暂不可用。可使用机器默认登录，或在设置中检查 Runner。</p>}
        {!selection && <p className="text-xs text-[var(--app-hint)]">选择账号池中的邮箱后，才能明确跟踪当前用量归属。账号在“设置 → Claude 账号管理”中配置。</p>}
    </div>
}
