import { useId } from 'react'
import { FormField, SelectInput } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'
import { serviceTierText } from '@/lib/option-labels'
import { CODEX_SERVICE_TIER_OPTIONS, type AgentType, type ServiceTier } from './types'

export function ServiceTierSelector(props: {
    agent: AgentType
    serviceTier: ServiceTier
    isDisabled: boolean
    onServiceTierChange: (value: ServiceTier) => void
}) {
    const { t } = useTranslation()
    const id = useId()
    if (props.agent !== 'codex') {
        return null
    }

    return (
        <FormField label={t('newSession.serviceTier')} htmlFor={id} optional>
            <SelectInput
                id={id}
                value={props.serviceTier}
                onChange={(e) => props.onServiceTierChange(e.target.value as ServiceTier)}
                disabled={props.isDisabled}
            >
                {CODEX_SERVICE_TIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                        {serviceTierText(option.value, option.label, t)}
                    </option>
                ))}
            </SelectInput>
        </FormField>
    )
}
