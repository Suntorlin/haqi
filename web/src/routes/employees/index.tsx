import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { SCHEDULE_AGENTS } from '@hapi/protocol/schedules'
import type { Employee, EmployeeInput } from '@/types/api'
import { LoadingState } from '@/components/LoadingState'
import { PlusCircleIcon } from '@/components/mobile/icons'
import { MobilePageHeader, MobileTabBar } from '@/components/mobile/MobileTabBar'
import { getMachineTitle } from '@/components/NewSession/MachineSelector'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { ChoiceChips, FormField } from '@/components/ui/FormControls'
import { FeedRow } from '@/components/ui/FeedRow'
import { IconButton } from '@/components/ui/IconButton'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { TextField } from '@/components/ui/TextField'
import { useEmployeeActions } from '@/hooks/mutations/useEmployeeActions'
import { useEmployees } from '@/hooks/queries/useEmployees'
import { useMachines } from '@/hooks/queries/useMachines'
import { useAppContext } from '@/lib/app-context'
import { apiErrorText } from '@/lib/schedules'
import { useTranslation } from '@/lib/use-translation'

function title(employee: Employee): string {
    return `${employee.emoji ? `${employee.emoji} ` : ''}${employee.name}`
}

function StatusBadge(props: { status: Employee['status'] }) {
    const { t } = useTranslation()
    if (props.status === 'active') return null
    return <Badge>{t(`employees.status.${props.status}`)}</Badge>
}

/** Name, machine, folder, agent: the least a new employee needs; everything else has a default. */
function CreateEmployeeDialog(props: {
    open: boolean
    isPending: boolean
    onClose: () => void
    onSubmit: (input: EmployeeInput) => Promise<void>
}) {
    const { t } = useTranslation()
    const { api } = useAppContext()
    const { machines } = useMachines(api, props.open)
    const [name, setName] = useState('')
    const [emoji, setEmoji] = useState('')
    const [machineId, setMachineId] = useState('')
    const [directory, setDirectory] = useState('')
    const [agent, setAgent] = useState<EmployeeInput['agent']>('claude')
    const [error, setError] = useState<string | null>(null)

    const submit = async () => {
        if (!name.trim() || !directory.trim() || !machineId) {
            setError(t('employees.form.missing'))
            return
        }
        setError(null)
        try {
            await props.onSubmit({
                name: name.trim(),
                ...(emoji.trim() ? { emoji: emoji.trim() } : {}),
                machineId,
                directory: directory.trim(),
                agent
            })
        } catch (cause) {
            setError(`${t('employees.form.failed')}: ${apiErrorText(cause)}`)
        }
    }

    return (
        <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose() }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('employees.new')}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4">
                    <FormField label={t('employees.form.name')} htmlFor="employee-name">
                        <TextField id="employee-name" value={name} onChange={(event) => setName(event.target.value)} />
                    </FormField>
                    <FormField label={t('employees.form.emoji')} htmlFor="employee-emoji" optional>
                        <TextField id="employee-emoji" value={emoji} onChange={(event) => setEmoji(event.target.value)} />
                    </FormField>
                    <ChoiceChips
                        label={t('employees.form.machine')}
                        value={machineId as never}
                        options={machines.map((machine) => ({ value: machine.id, label: getMachineTitle(machine) }))}
                        onChange={(value) => setMachineId(value)}
                    />
                    <FormField label={t('employees.form.directory')} htmlFor="employee-directory" hint={t('employees.form.directoryHint')}>
                        <TextField id="employee-directory" value={directory} onChange={(event) => setDirectory(event.target.value)} />
                    </FormField>
                    <ChoiceChips
                        label={t('employees.form.agent')}
                        value={agent}
                        options={SCHEDULE_AGENTS.map((value) => ({ value, label: value }))}
                        optionClassName="capitalize"
                        onChange={(value) => setAgent(value)}
                    />
                    {error ? <p className="text-footnote text-[var(--social-danger)]">{error}</p> : null}
                    <Button onClick={() => { void submit() }} disabled={props.isPending}>
                        {t('employees.form.create')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

/**
 * Digital employees: persistent identities with their own memory and main session.
 * - page: the phone's top-level page, with the tab bar.
 * - panel: the desktop list column beside the detail pane.
 */
export default function EmployeesListPage(props: {
    variant?: 'page' | 'panel'
    selectedId?: string | null
}) {
    const variant = props.variant ?? 'page'
    const { api } = useAppContext()
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { employees, isLoading, error } = useEmployees(api)
    const [createOpen, setCreateOpen] = useState(false)
    const { create } = useEmployeeActions(api)

    const handleCreate = async (input: EmployeeInput) => {
        const employee = await create.mutateAsync(input)
        setCreateOpen(false)
        navigate({ to: '/employees/$employeeId', params: { employeeId: employee.id } })
    }
    const open = (id: string) => navigate({ to: '/employees/$employeeId', params: { employeeId: id } })

    const panel = variant === 'panel'

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
            <MobilePageHeader
                contentWidth={!panel}
                title={t('employees.title')}
                subtitle={employees.length > 0 ? t('employees.list.summary', { n: employees.length }) : undefined}
                actions={(
                    <IconButton className="text-[var(--social-fg)]" label={t('employees.new')} onClick={() => setCreateOpen(true)}>
                        <PlusCircleIcon className="h-[24px] w-[24px]" />
                    </IconButton>
                )}
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className={panel ? 'pb-6 pt-1' : 'mx-auto w-full max-w-content px-4 pb-8 pt-3'}>
                    {isLoading ? (
                        <LoadingState className="flex w-full justify-center py-16" />
                    ) : error ? (
                        <EmptyState variant="page" title={t('employees.loadFailed')} subtitle={error} />
                    ) : employees.length === 0 ? (
                        <EmptyState
                            variant="page"
                            title={t('employees.empty.title')}
                            subtitle={t('employees.empty.subtitle')}
                            action={panel ? undefined : { label: t('employees.new'), onClick: () => setCreateOpen(true) }}
                        />
                    ) : panel ? (
                        employees.map((employee) => (
                            <FeedRow
                                key={employee.id}
                                onClick={() => open(employee.id)}
                                aria-current={props.selectedId === employee.id ? 'page' : undefined}
                                title={title(employee)}
                                aside={<StatusBadge status={employee.status} />}
                                subtitle={employee.directory}
                            />
                        ))
                    ) : (
                        <ListGroup>
                            {employees.map((employee) => (
                                <ListRow
                                    key={employee.id}
                                    title={title(employee)}
                                    subtitle={employee.directory}
                                    trailing={<StatusBadge status={employee.status} />}
                                    onClick={() => open(employee.id)}
                                />
                            ))}
                        </ListGroup>
                    )}
                </div>
            </div>
            {panel ? null : <MobileTabBar active="settings" />}
            <CreateEmployeeDialog
                open={createOpen}
                isPending={create.isPending}
                onClose={() => setCreateOpen(false)}
                onSubmit={handleCreate}
            />
        </div>
    )
}
