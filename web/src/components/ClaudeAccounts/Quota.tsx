import type { ClaudeRateLimitEntry, ClaudeRateLimitSnapshot } from '@hapi/protocol/schemas'
import { useTranslation } from '@/lib/use-translation'

const labelKeys: Record<string, string> = {
    five_hour: 'usage.rateLimit.fiveHour',
    seven_day: 'usage.rateLimit.weeklyAll',
    seven_day_opus: 'usage.rateLimit.weeklyOpus',
    seven_day_sonnet: 'usage.rateLimit.weeklySonnet',
    overage: 'usage.rateLimit.overage'
}

const usageKindLabelKeys: Record<string, string> = {
    session: 'usage.rateLimit.fiveHour',
    weekly_all: 'usage.rateLimit.weeklyAll',
    weekly_sonnet: 'usage.rateLimit.weeklySonnet',
    weekly_opus: 'usage.rateLimit.weeklyOpus',
    overage: 'usage.rateLimit.overage'
}

function QuotaLine({ label, usage, utilization, observedAt, resetsAt }: {
    label: string; usage: string; utilization?: number; observedAt?: number; resetsAt?: number
}) {
    const { t } = useTranslation()
    const stale = typeof observedAt === 'number' && Date.now() - observedAt > 5 * 60_000
    return <div className="text-[var(--app-hint)]">
        <span>{label} · {usage}</span>
        {utilization !== undefined && <progress aria-label={label} value={utilization} max={1} className="mx-2 h-1.5 w-24 align-middle" />}
        <span>
            {typeof observedAt === 'number' ? ` · ${t('claudeAccounts.quota.observedAt', { time: new Date(observedAt).toLocaleTimeString() })}` : ''}
            {stale ? ` · ${t('claudeAccounts.quota.stale')}` : ''}
            {resetsAt ? ` · ${t('claudeAccounts.quota.resetsAt', { time: new Date(resetsAt * 1000).toLocaleString() })}` : ''}
        </span>
    </div>
}

export function AccountQuota({ snapshot }: { snapshot?: ClaudeRateLimitSnapshot }) {
    const { t } = useTranslation()
    const usageLimits = snapshot?.usageLimits
    if (usageLimits?.length) {
        return <div className="space-y-1 text-xs">
            {usageLimits.map((limit, index) => {
                const labelKey = usageKindLabelKeys[limit.kind]
                const label = limit.kind === 'weekly_scoped' && limit.label
                    ? t('usage.rateLimit.weeklyModel', { label: limit.label })
                    : labelKey ? t(labelKey) : (limit.label ?? limit.kind)
                const usage = typeof limit.percent === 'number'
                    ? t('claudeAccounts.quota.used', { percent: Math.round(limit.percent) })
                    : t('claudeAccounts.quota.usageUnknown')
                return <QuotaLine key={`${limit.kind}:${limit.label ?? index}`} label={label} usage={usage}
                    utilization={typeof limit.percent === 'number' ? limit.percent / 100 : undefined}
                    observedAt={limit.observedAt} resetsAt={limit.resetsAt} />
            })}
        </div>
    }
    const entries = Object.entries(snapshot ?? {}).filter((pair): pair is [string, ClaudeRateLimitEntry] =>
        pair[0] !== 'usageLimits' && Boolean(pair[1]))
    if (!entries.length) {
        return <p className="text-xs text-[var(--app-hint)]">{t('claudeAccounts.quota.unknown')}</p>
    }
    return <div className="space-y-1 text-xs">
        {entries.map(([key, entry]) => {
            const label = t(labelKeys[key] ?? key)
            const usage = entry.utilization === undefined
                ? t('claudeAccounts.quota.usageUnknown')
                : t('claudeAccounts.quota.used', { percent: Math.round(entry.utilization * 100) })
            const limited = entry.status === 'rejected' ? ` · ${t('claudeAccounts.quota.limited')}` : ''
            return <QuotaLine key={key} label={`${label}${limited}`} usage={usage}
                utilization={entry.utilization} observedAt={entry.observedAt} resetsAt={entry.resetsAt} />
        })}
    </div>
}
