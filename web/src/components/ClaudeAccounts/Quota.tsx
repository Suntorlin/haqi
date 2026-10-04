import type { ClaudeRateLimitSnapshot } from '@hapi/protocol/schemas'

const labels = { five_hour: '5 小时', seven_day: '7 天', seven_day_opus: 'Opus 周限额', seven_day_sonnet: 'Sonnet 周限额', overage: '超额用量' }
export function AccountQuota({ snapshot }: { snapshot?: ClaudeRateLimitSnapshot }) {
    if (!snapshot || !Object.values(snapshot).some(Boolean)) return <p className="text-xs text-[var(--app-hint)]">额度未知 · 等待会话返回限额信息</p>
    return <div className="space-y-1 text-xs">
        {Object.entries(snapshot).map(([key, entry]) => {
            if (!entry) return null
            const stale = Date.now() - entry.observedAt > 5 * 60_000
            const reset = entry.resetsAt ? new Date(entry.resetsAt * 1000).toLocaleString() : null
            return <div key={key} className="text-[var(--app-hint)]">
                <span>{labels[key as keyof typeof labels]}：{entry.utilization === undefined ? '用量未知' : `已用 ${Math.round(entry.utilization * 100)}%`}{entry.status === 'rejected' ? ' · 已限额' : ''}</span>
                {entry.utilization !== undefined && <progress aria-label={labels[key as keyof typeof labels]} value={entry.utilization} max={1} className="mx-2 h-1.5 w-24 align-middle" />}
                <span> · {new Date(entry.observedAt).toLocaleTimeString()} 观测{stale ? '（数据可能已过期）' : ''}{reset ? ` · ${reset} 重置` : ''}</span>
            </div>
        })}
    </div>
}
