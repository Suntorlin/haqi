import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ClaudeAccountPoolSchema, type ClaudeAccountPool, type ClaudeAccountPoolView } from '@hapi/protocol/schemas'
import { ApiError, parseErrorCode, type ApiClient } from '@/api/client'
import type { Machine } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { AccountQuota } from './Quota'
import { ChevronDownIcon } from '@/components/mobile/icons'
import { SettingsSwitchRow } from '@/components/settings/SettingsParts'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/Chip'
import { FormField, SelectInput } from '@/components/ui/FormControls'
import { IconButton } from '@/components/ui/IconButton'
import { ListGroup } from '@/components/ui/ListRow'
import { Switch } from '@/components/ui/Switch'
import { TextField } from '@/components/ui/TextField'
import { EmptyState } from '@/components/ui/EmptyState'

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
    if (query.isPending) return <p role="status" className="text-footnote text-[var(--social-fg-muted)]">{t('settings.claudeAccounts.loading')}</p>
    if (query.isError) return <div role="alert" className="flex flex-col items-start gap-2 text-footnote"><p>{query.error.message}</p><Button variant="secondary" onClick={() => void query.refetch()}>{t('settings.claudeAccounts.retry')}</Button></div>
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
    return <div className="flex flex-col gap-4">
        <ListGroup>
            <SettingsSwitchRow
                title={t('settings.claudeAccounts.autoSwitch')}
                label={t('settings.claudeAccounts.autoSwitch')}
                checked={pool.autoSwitch}
                disabled={working}
                onCheckedChange={autoSwitch => change({ ...pool, autoSwitch })}
            />
        </ListGroup>
        {!pool.profiles.length && <EmptyState title={t('settings.claudeAccounts.empty')} />}
        {pool.profiles.map((profile, index) => <fieldset disabled={working} key={profile.id} className="flex min-w-0 flex-col gap-3 rounded-2xl border border-[var(--social-border)] p-4">
            <TextField type="email" aria-label={t('settings.claudeAccounts.emailLabel', { index: index + 1 })} placeholder="user@example.com" value={profile.email} onChange={e => { update(index, { email: e.target.value }); setChecks(old => ({ ...old, [profile.id]: '' })) }} />
            <div className="flex items-center justify-between gap-3">
                <Chip
                    role="radio"
                    aria-checked={pool.initialAccount === profile.id}
                    aria-pressed={undefined}
                    selected={pool.initialAccount === profile.id}
                    disabled={!profile.enabled}
                    onClick={() => change({ ...pool, initialAccount: profile.id })}
                    className="relative shrink-0 before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']"
                >
                    {t('settings.claudeAccounts.default')}
                </Chip>
                <div className="flex shrink-0 items-center gap-2 text-footnote text-[var(--social-fg-muted)]">
                    {t('settings.claudeAccounts.enabled')}
                    <Switch className="-my-3 py-3" checked={profile.enabled} onCheckedChange={enabled => update(index, { enabled })} ariaLabel={`${t('settings.claudeAccounts.enabled')} ${index + 1}`} />
                </div>
            </div>
            <div className="flex items-center gap-2">
                <Button variant="secondary" className="px-4" disabled={dirty} onClick={() => void check(profile.id)}>{t('settings.claudeAccounts.check')}</Button>
                <Button variant="secondary" className="px-4 text-[var(--social-danger)]" onClick={() => {
                    const profiles = pool.profiles.filter(p => p.id !== profile.id)
                    change({ ...pool, profiles, initialAccount: pool.initialAccount === profile.id ? profiles.find(p => p.enabled)?.id ?? '' : pool.initialAccount })
                }}>{t('settings.claudeAccounts.remove')}</Button>
                <div className="ml-auto flex items-center gap-1">
                    <IconButton variant="muted" label={`${t('settings.claudeAccounts.moveUp')} ${index + 1}`} disabled={index === 0} onClick={() => reorder(index, -1)}><ChevronDownIcon className="h-4 w-4 rotate-180" /></IconButton>
                    <IconButton variant="muted" label={`${t('settings.claudeAccounts.moveDown')} ${index + 1}`} disabled={index === pool.profiles.length - 1} onClick={() => reorder(index, 1)}><ChevronDownIcon className="h-4 w-4" /></IconButton>
                </div>
            </div>
            {checks[profile.id] && <p role="status" className="text-caption text-[var(--social-fg-muted)]">{checks[profile.id]}</p>}
            <AccountQuota snapshot={query.data?.usage?.[profile.id]} />
        </fieldset>)}
        <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={working || pool.profiles.length >= 10} onClick={() => {
                const id = `account-${crypto.randomUUID().slice(0, 8)}`
                change({ ...pool, initialAccount: pool.initialAccount || id, profiles: [...pool.profiles, { id, email: '', enabled: true, trustGroup: 'personal' }] })
            }}>{t('settings.claudeAccounts.add')}</Button>
            <Button disabled={working || !dirty} onClick={() => void save()}>{working ? t('settings.claudeAccounts.working') : t('settings.claudeAccounts.save')}</Button>
            <Button variant="secondary" disabled={working || dirty} onClick={() => void query.refetch()}>{t('settings.claudeAccounts.refresh')}</Button>
            {dirty && <Button variant="secondary" disabled={working} onClick={() => { setDirty(false); setNotice('') }}>{t('settings.claudeAccounts.discard')}</Button>}
        </div>
        {notice && <p role="status" className="px-1 text-footnote text-[var(--social-fg)]">{notice}</p>}
        <details className="group text-caption text-[var(--social-fg-muted)]">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 px-1 [&::-webkit-details-marker]:hidden">
                {t('settings.claudeAccounts.help')}
                <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
            </summary>
            <p className="mt-1">{t('settings.claudeAccounts.help.login')}</p>
            {pool.profiles.map(p => <code key={p.id} className="mt-1 block break-all rounded-md bg-[var(--social-muted)] p-2">{loginCommand(p.id)}</code>)}
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
        return <EmptyState role="status" title={t('settings.claudeAccounts.noMachine')} />
    }
    return <div className="flex flex-col gap-4">
        {online.length > 1 && <FormField label={t('settings.claudeAccounts.machine')}>
            <SelectInput aria-label={t('settings.claudeAccounts.machine')} value={machineId} onChange={e => setSelected(e.target.value)}>
                {online.map(m => <option key={m.id} value={m.id}>{m.metadata?.host ?? m.id}</option>)}
            </SelectInput>
        </FormField>}
        <PoolEditor key={machineId} api={api} machineId={machineId} />
    </div>
}
