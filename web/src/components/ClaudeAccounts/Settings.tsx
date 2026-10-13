import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClaudeAccountPoolSchema, type ClaudeAccountPool, type ClaudeAccountPoolView } from '@hapi/protocol/schemas'
import { ApiError, parseErrorCode, type ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { AccountQuota } from './Quota'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { buttonVariants } from '@/components/ui/button'
import { FormField, SelectInput } from '@/components/ui/FormControls'
import { Switch } from '@/components/ui/Switch'

const field = `${DIALOG_INPUT_CLASS} min-w-0 disabled:opacity-50`
const button = buttonVariants({ variant: 'secondary', size: 'sm' })
export const accountsKey = (machineId: string) => ['claude-accounts', machineId] as const
// Claude keys its keychain entry by the literal CLAUDE_CONFIG_DIR string, while the runner passes the symlink-resolved path
// (claude-accounts may be a symlink). `cd -P` makes the login land on the entry the runner will look up; if cd fails nothing runs.
const loginCommand = (id: string) => `(cd -P "\${HAPI_HOME:-$HOME/.hapi}/claude-accounts/${id}" && CLAUDE_CONFIG_DIR="$PWD" claude auth login)`
// The hub answers failures as {"error": "..."}; show that text rather than "HTTP 400 : {json}" so commands in it stay copyable.
const failure = (error: unknown, fallback: string) =>
    (error instanceof ApiError && error.body ? parseErrorCode(error.body) : undefined) ?? (error instanceof Error ? error.message : fallback)

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
        } catch (error) { setNotice(failure(error, t('settings.claudeAccounts.saveFailed'))) }
        finally { setWorking(false) }
    }
    const check = async (id: string) => {
        setWorking(true)
        try { const result = await api.checkClaudeAccount(machineId, id); setChecks(old => ({ ...old, [id]: t('settings.claudeAccounts.checkOk', { email: result.email }) })) }
        catch (error) { setChecks(old => ({ ...old, [id]: failure(error, t('settings.claudeAccounts.checkFailed')) })) }
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
        <div className="flex items-center justify-between gap-3 text-[15px] text-[var(--social-fg)]">
            {t('settings.claudeAccounts.autoSwitch')}
            <Switch checked={pool.autoSwitch} disabled={working} onCheckedChange={autoSwitch => change({ ...pool, autoSwitch })} ariaLabel={t('settings.claudeAccounts.autoSwitch')} />
        </div>
        {!pool.profiles.length && <p className="text-sm text-[var(--app-hint)]">{t('settings.claudeAccounts.empty')}</p>}
        {pool.profiles.map((profile, index) => <fieldset disabled={working} key={profile.id} className="flex flex-col gap-2.5 rounded-2xl border border-[var(--social-border)] p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <input className={`${field} min-w-[180px] flex-1`} type="email" aria-label={t('settings.claudeAccounts.emailLabel', { index: index + 1 })} placeholder="user@example.com" value={profile.email} onChange={e => { update(index, { email: e.target.value }); setChecks(old => ({ ...old, [profile.id]: '' })) }} />
                <button
                    type="button"
                    role="radio"
                    aria-checked={pool.initialAccount === profile.id}
                    disabled={!profile.enabled}
                    onClick={() => change({ ...pool, initialAccount: profile.id })}
                    className={`h-8 shrink-0 rounded-full border px-3.5 text-[13px] transition-colors disabled:opacity-40 ${pool.initialAccount === profile.id
                        ? 'border-[var(--social-primary)] bg-[var(--social-primary)] text-[var(--social-primary-fg)]'
                        : 'border-[var(--social-border)] text-[var(--social-fg)] hover:bg-[var(--social-hover)]'}`}
                >
                    {t('settings.claudeAccounts.default')}
                </button>
                <div className="flex shrink-0 items-center gap-2 text-[13px] text-[var(--social-fg-muted)]">
                    {t('settings.claudeAccounts.enabled')}
                    <Switch checked={profile.enabled} onCheckedChange={enabled => update(index, { enabled })} ariaLabel={`${t('settings.claudeAccounts.enabled')} ${index + 1}`} />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={button} aria-label={`${t('settings.claudeAccounts.moveUp')} ${index + 1}`} disabled={index === 0} onClick={() => reorder(index, -1)}>↑</button>
                <button type="button" className={button} aria-label={`${t('settings.claudeAccounts.moveDown')} ${index + 1}`} disabled={index === pool.profiles.length - 1} onClick={() => reorder(index, 1)}>↓</button>
                <button type="button" className={button} disabled={dirty} onClick={() => void check(profile.id)}>{t('settings.claudeAccounts.check')}</button>
                <button type="button" className={`${button} text-[var(--social-danger)]`} onClick={() => {
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
            <button type="button" className={buttonVariants({ size: 'sm' })} disabled={working || !dirty} onClick={() => void save()}>{working ? t('settings.claudeAccounts.working') : t('settings.claudeAccounts.save')}</button>
            <button type="button" className={button} disabled={working || dirty} onClick={() => void query.refetch()}>{t('settings.claudeAccounts.refresh')}</button>
            {dirty && <button type="button" className={button} disabled={working} onClick={() => { setDirty(false); setNotice('') }}>{t('settings.claudeAccounts.discard')}</button>}
        </div>
        {notice && <p role="status" className="text-sm">{notice}</p>}
        <details className="text-xs text-[var(--app-hint)]">
            <summary className="cursor-pointer">{t('settings.claudeAccounts.help')}</summary>
            <p className="mt-2">{t('settings.claudeAccounts.help.login')}</p>
            {pool.profiles.map(p => <code key={p.id} className="mt-1 block break-all rounded-lg bg-[var(--social-muted)] p-2">{loginCommand(p.id)}</code>)}
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
        {online.length > 1 && <FormField label={t('settings.claudeAccounts.machine')}>
            <SelectInput aria-label={t('settings.claudeAccounts.machine')} value={machineId} onChange={e => setSelected(e.target.value)}>
                {online.map(m => <option key={m.id} value={m.id}>{m.metadata?.host ?? m.id}</option>)}
            </SelectInput>
        </FormField>}
        <PoolEditor key={machineId} api={api} machineId={machineId} />
    </div>
}
