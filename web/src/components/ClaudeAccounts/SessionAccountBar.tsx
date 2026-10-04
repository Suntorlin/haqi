import type { ClaudeAccountRuntime, ClaudeRateLimitSnapshot } from '@hapi/protocol/schemas'
import { useTranslation } from '@/lib/use-translation'

/** Inline account + reset-time summary for the session header meta row. */
export function SessionAccountInline({ account, snapshot }: { account: ClaudeAccountRuntime; snapshot?: ClaudeRateLimitSnapshot }) {
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
        <span className="flex min-w-0 basis-full flex-wrap items-center gap-x-1 gap-y-0.5">
            <span className="max-w-[200px] truncate">{account.email}</span>
            {sessionReset ? <span className="hidden whitespace-nowrap sm:inline">· {t('sessionAccount.reset5h', { time: new Date(sessionReset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span> : null}
            {weeklyReset ? <span className="hidden whitespace-nowrap sm:inline">· {t('sessionAccount.reset7d', { time: new Date(weeklyReset * 1000).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) })}</span> : null}
            {blocked ? <span className="whitespace-nowrap text-red-500">· {t('claudeAccount.status.blocked')}</span> : null}
            {transient ? <span className="whitespace-nowrap text-blue-500">· {t('claudeAccount.status.switching')}</span> : null}
        </span>
    )
}
