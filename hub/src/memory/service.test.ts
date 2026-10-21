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

const topicOf = (text: string) => TOPICS.findIndex((words) => words.some((word) => text.includes(word)))

/**
 * A fake Jev: answers by keywords in the candidate, and matches anything containing "备份" or "推送"; "the same memory?"
 * is yes when both share a topic word. The chat model joins merged notes with " / ". Embedding requests get fake vectors.
 */
function fakeJev(calls: string[]): typeof fetch {
    return (async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/chat/completions')) {
            const content = (JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages[1]!.content
            if (content.startsWith('notes:')) {
                const notes = content.split('\n\n')[0]!.split('\n').slice(1).map((line) => line.replace(/^\d+\. /, ''))
                calls.push(`rewrite:${notes.length}`)
                return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ text: notes.join(' / ') }) } }], usage: { cost: 0.0002 } }), { status: 200 })
            }
            const message = (JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages[1]!.content.split('message:\n')[1]!.split('\n\nWrite every')[0]!
            const rules = message.includes('以后') ? [{ text: `长期规则：${message.replace('以后', '')}`, quote: message }] : []
            return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ rules }) } }], usage: { cost: 0.0004 } }), { status: 200 })
        }
        if (String(url).endsWith('/embeddings')) {
            const input = (JSON.parse(String(init?.body)) as { input: string[] }).input
            return new Response(JSON.stringify({ data: input.map((text, index) => ({ index, embedding: fakeVector(text) })), usage: { cost: 0.000001 } }), { status: 200 })
        }
        const body = JSON.parse(String(init?.body)) as { state: { candidate: string; message?: string }; questions: Record<string, { criteria?: Record<string, unknown> }> }
        if (body.questions.lasting) {
            calls.push(`gate:${body.state.message}`)
            const yes = body.state.message!.includes('以后') ? 0.9 : 0.1
            return new Response(JSON.stringify({ answers: { lasting: { type: 'noul', noul: yes } }, usage: { cost: 0.00005 }, model: 'jev-test' }), { status: 200 })
        }
        const text = body.state.candidate
        const same = Object.keys(body.questions).filter((key) => key.startsWith('same'))
        if (same.length > 0) {
            calls.push(`same:${text}`)
            const answers = Object.fromEntries(same.map((key) => {
                const entry = (body.questions[key] as unknown as { instructions: { entry: string } }).instructions.entry
                // "大概" (roughly) in either note makes Jev unsure: the user is asked, nothing merges by itself.
                const yes = topicOf(text) < 0 || topicOf(text) !== topicOf(entry) ? 0.05 : text.includes('大概') || entry.includes('大概') ? 0.6 : 0.95
                return [key, { type: 'noul', noul: yes }]
            }))
            return new Response(JSON.stringify({ answers, usage: { cost: 0.00005 }, model: 'jev-test' }), { status: 200 })
        }
        calls.push(text)
        const level = text.includes('一律') ? 'principle' : text.includes('10-') ? 'fact' : 'experience'
        const matchId = Object.keys(body.questions.match?.criteria ?? {}).find((id) => id !== 'none' && (text.includes('备份') || text.includes('推送')))
        const answers: Record<string, unknown> = {
            keep: { type: 'noul', noul: text.includes('好的') ? 0.05 : text.includes('下次') ? 0.5 : 0.9 },
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

        expect(await propose('发正式站前先备份 dist，出问题直接拷回去', { said: true })).toMatchObject({ action: 'candidate', message: expect.stringContaining('agent 记的') })
        expect(await propose('发布一律先备份再替换入口文件', { source: 'user_message' })).toMatchObject({ action: 'pending', message: expect.stringContaining('等你审批') })
        expect(await propose('部署前记得备份 dist 目录')).toMatchObject({ action: 'reinforced' })
        expect(await propose('好的，继续吧')).toMatchObject({ action: 'skipped' })
        expect(await propose('也许下次可以换个思路')).toMatchObject({ action: 'skipped' })
        expect(await propose('测试库密码是 Tr0ub4dor&3')).toMatchObject({ action: 'rejected' })
        expect(await propose('fish 的工单规则', { project: 'fish' })).toMatchObject({ action: 'not-enabled' })
        expect(await propose('发正式站前先备份 dist，出问题直接拷回去')).toMatchObject({ action: 'duplicate' })

        expect(calls.some((text) => text.includes('Tr0ub4dor'))).toBe(false)
        expect(calls.some((text) => text.includes('fish'))).toBe(false)

        const snapshot = await service.snapshot('default')
        // The agent's claim that the user said it does not count.
        expect(snapshot.memories.map((m) => [m.level, m.status, m.support, m.said]).sort()).toEqual([['experience', 'candidate', 2, false], ['principle', 'pending', 1, true]])
        expect(snapshot.links).toHaveLength(1)
        expect(snapshot.stats).toMatchObject({ addedToday: 2, skippedToday: 3 })
        expect(snapshot.recent.find((e) => e.action === 'rejected')?.text).toBe('（含密钥，原文没有保存）')
        expect(changes.length).toBeGreaterThan(0)

        const pending = snapshot.memories.find((m) => m.status === 'pending')
        expect(service.edit('default', pending!.id, { level: 'experience' })).toMatchObject({ level: 'experience', overridden: { level: 'experience' } })
        expect(service.confirm('default', pending!.id)).toMatchObject({ status: 'active', reason: null })
        ;(store as unknown as { db: Database }).db.close()
    })

    it('reads the user\'s own messages, skips what they did not write, and sends the rules for approval', async () => {
        const store = new Store(':memory:')
        const calls: string[] = []
        const settingsFile = join(dir, 'settings-read.json')
        const service = new MemoryService(store, { paths: () => ({ dataDir: dir, settingsFile }), onChange: () => {}, fetchFn: fakeJev(calls) })
        const session = store.sessions.getOrCreateSession('read', {}, null, 'default')
        const user = (text: string) => store.messages.addMessage(session.id, { role: 'user', content: { type: 'text', text } })
        user('以后汇报一律先写结论')
        user('这个按钮改成绿色')
        user('This session is being continued from a previous conversation that ran out of context. 以后')
        user('<local-command-stdout>以后都这样</local-command-stdout>')
        user('好')

        expect(await service.readUserMessages('default')).toMatchObject({ read: 2, passed: 1, proposed: 1 })
        expect(calls.filter((c) => c.startsWith('gate:'))).toEqual(['gate:以后汇报一律先写结论', 'gate:这个按钮改成绿色'])
        const [memory] = store.memories.list('default')
        expect(memory).toMatchObject({ status: 'pending', said: true, source: 'user_message', sourceLabel: '你说：「以后汇报一律先写结论」', sessionId: session.id })

        // The user saying what an agent noted backs it: it goes up for approval and keeps the evidence under the rule.
        const agentNote = store.memories.insert({
            namespace: 'default', text: '部署前先备份 dist', level: 'experience', scope: '', status: 'active', reason: null, source: 'claude_auto', sourceLabel: null,
            sessionId: null, said: true, support: 1, jev: null, overridden: null, replaces: null
        })
        expect(await service.propose({ namespace: 'default', text: '以后部署前记得备份 dist', said: true, source: 'user_message', sourceLabel: null, sessionId: null, project: 'haqi' })).toMatchObject({ action: 'reinforced', memoryId: agentNote.id })
        await service.maintain('default')
        expect(store.memories.get(agentNote.id, 'default')).toMatchObject({ status: 'pending', said: true, reason: '你说过' })

        // Read once: the next run starts after the last message.
        user('以后发布一律先备份')
        expect(await service.readUserMessages('default')).toMatchObject({ read: 1, proposed: 1 })
        expect(calls.filter((c) => c.startsWith('gate:'))).toHaveLength(3)
        ;(store as unknown as { db: Database }).db.close()
    })

    it('applies the rule to what is already stored: agents\' memories are watched again, the user\'s stay', async () => {
        const store = new Store(':memory:')
        const service = new MemoryService(store, { paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings-rule.json') }), onChange: () => {}, fetchFn: fakeJev([]) })
        const insert = (text: string, source: string, status: 'active' | 'pending', said: boolean) => store.memories.insert({
            namespace: 'default', text, level: 'principle', scope: '', status, reason: null, source, sourceLabel: null,
            sessionId: null, said, support: 1, jev: null, overridden: null, replaces: null
        })
        const agentActive = insert('agent 说用户喜欢短句', 'claude_auto', 'active', true)
        const agentPending = insert('agent 觉得要先跑 lint', 'propose', 'pending', false)
        const written = insert('回复用中文', 'import', 'active', true)
        const approved = insert('agent 记的但你点过确认', 'claude_auto', 'pending', false)
        service.confirm('default', approved.id)

        expect(await service.maintain('default')).toMatchObject({ moved: 2 })
        expect(store.memories.get(agentActive.id, 'default')).toMatchObject({ status: 'candidate', said: false })
        expect(store.memories.get(agentPending.id, 'default')).toMatchObject({ status: 'candidate' })
        expect(store.memories.get(written.id, 'default')).toMatchObject({ status: 'active', said: true })
        expect(store.memories.get(approved.id, 'default')).toMatchObject({ status: 'active', said: false })
        expect(await service.maintain('default')).toMatchObject({ moved: 0 })
        ;(store as unknown as { db: Database }).db.close()
    })

    it('tells the user once a batch waits for approval, and approves them in one go', async () => {
        const store = new Store(':memory:')
        const notices: string[] = []
        const service = new MemoryService(store, {
            paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings-notify.json') }),
            onChange: () => {},
            fetchFn: fakeJev([]),
            notify: async (_namespace, notice) => { notices.push(notice.body) }
        })
        const add = (n: number) => {
            for (let i = 0; i < n; i++) {
                store.memories.insert({
                    namespace: 'default', text: `你说的第 ${store.memories.list('default').length} 条`, level: 'principle', scope: '', status: 'pending', reason: '你说过',
                    source: 'user_message', sourceLabel: null, sessionId: null, said: true, support: 1, jev: null, overridden: null, replaces: null
                })
            }
        }
        add(9)
        await service.maintain('default')
        expect(notices).toEqual([])
        add(1)
        await service.maintain('default')
        await service.maintain('default')
        expect(notices).toEqual(['攒了 10 条记忆，点开一次看完。'])
        add(10)
        await service.maintain('default')
        expect(notices).toHaveLength(2)

        expect(service.confirmAll('default')).toBe(20)
        await service.maintain('default')
        add(10)
        await service.maintain('default')
        expect(notices).toHaveLength(3)
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
        expect(await propose('也许推送前先预热缓存会快一些')).toMatchObject({ action: 'reinforced', message: expect.stringContaining('交给你审批') })
        expect(store.memories.get(first.memoryId!, 'default')).toMatchObject({ status: 'pending', support: 3 })
        service.confirm('default', first.memoryId!)

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

    it('merges duplicates written in other words, asks Jev once per neighbourhood, and finds memories by meaning', async () => {
        const store = new Store(':memory:')
        const calls: string[] = []
        const service = new MemoryService(store, { paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings.json') }), onChange: () => {}, fetchFn: fakeJev(calls) })
        const insert = (text: string, status: 'active' | 'candidate', scope: string) => store.memories.insert({
            namespace: 'default', text, level: 'experience', scope, status, reason: null, source: status === 'active' ? 'import' : 'claude_auto', sourceLabel: null,
            sessionId: null, said: false, support: 1, jev: null, overridden: null, replaces: null
        })
        const kept = insert('禁止自动 push 到远程分支', 'active', '')
        const twin = insert('修复只本地提交，不要自己推送 push', 'candidate', 'haqi')
        const other = insert('回复一律用中文', 'active', '')
        // The offer to make it a principle is the same text on purpose; it is not a duplicate.
        const offer = store.memories.insert({ ...store.memories.get(kept.id, 'default')!, level: 'principle', status: 'pending', replaces: kept.id })

        expect(await service.maintain('default')).toMatchObject({ embedded: 4, merged: 1 })
        expect(store.memories.get(offer.id, 'default')?.status).toBe('pending')
        // The agent's twin is not approved, so the user's text stays as it was.
        expect(store.memories.get(kept.id, 'default')).toMatchObject({ status: 'active', support: 2, scope: '', text: '禁止自动 push 到远程分支' })
        expect(store.memories.get(twin.id, 'default')?.status).toBe('archived')
        expect(store.memories.get(other.id, 'default')?.status).toBe('active')
        expect(calls.filter((call) => call.startsWith('rewrite'))).toEqual([])

        // Nothing changed around any memory: Jev is not asked again.
        calls.length = 0
        await service.maintain('default')
        expect(calls.filter((call) => call.startsWith('same'))).toEqual([])

        expect((await service.search('default', '能不能推送')).map((hit) => hit.memory.id).sort()).toEqual([kept.id, offer.id].sort())
        expect((await service.search('default', '中文')).map((hit) => hit.memory.id)).toEqual([other.id])
        ;(store as unknown as { db: Database }).db.close()
    })

    it('merges what the user picks into one written again, and undoes it', async () => {
        const store = new Store(':memory:')
        const calls: string[] = []
        const service = new MemoryService(store, { paths: () => ({ dataDir: dir, settingsFile: join(dir, 'settings.json') }), onChange: () => {}, fetchFn: fakeJev(calls) })
        const insert = (text: string, status: 'active' | 'pending' | 'candidate', level: 'fact' | 'experience' | 'principle', scope: string) => store.memories.insert({
            namespace: 'default', text, level, scope, status, reason: status === 'pending' ? '你说过' : null, source: 'import', sourceLabel: null,
            sessionId: null, said: status !== 'candidate', support: 2, jev: null, overridden: null, replaces: null
        })
        const a = insert('发布前先备份 dist', 'active', 'principle', 'haqi')
        const b = insert('备份大概放在 ~/.hapi/backups', 'pending', 'experience', '')
        const c = insert('10-20 大概备份过一次', 'candidate', 'fact', 'haqi')
        const unrelated = insert('回复一律用中文', 'active', 'principle', '')
        store.memories.link('default', c.id, b.id)
        // Jev is unsure about each pair, so housekeeping merges nothing.
        expect(await service.maintain('default')).toMatchObject({ merged: 0 })

        // Jev keeps only the ones that may be the same.
        expect((await service.related('default', a.id)).map((hit) => hit.memory.id).sort()).toEqual([b.id, c.id].sort())

        const preview = await service.previewMerge('default', [b.id, a.id, c.id])
        expect(preview).toMatchObject({ keepId: a.id, rewritten: true, level: 'principle', scope: '', status: 'active', support: 6 })
        expect(preview!.text).toContain('备份大概放在 ~/.hapi/backups')
        expect(store.memories.get(b.id, 'default')?.status).toBe('pending')

        const merged = await service.mergeMany('default', [b.id, a.id, c.id], '发布前先备份 dist，备份放在 ~/.hapi/backups')
        expect(merged!.memory).toMatchObject({ id: a.id, text: '发布前先备份 dist，备份放在 ~/.hapi/backups', support: 6, scope: '', status: 'active', version: 2 })
        expect([b.id, c.id].map((id) => store.memories.get(id, 'default')?.status)).toEqual(['archived', 'archived'])
        expect(store.memories.links('default').map((l) => [l.fromId, l.toId])).toContainEqual([c.id, b.id])
        expect(service.undoableMerges('default')[a.id]?.drops.map((d) => d.id).sort()).toEqual([b.id, c.id].sort())

        expect(service.undoMerge('default', merged!.eventId)).toMatchObject({ id: a.id, text: '发布前先备份 dist', support: 2, scope: 'haqi', status: 'active' })
        expect(store.memories.get(b.id, 'default')).toMatchObject({ status: 'pending', reason: '你说过' })
        expect(store.memories.get(c.id, 'default')?.status).toBe('candidate')
        expect(store.memories.links('default').map((l) => [l.fromId, l.toId])).toEqual([[c.id, b.id]])
        expect(service.undoableMerges('default')).toEqual({})
        expect(service.undoMerge('default', merged!.eventId)).toBeNull()

        // Without a text from the preview, the merge writes one itself.
        calls.length = 0
        const again = await service.mergeMany('default', [a.id, b.id])
        expect(again!.memory.text).toBe('发布前先备份 dist / 备份大概放在 ~/.hapi/backups')
        expect(calls).toContain('rewrite:2')
        expect(await service.mergeMany('default', [a.id, b.id])).toBeNull()

        expect(service.archiveMany('default', [c.id, unrelated.id, b.id])).toBe(2)
        expect(store.memories.list('default').map((m) => m.id)).toEqual([a.id])
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
        // Not under /tmp (the Linux temp folder), which the project list leaves out on purpose, and not inside a git repository.
        const busy = mkdtempSync(join('/var/tmp', 'proj-busy-'))
        const quiet = mkdtempSync(join('/var/tmp', 'proj-quiet-'))
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
