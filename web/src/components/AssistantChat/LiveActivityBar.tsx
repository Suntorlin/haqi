import { useEffect, useMemo, useState } from 'react'
import type { DecryptedMessage } from '@/types/api'
import { extractLatestLiveActivity } from '@/components/AssistantChat/liveActivity'
import { TOOL_PROGRESS_STALE_AFTER_MS, type ToolProgressSignal } from '@/chat/toolProgress'
import { Spinner } from '@/components/Spinner'

function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function latestSignal(toolProgress: ReadonlyMap<string, ToolProgressSignal> | null | undefined): ToolProgressSignal | null {
    if (!toolProgress) return null
    let latest: ToolProgressSignal | null = null
    for (const signal of toolProgress.values()) {
        if (!latest || signal.at > latest.at) latest = signal
    }
    return latest
}

export function LiveActivityBar(props: {
    messages: DecryptedMessage[]
    visible: boolean
    toolProgress?: ReadonlyMap<string, ToolProgressSignal> | null
}) {
    const activity = useMemo(
        () => props.visible ? extractLatestLiveActivity(props.messages) : '',
        [props.messages, props.visible]
    )
    const signal = props.visible ? latestSignal(props.toolProgress) : null

    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!props.visible || !signal) return
        const id = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(id)
    }, [props.visible, signal !== null])

    if (!props.visible) {
        return null
    }

    const signalAgeMs = signal ? Math.max(0, now - signal.at) : null
    // A finished tool also stops heartbeating, so a stale signal means nothing
    // here — only show the runtime while the heartbeat is fresh. (The per-tool
    // card owns the "no signal" warning, where state==='running' makes it valid.)
    const fresh = signalAgeMs !== null && signalAgeMs <= TOOL_PROGRESS_STALE_AFTER_MS
    // Backend-reported runtime at the last heartbeat, advanced by local time.
    const runtimeSeconds = fresh ? signal!.elapsedSeconds + signalAgeMs / 1000 : null

    return (
        <div className="animate-bounce-in mx-auto w-full max-w-content px-3 pb-1">
            <div className="flex items-center gap-2 rounded-lg bg-[var(--app-subtle-bg)] px-3 py-1.5 text-xs text-[var(--app-hint)]">
                <Spinner size="sm" label={null} className="text-current" />
                <span className="truncate">{activity}</span>
                {runtimeSeconds !== null && (
                    <span
                        className="ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono"
                        title={`Backend heartbeat ${formatDuration(signalAgeMs! / 1000)} ago`}
                    >
                        {formatDuration(runtimeSeconds)}
                        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    </span>
                )}
            </div>
        </div>
    )
}
