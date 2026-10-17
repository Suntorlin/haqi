import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../store'
import { MemoryService } from './service'

/** A fake Jev: answers by keywords in the candidate, and matches anything containing "备份". */
function fakeJev(calls: string[]): typeof fetch {
    return (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { state: { candidate: string }; questions: Record<string, { criteria?: Record<string, unknown> }> }
        const text = body.state.candidate
        calls.push(text)
        const level = text.includes('一律') ? 'principle' : text.includes('10-') ? 'fact' : 'experience'
        const matchId = Object.keys(body.questions.match?.criteria ?? {}).find((id) => id !== 'none' && text.includes('备份'))
        const answers: Record<string, unknown> = {
            keep: { type: 'noul', noul: text.includes('好的') ? 0.05 : 0.9 },
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
        expect(await propose('fish 的工单规则', { project: 'fish' })).toMatchObject({ action: 'not-enabled' })
        expect(await propose('发正式站前先备份 dist，出问题直接拷回去')).toMatchObject({ action: 'duplicate' })

        expect(calls.some((text) => text.includes('Tr0ub4dor'))).toBe(false)
        expect(calls.some((text) => text.includes('fish'))).toBe(false)

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
