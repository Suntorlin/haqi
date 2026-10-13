import type { ReactNode } from 'react'
import type { PermissionMode } from '@hapi/protocol'
import type { QueueEntry, QueueSummary, SessionUsageOverview } from '@/types/api'
import { BottomSheet, SheetNote, SheetRow, SheetSection } from '@/components/mobile/BottomSheet'
import { permissionModeText } from '@/lib/option-labels'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { IconButton } from '@/components/ui/IconButton'

type Translate = (key: string, params?: Record<string, string | number>) => string

export type StatusRow = { label: string; value: string }

/** Field labels the agents print in their "/status" text, mapped to translation keys. */
const STATUS_FIELD_KEYS: Record<string, string> = {
    'mode': 'queueStatus.field.mode',
    'session': 'queueStatus.field.session',
    'permission mode': 'queueStatus.field.permissionMode',
    'model mode': 'queueStatus.field.model',
    'collaboration mode': 'queueStatus.field.collaborationMode',
    'cli version': 'queueStatus.field.cliVersion',
    'account': 'queueStatus.field.account',
    'plan': 'queueStatus.field.plan',
    'auth method': 'queueStatus.field.authMethod',
    'requires openai auth': 'queueStatus.field.requiresOpenaiAuth',
    'credits balance': 'queueStatus.field.creditsBalance',
    'credits available': 'queueStatus.field.creditsAvailable',
    'credits unlimited': 'queueStatus.field.creditsUnlimited',
    'rate limit (primary)': 'queueStatus.field.rateLimitPrimary',
    'rate limit (secondary)': 'queueStatus.field.rateLimitSecondary',
    'config model': 'queueStatus.field.configModel',
    'native status warnings': 'queueStatus.field.warnings',
    'login status': 'queueStatus.field.loginStatus'
}

const STATUS_VALUE_KEYS: Record<string, string> = {
    'yes': 'queueStatus.value.yes',
    'no': 'queueStatus.value.no',
    'unknown': 'queueStatus.value.unknown',
    'remote': 'queueStatus.value.remote',
    'local': 'queueStatus.value.local',
    'not established': 'queueStatus.value.notEstablished'
}

function parseRateLimit(value: string): { usedPercent: number; resetAt: string } | null {
    const match = value.match(/^(\d+(?:\.\d+)?)%\s*,\s*resets at\s*(.+)$/i)
    return match ? { usedPercent: Number.parseFloat(match[1]), resetAt: match[2] ?? '' } : null
}

function yesNo(value: boolean, t: Translate): string {
    return value ? t('queueStatus.value.yes') : t('queueStatus.value.no')
}

function describeStatusRow(row: StatusRow, t: Translate): { label: string; value: ReactNode } {
    const field = row.label.trim().toLowerCase()
    const labelKey = STATUS_FIELD_KEYS[field]
    const label = labelKey ? t(labelKey) : row.label
    const raw = row.value.trim()

    const rateLimit = field.startsWith('rate limit') ? parseRateLimit(raw) : null
    if (rateLimit) {
        const tone = rateLimit.usedPercent >= 85 ? 'bg-[var(--social-danger)]' : rateLimit.usedPercent >= 60 ? 'bg-[var(--social-warning)]' : 'bg-[var(--social-fg)]'
        return {
            label,
            value: (
                <span className="flex w-36 flex-col items-end gap-1">
                    <span className="text-[13px] tabular-nums text-[var(--social-fg)]">{`${rateLimit.usedPercent}% · ${rateLimit.resetAt}`}</span>
                    <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--social-muted)]">
                        <span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(100, rateLimit.usedPercent))}%` }} />
                    </span>
                </span>
            )
        }
    }
    if (field === 'permission mode' && raw) {
        return { label, value: permissionModeText(raw as PermissionMode, t) }
    }
    if (field === 'session' && raw.length > 12 && !STATUS_VALUE_KEYS[raw.toLowerCase()]) {
        return { label, value: <span className="font-mono text-[13px]" title={raw}>{`${raw.slice(0, 8)}…`}</span> }
    }
    const valueKey = STATUS_VALUE_KEYS[raw.toLowerCase()]
    return { label, value: valueKey ? t(valueKey) : raw || '—' }
}

function QueueSummaryRows(props: { status: QueueSummary }) {
    const { t } = useTranslation()
    return (
        <>
            <SheetRow label={t('queue.summary.pending')} value={String(props.status.pendingCount)} />
            <SheetRow label={t('queue.summary.inQueue')} value={yesNo(props.status.inQueue, t)} />
            <SheetRow label={t('queue.summary.taskRunning')} value={yesNo(props.status.taskRunning, t)} />
        </>
    )
}

/** Live status of the agent: queue, session fields from "/status", and token usage. */
export function QueueStatusSheet(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    loading: boolean
    error: string | null
    status: QueueSummary | null
    rows: StatusRow[]
    message: string
    usage: SessionUsageOverview | null
    usageError: string | null
    formatNumber: (value: number) => string
}) {
    const { t } = useTranslation()
    const { usage, formatNumber } = props

    return (
        <BottomSheet open={props.open} onOpenChange={props.onOpenChange} title={t('queueStatus.dialog.title')}>
            {props.loading ? <SheetNote>{t('queueStatus.dialog.loading')}</SheetNote> : null}
            {props.error ? <SheetNote tone="error">{props.error}</SheetNote> : null}

            {props.status ? (
                <SheetSection title={t('queue.dialog.title')}>
                    <QueueSummaryRows status={props.status} />
                    {props.status.nextPreview ? (
                        <SheetRow label={t('queueStatus.field.next')} value={props.status.nextPreview} />
                    ) : null}
                </SheetSection>
            ) : null}

            {props.rows.length > 0 ? (
                <SheetSection title={t('queueStatus.section.session')}>
                    {props.rows.map((row) => {
                        const described = describeStatusRow(row, t)
                        return <SheetRow key={`${row.label}:${row.value}`} label={described.label} value={described.value} />
                    })}
                </SheetSection>
            ) : !props.loading && !props.error && !props.status ? (
                <SheetNote>{props.message || t('queueStatus.dialog.empty')}</SheetNote>
            ) : null}

            {usage ? (
                <SheetSection title={t('queueStatus.usage.title')}>
                    <SheetRow label={t('queueStatus.usage.totalTokens')} value={formatNumber(usage.allTime.totalTokens)} />
                    <SheetRow label={t('queueStatus.usage.inputTokens')} value={formatNumber(usage.allTime.inputTokens)} />
                    <SheetRow label={t('queueStatus.usage.outputTokens')} value={formatNumber(usage.allTime.outputTokens)} />
                    <SheetRow label={t('queueStatus.usage.cachedInputTokens')} value={formatNumber(usage.allTime.cachedInputTokens)} />
                    <SheetRow label={t('queueStatus.usage.cacheCreationTokens')} value={formatNumber(usage.allTime.cacheCreationTokens)} />
                    {usage.allTime.reasoningOutputTokens > 0 ? (
                        <SheetRow label={t('queueStatus.usage.reasoningOutputTokens')} value={formatNumber(usage.allTime.reasoningOutputTokens)} />
                    ) : null}
                    <SheetRow label={t('queueStatus.usage.events')} value={formatNumber(usage.usageEventCount)} />
                    {usage.lastUsageAt ? (
                        <SheetRow label={t('queueStatus.usage.lastUpdated')} value={new Date(usage.lastUsageAt).toLocaleString()} />
                    ) : null}
                </SheetSection>
            ) : props.usageError ? (
                <SheetNote tone="error">{props.usageError}</SheetNote>
            ) : null}
            <div className="h-2" />
        </BottomSheet>
    )
}

function QueueEntryRow(props: {
    entry: QueueEntry
    index: number
    count: number
    disabled: boolean
    onMove: (id: string, index: number) => void
    onRemove: (id: string) => void
}) {
    const { t } = useTranslation()
    const { entry, index } = props
    return (
        <div className="flex items-center gap-3 px-4 py-1 [&+&]:border-t [&+&]:border-[var(--social-border)]">
            <span className="w-5 shrink-0 text-[13px] tabular-nums text-[var(--social-fg-subtle)]">{index + 1}</span>
            <div className="min-w-0 flex-1 py-2">
                <div className="line-clamp-3 break-words text-[15px] leading-snug text-[var(--social-fg)]">
                    {entry.preview || t('queue.dialog.emptyMessage')}
                </div>
                <div className="mt-1 text-[12px] text-[var(--social-fg-subtle)]">
                    {new Date(entry.enqueuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {entry.isolate ? ` · ${t('queue.entry.isolate')}` : ''}
                </div>
            </div>
            <div className="flex shrink-0 items-center">
                <IconButton label={t('queue.entry.moveUp')} disabled={props.disabled || index <= 0} onClick={() => props.onMove(entry.id, index - 1)}>↑</IconButton>
                <IconButton label={t('queue.entry.moveDown')} disabled={props.disabled || index >= props.count - 1} onClick={() => props.onMove(entry.id, index + 1)}>↓</IconButton>
                <IconButton label={t('queue.entry.remove')} className="hover:text-[var(--social-danger)]" disabled={props.disabled} onClick={() => props.onRemove(entry.id)}>✕</IconButton>
            </div>
        </div>
    )
}

/** Messages waiting to be sent while the agent works: reorder, remove, clear. */
export function QueueSheet(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    sendMode: 'queue' | 'direct'
    loading: boolean
    mutating: boolean
    error: string | null
    status: QueueSummary | null
    entries: QueueEntry[]
    onRefresh: () => void
    onClear: () => void
    onMove: (id: string, index: number) => void
    onRemove: (id: string) => void
}) {
    const { t } = useTranslation()

    return (
        <BottomSheet open={props.open} onOpenChange={props.onOpenChange} title={t('queue.dialog.title')}>
            <SheetSection>
                <SheetRow label={t('queue.dialog.modeLabel')} value={props.sendMode === 'queue' ? t('queue.mode.queue') : t('queue.mode.direct')} />
                {props.status ? <QueueSummaryRows status={props.status} /> : null}
            </SheetSection>
            {props.loading ? <SheetNote>{t('queue.dialog.loading')}</SheetNote> : null}
            {props.error ? <SheetNote tone="error">{props.error}</SheetNote> : null}
            <SheetSection title={t('queueStatus.section.entries')}>
                {props.entries.length > 0 ? props.entries.map((entry, index) => (
                    <QueueEntryRow
                        key={entry.id}
                        entry={entry}
                        index={index}
                        count={props.entries.length}
                        disabled={props.mutating}
                        onMove={props.onMove}
                        onRemove={props.onRemove}
                    />
                )) : (
                    <div className="px-4 py-3 text-[15px] text-[var(--social-fg-muted)]">{t('queue.dialog.empty')}</div>
                )}
            </SheetSection>
            <SheetSection>
                <SheetRow label={t('queue.dialog.refresh')} disabled={props.loading || props.mutating} onClick={props.onRefresh} />
                <SheetRow label={t('queue.dialog.clear')} destructive disabled={props.mutating || props.entries.length === 0} onClick={props.onClear} />
            </SheetSection>
            <div className="h-2" />
        </BottomSheet>
    )
}
