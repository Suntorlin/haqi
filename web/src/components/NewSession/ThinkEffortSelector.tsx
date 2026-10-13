import { useId } from 'react'
import { FormField, SelectInput } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'
import { thinkEffortText } from '@/lib/option-labels'
import type { AgentType, ThinkEffort } from './types'
import { getThinkEffortOptions } from './types'

export function ThinkEffortSelector(props: {
    agent: AgentType
    thinkEffort: ThinkEffort
    isDisabled: boolean
    onThinkEffortChange: (value: ThinkEffort) => void
}) {
    const { t } = useTranslation()
    const id = useId()
    const options = getThinkEffortOptions(props.agent)
    if (options.length === 0) {
        return null
    }

    return (
        <FormField label={t('newSession.think')} htmlFor={id} optional>
            <SelectInput
                id={id}
                value={props.thinkEffort}
                onChange={(e) => props.onThinkEffortChange(e.target.value as ThinkEffort)}
                disabled={props.isDisabled}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {thinkEffortText(option.value, option.label, t)}
                    </option>
                ))}
            </SelectInput>
        </FormField>
    )
}
