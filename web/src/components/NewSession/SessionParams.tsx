import { useState } from 'react'
import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'
import type { ApiClient } from '@/api/client'
import { ClaudeAccountChip } from '@/components/ClaudeAccounts/Selector'
import { FormField } from '@/components/ui/FormControls'
import { SettingChip, ToggleChip } from '@/components/ui/SettingChip'
import { TextField } from '@/components/ui/TextField'
import { modelOptionText, serviceTierText, thinkEffortText } from '@/lib/option-labels'
import { useTranslation } from '@/lib/use-translation'
import {
    CODEX_SERVICE_TIER_OPTIONS,
    getModelOptionsForAgent,
    getThinkEffortOptions,
    type AgentType,
    type ServiceTier,
    type ThinkEffort
} from './types'

const CUSTOM_MODEL = '__custom__'

/**
 * The optional launch settings in one row of chips, the same chips as the chat composer: each
 * shows its value and opens only its own choices (menu on desktop, drawer on phones).
 */
export function SessionParams(props: {
    api: ApiClient
    agent: AgentType
    machineId: string | null
    model: string
    customModel: string
    thinkEffort: ThinkEffort
    serviceTier: ServiceTier
    yoloMode: boolean
    claudeAccount?: ClaudeAccountSelection
    isDisabled: boolean
    onModelChange: (value: string) => void
    onCustomModelChange: (value: string) => void
    onThinkEffortChange: (value: ThinkEffort) => void
    onServiceTierChange: (value: ServiceTier) => void
    onYoloChange: (value: boolean) => void
    onClaudeAccountChange: (selection?: ClaudeAccountSelection) => void
}) {
    const { t } = useTranslation()
    const [customOpen, setCustomOpen] = useState(() => Boolean(props.customModel.trim()))
    const modelOptions = getModelOptionsForAgent(props.agent)
        .map((option) => ({ value: option.value, label: modelOptionText(option.value, option.label, t) }))
    const thinkOptions = getThinkEffortOptions(props.agent)
        .map((option) => ({ value: option.value, label: thinkEffortText(option.value, option.label, t) }))
    const tierOptions = CODEX_SERVICE_TIER_OPTIONS
        .map((option) => ({ value: option.value, label: serviceTierText(option.value, option.label, t) }))
    const labelOf = (options: ReadonlyArray<{ value: string; label: string }>, value: string) =>
        options.find((option) => option.value === value)?.label ?? value
    const customModel = props.customModel.trim()
    // A saved custom model keeps the field open; "Custom…" opens it before anything is typed.
    const showCustom = customOpen || customModel.length > 0

    return (
        <FormField label={t('newSession.params')}>
            <div className="flex flex-wrap gap-2 [&>button]:border [&>button]:border-[var(--social-border)] [&>button]:px-3 [&>button]:text-[var(--social-fg)] [&>button[aria-pressed=true]]:border-transparent [&>button[aria-pressed=true]]:text-[var(--social-primary-fg)]">
                {modelOptions.length > 0 ? (
                    <SettingChip
                        title={t('newSession.model')}
                        valueLabel={showCustom
                            ? t('newSession.model.customValue', { value: customModel || '…' })
                            : labelOf(modelOptions, props.model)}
                        disabled={props.isDisabled}
                        group={{
                            options: [...modelOptions, { value: CUSTOM_MODEL, label: t('newSession.model.custom') }],
                            value: showCustom ? CUSTOM_MODEL : props.model,
                            onChange: (value) => {
                                if (value === CUSTOM_MODEL) {
                                    setCustomOpen(true)
                                    return
                                }
                                setCustomOpen(false)
                                props.onCustomModelChange('')
                                props.onModelChange(value)
                            }
                        }}
                    />
                ) : null}
                {thinkOptions.length > 0 ? (
                    <SettingChip
                        title={t('newSession.think')}
                        valueLabel={t('composer.chip.think', { value: labelOf(thinkOptions, props.thinkEffort) })}
                        disabled={props.isDisabled}
                        group={{ options: thinkOptions, value: props.thinkEffort, onChange: props.onThinkEffortChange }}
                    />
                ) : null}
                {props.agent === 'codex' ? (
                    <SettingChip
                        title={t('newSession.serviceTier')}
                        valueLabel={t('composer.chip.tier', { value: labelOf(tierOptions, props.serviceTier) })}
                        disabled={props.isDisabled}
                        group={{ options: tierOptions, value: props.serviceTier, onChange: props.onServiceTierChange }}
                    />
                ) : null}
                {props.agent === 'claude' ? (
                    <ClaudeAccountChip
                        api={props.api}
                        machineId={props.machineId}
                        selection={props.claudeAccount}
                        onChange={props.onClaudeAccountChange}
                        disabled={props.isDisabled}
                    />
                ) : null}
                <ToggleChip
                    label={t('newSession.yolo')}
                    title={`${t('newSession.yolo.title')} · ${t('newSession.yolo.desc')}`}
                    pressed={props.yoloMode}
                    disabled={props.isDisabled}
                    onToggle={() => props.onYoloChange(!props.yoloMode)}
                />
            </div>
            {showCustom ? (
                <TextField
                    type="text"
                    autoFocus
                    value={props.customModel}
                    onChange={(event) => props.onCustomModelChange(event.target.value)}
                    disabled={props.isDisabled}
                    placeholder={t('newSession.model.customPlaceholder')}
                    aria-label={t('newSession.model.customPlaceholder')}
                />
            ) : null}
        </FormField>
    )
}
