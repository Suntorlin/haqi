import type { ClaudeAccountRuntime, ClaudeRateLimitSnapshot } from '@hapi/protocol/schemas'
import { useTranslation } from '@/lib/use-translation'

export function SessionAccountBar({ account, snapshot }: { account: ClaudeAccountRuntime; snapshot?: ClaudeRateLimitSnapshot }) {
    const { t } = useTranslation()
    const resetsAt = snapshot?.five_hour?.resetsAt
    const blocked = account.status === 'blocked'
    const transient = account.status === 'switching' || account.status === 'handoff'
    return (
        <div className="flex items-center gap-1.5 overflow-hidden border-b border-[var(--app-border)] px-4 py-1.5 text-xs text-[var(--app-hint)]">
            <span className="truncate">{account.email}</span>
            {resetsAt ? <span className="shrink-0">· {t('claudeAccounts.quota.resetsAt', { time: new Date(resetsAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) })}</span> : null}
            {blocked ? <span className="shrink-0 text-red-500">· {t('claudeAccount.status.blocked')}</span> : null}
            {transient ? <span className="shrink-0 text-blue-500">· {t('claudeAccount.status.switching')}</span> : null}
        </div>
    )
}
