import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type {
    ScheduleAgent,
    ScheduledRun,
    ScheduledRunFailure,
    ScheduledRunReport,
    ScheduledRunStatus,
    ScheduledRunTrigger,
    ScheduledTask,
    ScheduleSpec
} from '@hapi/protocol/schedules'

import { safeJsonParse } from './json'

export type StoredSchedule = Omit<ScheduledTask, 'lastRun'>
export type StoredScheduledRun = ScheduledRun & { namespace: string; sawBusy: boolean }

type ScheduleRow = {
    id: string
    namespace: string
    name: string
    prompt: string
    prompt_file: string | null
    machine_id: string
    directory: string
    agent: string
    model: string | null
    think_effort: string | null
    permission_mode: string | null
    account_id: string | null
    worktree: number
    max_minutes: number
    employee_id: string | null
    session_target: string
    spec: string
    timezone: string
    enabled: number
    next_run_at: number | null
    created_at: number
    updated_at: number
}

type RunRow = {
    id: string
    namespace: string
    schedule_id: string
    trigger: string
    status: string
    scheduled_for: number | null
    started_at: number
    finished_at: number | null
    session_id: string | null
    failure: string | null
    reported: string | null
    summary: string | null
    links: string
    account_id: string | null
    attempts: number
    saw_busy: number
}

function toSchedule(row: ScheduleRow): StoredSchedule {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        prompt: row.prompt,
        promptFile: row.prompt_file,
        machineId: row.machine_id,
        directory: row.directory,
        agent: row.agent as ScheduleAgent,
        model: row.model,
        thinkEffort: row.think_effort,
        permissionMode: row.permission_mode,
        accountId: row.account_id,
        worktree: row.worktree === 1,
        maxMinutes: row.max_minutes,
        employeeId: row.employee_id,
        sessionTarget: (row.session_target || 'isolated') as StoredSchedule['sessionTarget'],
        spec: (safeJsonParse(row.spec) ?? { kind: 'manual' }) as ScheduleSpec,
        timezone: row.timezone,
        enabled: row.enabled === 1,
        nextRunAt: row.next_run_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toRun(row: RunRow): StoredScheduledRun {
    const links = safeJsonParse(row.links)
    return {
        id: row.id,
        namespace: row.namespace,
        scheduleId: row.schedule_id,
        trigger: row.trigger as ScheduledRunTrigger,
        status: row.status as ScheduledRunStatus,
        scheduledFor: row.scheduled_for,
        startedAt: row.started_at,
        finishedAt: row.finished_at,
        sessionId: row.session_id,
        failure: row.failure as ScheduledRunFailure | null,
        reported: row.reported as ScheduledRunReport | null,
        summary: row.summary,
        links: Array.isArray(links) ? links.filter((link): link is string => typeof link === 'string') : [],
        accountId: row.account_id,
        attempts: row.attempts,
        sawBusy: row.saw_busy === 1
    }
}

export type ScheduleWrite = Omit<StoredSchedule, 'id' | 'namespace' | 'createdAt' | 'updatedAt'>

export type RunPatch = Partial<Pick<StoredScheduledRun,
    'status' | 'sessionId' | 'failure' | 'reported' | 'summary' | 'links' | 'accountId' | 'attempts' | 'finishedAt' | 'sawBusy'>>

const RUN_COLUMNS: Record<keyof RunPatch, string> = {
    status: 'status',
    sessionId: 'session_id',
    failure: 'failure',
    reported: 'reported',
    summary: 'summary',
    links: 'links',
    accountId: 'account_id',
    attempts: 'attempts',
    finishedAt: 'finished_at',
    sawBusy: 'saw_busy'
}

/** Scheduled tasks and their runs. Deleting a task deletes its runs; the sessions the runs started stay. */
export class ScheduleStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    create(namespace: string, input: ScheduleWrite): StoredSchedule {
        const now = Date.now()
        const id = randomUUID()
        this.db.prepare(`
            INSERT INTO scheduled_tasks (id, namespace, name, prompt, prompt_file, machine_id, directory, agent, model,
                think_effort, permission_mode, account_id, worktree, max_minutes, employee_id, session_target, spec, timezone, enabled, next_run_at, created_at, updated_at)
            VALUES (@id, @namespace, @name, @prompt, @prompt_file, @machine_id, @directory, @agent, @model,
                @think_effort, @permission_mode, @account_id, @worktree, @max_minutes, @employee_id, @session_target, @spec, @timezone, @enabled, @next_run_at, @created_at, @updated_at)
        `).run({ id, namespace, ...this.columns(input), created_at: now, updated_at: now })
        return this.get(namespace, id)!
    }

    update(namespace: string, id: string, input: ScheduleWrite): StoredSchedule | null {
        this.db.prepare(`
            UPDATE scheduled_tasks SET name = @name, prompt = @prompt, prompt_file = @prompt_file, machine_id = @machine_id,
                directory = @directory, agent = @agent, model = @model, think_effort = @think_effort,
                permission_mode = @permission_mode, account_id = @account_id, worktree = @worktree, max_minutes = @max_minutes,
                employee_id = @employee_id, session_target = @session_target, spec = @spec,
                timezone = @timezone, enabled = @enabled, next_run_at = @next_run_at, updated_at = @updated_at
            WHERE namespace = @namespace AND id = @id
        `).run({ id, namespace, ...this.columns(input), updated_at: Date.now() })
        return this.get(namespace, id)
    }

    /** Moves the clock on without touching updated_at, which tracks the user's edits. */
    setNextRun(id: string, nextRunAt: number | null, enabled: boolean): void {
        this.db.prepare('UPDATE scheduled_tasks SET next_run_at = ?, enabled = ? WHERE id = ?').run(nextRunAt, enabled ? 1 : 0, id)
    }

    get(namespace: string, id: string): StoredSchedule | null {
        const row = this.db.prepare('SELECT * FROM scheduled_tasks WHERE namespace = ? AND id = ?').get(namespace, id) as ScheduleRow | null
        return row ? toSchedule(row) : null
    }

    list(namespace: string): StoredSchedule[] {
        const rows = this.db.prepare('SELECT * FROM scheduled_tasks WHERE namespace = ? ORDER BY created_at DESC').all(namespace) as ScheduleRow[]
        return rows.map(toSchedule)
    }

    /** Enabled tasks in every namespace whose time has come. */
    due(now: number): StoredSchedule[] {
        const rows = this.db.prepare(
            'SELECT * FROM scheduled_tasks WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ? ORDER BY next_run_at ASC'
        ).all(now) as ScheduleRow[]
        return rows.map(toSchedule)
    }

    delete(namespace: string, id: string): boolean {
        return this.db.prepare('DELETE FROM scheduled_tasks WHERE namespace = ? AND id = ?').run(namespace, id).changes > 0
    }

    /** A deleted employee's schedules must not run as nobody: they disable and shed the dead employee_id. */
    detachEmployee(namespace: string, employeeId: string): number {
        return this.db.prepare(
            'UPDATE scheduled_tasks SET employee_id = NULL, enabled = 0, updated_at = ? WHERE namespace = ? AND employee_id = ?'
        ).run(Date.now(), namespace, employeeId).changes
    }

    /** Null when the task already has a run for this planned time. */
    addRun(input: {
        namespace: string
        scheduleId: string
        trigger: ScheduledRunTrigger
        status: ScheduledRunStatus
        scheduledFor: number | null
        failure?: ScheduledRunFailure | null
        summary?: string | null
        at?: number
    }): StoredScheduledRun | null {
        const now = input.at ?? Date.now()
        const row: RunRow = {
            id: randomUUID(),
            namespace: input.namespace,
            schedule_id: input.scheduleId,
            trigger: input.trigger,
            status: input.status,
            scheduled_for: input.scheduledFor,
            started_at: now,
            finished_at: input.status === 'skipped' || input.status === 'failed' ? now : null,
            session_id: null,
            failure: input.failure ?? null,
            reported: null,
            summary: input.summary ?? null,
            links: '[]',
            account_id: null,
            attempts: 0,
            saw_busy: 0
        }
        const result = this.db.prepare(`
            INSERT OR IGNORE INTO scheduled_task_runs (id, namespace, schedule_id, trigger, status, scheduled_for, started_at,
                finished_at, session_id, failure, reported, summary, links, account_id, attempts, saw_busy)
            VALUES (@id, @namespace, @schedule_id, @trigger, @status, @scheduled_for, @started_at, @finished_at,
                @session_id, @failure, @reported, @summary, @links, @account_id, @attempts, @saw_busy)
        `).run(row)
        return result.changes > 0 ? toRun(row) : null
    }

    updateRun(id: string, patch: RunPatch): void {
        const sets: string[] = []
        const values: Record<string, string | number | null> = { id }
        for (const [key, value] of Object.entries(patch) as Array<[keyof RunPatch, RunPatch[keyof RunPatch]]>) {
            if (value === undefined) continue
            const column = RUN_COLUMNS[key]
            sets.push(`${column} = @${column}`)
            values[column] = key === 'links' ? JSON.stringify(value) : typeof value === 'boolean' ? (value ? 1 : 0) : value as string | number | null
        }
        if (sets.length === 0) return
        this.db.prepare(`UPDATE scheduled_task_runs SET ${sets.join(', ')} WHERE id = @id`).run(values)
    }

    getRun(id: string): StoredScheduledRun | null {
        const row = this.db.prepare('SELECT * FROM scheduled_task_runs WHERE id = ?').get(id) as RunRow | null
        return row ? toRun(row) : null
    }

    /** The newest run a session belongs to. */
    latestRunForSession(sessionId: string): StoredScheduledRun | null {
        const row = this.db.prepare(
            'SELECT * FROM scheduled_task_runs WHERE session_id = ? ORDER BY started_at DESC LIMIT 1'
        ).get(sessionId) as RunRow | null
        return row ? toRun(row) : null
    }

    runs(namespace: string, scheduleId: string, limit: number): StoredScheduledRun[] {
        const rows = this.db.prepare(`
            SELECT * FROM scheduled_task_runs WHERE namespace = ? AND schedule_id = ?
            ORDER BY started_at DESC, rowid DESC LIMIT ?
        `).all(namespace, scheduleId, limit) as RunRow[]
        return rows.map(toRun)
    }

    /** The newest run that is not a skip: the one whose session matters. */
    lastRealRun(scheduleId: string): StoredScheduledRun | null {
        const row = this.db.prepare(`
            SELECT * FROM scheduled_task_runs WHERE schedule_id = ? AND status != 'skipped'
            ORDER BY started_at DESC, rowid DESC LIMIT 1
        `).get(scheduleId) as RunRow | null
        return row ? toRun(row) : null
    }

    lastRun(scheduleId: string): StoredScheduledRun | null {
        const row = this.db.prepare(
            'SELECT * FROM scheduled_task_runs WHERE schedule_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1'
        ).get(scheduleId) as RunRow | null
        return row ? toRun(row) : null
    }

    /** The runs of an employee's scheduled tasks inside a period, for its metrics. */
    runsForEmployee(namespace: string, employeeId: string, since: number): StoredScheduledRun[] {
        const rows = this.db.prepare(`
            SELECT r.* FROM scheduled_task_runs r
            JOIN scheduled_tasks t ON t.id = r.schedule_id
            WHERE r.namespace = ? AND t.employee_id = ? AND r.started_at >= ?
            ORDER BY r.started_at
        `).all(namespace, employeeId, since) as RunRow[]
        return rows.map(toRun)
    }

    /** Runs whose session is still working or waiting for the user. */
    openRuns(): StoredScheduledRun[] {
        const rows = this.db.prepare(
            "SELECT * FROM scheduled_task_runs WHERE status IN ('running', 'waiting') ORDER BY started_at ASC"
        ).all() as RunRow[]
        return rows.map(toRun)
    }

    private columns(input: ScheduleWrite) {
        return {
            name: input.name,
            prompt: input.prompt,
            prompt_file: input.promptFile,
            machine_id: input.machineId,
            directory: input.directory,
            agent: input.agent,
            model: input.model,
            think_effort: input.thinkEffort,
            permission_mode: input.permissionMode,
            account_id: input.accountId,
            worktree: input.worktree ? 1 : 0,
            max_minutes: input.maxMinutes,
            employee_id: input.employeeId,
            session_target: input.sessionTarget,
            spec: JSON.stringify(input.spec),
            timezone: input.timezone,
            enabled: input.enabled ? 1 : 0,
            next_run_at: input.nextRunAt
        }
    }
}
