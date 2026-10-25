import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { cpus, loadavg, totalmem } from 'node:os'
import type { MachineLoad } from '@hapi/protocol/schemas'

function run(command: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
        execFile(command, args, { timeout: 3_000 }, (error, stdout) => resolve(error ? '' : stdout))
    })
}

/** os.freemem() leaves out the cache macOS gives back on demand, so it reads far lower than what is really free. */
async function memFreePct(): Promise<number | undefined> {
    if (process.platform === 'darwin') {
        const match = /free percentage:\s*(\d+)%/.exec(await run('memory_pressure', ['-Q']))
        return match ? Number(match[1]) : undefined
    }
    if (process.platform === 'linux') {
        const info = await readFile('/proc/meminfo', 'utf8').catch(() => '')
        const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(info)?.[1])
        const pct = (kb('MemAvailable') / kb('MemTotal')) * 100
        return Number.isFinite(pct) ? Math.round(pct) : undefined
    }
    return undefined
}

async function battery(): Promise<MachineLoad['battery']> {
    if (process.platform !== 'darwin') return undefined
    const out = await run('pmset', ['-g', 'batt'])
    const pct = /(\d+)%/.exec(out)
    return pct ? { pct: Number(pct[1]), onBattery: out.includes("'Battery Power'") } : undefined
}

/** How busy this machine is now; sent with every heartbeat so the web can show where a new session fits. */
export async function readMachineLoad(): Promise<MachineLoad> {
    const [free, power] = await Promise.all([memFreePct(), battery()])
    return {
        cores: cpus().length,
        memGb: Math.round(totalmem() / 2 ** 30),
        ...(free === undefined ? {} : { memFreePct: free }),
        load1: Math.round(loadavg()[0] * 100) / 100,
        ...(power ? { battery: power } : {})
    }
}
