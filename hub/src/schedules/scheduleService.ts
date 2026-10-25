import {
    DEFAULT_MAX_MINUTES,
    isValidTimezone,
    nextRunTime,
    validateSpec,
    type ScheduledRun,
    type ScheduledRunDone,
    type ScheduledRunFailure,
    type ScheduledRunTrigger,
    type ScheduledTask,
    type ScheduledTaskInput,
    type ScheduledTaskPatch
} from '@hapi/protocol/schedules'

import type { Store } from '../store'
import type { StoredSchedule, StoredScheduledRun } from '../store/scheduleStore'

/** A run that was missed by more than this is dropped; a newer missed time inside it still runs once. */
export const CATCH_UP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
/** Later than this past its time, a run counts as a catch-up and its prompt says so. */
const LATE_MS = 5 * 60 * 1000
/**
 * Idle this long after it last worked, without a report, a run may be stuck: the user gets one reminder, the run is
 * not failed. A session that waits on a background command looks idle to the hub (a daily report run sat idle for
 * 10 minutes while its data script ran), so only the session's end or the time limit fails a run.
 */
const IDLE_REMIND_MS = 20 * 60 * 1000
/** A session that never turned busy did not start working, such as one whose account login failed on its first turn. */
const NEVER_BUSY_MS = 5 * 60 * 1000
export const SCHEDULE_TICK_MS = 30_000
/** How the host's start note begins when the run had to move past an account. */
export const ACCOUNT_NOTE = '换过账号'

export class ScheduleError extends Error {
    constructor(message: string, readonly status: 400 | 404 | 409 = 400) {
        super(message)
    }
}

export type ScheduleSessionState = { active: boolean; thinking: boolean; pendingRequests: number }

export type ScheduleSpawnInput = {
    namespace: string
    machineId: string
    directory: string
    agent: ScheduledTask['agent']
    model: string | null
    thinkEffort: string | null
    permissionMode: string | null
    accountId: string | null
    worktree: boolean
    text: string
    name: string
    meta: Record<string, unknown>
}

export type ScheduleSpawnResult =
    | { sessionId: string; accountId: string | null; attempts: number; note: string | null }
    | { error: string; attempts: number }

/** everywhere: every channel (a failure, or a failure that was corrected); otherwise a push only. */
export type ScheduleAlert = { runId: string; title: string; body: string; url: string; everywhere: boolean }

export type ScheduleHost = {
    /** Starts the session; on a login or quota failure it tries the next account itself. */
    spawn: (input: ScheduleSpawnInput) => Promise<ScheduleSpawnResult>
    session: (namespace: string, sessionId: string) => ScheduleSessionState | null
    /** When the session last showed work (a message or a busy beat), for the idle check. */
    lastActivity: (sessionId: string) => number | null
    machineOnline: (namespace: string, machineId: string) => boolean
    /** Stops a session; its history stays and it can be resumed. */
    archive: (sessionId: string) => Promise<void>
    changed: (namespace: string, scheduleId: string) => void
    /** A failure goes out on every channel; a success only as a push. */
    alert: (namespace: string, alert: ScheduleAlert) => Promise<void>
    now?: () => number
}

const FAILURE_TEXT: Record<ScheduledRunFailure, string> = {
    no_start: '没能启动',
    timeout: '超时',
    no_result: '没报结果',
    self_reported: '任务报告失败'
}

function formatTime(at: number, timezone: string): string {
    return new Intl.DateTimeFormat('zh-CN', {
        timeZone: timezone, hourCycle: 'h23', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).format(new Date(at))
}

/**
 * Runs scheduled tasks. Each run starts a new session on the task's machine and sends the task's prompt.
 * - Times are kept in the database (next_run_at, and one run row per planned time), so a hub restart loses nothing
 *   and never starts the same time twice.
 * - A time missed while the hub or the machine was down runs once, late (a catch-up), if it is less than 7 days old.
 * - A run never starts while the task's previous run is still open; that time is recorded as skipped.
 * - A run ends when its session calls scheduled_run_done. A session that stops without it, or runs past the task's
 *   limit, fails the run. Every failure raises an alert.
 * - When a new run starts, the previous run's session is stopped if it is idle, so a task keeps one live session.
 */
export class ScheduleService {
    private readonly firing = new Set<string>()
    /** Runs the user was already told may be stuck. */
    private readonly reminded = new Set<string>()

    constructor(private readonly store: Store, private readonly host: ScheduleHost) {}

    private now(): number {
        return this.host.now?.() ?? Date.now()
    }

    list(namespace: string): ScheduledTask[] {
        return this.store.schedules.list(namespace).map((schedule) => this.view(schedule))
    }

    get(namespace: string, id: string): { schedule: ScheduledTask; runs: ScheduledRun[] } {
        const schedule = this.require(namespace, id)
        return { schedule: this.view(schedule), runs: this.store.schedules.runs(namespace, id, 50).map(publicRun) }
    }

    create(namespace: string, input: ScheduledTaskInput): ScheduledTask {
        this.check(input.spec, input.timezone)
        const enabled = input.enabled ?? true
        const created = this.store.schedules.create(namespace, {
            name: input.name,
            prompt: input.prompt,
            promptFile: input.promptFile ?? null,
            machineId: input.machineId,
            directory: input.directory,
            agent: input.agent,
            model: input.model ?? null,
            thinkEffort: input.thinkEffort ?? null,
            permissionMode: input.permissionMode ?? null,
            accountId: input.accountId ?? null,
            worktree: input.worktree ?? false,
            maxMinutes: input.maxMinutes ?? DEFAULT_MAX_MINUTES,
            spec: input.spec,
            timezone: input.timezone,
            enabled,
            nextRunAt: enabled ? nextRunTime(input.spec, input.timezone, this.now()) : null
        })
        this.host.changed(namespace, created.id)
        return this.view(created)
    }

    update(namespace: string, id: string, patch: ScheduledTaskPatch): ScheduledTask {
        const current = this.require(namespace, id)
        const pick = <K extends keyof ScheduledTaskPatch & keyof StoredSchedule>(key: K) =>
            (patch[key] !== undefined ? patch[key] : current[key]) as StoredSchedule[K]
        const next = {
            name: pick('name'),
            prompt: pick('prompt'),
            promptFile: pick('promptFile'),
            machineId: pick('machineId'),
            directory: pick('directory'),
            agent: pick('agent'),
            model: pick('model'),
            thinkEffort: pick('thinkEffort'),
            permissionMode: pick('permissionMode'),
            accountId: pick('accountId'),
            worktree: pick('worktree'),
            maxMinutes: pick('maxMinutes'),
            spec: pick('spec'),
            timezone: pick('timezone'),
            enabled: pick('enabled')
        }
        if (!next.prompt && !next.promptFile) throw new ScheduleError('Give a prompt or a prompt file')
        this.check(next.spec, next.timezone)
        // A new clock or a resume counts from now: a paused task does not catch up on the time it was paused.
        const clockChanged = patch.spec !== undefined || patch.timezone !== undefined || (next.enabled && !current.enabled)
        const nextRunAt = !next.enabled ? null : clockChanged ? nextRunTime(next.spec, next.timezone, this.now()) : current.nextRunAt
        const updated = this.store.schedules.update(namespace, id, { ...next, nextRunAt })
        if (!updated) throw new ScheduleError('Scheduled task not found', 404)
        this.host.changed(namespace, id)
        return this.view(updated)
    }

    delete(namespace: string, id: string): void {
        if (!this.store.schedules.delete(namespace, id)) throw new ScheduleError('Scheduled task not found', 404)
        this.host.changed(namespace, id)
    }

    /** Run now, outside the schedule. The schedule's own next time stays. */
    async runNow(namespace: string, id: string): Promise<ScheduledRun> {
        const schedule = this.require(namespace, id)
        if (this.firing.has(schedule.id) || this.openRun(schedule.id)) throw new ScheduleError('The previous run is still open', 409)
        const run = await this.fire(schedule, 'manual', null)
        if (!run) throw new ScheduleError('The run could not be recorded', 409)
        return publicRun(run)
    }

    /** The session's own report, through the scheduled_run_done tool. */
    reportDone(namespace: string, input: ScheduledRunDone): ScheduledRun {
        // A run the watchdog failed as no_result is corrected by a late report.
        const latest = this.store.schedules.latestRunForSession(input.sessionId)
        const run = latest && (latest.status === 'running' || latest.status === 'waiting' || latest.failure === 'no_result') ? latest : null
        if (!run || run.namespace !== namespace) throw new ScheduleError('This session is not an open scheduled run', 404)
        const failed = input.status === 'failed'
        const corrected = run.status === 'failed'
        // The start's account note stays; a watchdog verdict that the report corrects does not.
        const startNote = run.summary?.startsWith(ACCOUNT_NOTE) ? run.summary : null
        this.store.schedules.updateRun(run.id, {
            status: failed ? 'failed' : 'done',
            reported: input.status,
            failure: failed ? 'self_reported' : null,
            summary: startNote ? `${input.summary}\n${startNote}` : input.summary,
            links: input.links ?? [],
            finishedAt: this.now()
        })
        const done = this.store.schedules.getRun(run.id) ?? run
        this.announce(done, corrected)
        return publicRun(done)
    }

    /** One pass of the clock: start what is due, then check the open runs. */
    async tick(): Promise<void> {
        const now = this.now()
        for (const schedule of this.store.schedules.due(now)) {
            if (this.firing.has(schedule.id)) continue
            await this.handleDue(schedule, now).catch((error: unknown) => console.warn('[Schedules] run failed to start', error))
        }
        await this.observe(this.now())
    }

    private async handleDue(schedule: StoredSchedule, now: number): Promise<void> {
        const plannedAt = schedule.nextRunAt ?? now
        const following = schedule.spec.kind === 'once' ? null : nextRunTime(schedule.spec, schedule.timezone, now)
        const advance = () => this.store.schedules.setNextRun(schedule.id, following, following !== null && schedule.enabled)

        // Many missed times run once, for the newest of them; one older than the window does not run at all.
        const recent = now - plannedAt > LATE_MS
            ? this.latestTimeSince(schedule, Math.max(plannedAt - 1, now - CATCH_UP_WINDOW_MS), now)
            : plannedAt
        if (recent === null) {
            advance()
            this.skip(schedule, plannedAt, '错过超过 7 天，不再补跑')
            return
        }
        const scheduledFor = recent
        // The machine is down: keep the time due, so the run starts late when the machine comes back.
        if (!this.host.machineOnline(schedule.namespace, schedule.machineId)) return

        // Move the clock before the slow spawn, so a second tick never starts the same time twice.
        advance()
        if (this.openRun(schedule.id)) {
            this.skip(schedule, scheduledFor, '上一次运行还没结束')
            return
        }
        const trigger: ScheduledRunTrigger = now - scheduledFor > LATE_MS ? 'catchup' : 'schedule'
        await this.fire(schedule, trigger, scheduledFor)
    }

    private skip(schedule: StoredSchedule, scheduledFor: number, summary: string): void {
        this.store.schedules.addRun({
            namespace: schedule.namespace, scheduleId: schedule.id, trigger: 'schedule', status: 'skipped', scheduledFor, summary, at: this.now()
        })
        this.host.changed(schedule.namespace, schedule.id)
    }

    /** The newest planned time in (from, to], walking the schedule forward. */
    private latestTimeSince(schedule: StoredSchedule, from: number, to: number): number | null {
        let latest: number | null = null
        let at = from
        for (let i = 0; i < 20_000; i++) {
            const next = nextRunTime(schedule.spec, schedule.timezone, at)
            if (next === null || next > to) break
            latest = next
            at = next
        }
        return latest
    }

    private composePrompt(schedule: StoredSchedule, trigger: ScheduledRunTrigger, scheduledFor: number | null): string {
        const now = this.now()
        const parts: string[] = []
        if (trigger === 'catchup' && scheduledFor !== null) {
            parts.push(`（补跑：原定 ${formatTime(scheduledFor, schedule.timezone)}，现在 ${formatTime(now, schedule.timezone)}）`)
        }
        if (schedule.promptFile) {
            parts.push(`读取并执行这个文件里的任务说明（每次运行都重新读，不要凭记忆）：${schedule.promptFile}`)
        }
        if (schedule.prompt) parts.push(schedule.prompt)
        const planned = scheduledFor !== null ? `计划 ${formatTime(scheduledFor, schedule.timezone)}，` : ''
        parts.push([
            '---',
            `这是 HAQI 定时任务「${schedule.name}」的一次无人值守运行（${planned}开始 ${formatTime(now, schedule.timezone)}，时区 ${schedule.timezone}）。`,
            '没有人在看，不要提问等回答。',
            '结束前必须调用一次 scheduled_run_done 工具：status 填 success、failed 或 skipped（没事可做），summary 写一句结论，links 放产出的链接。',
            `不调用就算失败。超过 ${schedule.maxMinutes} 分钟也算失败，会话会被停掉。`
        ].join('\n'))
        return parts.join('\n\n')
    }

    private async fire(schedule: StoredSchedule, trigger: ScheduledRunTrigger, scheduledFor: number | null): Promise<StoredScheduledRun | null> {
        this.firing.add(schedule.id)
        try {
            const previous = this.store.schedules.lastRealRun(schedule.id)
            // The row comes first: a planned time that already has a row is never started again.
            const run = this.store.schedules.addRun({
                namespace: schedule.namespace, scheduleId: schedule.id, trigger, status: 'running', scheduledFor, at: this.now()
            })
            if (!run) return null
            this.host.changed(schedule.namespace, schedule.id)
            if (!this.host.machineOnline(schedule.namespace, schedule.machineId)) {
                this.fail(run, 'no_start', '机器不在线', 0)
                return this.store.schedules.getRun(run.id)
            }
            const result = await this.host.spawn({
                namespace: schedule.namespace,
                machineId: schedule.machineId,
                directory: schedule.directory,
                agent: schedule.agent,
                model: schedule.model,
                thinkEffort: schedule.thinkEffort,
                permissionMode: schedule.permissionMode,
                accountId: schedule.accountId,
                worktree: schedule.worktree,
                text: this.composePrompt(schedule, trigger, scheduledFor),
                name: `⏰ ${schedule.name} · ${formatTime(this.now(), schedule.timezone)}`,
                meta: { scheduledTask: { scheduleId: schedule.id, runId: run.id } }
            })
            if ('error' in result) {
                this.fail(run, 'no_start', result.error, result.attempts)
            } else {
                this.store.schedules.updateRun(run.id, {
                    sessionId: result.sessionId, accountId: result.accountId, attempts: result.attempts,
                    ...(result.note ? { summary: result.note } : {})
                })
                this.host.changed(schedule.namespace, schedule.id)
                await this.retire(schedule.namespace, previous)
            }
            return this.store.schedules.getRun(run.id)
        } finally {
            this.firing.delete(schedule.id)
        }
    }

    /** Stops the previous run's session when nobody is using it. */
    private async retire(namespace: string, previous: StoredScheduledRun | null): Promise<void> {
        if (!previous?.sessionId) return
        const state = this.host.session(namespace, previous.sessionId)
        if (!state?.active || state.thinking || state.pendingRequests > 0) return
        await this.host.archive(previous.sessionId).catch(() => {})
    }

    /**
     * The watchdog. An open run fails when it passes its time limit (and its session is stopped), or when its session
     * is gone, has ended, or sits idle after working without having reported.
     */
    private async observe(now: number): Promise<void> {
        for (const run of this.store.schedules.openRuns()) {
            if (this.firing.has(run.scheduleId) || !run.sessionId) continue
            const schedule = this.store.schedules.get(run.namespace, run.scheduleId)
            const limitMs = (schedule?.maxMinutes ?? DEFAULT_MAX_MINUTES) * 60_000
            if (now - run.startedAt > limitMs) {
                this.fail(run, 'timeout', `超过 ${Math.round(limitMs / 60_000)} 分钟还没结束，已停掉会话`, run.attempts)
                await this.host.archive(run.sessionId).catch(() => {})
                continue
            }
            const state = this.host.session(run.namespace, run.sessionId)
            if (!state) {
                this.fail(run, 'no_result', '会话不见了，没报结果', run.attempts)
                continue
            }
            const sawBusy = run.sawBusy || state.thinking
            if (sawBusy && !run.sawBusy) this.store.schedules.updateRun(run.id, { sawBusy: true })
            if (!state.active) {
                this.fail(run, 'no_result', '会话结束了，没报结果', run.attempts)
                continue
            }
            const waiting = state.pendingRequests > 0
            if (waiting !== (run.status === 'waiting')) {
                this.store.schedules.updateRun(run.id, { status: waiting ? 'waiting' : 'running' })
                this.host.changed(run.namespace, run.scheduleId)
            }
            // A permission prompt waits for the user; the time limit still applies.
            if (waiting || state.thinking) continue
            if (!sawBusy) {
                if (now - run.startedAt > NEVER_BUSY_MS) this.fail(run, 'no_start', '会话 5 分钟内没开始干活（常见原因：账号登录失效）', run.attempts)
                continue
            }
            const idleSince = this.host.lastActivity(run.sessionId) ?? run.startedAt
            if (now - idleSince > IDLE_REMIND_MS && !this.reminded.has(run.id)) {
                this.reminded.add(run.id)
                const name = schedule?.name ?? '定时任务'
                void this.host.alert(run.namespace, {
                    runId: run.id,
                    title: `定时任务可能卡住：${name}`,
                    body: `会话已空闲 ${Math.round((now - idleSince) / 60_000)} 分钟，还没报结果。也可能在等后台命令；超过 ${Math.round(limitMs / 60_000)} 分钟会判超时。`,
                    url: `/sessions/${run.sessionId}`,
                    everywhere: false
                }).catch(() => {})
            }
        }
    }

    private fail(run: StoredScheduledRun, failure: ScheduledRunFailure, summary: string, attempts: number): void {
        this.store.schedules.updateRun(run.id, { status: 'failed', failure, summary, attempts, finishedAt: this.now() })
        this.announce(this.store.schedules.getRun(run.id) ?? run)
    }

    /** Tells the page, and the user: a failure, or a corrected one, on every channel; a success as a push. */
    private announce(run: StoredScheduledRun, corrected = false): void {
        this.host.changed(run.namespace, run.scheduleId)
        const schedule = this.store.schedules.get(run.namespace, run.scheduleId)
        if (!schedule) return
        const failed = run.status === 'failed'
        const url = run.sessionId ? `/sessions/${run.sessionId}` : `/scheduled/${schedule.id}`
        // The planned time tells one run from another; a manual run has none, so its start stands in.
        const which = `${schedule.name} ${formatTime(run.scheduledFor ?? run.startedAt, schedule.timezone)}${run.trigger === 'manual' ? '（手动）' : ''}`
        const title = failed
            ? `定时任务失败（${FAILURE_TEXT[run.failure ?? 'no_result']}）：${which}`
            : corrected ? `定时任务已恢复（前面的失败报警是误判）：${which}`
            : run.reported === 'skipped' ? `定时任务跳过：${which}` : `定时任务完成：${which}`
        const body = [run.summary ?? '', ...run.links].filter(Boolean).join('\n')
        void this.host.alert(run.namespace, { runId: run.id, title, body: body || '点开看这次运行做了什么', url, everywhere: failed || corrected }).catch(() => {})
    }

    /** The previous run while it is open, or while its session still works even though its record is closed. */
    private openRun(scheduleId: string): StoredScheduledRun | null {
        const last = this.store.schedules.lastRealRun(scheduleId)
        if (!last) return null
        if (last.status === 'running' || last.status === 'waiting') return last
        const state = last.sessionId ? this.host.session(last.namespace, last.sessionId) : null
        return state?.active && (state.thinking || state.pendingRequests > 0) ? last : null
    }

    private check(spec: ScheduledTaskInput['spec'], timezone: string): void {
        if (!isValidTimezone(timezone)) throw new ScheduleError(`Unknown time zone: ${timezone}`)
        try {
            validateSpec(spec)
        } catch (error) {
            throw new ScheduleError(error instanceof Error ? error.message : String(error))
        }
    }

    private require(namespace: string, id: string): StoredSchedule {
        const schedule = this.store.schedules.get(namespace, id)
        if (!schedule) throw new ScheduleError('Scheduled task not found', 404)
        return schedule
    }

    private view(schedule: StoredSchedule): ScheduledTask {
        const last = this.store.schedules.lastRun(schedule.id)
        return { ...schedule, lastRun: last ? publicRun(last) : null }
    }
}

function publicRun(run: StoredScheduledRun): ScheduledRun {
    const { namespace: _namespace, sawBusy: _sawBusy, ...rest } = run
    return rest
}
