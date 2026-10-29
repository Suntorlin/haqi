/**
 * The observer: looks at each working session of a running task and decides whether the user has to step in.
 * Rules only, no model: an approval that waits, a session that stopped, a session silent for too long (reminded
 * first, the user told only if it stays silent), a session its account's quota refuses, a risky command. Everything
 * else stays in the log.
 */
import type { TaskSignal, TaskSubtask } from '@hapi/protocol/types'

export type WatchedSession = {
    subtask: TaskSubtask
    active: boolean
    thinking: boolean
    /** When the session last wrote a message. */
    lastMessageAt: number
    pendingRequests: Array<{ id: string; tool: string; detail: string }>
    /** Shell commands it ran since the last look. */
    newCommands: string[]
    /** Its latest reply is the account's quota refusal, and when it came. */
    quota?: { text: string; at: number } | null
}

export type ObserverAction =
    | { type: 'signal'; signal: Omit<TaskSignal, 'at' | 'notified'>; notify: boolean }
    | { type: 'clear'; key: string }
    | { type: 'remind'; subtask: TaskSubtask }
    | { type: 'state'; subtaskId: string; state: 'running' | 'stuck' | 'stopped' }

export const OBSERVER_LIMITS = {
    silentRemindMs: 20 * 60_000,
    silentStuckMs: 35 * 60_000,
    /** The session moves itself to the next account in this time; a refusal still there after it is the user's. */
    quotaGraceMs: 2 * 60_000
} as const

/** Commands that act outside the worktree: the user's hard limits. */
const DANGER = [
    { pattern: /\bgit\s+push\b/, label: '推送代码（git push）' },
    { pattern: /\b(npm|pnpm|bun|yarn)\s+publish\b/, label: '发布包' },
    { pattern: /\b(wrangler|vercel|fly|netlify)\s+(deploy|publish)\b/, label: '部署' },
    { pattern: /\bkubectl\s+(apply|delete|rollout)\b/, label: '改线上集群' },
    { pattern: /\brm\s+-rf?\s+\/(?!tmp\b)/, label: '删除根目录下的文件' }
]

export function observe(sessions: WatchedSession[], open: TaskSignal[], now: number): ObserverAction[] {
    const actions: ObserverAction[] = []
    const openKeys = new Set(open.map((s) => s.key))
    const reminded = new Set(open.filter((s) => s.kind === 'reminded').map((s) => s.key))

    for (const watched of sessions) {
        const { subtask } = watched
        if (subtask.state === 'done') continue
        const sid = subtask.sessionId

        // An approval the session waits on: always the user's call.
        const wanted = new Set<string>()
        for (const request of watched.pendingRequests) {
            const key = `approval:${request.id}`
            wanted.add(key)
            if (!openKeys.has(key)) {
                actions.push({ type: 'signal', notify: true, signal: { key, kind: 'approval', text: `「${subtask.title}」等你批准：${request.tool} ${request.detail}`.slice(0, 300), sessionId: sid } })
            }
        }
        for (const signal of open) {
            if (signal.kind === 'approval' && signal.sessionId === sid && !wanted.has(signal.key)) actions.push({ type: 'clear', key: signal.key })
        }

        for (const command of watched.newCommands) {
            const hit = DANGER.find((d) => d.pattern.test(command))
            if (hit) {
                const key = `danger:${sid}:${hit.label}`
                if (!openKeys.has(key)) actions.push({ type: 'signal', notify: true, signal: { key, kind: 'danger', text: `「${subtask.title}」执行了${hit.label}：${command.slice(0, 160)}`, sessionId: sid } })
            }
        }

        const stoppedKey = `stopped:${subtask.id}`
        if (!watched.active) {
            if (subtask.state !== 'stopped') actions.push({ type: 'state', subtaskId: subtask.id, state: 'stopped' })
            if (!openKeys.has(stoppedKey)) actions.push({ type: 'signal', notify: true, signal: { key: stoppedKey, kind: 'stopped', text: `「${subtask.title}」的会话停了，子任务没做完。`, sessionId: sid } })
            continue
        }
        if (openKeys.has(stoppedKey)) actions.push({ type: 'clear', key: stoppedKey })

        // Quota: a reminder only gets the same refusal back, and that reply counts as activity, so the silence
        // rules never fire. Tell the user once the session had time to move to another account itself.
        const quotaKey = `quota:${subtask.id}`
        if (watched.quota) {
            if (now - watched.quota.at >= OBSERVER_LIMITS.quotaGraceMs && !openKeys.has(quotaKey)) {
                if (subtask.state !== 'stuck') actions.push({ type: 'state', subtaskId: subtask.id, state: 'stuck' })
                actions.push({ type: 'signal', notify: true, signal: {
                    key: quotaKey, kind: 'stuck', sessionId: sid,
                    text: `「${subtask.title}」用的账号额度用完了（${watched.quota.text}），没有能接手的账号。去会话里换个账号，或等额度恢复后点“继续”。`.slice(0, 300)
                } })
            }
            continue
        }
        if (openKeys.has(quotaKey)) actions.push({ type: 'clear', key: quotaKey })

        const silent = now - watched.lastMessageAt
        const remindKey = `reminded:${subtask.id}`
        const stuckKey = `stuck:${subtask.id}`
        if (watched.thinking || silent < OBSERVER_LIMITS.silentRemindMs) {
            if (subtask.state === 'stuck') actions.push({ type: 'state', subtaskId: subtask.id, state: 'running' })
            if (openKeys.has(stuckKey)) actions.push({ type: 'clear', key: stuckKey })
            if (reminded.has(remindKey) && silent < OBSERVER_LIMITS.silentRemindMs) actions.push({ type: 'clear', key: remindKey })
            continue
        }
        // Silent: remind the executor once; tell the user only if it stays silent.
        if (!reminded.has(remindKey)) {
            actions.push({ type: 'remind', subtask })
            actions.push({ type: 'signal', notify: false, signal: { key: remindKey, kind: 'reminded', text: `「${subtask.title}」${Math.round(silent / 60_000)} 分钟没有动静，已提醒执行者。`, sessionId: sid } })
        } else if (silent >= OBSERVER_LIMITS.silentStuckMs && !openKeys.has(stuckKey)) {
            actions.push({ type: 'state', subtaskId: subtask.id, state: 'stuck' })
            actions.push({ type: 'signal', notify: true, signal: { key: stuckKey, kind: 'stuck', text: `「${subtask.title}」${Math.round(silent / 60_000)} 分钟没有进展，提醒后也没动。`, sessionId: sid } })
        }
    }
    return actions
}
