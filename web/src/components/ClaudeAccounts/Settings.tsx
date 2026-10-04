import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClaudeAccountPoolSchema, type ClaudeAccountPool, type ClaudeAccountPoolView } from '@hapi/protocol/schemas'
import type { ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { AccountQuota } from './Quota'

const field = 'w-full min-w-0 rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50'
const button = 'rounded-lg border border-[var(--app-divider)] px-2.5 py-1.5 text-xs hover:bg-[var(--app-subtle-bg)] disabled:opacity-40'
export const accountsKey = (machineId: string) => ['claude-accounts', machineId] as const

function PoolEditor({ api, machineId }: { api: ApiClient; machineId: string }) {
    const { t } = useTranslation()
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
        if (!parsed.success) { setNotice(parsed.error.issues.map(i => i.message).join('; ')); return }
        setWorking(true); setNotice('')
        try {
            const updated = await api.saveClaudeAccounts(machineId, { pool: parsed.data, revision: draft.revision })
            cache.setQueryData(accountsKey(machineId), updated); setDraft(updated); setDirty(false)
            setNotice(t('settings.claudeAccounts.saved'))
        } catch (error) { setNotice(error instanceof Error ? error.message : t('settings.claudeAccounts.saveFailed')) }
        finally { setWorking(false) }
    }
    const check = async (id: string) => {
        setWorking(true)
        try { const result = await api.checkClaudeAccount(machineId, id); setChecks(old => ({ ...old, [id]: t('settings.claudeAccounts.checkOk', { email: result.email }) })) }
        catch (error) { setChecks(old => ({ ...old, [id]: error instanceof Error ? error.message : t('settings.claudeAccounts.checkFailed') })) }
        finally { setWorking(false) }
    }
    if (query.isPending) return <p role="status" className="text-sm text-[var(--app-hint)]">{t('settings.claudeAccounts.loading')}</p>
    if (query.isError) return <div role="alert" className="space-y-2 text-sm"><p>{query.error.message}</p><button type="button" className={button} onClick={() => void query.refetch()}>{t('settings.claudeAccounts.retry')}</button></div>
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
    return <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pool.autoSwitch} disabled={working} onChange={e => change({ ...pool, autoSwitch: e.target.checked })} />
            {t('settings.claudeAccounts.autoSwitch')}
        </label>
        {!pool.profiles.length && <p className="text-sm text-[var(--app-hint)]">{t('settings.claudeAccounts.empty')}</p>}
        {pool.profiles.map((profile, index) => <fieldset disabled={working} key={profile.id} className="flex flex-col gap-2 rounded-lg border border-[var(--app-divider)] p-2">
            <div className="flex items-center gap-3">
                <input className={`${field} flex-1`} type="email" aria-label={t('settings.claudeAccounts.emailLabel', { index: index + 1 })} placeholder="user@example.com" value={profile.email} onChange={e => { update(index, { email: e.target.value }); setChecks(old => ({ ...old, [profile.id]: '' })) }} />
                <label className="flex shrink-0 items-center gap-1 text-xs">
                    <input type="radio" name={`claude-default-${machineId}`} checked={pool.initialAccount === profile.id} disabled={!profile.enabled} onChange={() => change({ ...pool, initialAccount: profile.id })} />
                    {t('settings.claudeAccounts.default')}
                </label>
                <label className="flex shrink-0 items-center gap-1 text-xs">
                    <input type="checkbox" checked={profile.enabled} onChange={e => update(index, { enabled: e.target.checked })} />
                    {t('settings.claudeAccounts.enabled')}
                </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={button} aria-label={`${t('settings.claudeAccounts.moveUp')} ${index + 1}`} disabled={index === 0} onClick={() => reorder(index, -1)}>↑</button>
                <button type="button" className={button} aria-label={`${t('settings.claudeAccounts.moveDown')} ${index + 1}`} disabled={index === pool.profiles.length - 1} onClick={() => reorder(index, 1)}>↓</button>
                <button type="button" className={button} disabled={dirty} onClick={() => void check(profile.id)}>{t('settings.claudeAccounts.check')}</button>
                <button type="button" className={button} onClick={() => {
                    const profiles = pool.profiles.filter(p => p.id !== profile.id)
                    change({ ...pool, profiles, initialAccount: pool.initialAccount === profile.id ? profiles.find(p => p.enabled)?.id ?? '' : pool.initialAccount })
                }}>{t('settings.claudeAccounts.remove')}</button>
                {checks[profile.id] && <span role="status" className="text-xs text-[var(--app-hint)]">{checks[profile.id]}</span>}
            </div>
            <AccountQuota snapshot={query.data?.usage?.[profile.id]} />
        </fieldset>)}
        <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={working || pool.profiles.length >= 10} onClick={() => {
                const id = `account-${crypto.randomUUID().slice(0, 8)}`
                change({ ...pool, initialAccount: pool.initialAccount || id, profiles: [...pool.profiles, { id, email: '', enabled: true, trustGroup: 'personal' }] })
            }}>{t('settings.claudeAccounts.add')}</button>
            <button type="button" className={`${button} font-semibold`} disabled={working || !dirty} onClick={() => void save()}>{working ? t('settings.claudeAccounts.working') : t('settings.claudeAccounts.save')}</button>
            <button type="button" className={button} disabled={working || dirty} onClick={() => void query.refetch()}>{t('settings.claudeAccounts.refresh')}</button>
            {dirty && <button type="button" className={button} disabled={working} onClick={() => { setDirty(false); setNotice('') }}>{t('settings.claudeAccounts.discard')}</button>}
        </div>
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <details className="text-xs text-[var(--app-hint)]">
            <summary className="cursor-pointer">{t('settings.claudeAccounts.help')}</summary>
            <p className="mt-2">{t('settings.claudeAccounts.help.login')}</p>
            {pool.profiles.map(p => <code key={p.id} className="mt-1 block break-all rounded bg-[var(--app-subtle-bg)] p-2">{`CLAUDE_CONFIG_DIR="$HAPI_HOME/claude-accounts/${p.id}" claude auth login`}</code>)}
            <p className="mt-2">{t('settings.claudeAccounts.help.notes')}</p>
        </details>
    </div>
}

export function ClaudeAccountsSettings({ api, machines }: { api: ApiClient; machines: Machine[] }) {
    const { t } = useTranslation()
    const [selected, setSelected] = useState('')
    const online = machines.filter(m => m.active)
    const machineId = online.some(m => m.id === selected) ? selected : online[0]?.id
    if (!machineId) {
        return <p role="status" className="px-3 py-3 text-sm text-[var(--app-hint)]">{t('settings.claudeAccounts.noMachine')}</p>
    }
    return <div className="flex flex-col gap-3 px-3 py-3">
        {online.length > 1 && <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--app-hint)]">
            {t('settings.claudeAccounts.machine')}
            <select aria-label={t('settings.claudeAccounts.machine')} className={field} value={machineId} onChange={e => setSelected(e.target.value)}>
                {online.map(m => <option key={m.id} value={m.id}>{m.metadata?.host ?? m.id}</option>)}
            </select>
        </label>}
        <PoolEditor key={machineId} api={api} machineId={machineId} />
    </div>
}
