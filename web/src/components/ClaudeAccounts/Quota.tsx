import type { ClaudeRateLimitSnapshot } from '@hapi/protocol/schemas'
import { useTranslation } from '@/lib/use-translation'

const labelKeys: Record<string, string> = {
    five_hour: 'usage.rateLimit.fiveHour',
    seven_day: 'usage.rateLimit.weeklyAll',
    seven_day_opus: 'usage.rateLimit.weeklyOpus',
    seven_day_sonnet: 'usage.rateLimit.weeklySonnet',
    overage: 'usage.rateLimit.overage'
}

export function AccountQuota({ snapshot }: { snapshot?: ClaudeRateLimitSnapshot }) {
    const { t } = useTranslation()
    if (!snapshot || !Object.values(snapshot).some(Boolean)) {
        return <p className="text-xs text-[var(--app-hint)]">{t('claudeAccounts.quota.unknown')}</p>
    }
    return <div className="space-y-1 text-xs">
        {Object.entries(snapshot).map(([key, entry]) => {
            if (!entry) return null
            const stale = Date.now() - entry.observedAt > 5 * 60_000
            const label = t(labelKeys[key] ?? key)
            const usage = entry.utilization === undefined
                ? t('claudeAccounts.quota.usageUnknown')
                : t('claudeAccounts.quota.used', { percent: Math.round(entry.utilization * 100) })
            return <div key={key} className="text-[var(--app-hint)]">
                <span>{label} · {usage}{entry.status === 'rejected' ? ` · ${t('claudeAccounts.quota.limited')}` : ''}</span>
                {entry.utilization !== undefined && <progress aria-label={label} value={entry.utilization} max={1} className="mx-2 h-1.5 w-24 align-middle" />}
                <span> · {t('claudeAccounts.quota.observedAt', { time: new Date(entry.observedAt).toLocaleTimeString() })}{stale ? ` · ${t('claudeAccounts.quota.stale')}` : ''}{entry.resetsAt ? ` · ${t('claudeAccounts.quota.resetsAt', { time: new Date(entry.resetsAt * 1000).toLocaleString() })}` : ''}</span>
            </div>
        })}
    </div>
}
