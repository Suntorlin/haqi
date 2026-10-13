import type { ReactNode } from 'react'
import { ComposerPrimitive } from '@assistant-ui/react'
import type { ConversationStatus } from '@/realtime/types'
import {
    InfoCircleIcon,
    MicWaveIcon,
    PaperclipIcon,
    PlanIcon,
    PlusIcon,
    QueueListIcon,
    SendArrowIcon,
    SlidersIcon,
    SpeakerIcon,
    StopSquareIcon,
    SwitchIcon,
    TerminalIcon
} from '@/components/mobile/icons'
import { BottomSheet, SheetOption, SheetRow, SheetSection, SheetSwitchRow } from '@/components/mobile/BottomSheet'
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
 * WeChat-style "+" panel. Every tile does one thing the same way: tap → act or open a sheet.
 * Anything that is a setting (model, permissions, queue, plan…) lives in one settings sheet.
 */
export function MobileComposerToolPanel(props: {
    controlsDisabled: boolean
    voiceEnabled: boolean
    voiceActive: boolean
    onVoiceToggle: () => void
    showTerminalButton: boolean
    onTerminal: () => void
    showSettingsButton: boolean
    settingsBadge?: number
    onSettings: () => void
}) {
    const { t } = useTranslation()
    return (
        <div className="grid grid-cols-4 gap-x-2 px-5 pb-3 pt-4 [&_svg]:stroke-[1.6]">
            <ComposerPrimitive.AddAttachment disabled={props.controlsDisabled} className={tileClass}>
                <span className={tileIconClass}>
                    <PaperclipIcon className="h-6 w-6" />
                </span>
                {t('mobile.composer.attach')}
            </ComposerPrimitive.AddAttachment>
            {props.voiceEnabled ? (
                <PanelTile
                    icon={props.voiceActive ? <StopSquareIcon className="h-5 w-5" /> : <MicWaveIcon className="h-6 w-6" />}
                    label={props.voiceActive ? t('mobile.composer.stopVoice') : t('mobile.composer.voice')}
                    onClick={props.onVoiceToggle}
                />
            ) : null}
            {props.showTerminalButton ? (
                <PanelTile icon={<TerminalIcon className="h-6 w-6" />} label={t('composer.terminal')} onClick={props.onTerminal} disabled={props.controlsDisabled} />
            ) : null}
            {props.showSettingsButton ? (
                <PanelTile
                    icon={<SlidersIcon className="h-6 w-6" />}
                    label={t('mobile.composer.chatSettings')}
                    onClick={props.onSettings}
                    badge={props.settingsBadge}
                />
            ) : null}
        </div>
    )
}

type Choice<T extends string> = { value: T; label: string; description?: string }

type ChoiceGroup<T extends string> = {
    options: ReadonlyArray<Choice<T>>
    value: T
    onChange: (value: T) => void
}

/** One sheet for every conversation setting; choices apply immediately and the sheet stays open. */
export function MobileComposerSettingsSheet(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    disabled: boolean
    permission: ChoiceGroup<string> | null
    model: ChoiceGroup<string> | null
    thinkEffort: ChoiceGroup<string> | null
    serviceTier: ChoiceGroup<string> | null
    sendMode: ChoiceGroup<'direct' | 'queue'> | null
    planMode: { enabled: boolean; onChange: (enabled: boolean) => void } | null
    queue: { pendingCount: number; onOpen: () => void } | null
    status: { disabled: boolean; onOpen: () => void } | null
    switchRemote: { disabled: boolean; onSwitch: () => void } | null
}) {
    const { t } = useTranslation()
    const choiceSection = <T extends string>(title: string, group: ChoiceGroup<T> | null) => group ? (
        <SheetSection title={title}>
            {group.options.map((option) => (
                <SheetOption
                    key={option.value}
                    label={option.label}
                    description={option.description}
                    selected={group.value === option.value}
                    disabled={props.disabled}
                    onSelect={() => group.onChange(option.value)}
                />
            ))}
        </SheetSection>
    ) : null

    return (
        <BottomSheet open={props.open} onOpenChange={props.onOpenChange} title={t('mobile.composer.chatSettings')}>
            <div className="pt-1">
                {choiceSection(t('misc.permissionMode'), props.permission)}
                {choiceSection(t('misc.model'), props.model)}
                {choiceSection(t('newSession.think'), props.thinkEffort)}
                {choiceSection(t('newSession.serviceTier'), props.serviceTier)}
                {choiceSection(t('mobile.composer.sendMode'), props.sendMode)}
                {props.planMode || props.queue || props.status || props.switchRemote ? (
                    <SheetSection title={t('mobile.composer.other')}>
                        {props.planMode ? (
                            <SheetSwitchRow
                                icon={<PlanIcon />}
                                label={t('queue.mode.plan')}
                                description={t('mobile.composer.planHint')}
                                checked={props.planMode.enabled}
                                disabled={props.disabled}
                                onCheckedChange={props.planMode.onChange}
                            />
                        ) : null}
                        {props.queue ? (
                            <SheetRow
                                icon={<QueueListIcon />}
                                label={t('composer.queue')}
                                value={props.queue.pendingCount > 0 ? t('queue.inline.pending', { count: props.queue.pendingCount }) : undefined}
                                chevron
                                disabled={props.disabled}
                                onClick={props.queue.onOpen}
                            />
                        ) : null}
                        {props.status ? (
                            <SheetRow
                                icon={<InfoCircleIcon />}
                                label={t('composer.status')}
                                chevron
                                disabled={props.status.disabled}
                                onClick={props.status.onOpen}
                            />
                        ) : null}
                        {props.switchRemote ? (
                            <SheetRow
                                icon={<SwitchIcon />}
                                label={t('composer.switchRemote')}
                                chevron
                                disabled={props.switchRemote.disabled}
                                onClick={props.switchRemote.onSwitch}
                            />
                        ) : null}
                    </SheetSection>
                ) : null}
                <div className="h-2" />
            </div>
        </BottomSheet>
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
            className="mb-[2px] flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--social-muted)] text-[var(--social-fg)] transition-transform [-webkit-tap-highlight-color:transparent] active:scale-95 disabled:opacity-40"
        >
            <PlusIcon className={cn('h-5 w-5 transition-transform duration-200', props.open ? 'rotate-45' : '')} />
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
                aria-label={t('composer.voice')}
                title={t('composer.voice')}
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

const toolbarIconClass = 'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[var(--social-fg-muted)] transition-colors hover:bg-[var(--social-muted)] hover:text-[var(--social-fg)] disabled:opacity-40 [&_svg]:stroke-[1.7]'

/**
 * Desktop composer toolbar: the same four entries as the phone "+" panel, laid out inline.
 * Each does one thing; every setting opens the shared "chat settings" panel.
 */
export function DesktopComposerToolbar(props: {
    controlsDisabled: boolean
    voiceEnabled: boolean
    voiceActive: boolean
    voiceConnected: boolean
    voiceMicMuted?: boolean
    onVoiceToggle: () => void
    onVoiceMicToggle?: () => void
    showTerminalButton: boolean
    onTerminal: () => void
    showSettingsButton: boolean
    settingsLabel: string
    settingsBadge?: number
    onSettings: () => void
    action: ReactNode
}) {
    const { t } = useTranslation()
    const badge = props.settingsBadge ?? 0
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
            {props.voiceEnabled ? (
                <button
                    type="button"
                    onClick={props.onVoiceToggle}
                    className={cn(toolbarIconClass, props.voiceActive ? 'bg-[var(--social-badge)] text-white hover:bg-[var(--social-badge)] hover:text-white' : '')}
                    aria-label={props.voiceActive ? t('mobile.composer.stopVoice') : t('mobile.composer.voice')}
                    title={props.voiceActive ? t('mobile.composer.stopVoice') : t('mobile.composer.voice')}
                >
                    {props.voiceActive ? <StopSquareIcon className="h-3.5 w-3.5" /> : <MicWaveIcon className="h-[18px] w-[18px]" />}
                </button>
            ) : null}
            {props.voiceConnected && props.onVoiceMicToggle ? (
                <button
                    type="button"
                    onClick={props.onVoiceMicToggle}
                    className={cn(toolbarIconClass, props.voiceMicMuted ? 'bg-[var(--social-muted)] text-[var(--social-fg)]' : '')}
                    aria-label={props.voiceMicMuted ? t('voice.unmute') : t('voice.mute')}
                    title={props.voiceMicMuted ? t('voice.unmute') : t('voice.mute')}
                >
                    <SpeakerIcon muted={props.voiceMicMuted} className="h-[18px] w-[18px]" />
                </button>
            ) : null}
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
            {props.showSettingsButton ? (
                <button
                    type="button"
                    onClick={props.onSettings}
                    className="relative ml-1 flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-[var(--social-border)] pl-2.5 pr-3 text-[12.5px] text-[var(--social-fg-muted)] transition-colors hover:bg-[var(--social-hover)] hover:text-[var(--social-fg)]"
                    aria-label={t('mobile.composer.chatSettings')}
                    title={t('desktop.composer.settingsHint')}
                >
                    <SlidersIcon className="h-[15px] w-[15px] shrink-0 [stroke-width:1.8]" />
                    <span className="truncate">{props.settingsLabel}</span>
                    {badge > 0 ? (
                        <span className="flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[var(--social-badge)] px-1 text-[10px] font-semibold text-white">
                            {badge > 99 ? '99+' : badge}
                        </span>
                    ) : null}
                </button>
            ) : null}
            <div className="ml-auto flex shrink-0 items-center pl-2">
                {props.action}
            </div>
        </div>
    )
}
