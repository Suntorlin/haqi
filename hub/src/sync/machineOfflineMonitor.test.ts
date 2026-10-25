import { describe, expect, it } from 'bun:test'
import type { Machine } from './machineCache'
import { MachineOfflineMonitor } from './machineOfflineMonitor'

const MIN = 60_000

function machine(active: boolean, activeAt: number, role?: 'always-on' | 'portable'): Machine {
    return {
        id: 'm1', namespace: 'default', seq: 0, createdAt: 0, updatedAt: 0, active, activeAt,
        metadata: { host: 'desk.local', platform: 'linux', happyCliVersion: '1', displayName: 'Desk', role },
        metadataVersion: 1, runnerState: null, runnerStateVersion: 1
    }
}

describe('MachineOfflineMonitor', () => {
    it('alerts once after the threshold, then says when the machine is back', () => {
        const monitor = new MachineOfflineMonitor(5 * MIN)
        const t0 = 1_000_000
        expect(monitor.check([machine(true, t0)], t0)).toEqual([])
        expect(monitor.check([machine(false, t0)], t0 + 4 * MIN)).toEqual([])

        const down = monitor.check([machine(false, t0)], t0 + 5 * MIN)
        expect(down).toHaveLength(1)
        expect(down[0]?.title).toContain('机器离线 — Desk')
        expect(down[0]?.recovered).toBe(false)
        expect(monitor.check([machine(false, t0)], t0 + 10 * MIN)).toEqual([])

        const back = monitor.check([machine(true, t0 + 12 * MIN)], t0 + 12 * MIN)
        expect(back).toHaveLength(1)
        expect(back[0]?.recovered).toBe(true)
        expect(back[0]?.body).toContain('12 分钟')
    })

    it('stays quiet about machines it never saw online, and about portable ones', () => {
        const monitor = new MachineOfflineMonitor(5 * MIN)
        expect(monitor.check([machine(false, 0)], 60 * MIN)).toEqual([])

        monitor.check([machine(true, 0, 'portable')], 0)
        expect(monitor.check([machine(false, 0, 'portable')], 60 * MIN)).toEqual([])
    })

    it('repeats the alert every hour while the machine is still down', () => {
        const monitor = new MachineOfflineMonitor(5 * MIN)
        const t0 = 1_000_000
        monitor.check([machine(true, t0)], t0)
        expect(monitor.check([machine(false, t0)], t0 + 5 * MIN)).toHaveLength(1)
        expect(monitor.check([machine(false, t0)], t0 + 30 * MIN)).toEqual([])
        expect(monitor.check([machine(false, t0)], t0 + 65 * MIN)).toHaveLength(1)
    })
})
