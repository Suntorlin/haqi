import type { Machine } from '@/types/api'
import { CheckIcon } from '@/components/mobile/icons'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { useTranslation } from '@/lib/use-translation'
import { Section } from './Section'

export function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

/**
 * Step zero: pick the machine. It comes first because the recent projects, the folder suggestions
 * and the Claude accounts below all belong to the chosen machine.
 */
export function MachineSelector(props: {
    machines: Machine[]
    machineId: string | null
    isDisabled: boolean
    onChange: (machineId: string) => void
}) {
    const { t } = useTranslation()
    // The platform only tells machines apart when they differ.
    const showPlatform = new Set(props.machines.map((m) => m.metadata?.platform)).size > 1

    return (
        <Section title={t('newSession.machine')}>
            <div role="radiogroup" aria-label={t('newSession.machine')}>
                <ListGroup>
                    {props.machines.map((m) => {
                        const details = [
                            showPlatform ? m.metadata?.platform : undefined,
                            m.metadata?.role === 'portable' ? t('machine.portableSuffix') : undefined
                        ].filter(Boolean).join(' · ')
                        return (
                            <ListRow
                                key={m.id}
                                role="radio"
                                aria-checked={m.id === props.machineId}
                                title={getMachineTitle(m)}
                                subtitle={details || undefined}
                                trailing={m.id === props.machineId ? <CheckIcon className="h-[18px] w-[18px] text-[var(--social-fg)]" /> : undefined}
                                chevron={false}
                                disabled={props.isDisabled}
                                onClick={() => props.onChange(m.id)}
                            />
                        )
                    })}
                </ListGroup>
            </div>
        </Section>
    )
}
