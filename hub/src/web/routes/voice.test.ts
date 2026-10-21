import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { Hono } from 'hono'

type Received = { path: string; authorization: string | null; contentType: string | null; bytes: number }

let asr: ReturnType<typeof Bun.serve>
let received: Received[] = []
let createVoiceRoutes: typeof import('./voice').createVoiceRoutes

beforeAll(async () => {
    asr = Bun.serve({
        port: 0,
        async fetch(req) {
            const url = new URL(req.url)
            const body = await req.arrayBuffer()
            received.push({
                path: url.pathname + url.search,
                authorization: req.headers.get('authorization'),
                contentType: req.headers.get('content-type'),
                bytes: body.byteLength
            })
            if (url.pathname === '/api/voice/dictation') {
                return Response.json({ available: true, model: 'test-model' })
            }
            return Response.json({ text: '你好 hub', audioSeconds: 1.5 })
        }
    })
    process.env.HAQI_ASR_URL = `http://127.0.0.1:${asr.port}`
    ;({ createVoiceRoutes } = await import('./voice'))
})

afterAll(() => {
    asr.stop(true)
    delete process.env.HAQI_ASR_URL
})

function createApp() {
    const app = new Hono()
    app.route('/api', createVoiceRoutes() as never)
    return app
}

describe('dictation routes', () => {
    it('reports the dictation service status and forwards the token', async () => {
        received = []
        const res = await createApp().request('/api/voice/dictation', { headers: { authorization: 'Bearer t1' } })
        expect(await res.json()).toEqual({ available: true, model: 'test-model' })
        expect(received[0]?.authorization).toBe('Bearer t1')
    })

    it('forwards audio, content type and hotwords to the service', async () => {
        received = []
        const res = await createApp().request('/api/voice/transcribe?hotwords=hub,CI', {
            method: 'POST',
            headers: { authorization: 'Bearer t1', 'content-type': 'audio/webm' },
            body: new Uint8Array(1234)
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ text: '你好 hub', audioSeconds: 1.5 })
        expect(received[0]).toEqual({
            path: '/api/voice/transcribe?hotwords=hub,CI',
            authorization: 'Bearer t1',
            contentType: 'audio/webm',
            bytes: 1234
        })
    })

    it('reports unavailable when the service is down', async () => {
        asr.stop(true)
        const app = createApp()
        const status = await app.request('/api/voice/dictation')
        expect(await status.json()).toEqual({ available: false })
        const transcribe = await app.request('/api/voice/transcribe', { method: 'POST', body: new Uint8Array(10) })
        expect(transcribe.status).toBe(503)
    })
})
