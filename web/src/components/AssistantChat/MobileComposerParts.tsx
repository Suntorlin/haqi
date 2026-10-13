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
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

const tileClass = 'flex flex-col items-center gap-1.5 text-[12px] text-[var(--social-fg-muted)] [-webkit-tap-highlight-color:transparent] disabled:opacity-40'
const tileIconClass = 'relative flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--social-border)] bg-[var(--app-bg)] text-[var(--social-fg)] transition-transform active:scale-95'

function PanelTile(props: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; badge?: number }) {
    return (
        <button type="button" onClick={props.onClick} disabled={props.disabled} className={tileClass}>
            <span className={tileIconClass}>
                {props.icon}
                {props.badge && props.badge > 0 ? (
                    <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--social-badge)] px-1 text-[10px] font-semibold text-white">
                        {props.badge > 99 ? '99+' : props.badge}
                    </span>
                ) : null}
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
                <div className="social-scroll-x flex gap-2 overflow-x-auto px-5 pb-3">
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
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            aria-label={t('mobile.composer.more')}
            aria-expanded={props.open}
            className="mb-[2px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--social-muted)] text-[var(--social-fg)] transition-transform [-webkit-tap-highlight-color:transparent] active:scale-95 disabled:opacity-40"
        >
            <PlusIcon className={cn('h-5 w-5 transition-transform duration-200', props.open ? 'rotate-45' : '')} />
        </button>
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
    const base = 'mb-[2px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--social-primary)] text-[var(--social-primary-fg)] transition-[transform,opacity] [-webkit-tap-highlight-color:transparent] active:scale-95 disabled:bg-[var(--social-muted)] disabled:text-[var(--social-fg-subtle)]'
    const voiceActive = props.voiceStatus === 'connected' || props.voiceStatus === 'connecting'

    if (props.showStop) {
        return (
            <button
                type="button"
                onClick={props.onAbort}
                disabled={props.abortDisabled}
                aria-label={t('mobile.composer.stop')}
                title={t('mobile.composer.stop')}
                className={base}
            >
                {props.isAborting ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" />
                ) : (
                    <StopSquareIcon className="h-3.5 w-3.5" />
                )}
            </button>
        )
    }

    if (props.hasDraft || props.isSending) {
        return (
            <button
                type="button"
                onClick={props.onSend}
                disabled={!props.canSend || props.isSending}
                aria-label={t('composer.send')}
                title={t('composer.send')}
                className={base}
            >
                {props.isSending ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current/40 border-t-current" />
                ) : (
                    <SendArrowIcon className="h-[18px] w-[18px]" />
                )}
            </button>
        )
    }

    if (props.voiceEnabled || voiceActive) {
        return (
            <button
                type="button"
                onClick={props.onVoiceToggle}
                disabled={props.controlsDisabled && !voiceActive}
                aria-label={voiceActive ? t('mobile.composer.stopVoice') : t('mobile.composer.voice')}
                title={voiceActive ? t('mobile.composer.stopVoice') : t('mobile.composer.voice')}
                className={cn(base, voiceActive ? 'bg-[var(--social-badge)] text-white' : '')}
            >
                {voiceActive ? <StopSquareIcon className="h-3.5 w-3.5" /> : <MicWaveIcon className="h-[18px] w-[18px]" />}
            </button>
        )
    }

    return (
        <button
            type="button"
            disabled
            aria-label={t('composer.send')}
            className={base}
        >
            <SendArrowIcon className="h-[18px] w-[18px]" />
        </button>
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
            <div className="flex items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--app-bg)] py-1 pl-3.5 pr-1 text-[13px]">
                <QueueListIcon className="h-4 w-4 shrink-0 text-[var(--social-fg-muted)]" />
                <span className="shrink-0 font-medium text-[var(--social-fg)]">
                    {props.pendingCount > 0 ? t('queue.inline.pending', { count: props.pendingCount }) : t('queue.inline.empty')}
                </span>
                <span className="min-w-0 flex-1 truncate text-[var(--social-fg-muted)]" title={props.nextPreview || undefined}>
                    {props.nextPreview ? `· ${t('queue.inline.next')}：${props.nextPreview}` : ''}
                </span>
                {props.onOpen ? (
                    <button
                        type="button"
                        onClick={props.onOpen}
                        disabled={props.disabled}
                        className="shrink-0 rounded-full bg-[var(--social-muted)] px-3 py-1 text-[12.5px] text-[var(--social-fg)] transition-colors hover:bg-[var(--social-border)] disabled:opacity-50"
                    >
                        {t('queue.inline.open')}
                    </button>
                ) : null}
            </div>
            {entries.length > 0 ? (
                <div className="mt-1.5 flex flex-col gap-1 px-3.5">
                    {entries.slice(0, 5).map((entry, index) => (
                        <div key={entry.id} className="flex min-w-0 items-center gap-2 text-[12.5px]">
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
        <div role="status" className="flex items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--app-bg)] py-1 pl-3.5 pr-1 text-[13px]">
            <span className={cn('h-2 w-2 shrink-0 rounded-full bg-[var(--social-badge)]', connecting ? 'opacity-50' : 'animate-pulse')} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[var(--social-fg)]">{label}</span>
            {props.onToggleMic && !connecting ? (
                <button
                    type="button"
                    onClick={props.onToggleMic}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--social-fg-muted)] transition-colors hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)]"
                    aria-label={props.micMuted ? t('voice.unmute') : t('voice.mute')}
                    title={props.micMuted ? t('voice.unmute') : t('voice.mute')}
                >
                    <MicIcon muted={props.micMuted} className="h-4 w-4" />
                </button>
            ) : null}
            <button
                type="button"
                onClick={props.onEnd}
                className="shrink-0 rounded-full bg-[var(--social-badge)] px-3 py-1 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
            >
                {t('voice.end')}
            </button>
        </div>
    )
}

const toolbarIconClass = 'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--social-fg-muted)] transition-colors enabled:hover:bg-[var(--social-muted)] enabled:hover:text-[var(--social-fg)] disabled:opacity-40 [&_svg]:stroke-[1.7]'

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
            <ComposerPrimitive.AddAttachment
                disabled={props.controlsDisabled}
                className={toolbarIconClass}
                aria-label={t('mobile.composer.attach')}
                title={t('mobile.composer.attach')}
            >
                <PaperclipIcon className="h-[18px] w-[18px]" />
            </ComposerPrimitive.AddAttachment>
            {props.showTerminalButton ? (
                <button
                    type="button"
                    onClick={props.onTerminal}
                    disabled={props.controlsDisabled}
                    className={toolbarIconClass}
                    aria-label={t('composer.terminal')}
                    title={t('composer.terminal')}
                >
                    <TerminalIcon className="h-[18px] w-[18px]" />
                </button>
            ) : null}
            {compact ? (
                <button
                    type="button"
                    onClick={compact.onRun}
                    disabled={compact.disabled}
                    className={toolbarIconClass}
                    aria-label={t('composer.compact')}
                    title={t('composer.compact.hint')}
                >
                    <CompactIcon className="h-[18px] w-[18px]" />
                </button>
            ) : null}
            {props.settings ? (
                <div className="social-scroll-x ml-1 flex min-w-0 items-center gap-1.5 overflow-x-auto">
                    {props.settings}
                </div>
            ) : null}
            {queue || status || switchRemote ? (
                <button
                    type="button"
                    onClick={(event) => {
                        const rect = event.currentTarget.getBoundingClientRect()
                        setMoreAnchor({ x: rect.left + rect.width / 2, y: rect.top - 4 })
                    }}
                    className={cn(toolbarIconClass, 'ml-0.5')}
                    aria-label={t('mobile.composer.more')}
                    aria-haspopup="menu"
                    aria-expanded={moreAnchor !== null}
                    title={t('mobile.composer.more')}
                >
                    <MoreHorizontalIcon className="h-[18px] w-[18px]" />
                    {pending > 0 ? (
                        <span className="absolute -right-0.5 -top-0.5 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-[var(--social-badge)] px-1 text-[10px] font-semibold text-white">
                            {pending > 99 ? '99+' : pending}
                        </span>
                    ) : null}
                </button>
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
