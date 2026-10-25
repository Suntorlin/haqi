import type { Machine } from '@/types/api'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { FitText } from '@/components/ui/FitText'
import { useTranslation } from '@/lib/use-translation'

function getMachineTitle(machine: Machine): string {
    if (machine.metadata?.displayName) return machine.metadata.displayName
    if (machine.metadata?.host) return machine.metadata.host
    return machine.id.slice(0, 8)
}

export function MachineList(props: {
    machines: Machine[]
    onSelect: (machineId: string) => void
}) {
    const { t } = useTranslation()
    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="text-xs text-[var(--social-fg-muted)]">
                {t('machine.onlineCount', { n: props.machines.length })}
            </div>

            <div className="flex flex-col gap-3">
                {props.machines.map((m) => (
                    <Card
                        key={m.id}
                        className="cursor-pointer"
                        onClick={() => props.onSelect(m.id)}
                    >
                        <CardHeader className="pb-2">
                            <CardTitle>
                                <FitText kind="title" text={getMachineTitle(m)} />
                            </CardTitle>
                            <CardDescription>
                                <FitText kind="value" text={m.metadata?.platform ? m.metadata.platform : t('machine.unknown')} />
                            </CardDescription>
                        </CardHeader>
                    </Card>
                ))}
            </div>
        </div>
    )
}
