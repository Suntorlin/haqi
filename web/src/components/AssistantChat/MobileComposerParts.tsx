import type { ReactNode } from 'react'
import { ComposerPrimitive } from '@assistant-ui/react'
import type { ConversationStatus } from '@/realtime/types'
import {
    ChecklistIcon,
    InfoCircleIcon,
    MicWaveIcon,
    PaperclipIcon,
    PlusIcon,
    QueueListIcon,
    SendArrowIcon,
    SlidersIcon,
    StopSquareIcon,
    SwitchIcon,
    TerminalIcon
} from '@/components/mobile/icons'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

const tileClass = 'flex flex-col items-center gap-1.5 text-[12px] text-[var(--app-hint)] [-webkit-tap-highlight-color:transparent] disabled:opacity-40'
const tileIconClass = 'relative flex h-[58px] w-[58px] items-center justify-center rounded-2xl bg-[var(--social-cell-bg)] text-[var(--app-fg)] transition-transform active:scale-95'

function PanelTile(props: {
    icon: ReactNode
    label: string
    onClick: () => void
    disabled?: boolean
    active?: boolean
    badge?: number
}) {
    return (
        <button type="button" onClick={props.onClick} disabled={props.disabled} className={tileClass}>
            <span className={cn(tileIconClass, props.active ? 'bg-[var(--social-accent)] text-white' : '')}>
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

/** WeChat-style "+" panel: every secondary composer action lives here instead of a toolbar. */
export function MobileComposerToolPanel(props: {
    controlsDisabled: boolean
    showSettingsButton: boolean
    onSettings: () => void
    showTerminalButton: boolean
    onTerminal: () => void
    showStatusButton: boolean
    statusDisabled: boolean
    onStatus: () => void
    showQueueButton: boolean
    queuePendingCount: number
    onQueue: () => void
    showPlanModeToggle: boolean
    planModeEnabled: boolean
    onPlanModeToggle: () => void
    showSendModeToggle: boolean
    sendMode: 'direct' | 'queue'
    onSendModeToggle: () => void
    showSwitchButton: boolean
    switchDisabled: boolean
    onSwitch: () => void
    voiceEnabled: boolean
    voiceActive: boolean
    onVoiceToggle: () => void
}) {
    const { t } = useTranslation()
    return (
        <div className="grid grid-cols-4 gap-x-2 gap-y-4 px-5 pb-3 pt-4">
            <ComposerPrimitive.AddAttachment disabled={props.controlsDisabled} className={tileClass}>
                <span className={tileIconClass}>
                    <PaperclipIcon className="h-6 w-6" />
                </span>
                {t('mobile.composer.attach')}
            </ComposerPrimitive.AddAttachment>
            {props.showSettingsButton ? (
                <PanelTile icon={<SlidersIcon className="h-6 w-6" />} label={t('mobile.composer.settings')} onClick={props.onSettings} disabled={props.controlsDisabled} />
            ) : null}
            {props.showTerminalButton ? (
                <PanelTile icon={<TerminalIcon className="h-6 w-6" />} label={t('composer.terminal')} onClick={props.onTerminal} disabled={props.controlsDisabled} />
            ) : null}
            {props.voiceEnabled ? (
                <PanelTile icon={<MicWaveIcon className="h-6 w-6" />} label={t('mobile.composer.voice')} onClick={props.onVoiceToggle} active={props.voiceActive} />
            ) : null}
            {props.showQueueButton ? (
                <PanelTile icon={<QueueListIcon className="h-6 w-6" />} label={t('composer.queue')} onClick={props.onQueue} disabled={props.controlsDisabled} badge={props.queuePendingCount} />
            ) : null}
            {props.showStatusButton ? (
                <PanelTile icon={<InfoCircleIcon className="h-6 w-6" />} label={t('composer.status')} onClick={props.onStatus} disabled={props.statusDisabled} />
            ) : null}
            {props.showPlanModeToggle ? (
                <PanelTile
                    icon={<ChecklistIcon className="h-6 w-6" />}
                    label={t('queue.mode.plan')}
                    onClick={props.onPlanModeToggle}
                    disabled={props.controlsDisabled}
                    active={props.planModeEnabled}
                />
            ) : null}
            {props.showSendModeToggle ? (
                <PanelTile
                    icon={props.sendMode === 'queue' ? <QueueListIcon className="h-6 w-6" /> : <SendArrowIcon className="h-6 w-6" />}
                    label={props.sendMode === 'queue' ? t('queue.mode.queue') : t('queue.mode.direct')}
                    onClick={props.onSendModeToggle}
                    disabled={props.controlsDisabled}
                    active={props.sendMode === 'queue'}
                />
            ) : null}
            {props.showSwitchButton ? (
                <PanelTile icon={<SwitchIcon className="h-6 w-6" />} label={t('composer.switchRemote')} onClick={props.onSwitch} disabled={props.switchDisabled} />
            ) : null}
        </div>
    )
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
            className="mb-[3px] flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-[1.6px] border-[var(--app-fg)] text-[var(--app-fg)] transition-transform [-webkit-tap-highlight-color:transparent] disabled:opacity-40"
        >
            <PlusIcon className={cn('h-[20px] w-[20px] transition-transform duration-200', props.open ? 'rotate-45' : '')} />
        </button>
    )
}

/**
 * Right-hand action: send while there is a draft, stop while the agent is running,
 * otherwise the voice assistant (like WeChat swapping "+" for "发送").
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
    const base = 'mb-[2px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-[transform,opacity] [-webkit-tap-highlight-color:transparent] active:scale-95 disabled:opacity-40'
    const voiceActive = props.voiceStatus === 'connected' || props.voiceStatus === 'connecting'

    if (props.showStop) {
        return (
            <button
                type="button"
                onClick={props.onAbort}
                disabled={props.abortDisabled}
                aria-label={t('mobile.composer.stop')}
                title={t('mobile.composer.stop')}
                className={cn(base, 'bg-[var(--social-badge)] text-white')}
            >
                {props.isAborting ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
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
                className={cn(base, 'bg-[var(--social-accent)] text-white')}
            >
                {props.isSending ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
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
                aria-label={t('composer.voice')}
                title={t('composer.voice')}
                className={cn(base, voiceActive ? 'bg-[var(--social-badge)] text-white' : 'bg-[var(--app-fg)] text-[var(--app-bg)]')}
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
            className={cn(base, 'bg-[var(--social-accent)] text-white')}
        >
            <SendArrowIcon className="h-[18px] w-[18px]" />
        </button>
    )
}
