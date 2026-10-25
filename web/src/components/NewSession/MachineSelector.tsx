import type { Machine } from '@/types/api'
import { CheckIcon } from '@/components/mobile/icons'
import { Badge } from '@/components/ui/badge'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { useTranslation } from '@/lib/use-translation'
import { BUSY_PCT, idlestMachineId, loadPct } from './machineLoad'
import { Section } from './Section'

export function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

/**
 * Step zero: pick the machine. It comes first because the recent projects, the folder suggestions
 * and the Claude accounts below all belong to the chosen machine. Each row shows how busy the machine
 * is now, so the choice can follow the load.
 */
export function MachineSelector(props: {
    machines: Machine[]
    machineId: string | null
    /** Running sessions per machine id. */
    sessionCounts: Record<string, number>
    isDisabled: boolean
    onChange: (machineId: string) => void
}) {
    const { t } = useTranslation()
    // The platform only tells machines apart when they differ.
    const showPlatform = new Set(props.machines.map((m) => m.metadata?.platform)).size > 1
    const idlest = idlestMachineId(props.machines)

    return (
        <Section title={t('newSession.machine')}>
            <div role="radiogroup" aria-label={t('newSession.machine')}>
                <ListGroup>
                    {props.machines.map((m) => {
                        const pct = loadPct(m)
                        const battery = m.load?.battery
                        const details = [
                            showPlatform ? m.metadata?.platform : undefined,
                            pct === null ? undefined : t('machine.load', { pct }),
                            m.load?.memFreePct === undefined ? undefined : t('machine.memFree', { pct: m.load.memFreePct }),
                            t('machine.sessions', { n: props.sessionCounts[m.id] ?? 0 }),
                            m.metadata?.role === 'portable' ? t('machine.portableSuffix') : undefined,
                            battery?.onBattery ? t('machine.onBattery', { pct: battery.pct }) : undefined
                        ].filter(Boolean).join(' · ')
                        const badge = m.id === idlest
                            ? <Badge variant="success">{t('machine.idlest')}</Badge>
                            : pct !== null && pct >= BUSY_PCT ? <Badge variant="warning">{t('machine.busy')}</Badge> : null
                        const selected = m.id === props.machineId
                            ? <CheckIcon className="h-[18px] w-[18px] text-[var(--social-fg)]" />
                            : null
                        return (
                            <ListRow
                                key={m.id}
                                role="radio"
                                aria-checked={m.id === props.machineId}
                                title={getMachineTitle(m)}
                                subtitle={details}
                                trailing={badge || selected ? <span className="flex items-center gap-2">{badge}{selected}</span> : undefined}
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
