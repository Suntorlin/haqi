import type { Machine } from '@/types/api'

/** Busy cores as a share of all cores: 100 means every core has work waiting. */
export function loadPct(machine: Machine): number | null {
    const load = machine.load
    return load ? Math.round((load.load1 / load.cores) * 100) : null
}

/** At or above this a machine is marked busy. */
export const BUSY_PCT = 100

/** Below this gap two machines count as equally busy, so the hint does not jump between them on every heartbeat. */
const IDLEST_GAP_PCT = 20

/**
 * The machine a new session fits best by load, or null when there is no clear answer. A machine on battery
 * is left out: it may leave at any time.
 */
export function idlestMachineId(machines: Machine[]): string | null {
    const ranked = machines
        .filter((m) => m.load && !m.load.battery?.onBattery)
        .map((m) => ({ id: m.id, pct: loadPct(m)! }))
        .sort((a, b) => a.pct - b.pct)
    if (ranked.length < 2 || ranked[1].pct - ranked[0].pct < IDLEST_GAP_PCT) return null
    return ranked[0].id
}
