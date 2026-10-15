import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { NewSessionDefaultsStore } from './newSessionDefaults'
import { createSettingsRoutes } from '../web/routes/settings'
import { createSessionsRoutes } from '../web/routes/sessions'

let dir: string
let file: string

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'new-session-defaults-'))
    file = join(dir, 'new-session-defaults.json')
})

afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
})

function authedApp(mount: (app: Hono<any>) => void) {
    const app = new Hono<any>()
    app.use('/api/*', async (c, next) => {
        c.set('namespace', 'default')
        await next()
    })
    mount(app)
    return app
}

describe('NewSessionDefaultsStore', () => {
    it('keeps the form choice per namespace and reads it back after a restart', async () => {
        const store = new NewSessionDefaultsStore(file)
        const saved = await store.replace('default', { agent: 'claude', model: 'claude-opus-5-5', thinkEffort: 'high', yoloMode: true })
        expect(saved.updatedAt).toBeGreaterThan(0)

        const reopened = new NewSessionDefaultsStore(file)
        expect(await reopened.get('default')).toEqual(saved)
        expect(await reopened.get('other')).toBeNull()
    })

    it('a model switched in a chat replaces the remembered model and clears the custom one', async () => {
        const store = new NewSessionDefaultsStore(file)
        await store.replace('default', { agent: 'claude', model: 'sonnet', customModel: 'my-model', thinkEffort: 'high', yoloMode: false })

        await store.rememberChatChange('default', 'claude', { model: 'claude-opus-5-5' })
        await store.rememberChatChange('default', 'claude', { thinkEffort: 'max' })

        expect(await store.get('default')).toMatchObject({
            agent: 'claude', model: 'claude-opus-5-5', customModel: '', thinkEffort: 'max', yoloMode: false
        })
    })

    it('a chat of another agent does not change the remembered agent', async () => {
        const store = new NewSessionDefaultsStore(file)
        const saved = await store.replace('default', { agent: 'claude', model: 'sonnet' })

        expect(await store.rememberChatChange('default', 'codex', { model: 'gpt-6-sol' })).toBeNull()
        expect(await store.get('default')).toEqual(saved)
    })

    it('a Claude chat switch is remembered before the form was ever used', async () => {
        const store = new NewSessionDefaultsStore(file)
        await store.rememberChatChange('default', 'claude', { model: 'claude-opus-5-5' })
        expect(await store.get('default')).toMatchObject({ agent: 'claude', model: 'claude-opus-5-5' })
        expect(await store.rememberChatChange('other', 'codex', { model: 'gpt-6-sol' })).toBeNull()
    })

    it('ignores a broken file and entries that do not validate', async () => {
        writeFileSync(file, '{not json')
        expect(await new NewSessionDefaultsStore(file).get('default')).toBeNull()

        writeFileSync(file, JSON.stringify({ default: { agent: 'nope', updatedAt: 1 }, ok: { model: 'sonnet', updatedAt: 2 } }))
        const store = new NewSessionDefaultsStore(file)
        expect(await store.get('default')).toBeNull()
        expect(await store.get('ok')).toEqual({ model: 'sonnet', updatedAt: 2 })
    })

    it('serializes concurrent writes so none is lost', async () => {
        const store = new NewSessionDefaultsStore(file)
        await Promise.all([
            store.replace('a', { model: 'sonnet' }),
            store.replace('b', { model: 'opus' }),
            store.rememberChatChange('a', 'claude', { thinkEffort: 'low' })
        ])
        const onDisk = JSON.parse(readFileSync(file, 'utf8'))
        expect(onDisk.a).toMatchObject({ model: 'sonnet', thinkEffort: 'low' })
        expect(onDisk.b).toMatchObject({ model: 'opus' })
    })
})

describe('new session defaults routes', () => {
    it('saves and returns the form choice, rejecting invalid values', async () => {
        const store = new NewSessionDefaultsStore(file)
        const app = authedApp((app) => app.route('/api', createSettingsRoutes({} as never, () => store)))

        const empty = await app.request('/api/settings/new-session-defaults')
        expect(await empty.json()).toEqual({ defaults: null })

        const bad = await app.request('/api/settings/new-session-defaults', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ thinkEffort: 'extreme' })
        })
        expect(bad.status).toBe(400)

        const put = (body: unknown) => app.request('/api/settings/new-session-defaults', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        })
        expect((await put({ claudeAccountId: 'Not Valid!' })).status).toBe(400)
        expect((await put({ agent: 'claude', model: 'claude-opus-5-5', thinkEffort: 'high', yoloMode: true, claudeAccountId: 'account-1', extra: 'dropped' })).status).toBe(200)

        const got = await (await app.request('/api/settings/new-session-defaults')).json() as { defaults: Record<string, unknown> }
        expect(got.defaults).toMatchObject({ agent: 'claude', model: 'claude-opus-5-5', thinkEffort: 'high', yoloMode: true, claudeAccountId: 'account-1' })
        expect(got.defaults.extra).toBeUndefined()

        // An empty account means the machine default login.
        expect((await put({ agent: 'claude', model: 'sonnet', claudeAccountId: '' })).status).toBe(200)
        expect(await store.get('default')).toMatchObject({ model: 'sonnet', claudeAccountId: '' })
    })

    it('a model or thinking switch inside a chat becomes the new default', async () => {
        const store = new NewSessionDefaultsStore(file)
        await store.replace('default', { agent: 'claude', model: 'sonnet', thinkEffort: 'high' })
        const applySessionConfig = mock(async () => {})
        const engine = {
            resolveSessionAccess: () => ({
                ok: true,
                sessionId: 'session-1',
                session: { id: 'session-1', active: true, metadata: { flavor: 'claude' } }
            }),
            applySessionConfig
        }
        const app = authedApp((app) => app.route('/api', createSessionsRoutes(() => engine as never, () => store)))
        const post = (path: string, body: unknown) => app.request(`/api/sessions/session-1/${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        })

        expect((await post('model', { model: 'claude-opus-5-5' })).status).toBe(200)
        expect((await post('think-effort', { thinkEffort: 'max' })).status).toBe(200)
        expect(applySessionConfig).toHaveBeenCalledTimes(2)
        expect(await store.get('default')).toMatchObject({ agent: 'claude', model: 'claude-opus-5-5', thinkEffort: 'max' })

        expect((await post('model', { model: 'default' })).status).toBe(200)
        expect(await store.get('default')).toMatchObject({ model: 'auto' })
    })

    it('a failed switch is not remembered', async () => {
        const store = new NewSessionDefaultsStore(file)
        await store.replace('default', { agent: 'claude', model: 'sonnet' })
        const engine = {
            resolveSessionAccess: () => ({
                ok: true,
                sessionId: 'session-1',
                session: { id: 'session-1', active: true, metadata: { flavor: 'claude' } }
            }),
            applySessionConfig: async () => { throw new Error('rpc failed') }
        }
        const app = authedApp((app) => app.route('/api', createSessionsRoutes(() => engine as never, () => store)))
        const res = await app.request('/api/sessions/session-1/model', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'claude-opus-5-5' })
        })
        expect(res.status).toBe(409)
        expect(await store.get('default')).toMatchObject({ model: 'sonnet' })
    })
})
