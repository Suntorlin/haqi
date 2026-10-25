import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'
import { useTranslation } from '@/lib/use-translation'
import { SettingsSelectRow } from '@/components/settings/SettingsParts'
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

/** Account for a new Claude session as a settings row; the choices list each account's remaining quota. */
export function ClaudeAccountRow({ api, machineId, selection, onChange, disabled }: {
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

    const machineLogin = query.data?.machineLogin
    const options = [
        {
            value: '',
            label: machineLogin?.email
                ? `${t('newSession.claudeAccount.machineDefault')} · ${machineLogin.email}`
                : t('newSession.claudeAccount.machineDefault'),
            description: machineLogin?.failedAt
                ? t('newSession.claudeAccount.machineLoginFailed')
                : t('newSession.claudeAccount.autoSwitch', { state: pool.autoSwitch ? t('newSession.claudeAccount.enabled') : t('newSession.claudeAccount.disabled') })
        },
        ...profiles.map((p) => ({
            value: p.id,
            label: pool.initialAccount === p.id ? `${p.email} · ${t('newSession.claudeAccount.default')}` : p.email,
            description: quotaOptionLabel(query.data?.usage?.[p.id], t) ?? t('newSession.claudeAccount.remainingUnknown')
        }))
    ]
    const value = selection?.accountId ?? ''
    const current = value ? profiles.find(p => p.id === value)?.email ?? value : t('newSession.claudeAccount.machineDefault')

    return (
        <SettingsSelectRow
            title={t('newSession.claudeAccount')}
            subtitle={!value && machineLogin?.failedAt ? (
                <span className="text-[var(--social-danger)]">{t('newSession.claudeAccount.machineLoginFailedHint')}</span>
            ) : undefined}
            valueLabel={current}
            disabled={disabled}
            options={options}
            value={value}
            onChange={(accountId) => onChange(accountId ? { accountId, automatic: pool.autoSwitch } : undefined)}
        />
    )
}
