import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'
import { useTranslation } from '@/lib/use-translation'
import { accountsKey } from './Settings'

type RateLimitSnapshot = import('@hapi/protocol/schemas').ClaudeRateLimitSnapshot
type TranslateFn = (key: string, params?: Record<string, string | number>) => string

// resetsAt is unix seconds; a passed reset means the recorded usage no longer applies.
function windowExpired(resetsAt: number | undefined, now: number): boolean {
    return typeof resetsAt === 'number' && resetsAt * 1000 <= now
}

export function remainingLabel(snapshot: RateLimitSnapshot | undefined, now: number = Date.now()): string | undefined {
    const fiveHour = snapshot?.five_hour
    if (fiveHour?.status === 'rejected' && !windowExpired(fiveHour.resetsAt, now)) return '0%'
    const session = snapshot?.usageLimits?.find(limit => limit.kind === 'session')
    if (typeof session?.percent === 'number') {
        return windowExpired(session.resetsAt, now) ? '100%' : `${Math.max(0, Math.round(100 - session.percent))}%`
    }
    if (typeof fiveHour?.utilization === 'number') {
        return windowExpired(fiveHour.resetsAt, now) ? '100%' : `${Math.max(0, Math.round(100 - fiveHour.utilization * 100))}%`
    }
    return undefined
}

export function weeklyQuota(snapshot: RateLimitSnapshot | undefined, now: number = Date.now()): { remainingPercent?: number; resetsAt?: number } | undefined {
    if (!snapshot) return undefined
    const weeklyAll = snapshot.usageLimits?.find(limit => limit.kind === 'weekly_all')
    const sevenDay = snapshot.seven_day
    let remainingPercent: number | undefined
    if (typeof weeklyAll?.percent === 'number') {
        remainingPercent = windowExpired(weeklyAll.resetsAt, now) ? 100 : Math.max(0, Math.round(100 - weeklyAll.percent))
    } else if (typeof sevenDay?.utilization === 'number') {
        remainingPercent = windowExpired(sevenDay.resetsAt, now) ? 100 : Math.max(0, Math.round(100 - sevenDay.utilization * 100))
    }
    const futureResets = [
        sevenDay?.resetsAt,
        ...(snapshot.usageLimits ?? []).filter(limit => limit.kind.startsWith('weekly')).map(limit => limit.resetsAt)
    ].filter((value): value is number => typeof value === 'number' && value * 1000 > now)
    const resetsAt = futureResets.length ? Math.min(...futureResets) : undefined
    if (remainingPercent === undefined && resetsAt === undefined) return undefined
    return { remainingPercent, resetsAt }
}

/** Compact per-account quota summary for <option> rows: 5h left · 7d left · 7d reset time. */
export function quotaOptionLabel(snapshot: RateLimitSnapshot | undefined, t: TranslateFn, now: number = Date.now()): string | undefined {
    const parts: string[] = []
    const session = remainingLabel(snapshot, now)
    if (session !== undefined) parts.push(t('sessionAccount.quota5h', { percent: session }))
    const weekly = weeklyQuota(snapshot, now)
    if (weekly?.remainingPercent !== undefined) parts.push(t('sessionAccount.quota7d', { percent: `${weekly.remainingPercent}%` }))
    if (weekly?.resetsAt) {
        const time = new Date(weekly.resetsAt * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
        parts.push(t('sessionAccount.quota7dReset', { time }))
    }
    return parts.length ? parts.join(' · ') : undefined
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
                {profiles.map((p) => {
                    const quota = quotaOptionLabel(query.data?.usage?.[p.id], t)
                    return (
                        <option key={p.id} value={p.id}>
                            {p.email}
                            {pool.initialAccount === p.id ? ` · ${t('newSession.claudeAccount.default')}` : ''}
                            {quota ? ` · ${quota}` : ` · ${t('newSession.claudeAccount.remainingUnknown')}`}
                        </option>
                    )
                })}
            </select>
            <p className="text-[11px] text-[var(--app-hint)]">
                {t('newSession.claudeAccount.autoSwitch', { state: pool.autoSwitch ? t('newSession.claudeAccount.enabled') : t('newSession.claudeAccount.disabled') })}
            </p>
        </div>
    )
}
