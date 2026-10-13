import type { AgentType } from './types'
import { ChoiceChips, FormField } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'

const AGENTS: ReadonlyArray<{ value: AgentType; label: string }> = (['claude', 'codex', 'cursor', 'gemini', 'opencode'] as const)
    .map((agent) => ({ value: agent, label: agent }))

export function AgentSelector(props: {
    agent: AgentType
    isDisabled: boolean
    onAgentChange: (value: AgentType) => void
}) {
    const { t } = useTranslation()

    return (
        <FormField label={t('newSession.agent')}>
            <ChoiceChips
                label={t('newSession.agent')}
                value={props.agent}
                options={AGENTS}
                disabled={props.isDisabled}
                optionClassName="capitalize"
                onChange={props.onAgentChange}
            />
        </FormField>
    )
}
