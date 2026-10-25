import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'

export type DictationStatus = 'idle' | 'starting' | 'recording' | 'transcribing'
export type DictationError = 'micPermission' | 'unsupported' | 'failed'

export type DictationController = {
    status: DictationStatus
    elapsedMs: number
    error: DictationError | null
    start: () => void
    finish: () => void
    cancel: () => void
    clearError: () => void
}

/** Recordings stop by themselves after this long, then go to the speech-to-text service. */
export const DICTATION_MAX_MS = 5 * 60_000

/** While recording, the browser hands the service a chunk this often (segmented dictation). */
export const DICTATION_CHUNK_MS = 1000

// Chrome/Android record webm/opus; iOS Safari only records mp4/aac.
const MIME_CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']

function pickMimeType(): string | undefined {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return undefined
    }
    return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type))
}

export function isDictationSupported(): boolean {
    return typeof window !== 'undefined'
        && typeof MediaRecorder !== 'undefined'
        && Boolean(navigator.mediaDevices?.getUserMedia)
}

/**
 * Join dictated text onto a draft: no separator after CJK text or whitespace, one space otherwise.
 */
export function appendDictatedText(draft: string, dictated: string): string {
    const text = dictated.trim()
    if (!text) return draft
    if (!draft) return text
    const last = draft.slice(-1)
    const needsSpace = !/\s/.test(last) && !/[　-〿㐀-鿿＀-￯]/.test(last)
    return draft + (needsSpace ? ' ' : '') + text
}

function newStreamId(): string {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
}

/**
 * Push-to-talk dictation against the local speech-to-text service: record in the browser,
 * hand the text to `onText` when the user taps done. Returns null when the hub has no
 * dictation service or the browser cannot record, so callers can hide the button.
 *
 * When the service supports segments, each recorder chunk goes up while recording and the
 * service transcribes as it goes, so after done only the last few seconds are left. If any
 * chunk fails, the whole recording is uploaded once at the end, as without segments.
 */
export function useDictation(options: {
    api: ApiClient | null | undefined
    hotwords?: string[]
    onText: (text: string) => void
}): DictationController | null {
    const { api } = options
    const supported = isDictationSupported()
    const statusQuery = useQuery({
        queryKey: queryKeys.dictationStatus,
        queryFn: async () => await api!.getDictationStatus(),
        enabled: Boolean(api && supported),
        staleTime: 60_000,
        retry: false
    })

    const [status, setStatus] = useState<DictationStatus>('idle')
    const [elapsedMs, setElapsedMs] = useState(0)
    const [error, setError] = useState<DictationError | null>(null)

    const recorderRef = useRef<MediaRecorder | null>(null)
    const streamRef = useRef<MediaStream | null>(null)
    const chunksRef = useRef<Blob[]>([])
    const startedAtRef = useRef(0)
    const discardRef = useRef(false)
    // Segmented upload of the current recording: null when off or after a chunk failed.
    const segmentsRef = useRef<{ id: string; seq: number; queue: Promise<void> } | null>(null)
    const latestRef = useRef(options)
    latestRef.current = options

    const releaseMic = useCallback(() => {
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
    }, [])

    const sendChunk = useCallback((chunk: Blob, options?: { final?: boolean; cancel?: boolean }) => {
        const segments = segmentsRef.current
        const client = latestRef.current.api
        if (!segments || !client) return
        const seq = segments.seq++
        segments.queue = segments.queue.then(async () => {
            if (segmentsRef.current !== segments) return
            const result = await client.sendDictationChunk(segments.id, seq, chunk, {
                ...options,
                hotwords: latestRef.current.hotwords
            })
            if (!result.stream) throw new Error('The service did not take the chunk as a segment')
        }).catch(() => {
            if (segmentsRef.current === segments) segmentsRef.current = null
        })
    }, [])

    const upload = useCallback(async (audio: Blob) => {
        const client = latestRef.current.api
        const segments = segmentsRef.current
        if (!client) {
            setStatus('idle')
            return
        }
        setStatus('transcribing')
        try {
            let text: string | null = null
            if (segments) {
                await segments.queue
                if (segmentsRef.current === segments) {
                    text = await client.sendDictationChunk(segments.id, segments.seq++, new Blob([], { type: audio.type }), { final: true })
                        .then((result) => (result.stream && typeof result.text === 'string' ? result.text : null))
                        .catch(() => null)
                }
            }
            if (text === null) {
                text = (await client.transcribeAudio(audio, { hotwords: latestRef.current.hotwords })).text
            }
            if (text.trim()) {
                latestRef.current.onText(text)
            }
        } catch {
            setError('failed')
        } finally {
            segmentsRef.current = null
            setStatus('idle')
        }
    }, [])

    const start = useCallback(() => {
        if (recorderRef.current || status !== 'idle') return
        setError(null)
        setStatus('starting')
        void (async () => {
            let stream: MediaStream
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
            } catch (cause) {
                const name = cause instanceof DOMException ? cause.name : ''
                setError(name === 'NotAllowedError' || name === 'SecurityError' ? 'micPermission' : 'unsupported')
                setStatus('idle')
                return
            }
            const mimeType = pickMimeType()
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
            streamRef.current = stream
            recorderRef.current = recorder
            chunksRef.current = []
            discardRef.current = false
            const segmented = (statusQuery.data?.segmentSeconds ?? 0) > 0
            segmentsRef.current = segmented ? { id: newStreamId(), seq: 0, queue: Promise.resolve() } : null
            recorder.ondataavailable = (event) => {
                if (event.data.size === 0) return
                chunksRef.current.push(event.data)
                if (!discardRef.current) sendChunk(event.data)
            }
            recorder.onstop = () => {
                releaseMic()
                recorderRef.current = null
                const audio = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' })
                chunksRef.current = []
                if (discardRef.current || audio.size === 0) {
                    const segments = segmentsRef.current
                    if (segments && segments.seq > 0) {
                        // Tell the service to drop what it has; best effort.
                        void latestRef.current.api?.sendDictationChunk(segments.id, segments.seq, new Blob([]), { cancel: true }).catch(() => {})
                    }
                    segmentsRef.current = null
                    setStatus('idle')
                    return
                }
                void upload(audio)
            }
            recorder.start(segmented ? DICTATION_CHUNK_MS : undefined)
            startedAtRef.current = Date.now()
            setElapsedMs(0)
            setStatus('recording')
        })()
    }, [releaseMic, sendChunk, status, statusQuery.data?.segmentSeconds, upload])

    const finish = useCallback(() => {
        const recorder = recorderRef.current
        if (recorder && recorder.state !== 'inactive') recorder.stop()
    }, [])

    const cancel = useCallback(() => {
        discardRef.current = true
        finish()
    }, [finish])

    useEffect(() => {
        if (status !== 'recording') return
        const timer = setInterval(() => {
            const elapsed = Date.now() - startedAtRef.current
            setElapsedMs(elapsed)
            if (elapsed >= DICTATION_MAX_MS) finish()
        }, 250)
        return () => clearInterval(timer)
    }, [finish, status])

    // Leaving the session mid-recording drops the recording and frees the microphone.
    useEffect(() => () => {
        discardRef.current = true
        const recorder = recorderRef.current
        if (recorder && recorder.state !== 'inactive') recorder.stop()
        streamRef.current?.getTracks().forEach((track) => track.stop())
    }, [])

    const clearError = useCallback(() => setError(null), [])

    if (!supported || !statusQuery.data?.available) {
        return null
    }
    return { status, elapsedMs, error, start, finish, cancel, clearError }
}
