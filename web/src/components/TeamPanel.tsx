import { useEffect, useId, useMemo, useState } from 'react'
import type { AgentState, TeamControlAction, TeamControlRequest, TeamState } from '@hapi/protocol/types'
import { Button } from '@/components/ui/button'
import { FormField, SelectInput } from '@/components/ui/FormControls'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'

type Translate = (key: string, params?: Record<string, string | number>) => string

/** Compact pill whose touch target still reaches 44px (36px pill + 4px above and below). */
const ROW_ACTION_CLASS = "relative h-8 px-3 text-caption before:absolute before:-inset-y-2 before:inset-x-0 before:content-['']"

function memberStatusDot(status?: string): string {
    if (status === 'active') return 'bg-[var(--app-badge-success-text)]'
    if (status === 'shutdown') return 'bg-[var(--app-badge-error-text)]'
    return 'bg-[var(--social-fg-subtle)]'
}

function taskStatusColor(status?: string): string {
    if (status === 'completed') return 'text-[var(--app-badge-success-text)]'
    if (status === 'in_progress') return 'text-[var(--social-fg)]'
    if (status === 'blocked') return 'text-[var(--app-badge-error-text)]'
    return 'text-[var(--social-fg-muted)]'
}

function taskStatusIcon(status?: string): string {
    if (status === 'completed') return '\u2611'
    if (status === 'in_progress') return '\u25b6'
    if (status === 'blocked') return '\u26a0'
    return '\u2610'
}

type PendingControlState = {
    action: TeamControlAction
    memberName?: string
    taskId?: string
    message: string
    confirmRequired?: boolean
}

function buildInitialControlState(action: TeamControlAction, options?: {
    memberName?: string
    taskId?: string
    message?: string
}): PendingControlState {
    return {
        action,
        memberName: options?.memberName,
        taskId: options?.taskId,
        message: options?.message ?? '',
        confirmRequired: action === 'shutdown_member' || action === 'cleanup_team'
    }
}

function actionLabel(action: TeamControlAction, t: Translate): string {
    return action === 'cleanup_team' ? t('team.cleanup') : t(`team.action.${action}`)
}

function actionNeedsMessage(action: TeamControlAction): boolean {
    return action === 'message' || action === 'nudge_member'
}

function actionNeedsMember(action: TeamControlAction): boolean {
    return action === 'message'
        || action === 'nudge_member'
        || action === 'shutdown_member'
        || action === 'assign_task'
}

function actionNeedsTask(action: TeamControlAction): boolean {
    return action === 'assign_task'
}

function actionDescription(action: TeamControlAction, t: Translate): string {
    return t(`team.hint.${action}`)
}

export function TeamPanel(props: {
    teamState?: TeamState
    agentState?: AgentState | null
    canControl?: boolean
    onControl?: (request: TeamControlRequest) => Promise<void>
}) {
    const { t } = useTranslation()
    const [expanded, setExpanded] = useState(false)
    const memberFieldId = useId()
    const taskFieldId = useId()
    const messageFieldId = useId()
    const [pendingControl, setPendingControl] = useState<PendingControlState | null>(null)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const { teamState, agentState } = props
    const members = teamState?.members ?? []
    const tasks = teamState?.tasks ?? []
    const messages = teamState?.messages ?? []
    const runningAgents = agentState?.runningAgents ?? (agentState?.runningAgent ? [agentState.runningAgent] : [])

    const completedTasks = tasks.filter(t => t.status === 'completed').length
    const title = teamState?.teamName ?? t('team.runningAgents')

    const runningAgentMembers = useMemo(() => {
        const existing = new Set(members.map((member) => member.name))
        return runningAgents
            .filter((agent) => !existing.has(agent.name))
            .map((agent) => ({
                name: agent.name,
                agentType: undefined,
                status: 'active' as const
            }))
    }, [members, runningAgents])

    const visibleMembers = [...members, ...runningAgentMembers]
    const activeMembers = visibleMembers.filter((member) => member.status === 'active').length
    const memberCount = visibleMembers.length === 1
        ? t('team.summary.memberOne')
        : t('team.summary.members', { n: visibleMembers.length })
    const summary = [
        activeMembers > 0 ? t('team.summary.active', { members: memberCount, n: activeMembers }) : memberCount,
        runningAgents.length > 0 ? t('team.summary.running', { n: runningAgents.length }) : null,
        tasks.length > 0 ? t('team.summary.tasks', { done: completedTasks, total: tasks.length }) : null
    ].filter(Boolean).join(' · ')

    useEffect(() => {
        if (!pendingControl) {
            return
        }
        if (pendingControl.memberName) {
            const stillExists = visibleMembers.some((member) => member.name === pendingControl.memberName)
            if (!stillExists) {
                setPendingControl((current) => current
                    ? {
                        ...current,
                        memberName: visibleMembers[0]?.name
                    }
                    : null)
            }
        }
    }, [pendingControl, visibleMembers])

    if (!teamState && runningAgents.length === 0) {
        return null
    }

    const startControl = (action: TeamControlAction, options?: {
        memberName?: string
        taskId?: string
        message?: string
    }) => {
        setExpanded(true)
        setSubmitError(null)
        setPendingControl(buildInitialControlState(action, options))
    }

    const submitControl = async () => {
        if (!pendingControl || !props.onControl) {
            return
        }

        const request: TeamControlRequest = {
            action: pendingControl.action
        }
        if (actionNeedsMember(pendingControl.action) && pendingControl.memberName) {
            request.memberName = pendingControl.memberName
        }
        if (actionNeedsTask(pendingControl.action) && pendingControl.taskId) {
            request.taskId = pendingControl.taskId
        }
        if (pendingControl.message.trim()) {
            request.message = pendingControl.message.trim()
        }

        if (actionNeedsMember(pendingControl.action) && !request.memberName) {
            setSubmitError(t('team.error.noTeammate'))
            return
        }
        if (actionNeedsTask(pendingControl.action) && !request.taskId) {
            setSubmitError(t('team.error.noTask'))
            return
        }
        if (actionNeedsMessage(pendingControl.action) && !request.message) {
            setSubmitError(t('team.error.noMessage'))
            return
        }
        if (pendingControl.confirmRequired) {
            setSubmitError(t('team.error.confirm'))
            return
        }

        setIsSubmitting(true)
        setSubmitError(null)
        try {
            await props.onControl(request)
            setPendingControl(null)
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : t('team.error.sendFailed'))
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="mx-3 mt-3">
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                className="flex min-h-11 w-full items-center gap-2 rounded-2xl bg-[var(--social-muted)] px-4 py-2 text-left text-body transition-colors hover:bg-[var(--social-border)] [-webkit-tap-highlight-color:transparent]"
            >
                <svg className="h-4 w-4 shrink-0 text-[var(--social-fg-muted)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-[var(--social-fg)]">
                        {teamState ? t('team.title', { name: title }) : title}
                    </span>
                    <span className="block truncate text-caption text-[var(--social-fg-muted)]">
                        {summary}
                    </span>
                </span>
                <svg
                    className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', expanded && 'rotate-180')}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <path d="m6 9 6 6 6-6" />
                </svg>
            </button>

            {expanded && (
                <Card className="mt-1.5 flex flex-col gap-4 p-4">
                    {teamState?.description && (
                        <p className="text-footnote text-[var(--social-fg-muted)]">{teamState.description}</p>
                    )}

                    {props.canControl && teamState && (
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={ROW_ACTION_CLASS}
                                onClick={() => startControl('cleanup_team')}
                            >
                                {t('team.cleanup')}
                            </Button>
                        </div>
                    )}

                    {runningAgents.length > 0 && (
                        <div>
                            <div className="mb-1.5 px-1 text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{t('team.runningNow')}</div>
                            <div className="flex flex-col gap-1.5">
                                {runningAgents.map((agent, index) => (
                                    <div
                                        key={`${agent.name}:${agent.startedAt ?? index}`}
                                        className="rounded-xl bg-[var(--social-muted)] px-3 py-2 text-footnote"
                                    >
                                        <div className="font-semibold text-[var(--social-fg)]">{agent.name}</div>
                                        {agent.task ? (
                                            <div className="mt-0.5 text-[var(--social-fg-muted)]">{agent.task}</div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {visibleMembers.length > 0 && (
                        <div>
                            <div className="mb-1.5 px-1 text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{t('team.members')}</div>
                            <div className="flex flex-col gap-1.5">
                                {visibleMembers.map((member) => (
                                    <div
                                        key={member.name}
                                        className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--social-muted)] px-3 py-2 text-footnote"
                                    >
                                        <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${memberStatusDot(member.status)}`} />
                                        <span className="text-[var(--social-fg)]">{member.name}</span>
                                        {member.agentType && (
                                            <span className="text-[var(--social-fg-muted)]">({member.agentType})</span>
                                        )}
                                        {props.canControl && teamState ? (
                                            <div className="ml-auto flex flex-wrap gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className={ROW_ACTION_CLASS}
                                                    onClick={() => startControl('message', { memberName: member.name })}
                                                >
                                                    {t('team.message')}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className={ROW_ACTION_CLASS}
                                                    onClick={() => startControl('nudge_member', { memberName: member.name })}
                                                >
                                                    {t('team.nudge')}
                                                </Button>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className={ROW_ACTION_CLASS}
                                                    onClick={() => startControl('shutdown_member', { memberName: member.name })}
                                                >
                                                    {t('team.shutdown')}
                                                </Button>
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {tasks.length > 0 && (
                        <div>
                            <div className="mb-1.5 px-1 text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{t('team.tasks')}</div>
                            <div className="flex flex-col gap-1.5">
                                {tasks.map((task, idx) => (
                                    <div key={task.id ?? String(idx)} className="flex items-center gap-2 rounded-xl bg-[var(--social-muted)] px-3 py-2">
                                        <div className={`min-w-0 flex-1 text-footnote ${taskStatusColor(task.status)}`}>
                                            <span>{taskStatusIcon(task.status)}</span>{' '}
                                            <span>{task.title}</span>
                                            {task.owner && (
                                                <span className="ml-1 text-[var(--social-fg-muted)]">[{task.owner}]</span>
                                            )}
                                        </div>
                                        {props.canControl && teamState ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className={ROW_ACTION_CLASS}
                                                onClick={() => startControl('assign_task', {
                                                    taskId: task.id,
                                                    memberName: task.owner ?? visibleMembers[0]?.name
                                                })}
                                            >
                                                {t('team.assign')}
                                            </Button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {props.canControl && pendingControl && teamState ? (
                        <Card className="flex flex-col gap-3 p-4">
                            <div>
                                <div className="text-body font-semibold text-[var(--social-fg)]">
                                    {actionLabel(pendingControl.action, t)}
                                </div>
                                <div className="mt-0.5 text-footnote text-[var(--social-fg-muted)]">
                                    {actionDescription(pendingControl.action, t)}
                                </div>
                            </div>

                            {actionNeedsMember(pendingControl.action) && (
                                <FormField label={t('team.teammate')} htmlFor={memberFieldId}>
                                    <SelectInput
                                        id={memberFieldId}
                                        value={pendingControl.memberName ?? ''}
                                        onChange={(event) => setPendingControl((current) => current
                                            ? { ...current, memberName: event.target.value }
                                            : current)}
                                    >
                                        <option value="" disabled>{t('team.selectTeammate')}</option>
                                        {visibleMembers.map((member) => (
                                            <option key={member.name} value={member.name}>{member.name}</option>
                                        ))}
                                    </SelectInput>
                                </FormField>
                            )}

                            {actionNeedsTask(pendingControl.action) && (
                                <FormField label={t('team.task')} htmlFor={taskFieldId}>
                                    <SelectInput
                                        id={taskFieldId}
                                        value={pendingControl.taskId ?? ''}
                                        onChange={(event) => setPendingControl((current) => current
                                            ? { ...current, taskId: event.target.value }
                                            : current)}
                                    >
                                        <option value="" disabled>{t('team.selectTask')}</option>
                                        {tasks.map((task) => (
                                            <option key={task.id} value={task.id}>{task.title}</option>
                                        ))}
                                    </SelectInput>
                                </FormField>
                            )}

                            {(actionNeedsMessage(pendingControl.action) || pendingControl.action === 'assign_task') && (
                                <FormField
                                    label={pendingControl.action === 'assign_task' ? t('team.guidance') : t('team.messageLabel')}
                                    optional={pendingControl.action === 'assign_task'}
                                    htmlFor={messageFieldId}
                                >
                                    <textarea
                                        id={messageFieldId}
                                        className={cn(DIALOG_INPUT_CLASS, 'min-h-20 resize-y')}
                                        value={pendingControl.message}
                                        onChange={(event) => setPendingControl((current) => current
                                            ? { ...current, message: event.target.value }
                                            : current)}
                                        placeholder={pendingControl.action === 'message'
                                            ? t('team.placeholder.message')
                                            : pendingControl.action === 'nudge_member'
                                                ? t('team.placeholder.nudge_member')
                                                : t('team.placeholder.assign_task')}
                                    />
                                </FormField>
                            )}

                            {pendingControl.confirmRequired ? (
                                <label className="flex min-h-11 items-start gap-3 rounded-xl bg-[var(--app-badge-warning-bg)] px-3 py-2.5 text-footnote text-[var(--social-fg)]">
                                    <input
                                        type="checkbox"
                                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--social-primary)]"
                                        checked={!pendingControl.confirmRequired}
                                        onChange={(event) => setPendingControl((current) => current
                                            ? { ...current, confirmRequired: !event.target.checked }
                                            : current)}
                                    />
                                    <span>
                                        {pendingControl.action === 'cleanup_team'
                                            ? t('team.confirm.cleanup_team')
                                            : t('team.confirm.shutdown_member')}
                                    </span>
                                </label>
                            ) : null}

                            {submitError ? (
                                <div className="px-1 text-footnote text-[var(--social-danger)]">{submitError}</div>
                            ) : null}

                            <div className="flex justify-end gap-2">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() => {
                                        setPendingControl(null)
                                        setSubmitError(null)
                                    }}
                                    disabled={isSubmitting}
                                >
                                    {t('button.cancel')}
                                </Button>
                                <Button
                                    type="button"
                                    onClick={() => void submitControl()}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? t('button.sending') : t('team.sendToLead')}
                                </Button>
                            </div>
                        </Card>
                    ) : null}

                    {messages.length > 0 && (
                        <div>
                            <div className="mb-1.5 px-1 text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{t('team.recentMessages')}</div>
                            <div className="flex flex-col gap-1 px-1">
                                {messages.slice(-5).map((msg, idx) => (
                                    <div key={idx} className="text-footnote text-[var(--social-fg-muted)]">
                                        <span className="text-[var(--social-fg)]">{msg.from}</span>{' → '}
                                        <span className="text-[var(--social-fg)]">{msg.to}</span>
                                        {': '}
                                        <span>{msg.summary}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </Card>
            )}
        </div>
    )
}
