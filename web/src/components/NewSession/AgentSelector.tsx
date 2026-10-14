import type { AgentType } from './types'
import { ChoiceChips } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'
import { Section } from './Section'

const AGENTS: ReadonlyArray<{ value: AgentType; label: string }> = (['claude', 'codex', 'cursor', 'gemini', 'opencode'] as const)
    .map((agent) => ({ value: agent, label: agent }))

export function AgentSelector(props: {
    agent: AgentType
    isDisabled: boolean
    onAgentChange: (value: AgentType) => void
}) {
    const { t } = useTranslation()

    return (
        <Section title={t('newSession.agent')}>
            <ChoiceChips
                label={t('newSession.agent')}
                value={props.agent}
                options={AGENTS}
                disabled={props.isDisabled}
                className="-mx-4 flex-nowrap gap-2 overflow-x-auto px-4 [scrollbar-width:none]"
                optionClassName="shrink-0 capitalize"
                onChange={props.onAgentChange}
            />
        </Section>
    )
}
