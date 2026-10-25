import { getPermissionModeOptionsForFlavor } from '@hapi/protocol'
import type { PermissionMode } from '@/types/api'
import { useTranslation } from '@/lib/use-translation'
import { modelOptionText, permissionModeText, thinkEffortText } from '@/lib/option-labels'
import { SettingChip } from '@/components/ui/SettingChip'

export type ComposerModelOption = { value: string; label: string }
export type SessionThinkEffort = 'auto' | 'low' | 'medium' | 'high' | 'max' | 'xhigh'
export type ComposerThinkEffortOption = { value: SessionThinkEffort; label: string }

export function buildClaudeModelOptions(currentModel: string | undefined): ComposerModelOption[] {
    const options: ComposerModelOption[] = [
        { value: 'auto', label: 'Default (recommended)' },
        { value: 'claude-fable-5', label: 'Fable 5' },
        { value: 'sonnet', label: 'Sonnet (latest)' },
        { value: 'opus', label: 'Opus (latest)' },
        { value: 'haiku', label: 'Haiku (latest)' },
        { value: 'claude-opus-5-5', label: 'Opus 5.5' },
        { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
        { value: 'claude-opus-4-6', label: 'Opus 4.6' },
        { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    ]

    if (currentModel && !options.some((option) => option.value === currentModel)) {
        options.push({ value: currentModel, label: currentModel })
    }

    return options
}

export function getThinkEffortOptionsForFlavor(flavor?: string | null): ComposerThinkEffortOption[] {
    if (flavor === 'claude') {
        // cc CLI accepts low/medium/high/xhigh/max. xhigh is Opus 4.7-only;
        // cc downgrades unsupported levels server-side, so it's safe to expose.
        return [
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'Extra high' },
            { value: 'max', label: 'Max' },
        ]
    }
    if (flavor === 'codex') {
        return [
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
            { value: 'xhigh', label: 'XHigh' },
        ]
    }
    return []
}

type Setting<T> = { value: T; onChange: (value: T) => void }

/**
 * The prompt box's model, thinking and permission chips. A session's composer and the new-task box both use these, so
 * a task's default settings read and pick exactly like a session's. Leave a setting out to hide its chip.
 */
export function SessionSettingChips(props: {
    flavor?: string | null
    model?: Setting<string> & { custom?: string }
    think?: Setting<SessionThinkEffort>
    permission?: Setting<PermissionMode>
    disabled?: boolean
}) {
    const { t } = useTranslation()
    const optionLabel = (options: ReadonlyArray<{ value: string; label: string }>, value: string) =>
        options.find((option) => option.value === value)?.label ?? value
    const modelOptions = props.flavor === 'claude'
        ? buildClaudeModelOptions(props.model?.custom).map((option) => ({ ...option, label: modelOptionText(option.value, option.label, t) }))
        : []
    const thinkOptions = getThinkEffortOptionsForFlavor(props.flavor).map((option) => ({ ...option, label: thinkEffortText(option.value, option.label, t) }))
    const permissionOptions = getPermissionModeOptionsForFlavor(props.flavor).map((option) => ({ value: option.mode as string, label: permissionModeText(option.mode, t) }))
    return (
        <>
            {props.model && modelOptions.length > 0 ? (
                <SettingChip
                    title={t('misc.model')}
                    valueLabel={optionLabel(modelOptions, props.model.value)}
                    disabled={props.disabled}
                    group={{ options: modelOptions, value: props.model.value, onChange: props.model.onChange }}
                />
            ) : null}
            {props.think && thinkOptions.length > 0 ? (
                <SettingChip
                    title={t('newSession.think')}
                    valueLabel={t('composer.chip.think', { value: optionLabel(thinkOptions, props.think.value) })}
                    valueCandidates={[optionLabel(thinkOptions, props.think.value)]}
                    disabled={props.disabled}
                    group={{ options: thinkOptions, value: props.think.value, onChange: props.think.onChange }}
                />
            ) : null}
            {props.permission && permissionOptions.length > 0 ? (
                <SettingChip
                    title={t('misc.permissionMode')}
                    valueLabel={t('composer.chip.permission', { value: permissionModeText(props.permission.value, t) })}
                    valueCandidates={[permissionModeText(props.permission.value, t)]}
                    disabled={props.disabled}
                    group={{ options: permissionOptions, value: props.permission.value as string, onChange: (value) => props.permission!.onChange(value as PermissionMode) }}
                />
            ) : null}
        </>
    )
}
