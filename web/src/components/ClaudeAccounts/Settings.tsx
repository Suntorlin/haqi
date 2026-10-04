import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClaudeAccountPoolSchema, type ClaudeAccountPool, type ClaudeAccountPoolView } from '@hapi/protocol/schemas'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { AccountQuota } from './Quota'

const field = 'w-full min-w-0 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2 text-sm'
const button = 'rounded-lg border border-[var(--app-border)] px-3 py-2 text-sm hover:bg-[var(--app-subtle-bg)] disabled:opacity-40'
export const accountsKey = (machineId: string) => ['claude-accounts', machineId] as const

function PoolEditor({ api, machineId }: { api: ApiClient; machineId: string }) {
    const cache = useQueryClient()
    const query = useQuery({ queryKey: accountsKey(machineId), queryFn: () => api.getClaudeAccounts(machineId), retry: false })
    const [draft, setDraft] = useState<ClaudeAccountPoolView | null>(null)
    const [dirty, setDirty] = useState(false)
    const [working, setWorking] = useState(false)
    const [notice, setNotice] = useState('')
    const [checks, setChecks] = useState<Record<string, string>>({})
    useEffect(() => { if (query.data && !dirty) setDraft(query.data) }, [query.data, dirty])
    const change = (pool: ClaudeAccountPool) => { if (draft) { setDraft({ ...draft, pool }); setDirty(true); setNotice('') } }
    const save = async () => {
        if (!draft) return
        const parsed = ClaudeAccountPoolSchema.safeParse(draft.pool)
        if (!parsed.success) { setNotice(parsed.error.issues.map(i => i.message).join('；')); return }
        setWorking(true); setNotice('')
        try {
            const updated = await api.saveClaudeAccounts(machineId, { pool: parsed.data, revision: draft.revision })
            cache.setQueryData(accountsKey(machineId), updated); setDraft(updated); setDirty(false)
            setNotice('已保存。顺序与默认模式用于新会话，不强制切换正在运行的会话。')
        } catch (error) { setNotice(error instanceof Error ? error.message : '保存失败') }
        finally { setWorking(false) }
    }
    const check = async (id: string) => {
        setWorking(true)
        try { const result = await api.checkClaudeAccount(machineId, id); setChecks(old => ({ ...old, [id]: `${result.email} · 登录核验通过` })) }
        catch (error) { setChecks(old => ({ ...old, [id]: error instanceof Error ? error.message : '尚未登录' })) }
        finally { setWorking(false) }
    }
    if (query.isPending) return <p role="status">正在读取机器上的账号配置…</p>
    if (query.isError) return <div role="alert" className="space-y-2"><p>{query.error.message}</p><button type="button" className={button} onClick={() => void query.refetch()}>重试连接</button></div>
    if (!draft) return null
    const pool = draft.pool
    const update = (index: number, patch: Partial<ClaudeAccountPool['profiles'][number]>) => change({ ...pool, profiles: pool.profiles.map((p, i) => i === index ? { ...p, ...patch } : p) })
    const reorder = (index: number, direction: number) => {
        const profiles = [...pool.profiles]
        const target = index + direction
        if (target < 0 || target >= profiles.length) return
        ;[profiles[index], profiles[target]] = [profiles[target]!, profiles[index]!]
        change({ ...pool, profiles })
    }
    return <div className="space-y-4">
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={pool.autoSwitch} disabled={working} onChange={e => change({ ...pool, autoSwitch: e.target.checked })} />新会话默认自动切换（明确额度耗尽后，按下方顺序尝试同一授权组账号）</label>
        <p className="text-xs text-[var(--app-hint)]">不同会话可分别选择不同账号。账号凭据只保存在对应机器；这里不上传 token。额度来自会话观测，不是实时余额。</p>
        {!pool.profiles.length && <p className="rounded-lg bg-[var(--app-subtle-bg)] p-4 text-sm">还没有账号。添加邮箱后保存，再在机器上完成 Claude 官方登录。</p>}
        {pool.profiles.map((profile, index) => <fieldset disabled={working} key={profile.id} className="space-y-3 rounded-xl border border-[var(--app-border)] p-3">
            <legend className="px-1 text-sm font-semibold">{index + 1}. {profile.id}{pool.initialAccount === profile.id ? ' · 默认账号' : ''}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs">账号邮箱<input className={`${field} mt-1`} type="email" aria-label={`账号 ${index + 1} 邮箱`} value={profile.email} onChange={e => { update(index, { email: e.target.value }); setChecks(old => ({ ...old, [profile.id]: '' })) }} /></label>
                <label className="text-xs">授权组<input className={`${field} mt-1`} aria-label={`账号 ${index + 1} 授权组`} value={profile.trustGroup} onChange={e => update(index, { trustGroup: e.target.value })} /></label>
            </div>
            <AccountQuota snapshot={query.data?.usage?.[profile.id]} />
            <div className="flex flex-wrap items-center gap-2">
                <label className="mr-2 flex items-center gap-1 text-xs"><input type="checkbox" checked={profile.enabled} onChange={e => update(index, { enabled: e.target.checked })} />启用</label>
                <button type="button" className={button} aria-label={`上移 ${profile.id}`} disabled={index === 0} onClick={() => reorder(index, -1)}>上移</button>
                <button type="button" className={button} aria-label={`下移 ${profile.id}`} disabled={index === pool.profiles.length - 1} onClick={() => reorder(index, 1)}>下移</button>
                <button type="button" className={button} disabled={!profile.enabled || pool.initialAccount === profile.id} onClick={() => change({ ...pool, initialAccount: profile.id })}>设为默认</button>
                <button type="button" className={button} disabled={dirty} onClick={() => void check(profile.id)}>检查登录</button>
                <button type="button" className={button} onClick={() => {
                    const profiles = pool.profiles.filter(p => p.id !== profile.id)
                    change({ ...pool, profiles, initialAccount: pool.initialAccount === profile.id ? profiles.find(p => p.enabled)?.id ?? '' : pool.initialAccount })
                }}>移除配置</button>
            </div>
            {checks[profile.id] && <p role="status" className="text-xs">{checks[profile.id]}</p>}
            <details open className="text-xs text-[var(--app-hint)]"><summary className="cursor-pointer">登录说明（首次需要本人授权）</summary>
                <p className="mt-2">在所选机器的终端，将 HAPI_HOME 设为该 Runner 的数据目录后执行：</p>
                <code className="mt-1 block break-all rounded bg-[var(--app-subtle-bg)] p-2">{`HAPI_HOME="${'${HAPI_HOME:-$HOME/.hapi-haqi3}'}" HOME="${'${HAPI_HOME:-$HOME/.hapi-haqi3}'}/claude-accounts/${profile.id}/home" CLAUDE_CONFIG_DIR="${'${HAPI_HOME:-$HOME/.hapi-haqi3}'}/claude-accounts/${profile.id}" claude auth login`}</code>
                <p className="mt-1">必须同时隔离 HOME 和 CLAUDE_CONFIG_DIR；否则 Claude 可能显示登录成功，但会写入全局账号。haqi3 的默认数据目录是 ~/.hapi-haqi3。请选择上面填写的邮箱；完成后点“检查登录”。</p>
            </details>
        </fieldset>)}
        <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={working || pool.profiles.length >= 10} onClick={() => {
                const id = `account-${crypto.randomUUID().slice(0, 8)}`
                change({ ...pool, initialAccount: pool.initialAccount || id, profiles: [...pool.profiles, { id, email: '', enabled: true, trustGroup: 'personal' }] })
            }}>添加账号</button>
            <button type="button" className={`${button} font-semibold`} disabled={working || !dirty} onClick={() => void save()}>{working ? '处理中…' : '保存账号设置'}</button>
            <button type="button" className={button} disabled={working || dirty} onClick={() => void query.refetch()}>刷新额度</button>
            {dirty && <button type="button" className={button} disabled={working} onClick={() => { setDirty(false); setNotice('') }}>放弃修改</button>}
        </div>
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <p className="text-xs text-[var(--app-hint)]">自动接管为实验功能：后台 Agent、未完成工具、过长上下文或全部账号不可用时会暂停提示，不保证完全无感。跨授权组不迁移对话。</p>
    </div>
}

export function ClaudeAccountsSettings({ api, machines }: { api: ApiClient; machines: Machine[] }) {
    const [selected, setSelected] = useState('')
    const online = machines.filter(m => m.active)
    const machineId = online.some(m => m.id === selected) ? selected : online[0]?.id
    return <section aria-label="Claude 账号管理" className="space-y-4 border-b border-[var(--app-border)] p-4">
        <div><h2 className="text-base font-semibold">Claude 账号管理</h2><p className="mt-1 text-sm text-[var(--app-hint)]">账号、切换顺序与额度</p></div>
        {!machineId ? <p role="status" className="rounded-lg bg-[var(--app-subtle-bg)] p-3 text-sm">尚无在线机器。连接隔离版 Runner 后，即可在此添加账号和设置顺序。</p> : <>
            <label className="block text-sm">配置所在机器<select aria-label="账号所在机器" className={`${field} mt-1`} value={machineId} onChange={e => setSelected(e.target.value)}>{online.map(m => <option key={m.id} value={m.id}>{m.metadata?.host ?? m.id}</option>)}</select></label>
            <PoolEditor key={machineId} api={api} machineId={machineId} />
        </>}
    </section>
}
