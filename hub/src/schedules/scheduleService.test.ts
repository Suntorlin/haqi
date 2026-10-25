import { describe, expect, it } from 'bun:test'

import { describeSpec, nextRunTime, parseCron, specToCron, upcomingRunTimes } from '@hapi/protocol/schedules'

import { Store } from '../store'
import { CATCH_UP_WINDOW_MS, ScheduleService, type ScheduleAlert, type ScheduleHost, type ScheduleSessionState, type ScheduleSpawnInput } from './scheduleService'

const TOKYO = 'Asia/Tokyo'
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

function tokyo(iso: string): number {
    return Date.parse(`${iso}+09:00`)
}

describe('schedule clock', () => {
    it('finds the next wall-clock time in the time zone', () => {
        const spec = { kind: 'cron' as const, expr: '5 9 * * *' }
        expect(nextRunTime(spec, TOKYO, tokyo('2026-10-25T08:00:00'))).toBe(tokyo('2026-10-25T09:05:00'))
        expect(nextRunTime(spec, TOKYO, tokyo('2026-10-25T09:05:00'))).toBe(tokyo('2026-10-26T09:05:00'))
    })

    it('skips the weekend for weekdays and keeps weekly on its day', () => {
        // 2026-10-24 is a Saturday.
        expect(nextRunTime({ kind: 'weekdays', time: '09:00' }, TOKYO, tokyo('2026-10-24T10:00:00'))).toBe(tokyo('2026-10-26T09:00:00'))
        expect(nextRunTime({ kind: 'weekly', weekday: 1, time: '09:00' }, TOKYO, tokyo('2026-10-27T10:00:00'))).toBe(tokyo('2026-11-02T09:00:00'))
    })

    it('follows daylight saving time', () => {
        // New York moves to winter time on 2026-11-01: 09:00 local is 14:00 UTC after it, 13:00 UTC before.
        const spec = { kind: 'daily' as const, time: '09:00' }
        expect(nextRunTime(spec, 'America/New_York', Date.parse('2026-10-31T12:00:00Z'))).toBe(Date.parse('2026-10-31T13:00:00Z'))
        expect(nextRunTime(spec, 'America/New_York', Date.parse('2026-10-31T14:00:00Z'))).toBe(Date.parse('2026-11-01T14:00:00Z'))
    })

    it('reads steps, ranges and lists, and refuses bad fields', () => {
        expect([...parseCron('*/15 * * * *').minute]).toEqual([0, 15, 30, 45])
        expect([...parseCron('0 9-11 * * 1,3').hour]).toEqual([9, 10, 11])
        expect(specToCron({ kind: 'hourly', minute: 7 })).toBe('7 * * * *')
        expect(() => parseCron('0 9 * *')).toThrow()
        expect(() => parseCron('61 9 * * *')).toThrow()
        expect(() => parseCron('0 9 * * 7')).toThrow()
    })

    it('reads common cron shapes as their preset', () => {
        expect(describeSpec({ kind: 'cron', expr: '5 9 * * *' }, TOKYO)).toBe('每天 09:05')
        expect(describeSpec({ kind: 'cron', expr: '0 9 * * 1' }, TOKYO)).toBe('每周一 09:00')
        expect(describeSpec({ kind: 'cron', expr: '*/15 * * * *' }, TOKYO)).toBe('cron */15 * * * *')
    })

    it('runs a once task once and never a manual task', () => {
        const at = tokyo('2026-10-26T15:00:00')
        expect(upcomingRunTimes({ kind: 'once', at }, TOKYO, tokyo('2026-10-25T00:00:00'), 3)).toEqual([at])
        expect(nextRunTime({ kind: 'manual' }, TOKYO, 0)).toBeNull()
    })
})

type Harness = {
    service: ScheduleService
    store: Store
    sessions: Map<string, ScheduleSessionState>
    spawns: ScheduleSpawnInput[]
    alerts: ScheduleAlert[]
    archived: string[]
    activity: Map<string, number>
    setNow: (at: number) => void
    setMachineOnline: (online: boolean) => void
    spawnResult: { value: { error: string } | null }
}

function harness(start: number): Harness {
    const store = new Store(':memory:')
    const sessions = new Map<string, ScheduleSessionState>()
    const spawns: ScheduleSpawnInput[] = []
    const alerts: ScheduleAlert[] = []
    const archived: string[] = []
    const activity = new Map<string, number>()
    let now = start
    let online = true
    const spawnResult: Harness['spawnResult'] = { value: null }
    const host: ScheduleHost = {
        spawn: async (input) => {
            spawns.push(input)
            if (spawnResult.value) return { ...spawnResult.value, attempts: 2 }
            const sessionId = `s${spawns.length}`
            sessions.set(sessionId, { active: true, thinking: false, pendingRequests: 0 })
            return { sessionId, accountId: 'main', attempts: 1, note: input.accountId ? '换过账号：gone: 尚未在隔离目录登录' : null }
        },
        session: (_namespace, sessionId) => sessions.get(sessionId) ?? null,
        lastActivity: (sessionId) => activity.get(sessionId) ?? null,
        machineOnline: () => online,
        archive: async (sessionId) => { archived.push(sessionId) },
        changed: () => {},
        alert: async (_namespace, alert) => { alerts.push(alert) },
        now: () => now
    }
    return {
        service: new ScheduleService(store, host),
        store, sessions, spawns, alerts, archived, activity, spawnResult,
        setNow: (at) => { now = at },
        setMachineOnline: (value) => { online = value }
    }
}

const BASE = {
    name: 'daily report',
    prompt: '',
    promptFile: '/Users/me/routines/daily.md',
    machineId: 'm1',
    directory: '/Users/me/project',
    agent: 'claude' as const,
    permissionMode: 'bypassPermissions',
    maxMinutes: 90,
    spec: { kind: 'cron' as const, expr: '5 9 * * *' },
    timezone: TOKYO
}

describe('ScheduleService', () => {
    it('starts a due task once, with the file and the report instruction in the prompt', async () => {
        const h = harness(tokyo('2026-10-25T08:00:00'))
        const task = h.service.create('default', BASE)
        expect(task.nextRunAt).toBe(tokyo('2026-10-25T09:05:00'))

        h.setNow(tokyo('2026-10-25T09:05:10'))
        await h.service.tick()
        await h.service.tick()

        expect(h.spawns).toHaveLength(1)
        expect(h.spawns[0]!.text).toContain('/Users/me/routines/daily.md')
        expect(h.spawns[0]!.text).toContain('scheduled_run_done')
        const { schedule, runs } = h.service.get('default', task.id)
        expect(schedule.nextRunAt).toBe(tokyo('2026-10-26T09:05:00'))
        expect(runs).toHaveLength(1)
        expect(runs[0]).toMatchObject({ trigger: 'schedule', status: 'running', sessionId: 's1', accountId: 'main' })
    })

    it('ends a run with the session report, and a self-reported failure alerts', async () => {
        const h = harness(tokyo('2026-10-25T09:00:00'))
        const task = h.service.create('default', { ...BASE, spec: { kind: 'manual' } })

        await h.service.runNow('default', task.id)
        const done = h.service.reportDone('default', { sessionId: 's1', status: 'success', summary: 'sent', links: ['https://example.com/r'] })
        expect(done).toMatchObject({ status: 'done', reported: 'success', summary: 'sent', links: ['https://example.com/r'] })
        expect(h.alerts.at(-1)).toMatchObject({ everywhere: false })

        await h.service.runNow('default', task.id)
        const failed = h.service.reportDone('default', { sessionId: 's2', status: 'failed', summary: 'database down' })
        expect(failed).toMatchObject({ status: 'failed', failure: 'self_reported' })
        expect(h.alerts.at(-1)).toMatchObject({ everywhere: true })
        expect(h.archived).toContain('s1')
    })

    it('fails a run that goes idle without a report, or passes its time limit', async () => {
        const h = harness(tokyo('2026-10-25T09:00:00'))
        const task = h.service.create('default', { ...BASE, spec: { kind: 'manual' }, maxMinutes: 2 })

        await h.service.runNow('default', task.id)
        h.sessions.set('s1', { active: true, thinking: true, pendingRequests: 0 })
        await h.service.tick()
        h.sessions.set('s1', { active: true, thinking: false, pendingRequests: 0 })
        h.activity.set('s1', tokyo('2026-10-25T09:00:30'))
        h.setNow(tokyo('2026-10-25T09:01:00'))
        await h.service.tick()
        expect(h.service.get('default', task.id).runs[0]!.status).toBe('running')

        // The time limit comes before the idle grace time here.
        h.setNow(tokyo('2026-10-25T09:02:30'))
        await h.service.tick()
        const run = h.service.get('default', task.id).runs[0]!
        expect(run).toMatchObject({ status: 'failed', failure: 'timeout' })
        expect(h.archived).toContain('s1')
        expect(h.alerts.at(-1)).toMatchObject({ everywhere: true })
    })

    it('reminds about a long idle run without failing it; only the session end fails it; a late report corrects it', async () => {
        const h = harness(tokyo('2026-10-25T09:00:00'))
        const task = h.service.create('default', { ...BASE, spec: { kind: 'manual' } })

        // Busy, then idle for 25 minutes: one reminder, the run stays open.
        await h.service.runNow('default', task.id)
        h.sessions.set('s1', { active: true, thinking: true, pendingRequests: 0 })
        await h.service.tick()
        h.sessions.set('s1', { active: true, thinking: false, pendingRequests: 0 })
        h.activity.set('s1', tokyo('2026-10-25T09:01:00'))
        h.setNow(tokyo('2026-10-25T09:26:00'))
        await h.service.tick()
        await h.service.tick()
        expect(h.service.get('default', task.id).runs[0]!.status).toBe('running')
        expect(h.alerts.filter((alert) => alert.title.includes('可能卡住'))).toHaveLength(1)
        expect(h.alerts.at(-1)).toMatchObject({ everywhere: false })

        // The session ends without a report: a failure on every channel.
        h.sessions.set('s1', { active: false, thinking: false, pendingRequests: 0 })
        await h.service.tick()
        expect(h.service.get('default', task.id).runs[0]).toMatchObject({ status: 'failed', failure: 'no_result' })
        expect(h.alerts.at(-1)).toMatchObject({ everywhere: true })

        // Its late report corrects the run, and every channel hears it.
        h.service.reportDone('default', { sessionId: 's1', status: 'success', summary: 'late but done' })
        expect(h.service.get('default', task.id).runs[0]).toMatchObject({ status: 'done', failure: null, reported: 'success' })
        expect(h.alerts.at(-1)?.title).toContain('已恢复')
        expect(h.alerts.at(-1)).toMatchObject({ everywhere: true })
    })

    it('fails a session that never starts working as no_start', async () => {
        const h = harness(tokyo('2026-10-25T09:00:00'))
        const task = h.service.create('default', { ...BASE, spec: { kind: 'manual' } })
        await h.service.runNow('default', task.id)
        h.setNow(tokyo('2026-10-25T09:06:00'))
        await h.service.tick()
        expect(h.service.get('default', task.id).runs[0]).toMatchObject({ status: 'failed', failure: 'no_start' })
    })

    it('does not start a run while the previous session still works, even with its record closed', async () => {
        const h = harness(tokyo('2026-10-25T09:00:00'))
        const task = h.service.create('default', { ...BASE, spec: { kind: 'manual' } })
        await h.service.runNow('default', task.id)
        h.store.schedules.updateRun(h.service.get('default', task.id).runs[0]!.id, { status: 'failed', failure: 'no_result' })
        h.sessions.set('s1', { active: true, thinking: true, pendingRequests: 0 })
        await expect(h.service.runNow('default', task.id)).rejects.toThrow('still open')
        h.sessions.set('s1', { active: true, thinking: false, pendingRequests: 0 })
        await h.service.runNow('default', task.id)
        expect(h.spawns).toHaveLength(2)
    })

    it('keeps the account-switch note when the session reports', async () => {
        const h = harness(tokyo('2026-10-25T09:00:00'))
        const task = h.service.create('default', { ...BASE, spec: { kind: 'manual' }, accountId: 'gone' })
        await h.service.runNow('default', task.id)
        const done = h.service.reportDone('default', { sessionId: 's1', status: 'success', summary: 'sent' })
        expect(done.summary).toBe('sent\n换过账号：gone: 尚未在隔离目录登录')
    })

    it('records a start failure as no_start and alerts', async () => {
        const h = harness(tokyo('2026-10-25T09:00:00'))
        const task = h.service.create('default', { ...BASE, spec: { kind: 'manual' } })
        h.spawnResult.value = { error: 'main: 账号身份检查失败；backup: 账号身份检查失败' }
        await h.service.runNow('default', task.id)
        expect(h.service.get('default', task.id).runs[0]).toMatchObject({ status: 'failed', failure: 'no_start', attempts: 2 })
        expect(h.alerts.at(-1)?.title).toContain('没能启动')
    })

    it('skips a time while the previous run is open', async () => {
        const h = harness(tokyo('2026-10-25T08:00:00'))
        const task = h.service.create('default', { ...BASE, spec: { kind: 'hourly', minute: 0 } })
        h.setNow(tokyo('2026-10-25T09:00:05'))
        await h.service.tick()
        h.sessions.set('s1', { active: true, thinking: true, pendingRequests: 0 })
        h.setNow(tokyo('2026-10-25T10:00:05'))
        await h.service.tick()
        const runs = h.service.get('default', task.id).runs
        expect(runs.map((run) => run.status)).toEqual(['skipped', 'running'])
        expect(h.spawns).toHaveLength(1)
    })

    it('catches up once after a long gap, and waits for an offline machine', async () => {
        const h = harness(tokyo('2026-10-20T08:00:00'))
        const task = h.service.create('default', BASE)
        // The hub was down for five days; the machine is still offline when it comes back.
        h.setMachineOnline(false)
        h.setNow(tokyo('2026-10-25T12:00:00'))
        await h.service.tick()
        expect(h.spawns).toHaveLength(0)

        h.setMachineOnline(true)
        await h.service.tick()
        await h.service.tick()
        expect(h.spawns).toHaveLength(1)
        expect(h.spawns[0]!.text).toContain('补跑')
        const { schedule, runs } = h.service.get('default', task.id)
        expect(runs).toHaveLength(1)
        expect(runs[0]).toMatchObject({ trigger: 'catchup', scheduledFor: tokyo('2026-10-25T09:05:00') })
        expect(schedule.nextRunAt).toBe(tokyo('2026-10-26T09:05:00'))
    })

    it('drops a time older than seven days but still runs the newest missed one', async () => {
        const h = harness(tokyo('2026-10-01T08:00:00'))
        const task = h.service.create('default', { ...BASE, spec: { kind: 'weekly', weekday: 4, time: '09:00' } })
        h.setNow(tokyo('2026-10-01T08:00:00') + CATCH_UP_WINDOW_MS + 3 * 24 * HOUR)
        await h.service.tick()
        const runs = h.service.get('default', task.id).runs
        expect(runs).toHaveLength(1)
        expect(runs[0]).toMatchObject({ trigger: 'catchup', scheduledFor: tokyo('2026-10-08T09:00:00') })
    })

    it('pauses a once task after it runs and does not catch up on a paused time', async () => {
        const h = harness(tokyo('2026-10-25T08:00:00'))
        const once = h.service.create('default', { ...BASE, spec: { kind: 'once', at: tokyo('2026-10-25T09:00:00') } })
        h.setNow(tokyo('2026-10-25T09:00:30'))
        await h.service.tick()
        expect(h.service.get('default', once.id).schedule).toMatchObject({ enabled: false, nextRunAt: null })

        const daily = h.service.create('default', BASE)
        h.service.update('default', daily.id, { enabled: false })
        h.setNow(tokyo('2026-10-26T12:00:00'))
        await h.service.tick()
        const resumed = h.service.update('default', daily.id, { enabled: true })
        expect(resumed.nextRunAt).toBe(tokyo('2026-10-27T09:05:00'))
        expect(h.spawns).toHaveLength(1)
    })

    it('never records two runs for one planned time', () => {
        const h = harness(tokyo('2026-10-25T08:00:00'))
        const task = h.service.create('default', BASE)
        const first = h.store.schedules.addRun({ namespace: 'default', scheduleId: task.id, trigger: 'schedule', status: 'running', scheduledFor: 1000 })
        const second = h.store.schedules.addRun({ namespace: 'default', scheduleId: task.id, trigger: 'schedule', status: 'running', scheduledFor: 1000 })
        expect(first).not.toBeNull()
        expect(second).toBeNull()
        expect(MINUTE).toBe(60_000)
    })
})
