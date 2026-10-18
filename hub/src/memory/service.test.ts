import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../store'
import { MemoryService } from './service'

/** Fake embeddings: one axis per topic word, so texts sharing a topic read as close. */
const TOPICS = [['备份'], ['dist'], ['推送', 'push'], ['中文']]
function fakeVector(text: string): number[] {
    return [...TOPICS.map((words) => (words.some((word) => text.includes(word)) ? 1 : 0)), 0.01]
}

/** A fake Jev: answers by keywords in the candidate, and matches anything containing "备份" or "推送". Embedding requests get fake vectors. */
function fakeJev(calls: string[]): typeof fetch {
    return (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/embeddings')) {
            const input = (JSON.parse(String(init?.body)) as { input: string[] }).input
            return new Response(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: fakeVector(text) })), usage: { cost: 0.000001 } }), { status: 200 })
        }
        const body = JSON.parse(String(init?.body)) as { state: { candidate: string }; questions: Record<string, { criteria?: Record<string, unknown> }> }
        const text = body.state.candidate
        calls.push(text)
        const level = text.includes('一律') ? 'principle' : text.includes('10-') ? 'fact' : 'experience'
        const matchId = Object.keys(body.questions.match?.criteria ?? {}).find((id) => id !== 'none' && (text.includes('备份') || text.includes('推送')))
        const answers: Record<string, unknown> = {
            keep: { type: 'noul', noul: text.includes('好的') ? 0.05 : text.includes('也许') ? 0.5 : 0.9 },
            level: { type: 'choice', choice: level, probabilities: { [level]: 0.9 }, confidence: 0.85 },
            scope: { type: 'choice', choice: 'project', probabilities: { project: 0.9 }, confidence: 0.9 },
            secret: { type: 'noul', noul: 0.01 }
        }
        if (body.questions.match) answers.match = { type: 'choice', choice: matchId ?? 'none', probabilities: {}, confidence: 0.95 }
        return new Response(JSON.stringify({ answers, usage: { cost: 0.00005 }, model: 'jev-test' }), { status: 200 })
    }) as typeof fetch
}

describe('MemoryService.propose', () => {
    let dir = ''
    const previousKey = process.env.JEV_API_KEY
    beforeAll(() => {
        dir = mkdtempSync(join(tmpdir(), 'haqi-memory-'))
        process.env.JEV_API_KEY = 'test-key'
    })
    afterAll(() => {
        rmSync(dir, { recursive: true, force: true })
        if (previousKey === undefined) delete process.env.JEV_API_KEY
        else process.env.JEV_API_KEY = previousKey
    })

    it('runs the one rule end to end and never sends secrets or disabled projects', async () => {
        const store = new Store(':memory:')
        const calls: string[] = []
        const changes: string[] = []
        const service = new MemoryService(store, {
            paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings.json') }),
            onChange: (namespace) => changes.push(namespace),
            fetchFn: fakeJev(calls)
        })
        const propose = (text: string, extra: Partial<Parameters<MemoryService['propose']>[0]> = {}) =>
            service.propose({ namespace: 'default', text, said: false, source: 'propose', sourceLabel: null, sessionId: null, project: 'haqi', ...extra })

        expect(await propose('发正式站前先备份 dist，出问题直接拷回去')).toMatchObject({ action: 'added', message: '已记下：经验 · haqi。' })
        expect(await propose('发布一律先备份再替换入口文件')).toMatchObject({ action: 'pending' })
        expect(await propose('部署前记得备份 dist 目录')).toMatchObject({ action: 'reinforced' })
        expect(await propose('好的，继续吧')).toMatchObject({ action: 'skipped' })
        expect(await propose('测试库密码是 Tr0ub4dor&3')).toMatchObject({ action: 'rejected' })
        expect(await propose('shop 的工单规则', { project: 'shop' })).toMatchObject({ action: 'not-enabled' })
        expect(await propose('发正式站前先备份 dist，出问题直接拷回去')).toMatchObject({ action: 'duplicate' })

        expect(calls.some((text) => text.includes('Tr0ub4dor'))).toBe(false)
        expect(calls.some((text) => text.includes('shop'))).toBe(false)

        const snapshot = await service.snapshot('default')
        expect(snapshot.memories.map((m) => [m.level, m.status, m.support]).sort()).toEqual([['experience', 'active', 2], ['principle', 'pending', 1]])
        expect(snapshot.links).toHaveLength(1)
        expect(snapshot.stats).toMatchObject({ addedToday: 2, skippedToday: 2 })
        expect(snapshot.recent.find((e) => e.action === 'rejected')?.text).toBe('（含密钥，原文没有保存）')
        expect(changes.length).toBeGreaterThan(0)

        const pending = snapshot.memories.find((m) => m.status === 'pending')
        expect(service.edit('default', pending!.id, { level: 'experience' })).toMatchObject({ level: 'experience', overridden: { level: 'experience' } })
        expect(service.confirm('default', pending!.id)).toMatchObject({ status: 'active', reason: null })
        ;(store as unknown as { db: Database }).db.close()
    })

    it('puts unsure memories on trial, promotes them by mentions and lets old ones go', async () => {
        const store = new Store(':memory:')
        const service = new MemoryService(store, { paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings.json') }), onChange: () => {}, fetchFn: fakeJev([]) })
        const propose = (text: string) => service.propose({ namespace: 'default', text, said: false, source: 'propose', sourceLabel: null, sessionId: null, project: 'haqi' })

        const first = await propose('也许周一构建慢是因为推送前缓存是冷的')
        expect(first).toMatchObject({ action: 'candidate' })
        expect(await propose('也许推送到 dev 前要等缓存热起来')).toMatchObject({ action: 'reinforced', memoryId: first.memoryId })
        expect(store.memories.get(first.memoryId!, 'default')?.status).toBe('candidate')
        expect(await propose('也许推送前先预热缓存会快一些')).toMatchObject({ action: 'reinforced', message: expect.stringContaining('已生效') })
        expect(store.memories.get(first.memoryId!, 'default')).toMatchObject({ status: 'active', support: 3 })

        const lonely = await propose('也许 lint 在 Node 26 上更慢')
        const db = (store as unknown as { db: Database }).db
        db.prepare('UPDATE memory_events SET created_at = ? WHERE memory_id = ?').run(Date.now() - 31 * 24 * 3600 * 1000, lonely.memoryId)
        expect(await service.maintain('default')).toMatchObject({ expired: 1 })
        expect(store.memories.get(lonely.memoryId!, 'default')?.status).toBe('archived')

        store.memories.update(first.memoryId!, 'default', { support: 5 })
        expect(await service.maintain('default')).toMatchObject({ offered: 1 })
        const offer = store.memories.list('default').find((m) => m.replaces === first.memoryId)
        expect(offer).toMatchObject({ level: 'principle', status: 'pending' })
        service.dismiss('default', offer!.id)
        expect(await service.maintain('default')).toMatchObject({ offered: 0 })
        db.close()
    })

    it('merges duplicates written in other words and finds memories by meaning', async () => {
        const store = new Store(':memory:')
        const service = new MemoryService(store, { paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings.json') }), onChange: () => {}, fetchFn: fakeJev([]) })
        const insert = (text: string, status: 'active' | 'candidate', scope: string) => store.memories.insert({
            namespace: 'default', text, level: 'experience', scope, status, reason: null, source: 'claude_auto', sourceLabel: null,
            sessionId: null, said: false, support: 1, jev: null, overridden: null, replaces: null
        })
        const kept = insert('禁止自动 push 到远程分支', 'active', '')
        const twin = insert('修复只本地提交，不要自己推送 push', 'candidate', 'haqi')
        const other = insert('回复一律用中文', 'active', '')

        expect(await service.maintain('default')).toMatchObject({ embedded: 3, merged: 1 })
        expect(store.memories.get(kept.id, 'default')).toMatchObject({ status: 'active', support: 2, scope: '' })
        expect(store.memories.get(twin.id, 'default')?.status).toBe('archived')
        expect(store.memories.get(other.id, 'default')?.status).toBe('active')

        expect((await service.search('default', '能不能推送')).map((hit) => hit.memory.id)).toEqual([kept.id])
        expect((await service.search('default', '中文')).map((hit) => hit.memory.id)).toEqual([other.id])
        ;(store as unknown as { db: Database }).db.close()
    })

    it('keeps everything for the user when Jev cannot answer', async () => {
        const store = new Store(':memory:')
        const service = new MemoryService(store, {
            paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings.json') }),
            onChange: () => {},
            fetchFn: (async () => new Response('down', { status: 503 })) as unknown as typeof fetch
        })
        const result = await service.propose({ namespace: 'default', text: '回复用中文，结论先行', said: true, source: 'import', sourceLabel: 'MEMORY.md', sessionId: null, project: null })
        expect(result.action).toBe('pending')
        expect(store.memories.list('default')[0]).toMatchObject({ status: 'pending', level: 'principle', scope: '' })
        ;(store as unknown as { db: Database }).db.close()
    })

    it('lists every project the user has sessions in, busiest first', async () => {
        const store = new Store(':memory:')
        const busy = mkdtempSync(join(tmpdir(), 'proj-busy-'))
        const quiet = mkdtempSync(join(tmpdir(), 'proj-quiet-'))
        store.sessions.getOrCreateSession('a', { path: busy }, null, 'default')
        store.sessions.getOrCreateSession('b', { path: busy }, null, 'default')
        store.sessions.getOrCreateSession('c', { path: quiet }, null, 'default')
        const service = new MemoryService(store, { paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings.json') }), onChange: () => {}, fetchFn: fakeJev([]) })
        const known = (await service.snapshot('default')).settings.knownProjects
        const names = known.map((p) => p.name)
        const busyName = busy.split('/').pop()!
        const quietName = quiet.split('/').pop()!
        expect(names.indexOf(busyName)).toBeLessThan(names.indexOf(quietName))
        expect(known.find((p) => p.name === busyName)).toMatchObject({ sessions: 2, path: busy })
        expect(names).toContain('haqi')
        rmSync(busy, { recursive: true, force: true })
        rmSync(quiet, { recursive: true, force: true })
        ;(store as unknown as { db: Database }).db.close()
    })

    it('turns capture off and limits projects from settings', async () => {
        const store = new Store(':memory:')
        const service = new MemoryService(store, { paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings.json') }), onChange: () => {}, fetchFn: fakeJev([]) })
        await service.updateSettings({ projects: ['haqi', 'agent-engine'] })
        expect((await service.getSettings()).projects).toEqual(['haqi', 'agent-engine'])
        await service.updateSettings({ mode: 'off' })
        expect(await service.propose({ namespace: 'default', text: '任何内容都不收', said: false, source: 'propose', sourceLabel: null, sessionId: null, project: 'haqi' })).toMatchObject({ action: 'off' })
        await service.updateSettings({ mode: 'record' })
        ;(store as unknown as { db: Database }).db.close()
    })
})
