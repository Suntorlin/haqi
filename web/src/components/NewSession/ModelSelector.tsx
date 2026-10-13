import { useId } from 'react'
import type { AgentType, ModelOption } from './types'
import { getModelOptionsForAgent } from './types'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { FormField, SelectInput } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'
import { modelOptionText } from '@/lib/option-labels'

export function ModelSelector(props: {
    agent: AgentType
    model: string
    customModel: string
    isDisabled: boolean
    onModelChange: (value: string) => void
    onCustomModelChange: (value: string) => void
}) {
    const { t } = useTranslation()
    const id = useId()
    const options: ModelOption[] = getModelOptionsForAgent(props.agent)
    if (options.length === 0) {
        return null
    }

    return (
        <FormField label={t('newSession.model')} htmlFor={id} optional hint={t('newSession.model.customHint')}>
            <SelectInput
                id={id}
                value={props.model}
                onChange={(e) => props.onModelChange(e.target.value)}
                disabled={props.isDisabled}
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {modelOptionText(option.value, option.label, t)}
                    </option>
                ))}
            </SelectInput>
            <input
                type="text"
                value={props.customModel}
                onChange={(e) => props.onCustomModelChange(e.target.value)}
                disabled={props.isDisabled}
                placeholder={t('newSession.model.customPlaceholder')}
                aria-label={t('newSession.model.customPlaceholder')}
                className={`${DIALOG_INPUT_CLASS} disabled:opacity-50`}
            />
        </FormField>
    )
}
