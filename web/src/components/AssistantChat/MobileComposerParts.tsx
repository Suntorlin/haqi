import { useState, type ReactNode } from 'react'
import { ComposerPrimitive } from '@assistant-ui/react'
import type { ConversationStatus } from '@/realtime/types'
import type { DictationError, DictationStatus } from '@/hooks/useDictation'
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
import { ActionTile } from '@/components/mobile/ActionTile'
import { IconButton } from '@/components/ui/IconButton'
import { Spinner } from '@/components/Spinner'
import { HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'


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
                <div className="flex gap-2 overflow-x-auto px-5 pb-3 [&>button]:h-11 [&>button]:text-footnote">
                    {props.settings}
                </div>
            ) : null}
            <div className="grid grid-cols-4 gap-2 px-5 pt-1 [&_svg]:stroke-[1.6]">
                <ComposerPrimitive.AddAttachment asChild disabled={props.controlsDisabled}>
                    <ActionTile icon={<PaperclipIcon className="h-6 w-6" />} label={t('mobile.composer.attach')} />
                </ComposerPrimitive.AddAttachment>
                {props.showTerminalButton ? (
                    <ActionTile icon={<TerminalIcon className="h-6 w-6" />} label={t('composer.terminal')} onClick={props.onTerminal} disabled={props.controlsDisabled} />
                ) : null}
                {compact ? (
                    <ActionTile icon={<CompactIcon className="h-6 w-6" />} label={t('composer.compact')} onClick={compact.onRun} disabled={compact.disabled} />
                ) : null}
                {queue ? (
                    <ActionTile icon={<QueueListIcon className="h-6 w-6" />} label={t('composer.queue')} onClick={queue.onOpen} disabled={queue.disabled} badge={queue.pendingCount} />
                ) : null}
                {status ? (
                    <ActionTile icon={<InfoCircleIcon className="h-6 w-6" />} label={t('composer.status')} onClick={status.onOpen} disabled={status.disabled} />
                ) : null}
                {switchRemote ? (
                    <ActionTile icon={<SwitchIcon className="h-6 w-6" />} label={t('composer.switchRemote')} onClick={switchRemote.onSwitch} disabled={switchRemote.disabled} />
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
const primaryActionClass = cn('mb-[2px] h-9 w-9 transition-[transform,opacity] active:scale-95 disabled:bg-[var(--social-muted)] disabled:text-[var(--social-fg-subtle)] disabled:opacity-100', HIT_AREA_CLASS)

export type DictationControl = {
    status: DictationStatus
    onStart: () => void
    onFinish: () => void
}

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
    // Local dictation; when present, the empty-draft action is its mic instead of the voice call.
    dictation?: DictationControl | null
}) {
    const { t } = useTranslation()
    const voiceActive = props.voiceStatus === 'connected' || props.voiceStatus === 'connecting'

    if (props.showStop) {
        return (
            <IconButton
                variant="filled"
                label={t('mobile.composer.stop')}
                onClick={props.onAbort}
                disabled={props.abortDisabled}
                className={primaryActionClass}
            >
                {props.isAborting ? (
                    <Spinner size="md" label={null} className="text-current" />
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
                className={primaryActionClass}
            >
                {props.isSending ? (
                    <Spinner size="md" label={null} className="text-current" />
                ) : (
                    <SendArrowIcon className="h-[18px] w-[18px]" />
                )}
            </IconButton>
        )
    }

    if (props.dictation && !voiceActive) {
        return (
            <DictationButton
                {...props.dictation}
                primary
                disabled={props.controlsDisabled}
            />
        )
    }

    if (props.voiceEnabled || voiceActive) {
        return (
            <IconButton
                variant="filled"
                label={voiceActive ? t('mobile.composer.stopVoice') : t('mobile.composer.voice')}
                onClick={props.onVoiceToggle}
                disabled={props.controlsDisabled && !voiceActive}
                className={cn(primaryActionClass, voiceActive ? 'bg-[var(--social-badge)] text-[var(--social-on-accent)]' : '')}
            >
                {voiceActive ? <StopSquareIcon className="h-3.5 w-3.5" /> : <MicWaveIcon className="h-[18px] w-[18px]" />}
            </IconButton>
        )
    }

    return (
        <IconButton variant="filled" label={t('composer.send')} disabled className={primaryActionClass}>
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
            <div className="flex items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--social-surface)] py-1 pl-3.5 pr-1 text-footnote">
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
                        size="xs"
                        onClick={props.onOpen}
                        disabled={props.disabled}
                    >
                        {t('queue.inline.open')}
                    </Button>
                ) : null}
            </div>
            {entries.length > 0 ? (
                <div className="mt-1.5 flex flex-col gap-1 px-3.5">
                    {entries.slice(0, 5).map((entry, index) => (
                        <div key={entry.id} className="flex min-w-0 items-center gap-2 text-footnote">
                            <span className="w-4 shrink-0 tabular-nums text-[var(--social-fg-subtle)]">{index + 1}</span>
                            <span className="min-w-0 flex-1 truncate text-[var(--social-fg)]">{entry.preview || t('queue.dialog.emptyMessage')}</span>
                            <span className="shrink-0 text-[var(--social-fg-subtle)]">
                                {new Date(entry.enqueuedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                        </div>
                    ))}
                    {entries.length > 5 ? (
                        <div className="text-caption text-[var(--social-fg-subtle)]">+{entries.length - 5}</div>
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
        <div role="status" className="flex items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--social-surface)] py-1 pl-3.5 pr-1 text-footnote">
            <DotBadge className={cn('h-2 w-2 shrink-0 ring-0', connecting ? 'opacity-50' : 'animate-pulse')} />
            <span className="min-w-0 flex-1 truncate text-[var(--social-fg)]">{label}</span>
            {props.onToggleMic && !connecting ? (
                <IconButton
                    size="xs"
                    label={props.micMuted ? t('voice.unmute') : t('voice.mute')}
                    onClick={props.onToggleMic}
                >
                    <MicIcon muted={props.micMuted} className="h-4 w-4" />
                </IconButton>
            ) : null}
            <Button
                variant="destructive"
                size="xs"
                onClick={props.onEnd}
            >
                {t('voice.end')}
            </Button>
        </div>
    )
}

/**
 * Speech-to-text into the draft: tap to record, tap again (or "Done" in the bar) to turn it into text.
 * `primary` is the composer's main action while the draft is empty; the small one only shows
 * while the main action is "stop", so a reply can still be dictated during a run.
 */
export function DictationButton(props: DictationControl & {
    disabled: boolean
    primary?: boolean
    className?: string
}) {
    const { t } = useTranslation()
    const recording = props.status === 'recording'
    const busy = props.status === 'starting' || props.status === 'transcribing'
    return (
        <IconButton
            variant={props.primary ? 'filled' : undefined}
            size={props.primary ? undefined : 'xs'}
            label={recording ? t('dictation.finish') : t('dictation.start')}
            onClick={recording ? props.onFinish : props.onStart}
            disabled={busy || (props.disabled && !recording)}
            aria-pressed={recording}
            className={cn(props.primary && primaryActionClass, recording ? 'bg-[var(--social-badge)] text-[var(--social-on-accent)] hover:bg-[var(--social-badge)] hover:text-[var(--social-on-accent)]' : '', props.className)}
        >
            {busy ? <Spinner size="sm" label={null} className="text-current" /> : <MicIcon className="h-[18px] w-[18px]" />}
        </IconButton>
    )
}

function formatDictationTime(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/**
 * Shown above the input while dictating, the same slim bar as the voice call: recording time with
 * cancel and done, then "converting", or why it failed.
 */
export function DictationBar(props: {
    status: DictationStatus
    elapsedMs: number
    error: DictationError | null
    onCancel: () => void
    onFinish: () => void
    onDismissError: () => void
}) {
    const { t } = useTranslation()
    if (props.error && props.status === 'idle') {
        return (
            <div role="alert" className="flex items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--social-surface)] py-1 pl-3.5 pr-1 text-footnote">
                <span className="min-w-0 flex-1 truncate text-[var(--social-danger)]">{t(`dictation.error.${props.error}`)}</span>
                <Button variant="ghost" size="xs" onClick={props.onDismissError}>
                    {t('button.close')}
                </Button>
            </div>
        )
    }
    if (props.status !== 'recording' && props.status !== 'transcribing') {
        return null
    }
    const recording = props.status === 'recording'
    return (
        <div role="status" className="flex items-center gap-2 rounded-full border border-[var(--social-border)] bg-[var(--social-surface)] py-1 pl-3.5 pr-1 text-footnote">
            {recording ? (
                <DotBadge className="h-2 w-2 shrink-0 animate-pulse bg-[var(--social-danger)] ring-0" />
            ) : (
                <Spinner size="sm" label={null} className="shrink-0 text-[var(--social-fg-muted)]" />
            )}
            <span className="min-w-0 flex-1 truncate text-[var(--social-fg)]">
                {recording
                    ? t('dictation.recording', { time: formatDictationTime(props.elapsedMs) })
                    : t('dictation.transcribing')}
            </span>
            {recording ? (
                <>
                    <Button variant="ghost" size="xs" onClick={props.onCancel}>
                        {t('button.cancel')}
                    </Button>
                    <Button size="xs" onClick={props.onFinish}>
                        {t('dictation.done')}
                    </Button>
                </>
            ) : null}
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
                <div className="ml-1 flex min-w-0 items-center gap-1.5 overflow-x-auto [&>button]:text-footnote">
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
                            trailing={pending > 0 ? <span className="text-footnote text-[var(--social-fg-muted)]">{t('queue.inline.pending', { count: pending })}</span> : undefined}
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
