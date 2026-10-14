import { useState, type ReactNode } from 'react'
import { ComposerPrimitive } from '@assistant-ui/react'
import type { ConversationStatus } from '@/realtime/types'
import {
    CompactIcon,
    InfoCircleIcon,
    MicIcon,
    MicWaveIcon,
    MoreHorizontalIcon,
    PaperclipIcon,
    PlusIcon,
    QueueListIcon,
    SendArrowIcon,
    StopSquareIcon,
    SwitchIcon,
    TerminalIcon
} from '@/components/mobile/icons'
import { ContextMenu, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { Button } from '@/components/ui/button'
import { CountBadge, DotBadge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/IconButton'
import { HIT_AREA_28_CLASS, HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'


const tileClass = 'flex flex-col items-center gap-1.5 text-[12px] text-[var(--social-fg-muted)] [-webkit-tap-highlight-color:transparent] disabled:opacity-40'
const tileIconClass = 'relative flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--social-border)] bg-[var(--social-surface)] text-[var(--social-fg)] transition-transform active:scale-95'

function PanelTile(props: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; badge?: number }) {
    return (
        <button type="button" onClick={props.onClick} disabled={props.disabled} className={tileClass}>
            <span className={tileIconClass}>
                {props.icon}
                <CountBadge count={props.badge ?? 0} className="absolute -right-1 -top-1" />
            </span>
            {props.label}
        </button>
    )
}

/**
 * WeChat-style "+" panel: the conversation settings as chips (each opens its own drawer), then
 * one tile per action.
 */
export function MobileComposerToolPanel(props: {
    controlsDisabled: boolean
    settings: ReactNode
    showTerminalButton: boolean
    onTerminal: () => void
    extras: ComposerExtras
}) {
    const { t } = useTranslation()
    const { compact, queue, status, switchRemote } = props.extras
    return (
        <div className="pb-3 pt-3">
            {props.settings ? (
                <div className="social-scroll-x flex gap-2 overflow-x-auto px-5 pb-3 [&>button]:h-11 [&>button]:text-[13px]">
                    {props.settings}
                </div>
            ) : null}
            <div className="grid grid-cols-4 gap-x-2 gap-y-3 px-5 pt-1 [&_svg]:stroke-[1.6]">
                <ComposerPrimitive.AddAttachment disabled={props.controlsDisabled} className={tileClass}>
                    <span className={tileIconClass}>
                        <PaperclipIcon className="h-6 w-6" />
                    </span>
                    {t('mobile.composer.attach')}
                </ComposerPrimitive.AddAttachment>
                {props.showTerminalButton ? (
                    <PanelTile icon={<TerminalIcon className="h-6 w-6" />} label={t('composer.terminal')} onClick={props.onTerminal} disabled={props.controlsDisabled} />
                ) : null}
                {compact ? (
                    <PanelTile icon={<CompactIcon className="h-6 w-6" />} label={t('composer.compact')} onClick={compact.onRun} disabled={compact.disabled} />
                ) : null}
                {queue ? (
                    <PanelTile icon={<QueueListIcon className="h-6 w-6" />} label={t('composer.queue')} onClick={queue.onOpen} disabled={queue.disabled} badge={queue.pendingCount} />
                ) : null}
                {status ? (
                    <PanelTile icon={<InfoCircleIcon className="h-6 w-6" />} label={t('composer.status')} onClick={status.onOpen} disabled={status.disabled} />
                ) : null}
                {switchRemote ? (
                    <PanelTile icon={<SwitchIcon className="h-6 w-6" />} label={t('composer.switchRemote')} onClick={switchRemote.onSwitch} disabled={switchRemote.disabled} />
                ) : null}
            </div>
        </div>
    )
}

/** Composer extras that are actions, not settings: "/compact", the queue, "/status", switching to remote. */
export type ComposerExtras = {
    compact: { disabled: boolean; onRun: () => void } | null
    queue: { pendingCount: number; disabled: boolean; onOpen: () => void } | null
    status: { disabled: boolean; onOpen: () => void } | null
    switchRemote: { disabled: boolean; onSwitch: () => void } | null
}

export function MobileComposerToggle(props: { open: boolean; onClick: () => void; disabled?: boolean }) {
    const { t } = useTranslation()
    return (
        <IconButton
            variant="muted"
            label={t('mobile.composer.more')}
            onClick={props.onClick}
            disabled={props.disabled}
            aria-expanded={props.open}
            className={cn('mb-[2px] h-9 w-9 transition-transform active:scale-95', HIT_AREA_CLASS)}
        >
            <PlusIcon className={cn('h-5 w-5 transition-transform duration-200', props.open ? 'rotate-45' : '')} />
        </IconButton>
    )
}

/**
 * The one right-hand action, in both layouts: stop while the agent is running, send while there is
 * a draft, otherwise voice (like WeChat swapping the mic for "发送" once you type).
 */
export function MobileComposerAction(props: {
    hasDraft: boolean
    canSend: boolean
    isSending: boolean
    showStop: boolean
    abortDisabled: boolean
    isAborting: boolean
    voiceEnabled: boolean
    voiceStatus: ConversationStatus
    controlsDisabled: boolean
    onSend: () => void
    onAbort: () => void
    onVoiceToggle: () => void
}) {
    const { t } = useTranslation()
    const base = cn('mb-[2px] h-9 w-9 transition-[transform,opacity] active:scale-95 disabled:bg-[var(--social-muted)] disabled:text-[var(--social-fg-subtle)] disabled:opacity-100', HIT_AREA_CLASS)
    const voiceActive = props.voiceStatus === 'connected' || props.voiceStatus === 'connecting'

    if (props.showStop) {
        return (
            <IconButton
                variant="filled"
                label={t('mobile.composer.stop')}
                onClick={props.onAbort}
                disabled={props.abortDisabled}
                className={base}
            >
                {props.isAborting ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" />
                ) : (
                    <StopSquareIcon className="h-3.5 w-3.5" />
                )}
            </IconButton>
        )
    }

    if (props.hasDraft || props.isSending) {
        return (
            <IconButton
                variant="filled"
                label={t('composer.send')}
                onClick={props.onSend}
                disabled={!props.canSend || props.isSending}
                className={base}
            >
                {props.isSending ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" />
                ) : (
                    <SendArrowIcon className="h-[18px] w-[18px]" />
                )}
            </IconButton>
        )
    }

    if (props.voiceEnabled || voiceActive) {
        return (
            <IconButton
                variant="filled"
                label={voiceActive ? t('mobile.composer.stopVoice') : t('mobile.composer.voice')}
                onClick={props.onVoiceToggle}
                disabled={props.controlsDisabled && !voiceActive}
                className={cn(base, voiceActive ? 'bg-[var(--social-badge)] text-[var(--social-on-accent)]' : '')}
            >
                {voiceActive ? <StopSquareIcon className="h-3.5 w-3.5" /> : <MicWaveIcon className="h-[18px] w-[18px]" />}
            </IconButton>
        )
    }

    return (
        <IconButton variant="filled" label={t('composer.send')} disabled className={base}>
            <SendArrowIcon className="h-[18px] w-[18px]" />
        </IconButton>
    )
}

/**
 * Queue mode status above the input, the same slim bar as the voice bar: how many messages wait
 * and what goes next, with "管理" to open the queue. "full" mode also lists the first entries.
 */
export function QueueStrip(props: {
    pendingCount: number
    nextPreview: string
    entries?: ReadonlyArray<{ id: string; preview: string; enqueuedAt: number }>
    disabled: boolean
    onOpen?: () => void
}) {
    const { t } = useTranslation()
    const entries = props.entries ?? []
    return (
        <div role="status">
            <div className="flex items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--social-surface)] py-1 pl-3.5 pr-1 text-[13px]">
                <QueueListIcon className="h-4 w-4 shrink-0 text-[var(--social-fg-muted)]" />
                <span className="shrink-0 font-semibold text-[var(--social-fg)]">
                    {props.pendingCount > 0 ? t('queue.inline.pending', { count: props.pendingCount }) : t('queue.inline.empty')}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--social-fg-muted)]" title={props.nextPreview || undefined}>
                    {props.nextPreview ? `· ${t('queue.inline.next')}：${props.nextPreview}` : ''}
                </span>
                {props.onOpen ? (
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={props.onOpen}
                        disabled={props.disabled}
                        className={cn('h-7 px-3', HIT_AREA_28_CLASS)}
                    >
                        {t('queue.inline.open')}
                    </Button>
                ) : null}
            </div>
            {entries.length > 0 ? (
                <div className="mt-1.5 flex flex-col gap-1 px-3.5">
                    {entries.slice(0, 5).map((entry, index) => (
                        <div key={entry.id} className="flex min-w-0 items-center gap-2 text-[13px]">
                            <span className="w-4 shrink-0 tabular-nums text-[var(--social-fg-subtle)]">{index + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-[var(--social-fg)]">{entry.preview || t('queue.dialog.emptyMessage')}</span>
                            <span className="shrink-0 text-[var(--social-fg-subtle)]">
                                {new Date(entry.enqueuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                    ))}
                    {entries.length > 5 ? (
                        <div className="text-[12px] text-[var(--social-fg-subtle)]">+{entries.length - 5}</div>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

/**
 * Shown above the input while a voice conversation runs: status, mute and hang up. It keeps the call
 * controls reachable when the action button turns into "stop" for a running agent.
 */
export function VoiceCallBar(props: {
    status: ConversationStatus
    micMuted: boolean
    onToggleMic?: () => void
    onEnd: () => void
}) {
    const { t } = useTranslation()
    const connecting = props.status === 'connecting'
    const label = connecting
        ? t('voice.call.connecting')
        : props.micMuted ? t('voice.call.muted') : t('voice.call.active')
    return (
        <div role="status" className="flex items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--social-surface)] py-1 pl-3.5 pr-1 text-[13px]">
            <DotBadge className={cn('h-2 w-2 shrink-0 ring-0', connecting ? 'opacity-50' : 'animate-pulse')} />
            <span className="min-w-0 flex-1 truncate text-[var(--social-fg)]">{label}</span>
            {props.onToggleMic && !connecting ? (
                <IconButton
                    size="sm"
                    label={props.micMuted ? t('voice.unmute') : t('voice.mute')}
                    onClick={props.onToggleMic}
                    className={cn('h-7 w-7', HIT_AREA_28_CLASS)}
                >
                    <MicIcon muted={props.micMuted} className="h-4 w-4" />
                </IconButton>
            ) : null}
            <Button
                variant="destructive"
                size="sm"
                onClick={props.onEnd}
                className={cn('h-7 px-3', HIT_AREA_28_CLASS)}
            >
                {t('voice.end')}
            </Button>
        </div>
    )
}

const toolbarIconClass = 'relative [&_svg]:stroke-[1.7]'

/**
 * Desktop composer toolbar: attach, terminal and "/compact", then each conversation setting as a
 * chip that opens its own small menu, and "…" for the queue / status / switch actions.
 */
export function DesktopComposerToolbar(props: {
    controlsDisabled: boolean
    showTerminalButton: boolean
    onTerminal: () => void
    settings: ReactNode
    extras: ComposerExtras
    action: ReactNode
}) {
    const { t } = useTranslation()
    const { compact, queue, status, switchRemote } = props.extras
    const [moreAnchor, setMoreAnchor] = useState<{ x: number; y: number } | null>(null)
    const pending = queue?.pendingCount ?? 0
    const runThen = (action: () => void) => () => {
        setMoreAnchor(null)
        action()
    }

    return (
        <div className="flex items-center gap-0.5 px-2 pb-2 pt-1">
            <ComposerPrimitive.AddAttachment asChild disabled={props.controlsDisabled}>
                <IconButton size="sm" label={t('mobile.composer.attach')} className={toolbarIconClass}>
                    <PaperclipIcon className="h-[18px] w-[18px]" />
                </IconButton>
            </ComposerPrimitive.AddAttachment>
            {props.showTerminalButton ? (
                <IconButton
                    size="sm"
                    label={t('composer.terminal')}
                    onClick={props.onTerminal}
                    disabled={props.controlsDisabled}
                    className={toolbarIconClass}
                >
                    <TerminalIcon className="h-[18px] w-[18px]" />
                </IconButton>
            ) : null}
            {compact ? (
                <IconButton
                    size="sm"
                    label={t('composer.compact.hint')}
                    onClick={compact.onRun}
                    disabled={compact.disabled}
                    className={toolbarIconClass}
                >
                    <CompactIcon className="h-[18px] w-[18px]" />
                </IconButton>
            ) : null}
            {props.settings ? (
                <div className="social-scroll-x ml-1 flex min-w-0 items-center gap-1.5 overflow-x-auto [&>button]:text-[13px]">
                    {props.settings}
                </div>
            ) : null}
            {queue || status || switchRemote ? (
                <IconButton
                    size="sm"
                    label={t('mobile.composer.more')}
                    onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        setMoreAnchor({ x: rect.left + rect.width / 2, y: rect.top - 4 })
                    }}
                    className={cn(toolbarIconClass, 'ml-0.5')}
                    aria-haspopup="menu"
                    aria-expanded={moreAnchor !== null}
                >
                    <MoreHorizontalIcon className="h-[18px] w-[18px]" />
                    <CountBadge count={pending} className="absolute -right-0.5 -top-0.5" />
                </IconButton>
            ) : null}
            {moreAnchor ? (
                <ContextMenu open anchorPoint={moreAnchor} onClose={() => setMoreAnchor(null)} label={t('mobile.composer.more')}>
                    {queue ? (
                        <ContextMenuItem
                            icon={<QueueListIcon />}
                            label={t('composer.queue')}
                            disabled={queue.disabled}
                            onSelect={runThen(queue.onOpen)}
                            trailing={pending > 0 ? <span className="text-[13px] text-[var(--social-fg-muted)]">{t('queue.inline.pending', { count: pending })}</span> : undefined}
                        />
                    ) : null}
                    {status ? (
                        <ContextMenuItem icon={<InfoCircleIcon />} label={t('composer.status')} disabled={status.disabled} onSelect={runThen(status.onOpen)} />
                    ) : null}
                    {switchRemote ? (
                        <ContextMenuItem icon={<SwitchIcon />} label={t('composer.switchRemote')} disabled={switchRemote.disabled} onSelect={runThen(switchRemote.onSwitch)} />
                    ) : null}
                </ContextMenu>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center pl-2">
                {props.action}
            </div>
        </div>
    )
}
