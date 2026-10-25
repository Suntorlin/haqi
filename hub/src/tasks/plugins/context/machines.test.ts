import { describe, expect, it } from 'bun:test'
import { suggestMachine, type MachineOffer, type RepoOffer } from './machines'

const machine = (id: string, loadPct: number, extra: Partial<MachineOffer> = {}): MachineOffer => ({
    id, name: id, portable: false, loadPct, memFreePct: 50, onBattery: false, sessions: 0, ...extra
})
const repo = (...ids: string[]): RepoOffer => ({ name: 'app', places: ids.map((machineId) => ({ machineId, path: `/${machineId}/app`, blocked: false, notes: [] })) })

describe('suggestMachine', () => {
    it('picks the idlest machine that has the repository, and the always-on one when loads are close', () => {
        expect(suggestMachine(repo('desk', 'laptop'), [machine('desk', 60), machine('laptop', 10, { portable: true })])).toBe('laptop')
        expect(suggestMachine(repo('desk', 'laptop'), [machine('desk', 25), machine('laptop', 10, { portable: true })])).toBe('desk')
        expect(suggestMachine(repo('desk'), [machine('desk', 90), machine('laptop', 10)])).toBe('desk')
    })

    it('leaves out a machine on battery and a checkout that cannot take the work', () => {
        expect(suggestMachine(repo('desk', 'laptop'), [machine('desk', 90), machine('laptop', 10, { onBattery: true })])).toBe('desk')
        const blocked = { name: 'app', places: [{ machineId: 'desk', path: '/desk/app', blocked: true, notes: [] }] }
        expect(suggestMachine(blocked, [machine('desk', 10)])).toBeNull()
    })
})
