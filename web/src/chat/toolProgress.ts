import { isObject } from '@hapi/protocol'
import type { DecryptedMessage } from '@/types/api'

export type ToolProgressSignal = {
    /** Wall-clock ms of the latest progress message for this tool. */
    at: number
    /** Tool runtime in seconds as reported by the backend at `at`. */
    elapsedSeconds: number
}

/** Heartbeats arrive every ~30s; after this much silence a running tool is suspicious. */
export const TOOL_PROGRESS_STALE_AFTER_MS = 75_000

const MAX_SCAN_MESSAGES = 400
const MAX_SIGNAL_AGE_MS = 15 * 60 * 1000

function readSignal(message: DecryptedMessage): { toolId: string; signal: ToolProgressSignal } | null {
    const envelope = isObject(message.content) ? message.content : null
    if (!envelope || envelope.role !== 'agent') return null
    const content = isObject(envelope.content) ? envelope.content : null
    if (!content || content.type !== 'output') return null
    const data = isObject(content.data) ? content.data : null
    if (!data || data.type !== 'tool_progress') return null

    const elapsed = data.elapsed_time_seconds
    if (typeof elapsed !== 'number' || !Number.isFinite(elapsed) || elapsed < 0) return null

    // Heartbeat frames carry the running tool's id in parent_tool_use_id and a
    // synthetic "<id>-heartbeat-N" in tool_use_id.
    const parent = typeof data.parent_tool_use_id === 'string' && data.parent_tool_use_id.length > 0
        ? data.parent_tool_use_id
        : null
    const own = typeof data.tool_use_id === 'string' && data.tool_use_id.length > 0
        ? data.tool_use_id.replace(/-heartbeat-\d+$/, '')
        : null
    const toolId = parent ?? own
    if (!toolId) return null

    return { toolId, signal: { at: message.createdAt, elapsedSeconds: elapsed } }
}

/**
 * Latest backend progress signal per tool id, from the most recent messages.
 * Returns null when there is no usable signal, so consumers can skip work.
 */
export function extractToolProgress(
    messages: DecryptedMessage[],
    now: number = Date.now()
): Map<string, ToolProgressSignal> | null {
    let result: Map<string, ToolProgressSignal> | null = null
    const cutoff = now - MAX_SIGNAL_AGE_MS
    const stop = Math.max(0, messages.length - MAX_SCAN_MESSAGES)
    for (let i = messages.length - 1; i >= stop; i--) {
        const message = messages[i]
        if (message.createdAt < cutoff) break
        const hit = readSignal(message)
        if (!hit) continue
        if (!result) result = new Map()
        // Scanning backwards, so the first signal seen per tool is the newest.
        if (!result.has(hit.toolId)) result.set(hit.toolId, hit.signal)
    }
    return result
}
