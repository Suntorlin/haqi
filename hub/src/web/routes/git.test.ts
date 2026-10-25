import { describe, expect, it, mock } from 'bun:test'
import { Hono } from 'hono'
import { createDownloadKeyPair, decryptFileDownload } from '@hapi/protocol/fileTransfer'
import { createGitRoutes } from './git'

function createApp(readSessionFile: (...args: unknown[]) => Promise<unknown>, permissionMode = 'default') {
    const engine = {
        resolveSessionAccess: () => ({
            ok: true,
            sessionId: 'session-1',
            session: { id: 'session-1', active: true, permissionMode, metadata: { path: '/repo' } }
        }),
        readSessionFile: mock(readSessionFile)
    }
    const app = new Hono<{ Variables: { namespace: string } }>()
    app.use('/api/*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createGitRoutes(() => engine as never))
    return { app, engine }
}

function download(app: Hono<{ Variables: { namespace: string } }>, body: unknown) {
    return app.request('http://localhost/api/sessions/session-1/file/download', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
    })
}

describe('POST /sessions/:id/file/download', () => {
    it('returns the file encrypted to the browser key', async () => {
        const plaintext = new Uint8Array([0, 1, 2, 250, 251, 255])
        const { app } = createApp(async () => ({
            success: true,
            content: Buffer.from(plaintext).toString('base64'),
            size: plaintext.length,
            truncated: false
        }))
        const keys = await createDownloadKeyPair()

        const response = await download(app, { path: 'dist/a.zip', publicKey: keys.publicKey })
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')

        const envelope = new Uint8Array(await response.arrayBuffer())
        expect(Buffer.from(envelope).includes(Buffer.from(plaintext))).toBe(false)
        expect(await decryptFileDownload(keys.privateKey, envelope, 'dist/a.zip')).toEqual(plaintext)
        await expect(decryptFileDownload(keys.privateKey, envelope, 'dist/b.zip')).rejects.toThrow()

        const other = await createDownloadKeyPair()
        await expect(decryptFileDownload(other.privateKey, envelope, 'dist/a.zip')).rejects.toThrow()
    })

    it('rejects files over the size limit', async () => {
        const { app } = createApp(async () => ({ success: true, content: '', size: 999, truncated: true }))
        const keys = await createDownloadKeyPair()
        const response = await download(app, { path: 'big.bin', publicKey: keys.publicKey })
        expect(response.status).toBe(413)
    })

    it('rejects an invalid public key', async () => {
        const { app } = createApp(async () => ({ success: true, content: 'AA==', size: 1, truncated: false }))
        const response = await download(app, { path: 'a.txt', publicKey: 'not-a-key' })
        expect(response.status).toBe(400)
    })

    it('needs YOLO mode for paths outside the workspace', async () => {
        const { app, engine } = createApp(async () => ({ success: true, content: '', size: 0, truncated: false }))
        const keys = await createDownloadKeyPair()
        const response = await download(app, { path: '/etc/hosts', publicKey: keys.publicKey })
        expect(response.status).toBe(403)
        expect(engine.readSessionFile).not.toHaveBeenCalled()
    })
})
