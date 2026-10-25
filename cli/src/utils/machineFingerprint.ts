import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'

let cached: string | null | undefined

function hardwareId(): string | null {
    try {
        if (os.platform() === 'darwin') {
            const out = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8', timeout: 5_000 })
            return /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(out)?.[1] ?? null
        }
        if (os.platform() === 'linux') {
            return readFileSync('/etc/machine-id', 'utf8').trim() || null
        }
    } catch {
        return null
    }
    return null
}

/**
 * A short hash of this computer's hardware id. The hub uses it to tell two computers apart when
 * they share a machine id (a copied settings.json). Only the hash leaves the machine.
 */
export function machineFingerprint(): string | undefined {
    if (cached === undefined) {
        const id = hardwareId()
        cached = id ? createHash('sha256').update(`haqi-machine:${id}`).digest('hex').slice(0, 16) : null
    }
    return cached ?? undefined
}
