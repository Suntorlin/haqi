import { useState } from 'react'
import type { ClaudeAccountSelection } from '@hapi/protocol/schemas'
import type { ApiClient } from '@/api/client'
import { ClaudeAccountRow } from '@/components/ClaudeAccounts/Selector'
import { SettingsSelectRow, SettingsSwitchRow } from '@/components/settings/SettingsParts'
import { ListGroup } from '@/components/ui/ListRow'
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
import { Section } from './Section'

const CUSTOM_MODEL = '__custom__'

/**
 * What the session runs with, as one settings list: account (Claude), model, thinking, tier
 * (Codex) and the YOLO switch. Each row shows its current value on the right and opens only its own
 * choices (menu on desktop, drawer on phones), like the settings page.
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
        <Section title={t('newSession.params')}>
            <ListGroup>
                {props.agent === 'claude' ? (
                    <ClaudeAccountRow
                        api={props.api}
                        machineId={props.machineId}
                        selection={props.claudeAccount}
                        onChange={props.onClaudeAccountChange}
                        disabled={props.isDisabled}
                    />
                ) : null}
                {modelOptions.length > 0 ? (
                    <SettingsSelectRow
                        title={t('newSession.model')}
                        valueLabel={showCustom
                            ? t('newSession.model.customValue', { value: customModel || '…' })
                            : labelOf(modelOptions, props.model)}
                        disabled={props.isDisabled}
                        options={[...modelOptions, { value: CUSTOM_MODEL, label: t('newSession.model.custom') }]}
                        value={showCustom ? CUSTOM_MODEL : props.model}
                        onChange={(value) => {
                            if (value === CUSTOM_MODEL) {
                                setCustomOpen(true)
                                return
                            }
                            setCustomOpen(false)
                            props.onCustomModelChange('')
                            props.onModelChange(value)
                        }}
                    />
                ) : null}
                {thinkOptions.length > 0 ? (
                    <SettingsSelectRow
                        title={t('newSession.think')}
                        valueLabel={labelOf(thinkOptions, props.thinkEffort)}
                        disabled={props.isDisabled}
                        options={thinkOptions}
                        value={props.thinkEffort}
                        onChange={props.onThinkEffortChange}
                    />
                ) : null}
                {props.agent === 'codex' ? (
                    <SettingsSelectRow
                        title={t('newSession.serviceTier')}
                        valueLabel={labelOf(tierOptions, props.serviceTier)}
                        disabled={props.isDisabled}
                        options={tierOptions}
                        value={props.serviceTier}
                        onChange={props.onServiceTierChange}
                    />
                ) : null}
                <SettingsSwitchRow
                    title={t('newSession.yolo')}
                    subtitle={t('newSession.yolo.title')}
                    label={t('newSession.yolo')}
                    checked={props.yoloMode}
                    disabled={props.isDisabled}
                    onCheckedChange={props.onYoloChange}
                />
            </ListGroup>
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
        </Section>
    )
}
