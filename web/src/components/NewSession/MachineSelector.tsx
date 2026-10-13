import { useId } from 'react'
import type { Machine } from '@/types/api'
import { FormField, SelectInput } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'

function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

export function MachineSelector(props: {
    machines: Machine[]
    machineId: string | null
    isLoading?: boolean
    isDisabled: boolean
    onChange: (machineId: string) => void
}) {
    const { t } = useTranslation()
    const id = useId()

    return (
        <FormField label={t('newSession.machine')} htmlFor={id}>
            <SelectInput
                id={id}
                value={props.machineId ?? ''}
                onChange={(e) => props.onChange(e.target.value)}
                disabled={props.isDisabled}
            >
                {props.isLoading && (
                    <option value="">{t('loading.machines')}</option>
                )}
                {!props.isLoading && props.machines.length === 0 && (
                    <option value="">{t('misc.noMachines')}</option>
                )}
                {props.machines.map((m) => (
                    <option key={m.id} value={m.id}>
                        {getMachineTitle(m)}
                        {m.metadata?.platform ? ` (${m.metadata.platform})` : ''}
                    </option>
                ))}
            </SelectInput>
        </FormField>
    )
}
