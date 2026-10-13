import { useEffect, useMemo, useState } from 'react'
import type { AgentState, TeamControlAction, TeamControlRequest, TeamState } from '@hapi/protocol/types'

function memberStatusDot(status?: string): string {
    if (status === 'active') return 'bg-emerald-500'
    if (status === 'shutdown') return 'bg-red-500'
    return 'bg-gray-400'
}

function taskStatusColor(status?: string): string {
    if (status === 'completed') return 'text-emerald-600'
    if (status === 'in_progress') return 'text-[var(--app-link)]'
    if (status === 'blocked') return 'text-red-500'
    return 'text-[var(--app-hint)]'
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

function actionLabel(action: TeamControlAction): string {
    switch (action) {
        case 'message':
            return 'Message teammate'
        case 'nudge_member':
            return 'Nudge teammate'
        case 'shutdown_member':
            return 'Shut down teammate'
        case 'assign_task':
            return 'Assign task'
        case 'cleanup_team':
            return 'Clean up team'
    }
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

function actionDescription(action: TeamControlAction): string {
    switch (action) {
        case 'message':
            return 'Send a direct instruction to one teammate through the team lead.'
        case 'nudge_member':
            return 'Ask the lead to check on a teammate and redirect them if they are idle or stuck.'
        case 'shutdown_member':
            return 'Have the lead stop one teammate gracefully after they summarize remaining work.'
        case 'assign_task':
            return 'Ask the lead to assign an existing task to a selected teammate.'
        case 'cleanup_team':
            return 'Have the lead stop active teammates if needed, then clean up shared team resources.'
    }
}

export function TeamPanel(props: {
    teamState?: TeamState
    agentState?: AgentState | null
    canControl?: boolean
    onControl?: (request: TeamControlRequest) => Promise<void>
}) {
    const [expanded, setExpanded] = useState(false)
    const [pendingControl, setPendingControl] = useState<PendingControlState | null>(null)
    const [submitError, setSubmitError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const { teamState, agentState } = props
    const members = teamState?.members ?? []
    const tasks = teamState?.tasks ?? []
    const messages = teamState?.messages ?? []
    const runningAgents = agentState?.runningAgents ?? (agentState?.runningAgent ? [agentState.runningAgent] : [])

    const completedTasks = tasks.filter(t => t.status === 'completed').length
    const title = teamState?.teamName ?? 'Running Agents'

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
            setSubmitError('Choose a teammate first.')
            return
        }
        if (actionNeedsTask(pendingControl.action) && !request.taskId) {
            setSubmitError('Choose a task first.')
            return
        }
        if (actionNeedsMessage(pendingControl.action) && !request.message) {
            setSubmitError('Add a message before sending.')
            return
        }
        if (pendingControl.confirmRequired) {
            setSubmitError('Confirm this action before sending it to the lead.')
            return
        }

        setIsSubmitting(true)
        setSubmitError(null)
        try {
            await props.onControl(request)
            setPendingControl(null)
        } catch (error) {
            setSubmitError(error instanceof Error ? error.message : 'Failed to send team control')
        } finally {
            setIsSubmitting(false)
        }
    }

    return (
        <div className="mx-3 mt-3">
            <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className="flex w-full items-center gap-2 rounded-md bg-[var(--app-subtle-bg)] px-3 py-2 text-left text-sm transition-colors hover:bg-[var(--app-subtle-bg-hover)]"
            >
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                <span className="font-medium text-[var(--app-fg)]">
                    {teamState ? `Team: ${title}` : title}
                </span>
                <span className="text-xs text-[var(--app-hint)]">
                    {visibleMembers.length} member{visibleMembers.length !== 1 ? 's' : ''}
                    {activeMembers > 0 ? ` (${activeMembers} active)` : ''}
                    {runningAgents.length > 0 ? ` · ${runningAgents.length} running` : ''}
                    {tasks.length > 0 ? ` · ${completedTasks}/${tasks.length} tasks` : ''}
                </span>
                <svg
                    className={`ml-auto h-3 w-3 shrink-0 text-[var(--app-hint)] transition-transform ${expanded ? 'rotate-180' : ''}`}
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
                <div className="mt-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-3 py-2">
                    {teamState?.description && (
                        <p className="mb-2 text-xs text-[var(--app-hint)]">{teamState.description}</p>
                    )}

                    {props.canControl && teamState && (
                        <div className="mb-2 flex flex-wrap gap-2 border-b border-[var(--app-border)] pb-2">
                            <button
                                type="button"
                                className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                                onClick={() => startControl('cleanup_team')}
                            >
                                Clean up team
                            </button>
                        </div>
                    )}

                    {runningAgents.length > 0 && (
                        <div className="mb-2">
                            <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">Running Now</div>
                            <div className="flex flex-col gap-1">
                                {runningAgents.map((agent, index) => (
                                    <div
                                        key={`${agent.name}:${agent.startedAt ?? index}`}
                                        className="rounded-md bg-[var(--app-subtle-bg)] px-2 py-1 text-xs"
                                    >
                                        <div className="font-medium text-[var(--app-fg)]">{agent.name}</div>
                                        {agent.task ? (
                                            <div className="mt-0.5 text-[var(--app-hint)]">{agent.task}</div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {visibleMembers.length > 0 && (
                        <div className="mb-2">
                            <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">Members</div>
                            <div className="flex flex-col gap-2">
                                {visibleMembers.map((member) => (
                                    <div
                                        key={member.name}
                                        className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--app-subtle-bg)] px-2 py-1.5 text-xs"
                                    >
                                        <span className={`inline-block h-1.5 w-1.5 rounded-full ${memberStatusDot(member.status)}`} />
                                        <span className="text-[var(--app-fg)]">{member.name}</span>
                                        {member.agentType && (
                                            <span className="text-[var(--app-hint)]">({member.agentType})</span>
                                        )}
                                        {props.canControl && teamState ? (
                                            <div className="ml-auto flex flex-wrap gap-1">
                                                <button
                                                    type="button"
                                                    className="rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--app-bg)]"
                                                    onClick={() => startControl('message', { memberName: member.name })}
                                                >
                                                    Message
                                                </button>
                                                <button
                                                    type="button"
                                                    className="rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--app-bg)]"
                                                    onClick={() => startControl('nudge_member', { memberName: member.name })}
                                                >
                                                    Nudge
                                                </button>
                                                <button
                                                    type="button"
                                                    className="rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--app-bg)]"
                                                    onClick={() => startControl('shutdown_member', { memberName: member.name })}
                                                >
                                                    Shutdown
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {tasks.length > 0 && (
                        <div className="mb-2">
                            <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">Tasks</div>
                            <div className="flex flex-col gap-1">
                                {tasks.map((task, idx) => (
                                    <div key={task.id ?? String(idx)} className="flex items-center gap-2 rounded-md bg-[var(--app-subtle-bg)] px-2 py-1">
                                        <div className={`min-w-0 flex-1 text-xs ${taskStatusColor(task.status)}`}>
                                            <span>{taskStatusIcon(task.status)}</span>{' '}
                                            <span>{task.title}</span>
                                            {task.owner && (
                                                <span className="ml-1 text-[var(--app-hint)]">[{task.owner}]</span>
                                            )}
                                        </div>
                                        {props.canControl && teamState ? (
                                            <button
                                                type="button"
                                                className="rounded border border-[var(--app-border)] px-1.5 py-0.5 text-[11px] hover:bg-[var(--app-bg)]"
                                                onClick={() => startControl('assign_task', {
                                                    taskId: task.id,
                                                    memberName: task.owner ?? visibleMembers[0]?.name
                                                })}
                                            >
                                                Assign
                                            </button>
                                        ) : null}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {props.canControl && pendingControl && teamState ? (
                        <div className="mb-2 rounded-md border border-[var(--app-border)] bg-[var(--app-subtle-bg)] p-2">
                            <div className="mb-2 text-xs font-medium text-[var(--app-fg)]">
                                {actionLabel(pendingControl.action)}
                            </div>
                            <div className="mb-2 text-xs text-[var(--app-hint)]">
                                {actionDescription(pendingControl.action)}
                            </div>

                            {actionNeedsMember(pendingControl.action) && (
                                <label className="mb-2 block text-xs text-[var(--app-hint)]">
                                    Teammate
                                    <select
                                        className="mt-1 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-sm text-[var(--app-fg)]"
                                        value={pendingControl.memberName ?? ''}
                                        onChange={(event) => setPendingControl((current) => current
                                            ? { ...current, memberName: event.target.value }
                                            : current)}
                                    >
                                        <option value="" disabled>Select teammate</option>
                                        {visibleMembers.map((member) => (
                                            <option key={member.name} value={member.name}>{member.name}</option>
                                        ))}
                                    </select>
                                </label>
                            )}

                            {actionNeedsTask(pendingControl.action) && (
                                <label className="mb-2 block text-xs text-[var(--app-hint)]">
                                    Task
                                    <select
                                        className="mt-1 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-sm text-[var(--app-fg)]"
                                        value={pendingControl.taskId ?? ''}
                                        onChange={(event) => setPendingControl((current) => current
                                            ? { ...current, taskId: event.target.value }
                                            : current)}
                                    >
                                        <option value="" disabled>Select task</option>
                                        {tasks.map((task) => (
                                            <option key={task.id} value={task.id}>{task.title}</option>
                                        ))}
                                    </select>
                                </label>
                            )}

                            {(actionNeedsMessage(pendingControl.action) || pendingControl.action === 'assign_task') && (
                                <label className="mb-2 block text-xs text-[var(--app-hint)]">
                                    {pendingControl.action === 'assign_task' ? 'Additional guidance (optional)' : 'Message'}
                                    <textarea
                                        className="mt-1 min-h-20 w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-sm text-[var(--app-fg)]"
                                        value={pendingControl.message}
                                        onChange={(event) => setPendingControl((current) => current
                                            ? { ...current, message: event.target.value }
                                            : current)}
                                        placeholder={pendingControl.action === 'message'
                                            ? 'Tell the teammate what you need.'
                                            : pendingControl.action === 'nudge_member'
                                                ? 'Describe how to redirect or unblock them.'
                                                : 'Optional extra context for the assignee.'}
                                    />
                                </label>
                            )}

                            {pendingControl.confirmRequired ? (
                                <label className="mb-2 flex items-start gap-2 rounded-md border border-amber-300/50 bg-amber-500/10 px-2 py-1.5 text-xs text-[var(--app-fg)]">
                                    <input
                                        type="checkbox"
                                        checked={!pendingControl.confirmRequired}
                                        onChange={(event) => setPendingControl((current) => current
                                            ? { ...current, confirmRequired: !event.target.checked }
                                            : current)}
                                    />
                                    <span>
                                        {pendingControl.action === 'cleanup_team'
                                            ? 'I understand this asks the lead to stop active teammates if needed and remove team resources.'
                                            : 'I understand this asks the lead to stop the selected teammate gracefully.'}
                                    </span>
                                </label>
                            ) : null}

                            {submitError ? (
                                <div className="mb-2 text-xs text-red-500">{submitError}</div>
                            ) : null}

                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    className="rounded-md bg-[var(--app-button)] px-2 py-1 text-xs font-medium text-[var(--app-button-text)] disabled:opacity-60"
                                    onClick={() => void submitControl()}
                                    disabled={isSubmitting}
                                >
                                    {isSubmitting ? 'Sending…' : 'Send to lead'}
                                </button>
                                <button
                                    type="button"
                                    className="rounded-md border border-[var(--app-border)] px-2 py-1 text-xs text-[var(--app-fg)]"
                                    onClick={() => {
                                        setPendingControl(null)
                                        setSubmitError(null)
                                    }}
                                    disabled={isSubmitting}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    ) : null}

                    {messages.length > 0 && (
                        <div>
                            <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">Recent Messages</div>
                            <div className="flex flex-col gap-0.5">
                                {messages.slice(-5).map((msg, idx) => (
                                    <div key={idx} className="text-xs text-[var(--app-hint)]">
                                        <span className="text-[var(--app-fg)]">{msg.from}</span>{' → '}
                                        <span className="text-[var(--app-fg)]">{msg.to}</span>
                                        {': '}
                                        <span>{msg.summary}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
