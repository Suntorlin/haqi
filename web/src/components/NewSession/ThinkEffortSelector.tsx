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
    const options = getThinkEffortOptions(props.agent)
    if (options.length === 0) {
        return null
    }

    return (
        <div className="flex flex-col gap-1.5 px-3 py-3">
            <label className="text-xs font-medium text-[var(--app-hint)]">
                {t('newSession.think')}{' '}
                <span className="font-normal">({t('newSession.model.optional')})</span>
            </label>
            <select
                value={props.thinkEffort}
                onChange={(e) => props.onThinkEffortChange(e.target.value as ThinkEffort)}
                disabled={props.isDisabled}
                className="w-full px-3 py-2 text-sm rounded-lg border border-[var(--app-divider)] bg-[var(--app-bg)] text-[var(--app-text)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
            >
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {thinkEffortText(option.value, option.label, t)}
                    </option>
                ))}
            </select>
        </div>
    )
}
