import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import { appendDictatedText, useDictation } from './useDictation'

describe('appendDictatedText', () => {
    it('joins Chinese without a space and Latin text with one', () => {
        expect(appendDictatedText('', '你好')).toBe('你好')
        expect(appendDictatedText('先看一下', 'hub 路由')).toBe('先看一下hub 路由')
        expect(appendDictatedText('check the', 'hub route')).toBe('check the hub route')
        expect(appendDictatedText('line one\n', 'next')).toBe('line one\nnext')
        expect(appendDictatedText('draft', '   ')).toBe('draft')
    })
})

class FakeRecorder {
    static isTypeSupported = (type: string) => type === 'audio/mp4'
    static last: FakeRecorder | null = null
    state: 'inactive' | 'recording' = 'inactive'
    mimeType = 'audio/mp4'
    ondataavailable: ((event: { data: Blob }) => void) | null = null
    onstop: (() => void) | null = null
    constructor(public stream: unknown, public options?: { mimeType?: string }) {
        FakeRecorder.last = this
    }
    start() { this.state = 'recording' }
    stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: 'audio/mp4' }) })
        this.onstop?.()
    }
}

describe('useDictation', () => {
    const stopTrack = vi.fn()

    beforeEach(() => {
        vi.stubGlobal('MediaRecorder', FakeRecorder)
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })) }
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        stopTrack.mockReset()
    })

    function setup(api: Partial<ApiClient>) {
        const client = new QueryClient()
        const onText = vi.fn()
        const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
        const hook = renderHook(() => useDictation({ api: api as ApiClient, hotwords: ['haqi'], onText }), { wrapper })
        return { hook, onText }
    }

    it('stays hidden when the hub has no dictation service', async () => {
        const getDictationStatus = vi.fn(async () => ({ available: false }))
        const { hook } = setup({ getDictationStatus })
        await waitFor(() => expect(getDictationStatus).toHaveBeenCalled())
        expect(hook.result.current).toBeNull()
    })

    it('records, uploads with hotwords, and hands back the text', async () => {
        const transcribeAudio = vi.fn(async () => ({ text: '帮我看一下 hub' }))
        const { hook, onText } = setup({ getDictationStatus: async () => ({ available: true }), transcribeAudio })
        await waitFor(() => expect(hook.result.current).not.toBeNull())

        act(() => hook.result.current!.start())
        await waitFor(() => expect(hook.result.current!.status).toBe('recording'))
        expect(FakeRecorder.last?.options).toEqual({ mimeType: 'audio/mp4' })

        act(() => hook.result.current!.finish())
        await waitFor(() => expect(onText).toHaveBeenCalledWith('帮我看一下 hub'))
        const [audio, options] = transcribeAudio.mock.calls[0] as unknown as [Blob, { hotwords: string[] }]
        expect(audio.type).toBe('audio/mp4')
        expect(options.hotwords).toEqual(['haqi'])
        expect(stopTrack).toHaveBeenCalled()
        await waitFor(() => expect(hook.result.current!.status).toBe('idle'))
    })

    it('drops the recording on cancel', async () => {
        const transcribeAudio = vi.fn()
        const { hook } = setup({ getDictationStatus: async () => ({ available: true }), transcribeAudio })
        await waitFor(() => expect(hook.result.current).not.toBeNull())
        act(() => hook.result.current!.start())
        await waitFor(() => expect(hook.result.current!.status).toBe('recording'))
        act(() => hook.result.current!.cancel())
        await waitFor(() => expect(hook.result.current!.status).toBe('idle'))
        expect(transcribeAudio).not.toHaveBeenCalled()
        expect(stopTrack).toHaveBeenCalled()
    })

    it('reports a denied microphone', async () => {
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: { getUserMedia: vi.fn(async () => { throw new DOMException('denied', 'NotAllowedError') }) }
        })
        const { hook } = setup({ getDictationStatus: async () => ({ available: true }) })
        await waitFor(() => expect(hook.result.current).not.toBeNull())
        act(() => hook.result.current!.start())
        await waitFor(() => expect(hook.result.current!.error).toBe('micPermission'))
        expect(hook.result.current!.status).toBe('idle')
    })

    it('reports a failed upload', async () => {
        const { hook, onText } = setup({
            getDictationStatus: async () => ({ available: true }),
            transcribeAudio: vi.fn(async () => { throw new Error('HTTP 503') })
        })
        await waitFor(() => expect(hook.result.current).not.toBeNull())
        act(() => hook.result.current!.start())
        await waitFor(() => expect(hook.result.current!.status).toBe('recording'))
        act(() => hook.result.current!.finish())
        await waitFor(() => expect(hook.result.current!.error).toBe('failed'))
        expect(onText).not.toHaveBeenCalled()
    })
})
