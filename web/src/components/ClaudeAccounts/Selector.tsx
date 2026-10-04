import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'
import { useTranslation } from '@/lib/use-translation'
import { accountsKey } from './Settings'

export function remainingLabel(snapshot: import('@hapi/protocol/schemas').ClaudeRateLimitSnapshot | undefined): string | undefined {
    if (snapshot?.five_hour?.status === 'rejected') return '0%'
    const session = snapshot?.usageLimits?.find(limit => limit.kind === 'session')
    const percent = typeof session?.percent === 'number'
        ? session.percent
        : typeof snapshot?.five_hour?.utilization === 'number'
            ? snapshot.five_hour.utilization * 100
            : undefined
    if (percent === undefined) return undefined
    return `${Math.max(0, Math.round(100 - percent))}%`
}

export function ClaudeAccountSelector({ api, machineId, selection, onChange, disabled }: {
    api: ApiClient; machineId: string | null; selection?: ClaudeAccountSelection;
    onChange: (selection?: ClaudeAccountSelection) => void; disabled: boolean
}) {
    const { t } = useTranslation()
    const query = useQuery({ queryKey: accountsKey(machineId ?? ''), queryFn: () => api.getClaudeAccounts(machineId!), enabled: !!machineId, retry: false })
    const pool = query.data?.pool
    const profiles = pool?.profiles.filter(p => p.enabled) ?? []
    if (!pool || profiles.length === 0) {
        return null
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.claudeAccount')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <select
                aria-label={t('newSession.claudeAccount')}
                value={selection?.accountId ?? ''}
                onChange={(e) => onChange(e.target.value ? { accountId: e.target.value, automatic: pool.autoSwitch } : undefined)}
                disabled={disabled}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                <option value="">{t('newSession.claudeAccount.machineDefault')}</option>
                {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                        {p.email}
                        {pool.initialAccount === p.id ? ` · ${t('newSession.claudeAccount.default')}` : ''}
                        {remainingLabel(query.data?.usage?.[p.id]) !== undefined
                            ? ` · ${t('newSession.claudeAccount.remaining', { percent: remainingLabel(query.data?.usage?.[p.id])! })}`
                            : ` · ${t('newSession.claudeAccount.remainingUnknown')}`}
                    </option>
                ))}
            </select>
            <p className="text-[11px] text-[var(--app-hint)]">
                {t('newSession.claudeAccount.autoSwitch', { state: pool.autoSwitch ? t('newSession.claudeAccount.enabled') : t('newSession.claudeAccount.disabled') })}
            </p>
        </div>
    )
}
