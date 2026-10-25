import type { Machine } from './machineCache'

export type MachineOfflineAlert = { machineId: string; namespace: string; title: string; body: string; recovered: boolean }

type Track = { offlineSince: number | null; alertedAt: number | null }

const DEFAULT_THRESHOLD_MS = 5 * 60_000
const REALERT_MS = 60 * 60_000

function machineName(machine: Machine): string {
    return machine.metadata?.displayName || machine.metadata?.host || machine.id.slice(0, 8)
}

/**
 * Tells the user when an always-on machine stays offline (and when it is back).
 * Portable machines are skipped: a laptop going away is normal. A machine counts only after the hub has
 * seen it online, so a hub restart does not page about machines that were already off.
 */
export class MachineOfflineMonitor {
    private readonly tracks = new Map<string, Track>()

    constructor(private readonly thresholdMs: number = DEFAULT_THRESHOLD_MS) {}

    check(machines: Machine[], now: number = Date.now()): MachineOfflineAlert[] {
        if (this.thresholdMs <= 0) return []
        const alerts: MachineOfflineAlert[] = []
        for (const machine of machines) {
            if (machine.metadata?.role === 'portable') {
                this.tracks.delete(machine.id)
                continue
            }
            const track = this.tracks.get(machine.id)
            if (machine.active) {
                if (track?.alertedAt && track.offlineSince !== null) {
                    const minutes = Math.max(1, Math.round((now - track.offlineSince) / 60_000))
                    alerts.push({
                        machineId: machine.id,
                        namespace: machine.namespace,
                        title: `HAQI：机器已恢复 — ${machineName(machine)}`,
                        body: `离线约 ${minutes} 分钟后重新连上了。`,
                        recovered: true
                    })
                }
                this.tracks.set(machine.id, { offlineSince: null, alertedAt: null })
                continue
            }
            if (!track) continue   // never seen online since the hub started
            const offlineSince = track.offlineSince ?? Math.min(now, machine.activeAt || now)
            track.offlineSince = offlineSince
            const due = track.alertedAt === null
                ? now - offlineSince >= this.thresholdMs
                : now - track.alertedAt >= REALERT_MS
            if (!due) continue
            track.alertedAt = now
            const minutes = Math.round((now - offlineSince) / 60_000)
            const lines = [`已离线 ${minutes} 分钟。它上面的会话收不到消息，定时任务也会等它回来。`]
            if (machine.metadata?.platform === 'darwin') {
                lines.push('如果它刚重启，可能停在 FileVault 解锁界面：在另一台机器的会话里打开终端，用 ssh 登录它并输入登录密码解锁（macOS 26 起支持）。')
            }
            lines.push('它是便携电脑、离线是正常的话，可以在 设置 → 机器 里把它标成"便携"，就不再提醒。')
            alerts.push({ machineId: machine.id, namespace: machine.namespace, title: `HAQI：机器离线 — ${machineName(machine)}`, body: lines.join('\n'), recovered: false })
        }
        return alerts
    }
}
