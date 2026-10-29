import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
    DEFAULT_MAX_MINUTES,
    SCHEDULE_AGENTS,
    upcomingRunTimes,
    type ScheduleAgent
} from '@hapi/protocol/schedules'
import { getPermissionModesForFlavor } from '@hapi/protocol/modes'
import type { Machine, ScheduledTask, ScheduledTaskInput } from '@/types/api'
import { getMachineTitle } from '@/components/NewSession/MachineSelector'
import { AutoTextarea } from '@/components/ui/AutoTextarea'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ChoiceChips, FieldHint, FormField, SelectInput } from '@/components/ui/FormControls'
import { Switch } from '@/components/ui/Switch'
import { TextField } from '@/components/ui/TextField'
import {
    SCHEDULE_KINDS,
    apiErrorText,
    browserTimezone,
    draftToSpec,
    formatScheduleTime,
    specToDraft,
    type ScheduleKind,
    type SpecDraft,
    type SpecError
} from '@/lib/schedules'
import { useAppContext } from '@/lib/app-context'
import { useEmployees } from '@/hooks/queries/useEmployees'
import { useClaudeAccountPool } from '@/hooks/queries/useSchedules'
import { useTranslation } from '@/lib/use-translation'

/** Monday first: the order people read a week in. */
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const

type FormState = {
    name: string
    prompt: string
    promptFile: string
    machineId: string
    directory: string
    agent: ScheduleAgent
    model: string
    permissionMode: string
    /** '' = the pool's default account. */
    accountId: string
    /** '' = a plain task with no employee. */
    employeeId: string
    sessionTarget: string
    worktree: boolean
    maxMinutes: string
    timezone: string
    draft: SpecDraft
}

function initialState(schedule: ScheduledTask | null): FormState {
    const timezone = schedule?.timezone ?? browserTimezone()
    return {
        name: schedule?.name ?? '',
        prompt: schedule?.prompt ?? '',
        promptFile: schedule?.promptFile ?? '',
        machineId: schedule?.machineId ?? '',
        directory: schedule?.directory ?? '',
        agent: schedule?.agent ?? 'claude',
        model: schedule?.model ?? '',
        permissionMode: schedule?.permissionMode ?? 'default',
        accountId: schedule?.accountId ?? '',
        employeeId: schedule?.employeeId ?? '',
        sessionTarget: schedule?.sessionTarget ?? 'isolated',
        worktree: schedule?.worktree ?? false,
        maxMinutes: String(schedule?.maxMinutes ?? DEFAULT_MAX_MINUTES),
        timezone,
        draft: specToDraft(schedule?.spec ?? null, timezone)
    }
}

function specErrorText(error: SpecError, t: (key: string, params?: Record<string, string | number>) => string): string {
    return 'key' in error ? t(`scheduled.form.error.${error.key}`) : t('scheduled.form.error.spec', { error: error.message })
}

/** Create or edit a scheduled task. `schedule` null = create. */
export function ScheduleFormDialog(props: {
    open: boolean
    schedule: ScheduledTask | null
    machines: Machine[]
    isPending: boolean
    onClose: () => void
    onSubmit: (input: ScheduledTaskInput) => Promise<void>
}) {
    const { t, locale } = useTranslation()
    const { api } = useAppContext()
    const ids = useId()
    const [state, setState] = useState<FormState>(() => initialState(props.schedule))
    const [tried, setTried] = useState(false)
    const [submitError, setSubmitError] = useState<string | null>(null)

    // Reset only when the dialog opens: a live refresh of the task must not wipe what the user is typing.
    const scheduleRef = useRef(props.schedule)
    scheduleRef.current = props.schedule
    useEffect(() => {
        if (!props.open) return
        setState(initialState(scheduleRef.current))
        setTried(false)
        setSubmitError(null)
    }, [props.open])

    // A new task starts on the first online machine once the list arrives.
    useEffect(() => {
        if (!props.open || state.machineId || props.machines.length === 0) return
        const machine = props.machines.find((item) => item.active) ?? props.machines[0]
        if (machine) setState((prev) => ({ ...prev, machineId: machine.id }))
    }, [props.open, props.machines, state.machineId])

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((prev) => ({ ...prev, [key]: value }))
    const setDraft = <K extends keyof SpecDraft>(key: K, value: SpecDraft[K]) => setState((prev) => ({ ...prev, draft: { ...prev.draft, [key]: value } }))

    const permissionModes = getPermissionModesForFlavor(state.agent)
    const isClaude = state.agent === 'claude'
    const { employees } = useEmployees(props.open ? api : null)
    const pool = useClaudeAccountPool(api, state.machineId || null, props.open && isClaude)
    const accounts = pool?.profiles.filter((profile) => profile.enabled || profile.id === state.accountId) ?? []
    const defaultEmail = pool?.profiles.find((profile) => profile.id === pool.initialAccount)?.email
    const timezone = state.timezone.trim()
    const check = useMemo(() => draftToSpec(state.draft, timezone), [state.draft, timezone])
    const upcoming = useMemo(() => {
        if (!check.spec) return []
        try {
            return upcomingRunTimes(check.spec, timezone, Date.now(), 3)
        } catch {
            return []
        }
    }, [check.spec, timezone])
    const otherZone = timezone !== browserTimezone()

    const maxMinutes = Number(state.maxMinutes)
    const problem = !state.name.trim() ? t('scheduled.form.error.name')
        : !state.prompt.trim() && !state.promptFile.trim() ? t('scheduled.form.error.prompt')
        : !state.machineId ? t('scheduled.form.error.machine')
        : !state.directory.trim() ? t('scheduled.form.error.directory')
        : !Number.isInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > 24 * 60 ? t('scheduled.form.error.maxMinutes')
        : check.error ? specErrorText(check.error, t)
        : null

    const submit = async () => {
        setTried(true)
        setSubmitError(null)
        if (problem || !check.spec) return
        try {
            await props.onSubmit({
                name: state.name.trim(),
                prompt: state.prompt.trim(),
                promptFile: state.promptFile.trim() || null,
                machineId: state.machineId,
                directory: state.directory.trim(),
                agent: state.agent,
                model: state.model.trim() || null,
                permissionMode: state.permissionMode === 'default' ? null : state.permissionMode,
                accountId: isClaude && state.accountId ? state.accountId : null,
                employeeId: state.employeeId || null,
                sessionTarget: state.employeeId ? state.sessionTarget : 'isolated',
                worktree: state.worktree,
                maxMinutes,
                spec: check.spec,
                timezone: timezone || browserTimezone()
            })
        } catch (error) {
            setSubmitError(apiErrorText(error))
        }
    }

    const knownMachine = props.machines.some((machine) => machine.id === state.machineId)
    const kindOptions = SCHEDULE_KINDS.map((kind) => ({ value: kind, label: t(`scheduled.kind.${kind}`) }))
    const agentOptions = SCHEDULE_AGENTS.map((agent) => ({ value: agent, label: agent }))
    const weekdayOptions = WEEKDAY_ORDER.map((day) => ({ value: String(day), label: t(`scheduled.weekday.${day}`) }))
    // isolated and main are the form's choices; an API-made named:<key> target survives an edit untouched.
    const sessionTargetOptions = [
        { value: 'isolated', label: t('scheduled.form.sessionTargetIsolated') },
        { value: 'main', label: t('scheduled.form.sessionTargetMain') },
        ...(state.sessionTarget.startsWith('named:')
            ? [{ value: state.sessionTarget, label: t('scheduled.form.sessionTargetNamed', { key: state.sessionTarget.slice('named:'.length) }) }]
            : [])
    ]

    return (
        <Dialog open={props.open} onOpenChange={(open) => { if (!open) props.onClose() }}>
            <DialogContent className="max-h-[88dvh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="text-headline">{props.schedule ? t('scheduled.form.editTitle') : t('scheduled.form.createTitle')}</DialogTitle>
                </DialogHeader>
                <form
                    className="mt-4 flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault()
                        void submit()
                    }}
                >
                    <FormField label={t('scheduled.form.name')} htmlFor={`${ids}-name`}>
                        <TextField id={`${ids}-name`} value={state.name} placeholder={t('scheduled.form.namePlaceholder')} onChange={(e) => set('name', e.target.value)} />
                    </FormField>
                    <FormField label={t('scheduled.form.prompt')} htmlFor={`${ids}-prompt`} optional={Boolean(state.promptFile.trim())}>
                        <AutoTextarea id={`${ids}-prompt`} value={state.prompt} minRows={3} maxRows={10} placeholder={t('scheduled.form.promptPlaceholder')} onChange={(e) => set('prompt', e.target.value)} />
                    </FormField>
                    <FormField label={t('scheduled.form.promptFile')} htmlFor={`${ids}-file`} optional hint={t('scheduled.form.promptFileHint')}>
                        <TextField id={`${ids}-file`} value={state.promptFile} placeholder="/Users/me/notes/daily-report.md" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => set('promptFile', e.target.value)} />
                    </FormField>

                    <FormField label={t('newSession.machine')} htmlFor={`${ids}-machine`}>
                        <SelectInput id={`${ids}-machine`} value={state.machineId} onChange={(e) => { const machineId = e.target.value; setState((prev) => ({ ...prev, machineId, accountId: '' })) }}>
                            {props.machines.length === 0 && !state.machineId ? <option value="">{t('misc.noMachines')}</option> : null}
                            {state.machineId && !knownMachine ? <option value={state.machineId}>{t('scheduled.form.machineOffline', { id: state.machineId.slice(0, 8) })}</option> : null}
                            {props.machines.map((machine) => (
                                <option key={machine.id} value={machine.id}>
                                    {getMachineTitle(machine)}
                                    {machine.metadata?.platform ? ` (${machine.metadata.platform})` : ''}
                                </option>
                            ))}
                        </SelectInput>
                    </FormField>
                    <FormField label={t('scheduled.form.directory')} htmlFor={`${ids}-dir`}>
                        <TextField id={`${ids}-dir`} value={state.directory} placeholder="/Users/me/projects/app" autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => set('directory', e.target.value)} />
                    </FormField>
                    <FormField label={t('newSession.agent')}>
                        <ChoiceChips
                            label={t('newSession.agent')}
                            value={state.agent}
                            options={agentOptions}
                            optionClassName="shrink-0 capitalize"
                            onChange={(agent) => setState((prev) => ({
                                ...prev,
                                agent,
                                permissionMode: (getPermissionModesForFlavor(agent) as readonly string[]).includes(prev.permissionMode) ? prev.permissionMode : 'default'
                            }))}
                        />
                    </FormField>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <FormField label={t('scheduled.form.model')} htmlFor={`${ids}-model`} optional>
                            <TextField id={`${ids}-model`} value={state.model} placeholder={t('scheduled.form.modelPlaceholder')} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => set('model', e.target.value)} />
                        </FormField>
                        <FormField label={t('misc.permissionMode')} htmlFor={`${ids}-perm`}>
                            <SelectInput id={`${ids}-perm`} value={state.permissionMode} onChange={(e) => set('permissionMode', e.target.value)}>
                                {permissionModes.map((mode) => (
                                    <option key={mode} value={mode}>
                                        {mode === 'bypassPermissions' ? t('scheduled.permission.bypassPermissions') : t(`permissionMode.${mode}`)}
                                    </option>
                                ))}
                            </SelectInput>
                        </FormField>
                    </div>
                    {isClaude ? (
                        <FormField label={t('scheduled.form.account')} htmlFor={`${ids}-account`} optional hint={t('scheduled.form.accountHint')}>
                            <SelectInput id={`${ids}-account`} value={state.accountId} onChange={(e) => set('accountId', e.target.value)}>
                                <option value="">{defaultEmail ? t('scheduled.form.accountDefaultEmail', { email: defaultEmail }) : t('scheduled.form.accountDefault')}</option>
                                {state.accountId && !accounts.some((profile) => profile.id === state.accountId) ? <option value={state.accountId}>{state.accountId}</option> : null}
                                {accounts.map((profile) => (
                                    <option key={profile.id} value={profile.id}>{profile.email}</option>
                                ))}
                            </SelectInput>
                        </FormField>
                    ) : null}
                    {employees.length > 0 || state.employeeId ? (
                        <FormField label={t('scheduled.form.employee')} htmlFor={`${ids}-employee`} optional hint={t('scheduled.form.employeeHint')}>
                            <SelectInput id={`${ids}-employee`} value={state.employeeId} onChange={(e) => set('employeeId', e.target.value)}>
                                <option value="">{t('scheduled.form.employeeNone')}</option>
                                {state.employeeId && !employees.some((employee) => employee.id === state.employeeId) ? (
                                    <option value={state.employeeId}>{t('scheduled.form.employeeMissing', { id: state.employeeId.slice(0, 8) })}</option>
                                ) : null}
                                {employees.map((employee) => (
                                    <option key={employee.id} value={employee.id}>
                                        {employee.emoji ? `${employee.emoji} ` : ''}{employee.name}
                                    </option>
                                ))}
                            </SelectInput>
                        </FormField>
                    ) : null}
                    {state.employeeId ? (
                        <FormField label={t('scheduled.form.sessionTarget')} hint={t('scheduled.form.sessionTargetHint')}>
                            <ChoiceChips
                                label={t('scheduled.form.sessionTarget')}
                                value={state.sessionTarget}
                                options={sessionTargetOptions}
                                onChange={(value) => set('sessionTarget', value)}
                            />
                        </FormField>
                    ) : null}
                    <div className="flex min-h-11 items-center gap-3 px-1">
                        <div className="min-w-0 flex-1">
                            <div className="text-body text-[var(--social-fg)]">{t('scheduled.form.worktree')}</div>
                            <div className="text-caption text-[var(--social-fg-subtle)]">{t('scheduled.form.worktreeHint')}</div>
                        </div>
                        <Switch checked={state.worktree} onCheckedChange={(value) => set('worktree', value)} ariaLabel={t('scheduled.form.worktree')} />
                    </div>
                    <FormField label={t('scheduled.form.maxMinutes')} htmlFor={`${ids}-max`} hint={t('scheduled.form.maxMinutesHint')}>
                        <TextField id={`${ids}-max`} type="number" inputMode="numeric" min={1} max={24 * 60} value={state.maxMinutes} onChange={(e) => set('maxMinutes', e.target.value)} />
                    </FormField>

                    <FormField label={t('scheduled.form.when')}>
                        <ChoiceChips<ScheduleKind>
                            label={t('scheduled.form.when')}
                            value={state.draft.kind}
                            options={kindOptions}
                            onChange={(kind) => setDraft('kind', kind)}
                        />
                    </FormField>
                    {state.draft.kind === 'hourly' ? (
                        <FormField label={t('scheduled.form.minute')} htmlFor={`${ids}-minute`}>
                            <TextField id={`${ids}-minute`} type="number" inputMode="numeric" min={0} max={59} value={state.draft.minute} onChange={(e) => setDraft('minute', e.target.value)} />
                        </FormField>
                    ) : null}
                    {state.draft.kind === 'weekly' ? (
                        <FormField label={t('scheduled.form.weekday')}>
                            <ChoiceChips
                                label={t('scheduled.form.weekday')}
                                value={String(state.draft.weekday)}
                                options={weekdayOptions}
                                onChange={(day) => setDraft('weekday', Number(day))}
                            />
                        </FormField>
                    ) : null}
                    {state.draft.kind === 'daily' || state.draft.kind === 'weekdays' || state.draft.kind === 'weekly' ? (
                        <FormField label={t('scheduled.form.time')} htmlFor={`${ids}-time`}>
                            <TextField id={`${ids}-time`} type="time" value={state.draft.time} onChange={(e) => setDraft('time', e.target.value)} />
                        </FormField>
                    ) : null}
                    {state.draft.kind === 'cron' ? (
                        <FormField label={t('scheduled.form.cron')} htmlFor={`${ids}-cron`} hint={t('scheduled.form.cronHint')}>
                            <TextField id={`${ids}-cron`} value={state.draft.cron} placeholder="0 9 * * 1-5" autoCapitalize="off" autoCorrect="off" spellCheck={false} className="font-mono" onChange={(e) => setDraft('cron', e.target.value)} />
                        </FormField>
                    ) : null}
                    {state.draft.kind === 'once' ? (
                        <FormField label={t('scheduled.form.onceAt')} htmlFor={`${ids}-once`}>
                            <TextField id={`${ids}-once`} type="datetime-local" value={state.draft.onceAt} onChange={(e) => setDraft('onceAt', e.target.value)} />
                        </FormField>
                    ) : null}
                    {state.draft.kind !== 'manual' ? (
                        <FormField label={t('scheduled.form.timezone')} htmlFor={`${ids}-tz`}>
                            <TextField id={`${ids}-tz`} value={state.timezone} placeholder={browserTimezone()} autoCapitalize="off" autoCorrect="off" spellCheck={false} onChange={(e) => set('timezone', e.target.value)} />
                        </FormField>
                    ) : null}

                    <div className="rounded-xl bg-[var(--social-hover)] px-3.5 py-3 text-footnote" aria-live="polite">
                        {check.error ? (
                            <span className="text-[var(--social-danger)]">{specErrorText(check.error, t)}</span>
                        ) : state.draft.kind === 'manual' ? (
                            <span className="text-[var(--social-fg-muted)]">{t('scheduled.form.previewManual')}</span>
                        ) : upcoming.length === 0 ? (
                            <span className="text-[var(--social-danger)]">{t('scheduled.form.previewNone')}</span>
                        ) : (
                            <>
                                <div className="font-semibold text-[var(--social-fg-muted)]">
                                    {otherZone ? t('scheduled.form.previewLocal') : t('scheduled.form.preview')}
                                </div>
                                <ul className="mt-1 flex flex-col gap-0.5 text-[var(--social-fg)]">
                                    {upcoming.map((at) => <li key={at}>{formatScheduleTime(at, locale)}</li>)}
                                </ul>
                            </>
                        )}
                    </div>

                    {tried && problem && !check.error ? <FieldHint><span className="text-[var(--social-danger)]">{problem}</span></FieldHint> : null}
                    {submitError ? <FieldHint><span className="text-[var(--social-danger)]">{t('scheduled.form.saveFailed', { error: submitError })}</span></FieldHint> : null}

                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="secondary" onClick={props.onClose} disabled={props.isPending}>
                            {t('button.cancel')}
                        </Button>
                        <Button type="submit" disabled={props.isPending}>
                            {props.isPending ? t('scheduled.form.saving') : props.schedule ? t('button.save') : t('scheduled.form.create')}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    )
}
