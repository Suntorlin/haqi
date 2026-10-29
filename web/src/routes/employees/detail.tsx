import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { LoadingState } from '@/components/LoadingState'
import { getMachineTitle } from '@/components/NewSession/MachineSelector'
import { DesktopPaneHeader } from '@/components/mobile/DesktopPaneHeader'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { FitText } from '@/components/ui/FitText'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { Switch } from '@/components/ui/Switch'
import { TextField } from '@/components/ui/TextField'
import { useEmployeeActions } from '@/hooks/mutations/useEmployeeActions'
import { useEmployee } from '@/hooks/queries/useEmployees'
import { useMachines } from '@/hooks/queries/useMachines'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { useAppContext } from '@/lib/app-context'
import { apiErrorText } from '@/lib/schedules'
import { useTranslation } from '@/lib/use-translation'

/** A label on the left, its value on the right; long values (paths) wrap under the label. */
function InfoRow(props: { label: string; value: ReactNode; long?: boolean }) {
    if (props.long) {
        return <ListRow wrap title={props.label} subtitle={<span className="break-all">{props.value}</span>} />
    }
    const trailing = typeof props.value === 'string'
        ? <FitText kind="value" text={props.value} className="max-w-[55vw] text-right sm:max-w-sm" />
        : <span className="block max-w-[55vw] text-right sm:max-w-sm">{props.value}</span>
    return <ListRow title={props.label} trailing={trailing} />
}

export default function EmployeeDetailPage() {
    const { api } = useAppContext()
    const { t, locale } = useTranslation()
    const navigate = useNavigate()
    const { employeeId } = useParams({ from: '/employees/$employeeId' })
    const { employee, openIssues, isLoading, error } = useEmployee(api, employeeId)
    const { machines } = useMachines(api, true)
    const { update, remove, wake, generateMemory, syncMemory, maintain } = useEmployeeActions(api)
    const [wakeText, setWakeText] = useState('')
    const [deleteOpen, setDeleteOpen] = useState(false)
    const [notice, setNotice] = useState<string | null>(null)

    const goBack = () => navigate({ to: '/employees' })
    const isMobile = useIsMobileLayout()

    if (!employee) {
        return (
            <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
                {isMobile ? <SubPageHeader title={t('employees.title')} onBack={goBack} /> : <DesktopPaneHeader title={t('employees.title')} />}
                <div className="min-h-0 flex-1 overflow-y-auto">
                    {isLoading ? (
                        <LoadingState className="flex w-full justify-center py-16" />
                    ) : (
                        <EmptyState
                            variant="page"
                            title={error ? t('employees.loadFailed') : t('employees.detail.notFound')}
                            subtitle={error ?? undefined}
                            action={{ label: t('employees.detail.backToList'), onClick: goBack }}
                        />
                    )}
                </div>
            </div>
        )
    }

    const name = `${employee.emoji ? `${employee.emoji} ` : ''}${employee.name}`
    const machine = machines.find((item) => item.id === employee.machineId)
    const machineName = machine ? getMachineTitle(machine) : employee.machineId.slice(0, 8)

    const report = (text: string) => setNotice(text)
    const fail = (err: unknown) => setNotice(`${t('employees.detail.actionFailed')}: ${apiErrorText(err)}`)

    const handleWake = () => {
        setNotice(null)
        wake.mutate({ id: employee.id, ...(wakeText.trim() ? { text: wakeText.trim() } : {}) }, {
            onSuccess: (result) => {
                setWakeText('')
                report(t(`employees.detail.wake.${result.outcome}`))
                navigate({ to: '/sessions/$sessionId', params: { sessionId: result.sessionId } })
            },
            onError: fail
        })
    }
    const handleToggle = (active: boolean) => {
        setNotice(null)
        update.mutate({ id: employee.id, patch: { status: active ? 'active' : 'paused' } }, { onError: fail })
    }

    const memoryBusy = generateMemory.isPending || syncMemory.isPending || maintain.isPending

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
            {isMobile ? (
                <SubPageHeader title={name} subtitle={employee.directory} onBack={goBack} />
            ) : (
                <DesktopPaneHeader title={name} subtitle={employee.directory} />
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content px-4 pb-10 pt-4">
                    <div className="flex flex-col gap-5">
                        <div className="flex flex-col gap-2">
                            <TextField
                                value={wakeText}
                                placeholder={t('employees.detail.wakePlaceholder')}
                                onChange={(event) => setWakeText(event.target.value)}
                            />
                            <div className="flex gap-2">
                                <Button className="flex-1 sm:flex-none" onClick={handleWake} disabled={wake.isPending || employee.status !== 'active'}>
                                    {wake.isPending ? t('employees.detail.waking') : t('employees.detail.wakeNow')}
                                </Button>
                                {employee.mainSessionId ? (
                                    <Button variant="secondary" onClick={() => navigate({ to: '/sessions/$sessionId', params: { sessionId: employee.mainSessionId! } })}>
                                        {t('employees.detail.openMainSession')}
                                    </Button>
                                ) : null}
                            </div>
                            {notice ? <p role="status" className="px-1 text-footnote text-[var(--social-fg-muted)]">{notice}</p> : null}
                        </div>

                        <ListGroup>
                            <ListRow
                                title={t('employees.detail.active')}
                                subtitle={t(`employees.status.${employee.status}`)}
                                trailing={(
                                    <Switch
                                        checked={employee.status === 'active'}
                                        disabled={update.isPending || employee.status === 'retired'}
                                        onCheckedChange={handleToggle}
                                        ariaLabel={t('employees.detail.active')}
                                    />
                                )}
                            />
                        </ListGroup>

                        <ListGroup title={t('employees.detail.settings')}>
                            <InfoRow label={t('newSession.machine')} value={machineName} />
                            <InfoRow label={t('employees.form.directory')} value={employee.directory} long />
                            <InfoRow label={t('employees.form.agent')} value={<span className="capitalize">{employee.agent}</span>} />
                            <InfoRow label={t('employees.detail.home')} value={employee.homePath} long />
                            <InfoRow label={t('employees.detail.timezone')} value={employee.timezone} />
                        </ListGroup>

                        <ListGroup title={t('employees.detail.memory')}>
                            <div className="flex flex-wrap gap-2 px-3 py-3">
                                <Button variant="secondary" disabled={memoryBusy} onClick={() => {
                                    setNotice(null)
                                    generateMemory.mutate(employee.id, { onSuccess: () => report(t('employees.detail.memoryGenerated')), onError: fail })
                                }}>{t('employees.detail.generateMemory')}</Button>
                                <Button variant="secondary" disabled={memoryBusy} onClick={() => {
                                    setNotice(null)
                                    syncMemory.mutate(employee.id, { onSuccess: (result) => report(t('employees.detail.memorySynced', { state: result.state })), onError: fail })
                                }}>{t('employees.detail.syncMemory')}</Button>
                                <Button variant="secondary" disabled={memoryBusy} onClick={() => {
                                    setNotice(null)
                                    maintain.mutate(employee.id, { onSuccess: () => report(t('employees.detail.maintained')), onError: fail })
                                }}>{t('employees.detail.maintain')}</Button>
                            </div>
                        </ListGroup>

                        <ListGroup title={t('employees.detail.issues', { n: openIssues.length })}>
                            {openIssues.length === 0 ? (
                                <ListRow title={t('employees.detail.noIssues')} />
                            ) : openIssues.map((issue) => (
                                <ListRow
                                    key={issue.id}
                                    wrap
                                    title={issue.text}
                                    subtitle={t('employees.detail.issueMeta', {
                                        when: new Date(issue.firstSeen).toLocaleDateString(locale),
                                        n: issue.seenCount
                                    })}
                                />
                            ))}
                        </ListGroup>

                        <ListGroup>
                            <ListRow
                                title={<span className="text-[var(--social-danger)]">{t('employees.detail.delete')}</span>}
                                onClick={() => setDeleteOpen(true)}
                            />
                        </ListGroup>
                    </div>
                </div>
            </div>
            <ConfirmDialog
                isOpen={deleteOpen}
                title={t('employees.detail.deleteTitle', { name: employee.name })}
                description={t('employees.detail.deleteBody')}
                confirmLabel={t('employees.detail.delete')}
                confirmingLabel={t('employees.detail.delete')}
                isPending={remove.isPending}
                destructive
                onConfirm={async () => {
                    await remove.mutateAsync(employee.id)
                    goBack()
                }}
                onClose={() => setDeleteOpen(false)}
            />
        </div>
    )
}
