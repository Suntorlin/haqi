import { describe, expect, it } from 'vitest'
import type { Machine } from '@/types/api'
import { idlestMachineId } from './machineLoad'

const machine = (id: string, load1: number, onBattery?: boolean): Machine => ({
    id,
    active: true,
    metadata: { host: `${id}.local`, platform: 'darwin', happyCliVersion: '1.0.0' },
    load: { cores: 10, memGb: 32, load1, ...(onBattery === undefined ? {} : { battery: { pct: 80, onBattery } }) }
})

describe('idlestMachineId', () => {
    it('names the machine with clearly less load', () => {
        expect(idlestMachineId([machine('desk', 6.5), machine('laptop', 2, false)])).toBe('laptop')
    })

    it('names none when the loads are close, so the hint does not jump between heartbeats', () => {
        expect(idlestMachineId([machine('desk', 5), machine('laptop', 4)])).toBeNull()
    })

    it('leaves out a machine on battery', () => {
        expect(idlestMachineId([machine('desk', 6.5), machine('laptop', 0.5, true)])).toBeNull()
    })
})
