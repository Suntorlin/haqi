import type { ClaudeAccountRuntime, ClaudeRateLimitSnapshot } from '@hapi/protocol/schemas'
import { useTranslation } from '@/lib/use-translation'

export function SessionAccountBar({ account, snapshot }: { account: ClaudeAccountRuntime; snapshot?: ClaudeRateLimitSnapshot }) {
    const { t } = useTranslation()
    const sessionReset = snapshot?.five_hour?.resetsAt
        ?? snapshot?.usageLimits?.find(l => l.kind === 'session')?.resetsAt
    const weeklyResets = (snapshot?.usageLimits ?? [])
        .filter(l => l.kind.startsWith('weekly') && typeof l.resetsAt === 'number')
        .map(l => l.resetsAt!)
    if (typeof snapshot?.seven_day?.resetsAt === 'number') weeklyResets.push(snapshot.seven_day.resetsAt)
    const weeklyReset = weeklyResets.length ? Math.min(...weeklyResets) : undefined
    const blocked = account.status === 'blocked'
    const transient = account.status === 'switching' || account.status === 'handoff'
    return (
        <div className="flex items-center gap-1.5 overflow-hidden border-b border-[var(--app-border)] px-4 py-1.5 text-xs text-[var(--app-hint)]">
            <span className="truncate">{account.email}</span>
            {sessionReset ? <span className="shrink-0">· {t('sessionAccount.reset5h', { time: new Date(sessionReset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span> : null}
            {weeklyReset ? <span className="shrink-0">· {t('sessionAccount.reset7d', { time: new Date(weeklyReset * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</span> : null}
            {blocked ? <span className="shrink-0 text-red-500">· {t('claudeAccount.status.blocked')}</span> : null}
            {transient ? <span className="shrink-0 text-blue-500">· {t('claudeAccount.status.switching')}</span> : null}
        </div>
    )
}
