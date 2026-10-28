import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'

import { Store } from '../store'
import { fileNameFor, folderFromHistory, indexLine, normalizeFolder, readHandoffMeta, rewriteAssets, upsertIndexLine } from './handoff'
import { HandoffService, type HandoffHost, type HandoffSession } from './handoffService'

const BODY = `# 交接\n\n${'结论和数据。'.repeat(60)}\n\n![架构图](asset://a1)\n`

describe('handoff rules', () => {
    it('keeps folders inside the notes root', () => {
        expect(normalizeFolder('01 项目/HAQI/')).toBe('01 项目/HAQI')
        expect(normalizeFolder('/etc')).toBeNull()
        expect(normalizeFolder('a/../../b')).toBeNull()
    })

    it('reads only reports marked as handoffs', () => {
        expect(readHandoffMeta({ other: 1 })).toBeNull()
        expect(readHandoffMeta({ handoff: { folder: 'a', summary: ' 结论 ' } })).toEqual({ folder: 'a', summary: '结论', shortTitle: null })
    })

    it('links report images to the web report instead of copying them', () => {
        expect(rewriteAssets('![图一](asset://x) 和 [附件](asset://y)', 'https://h/share/r/t'))
            .toBe('（图：图一，见[网页报告](https://h/share/r/t)） 和 [附件](https://h/share/r/t)')
    })

    it('replaces the line of the same document in place and adds new ones on top', () => {
        const index = '---\ntags: x\n---\n- old [[a/b|B]]：旧\n- other'
        const updated = upsertIndexLine(index, ['a/b'], '- new [[a/b|B]]：新')
        expect(updated).toBe('---\ntags: x\n---\n- new [[a/b|B]]：新\n- other')
        expect(upsertIndexLine(updated, ['c/d'], '- top').split('\n')[3]).toBe('- top')
    })

    it('keeps a project to its folder only when it clearly uses one', () => {
        expect(folderFromHistory([{ folder: 'a', count: 9 }, { folder: 'b', count: 1 }])).toBe('a')
        expect(folderFromHistory([{ folder: 'a', count: 5 }, { folder: 'b', count: 4 }])).toBeNull()
        expect(folderFromHistory([{ folder: 'a', count: 1 }])).toBeNull()
    })

    it('names files and index lines the way the notes already do', () => {
        expect(fileNameFor('方案: A/B', '2026-10-28')).toBe('方案 A B 2026-10-28.md')
        expect(fileNameFor('交接 2026-10-27', '2026-10-28')).toBe('交接 2026-10-27.md')
        expect(indexLine({ date: '2026-10-28', time: '14:05', zoneLabel: 'JST', linkPath: 'a/b', shortTitle: 'B', summary: '结论。', shareUrl: null, stale: true, inbox: false }))
            .toBe('- 2026-10-28 14:05 JST：【报告可能过时】[[a/b|B]]：结论。')
    })
})

describe('HandoffService', () => {
    let root: string
    let store: Store
    let sessions: Map<string, HandoffSession>
    let activity: Map<string, number>
    let sent: Array<{ sessionId: string; text: string }>
    let alerts: string[]
    let service: HandoffService

    beforeEach(() => {
        root = mkdtempSync(join(tmpdir(), 'handoff-'))
        mkdirSync(join(root, '项目', 'HAQI'), { recursive: true })
        store = new Store(':memory:')
        sessions = new Map()
        activity = new Map()
        sent = []
        alerts = []
        const host: HandoffHost = {
            config: async () => ({ root, index: '总入口.md', inbox: '待归档', timeZone: 'Asia/Tokyo', zoneLabel: 'JST' }),
            session: (id) => sessions.get(id) ?? null,
            lastActivity: (id) => activity.get(id) ?? null,
            send: async (sessionId, text) => { sent.push({ sessionId, text }); return true },
            shareUrl: () => 'https://h/share/r/t',
            project: () => 'haqi',
            alert: async (_namespace, alert) => { alerts.push(alert.title) }
        }
        service = new HandoffService(store, host)
    })

    afterEach(() => {
        service.stop()
        rmSync(root, { recursive: true, force: true })
    })

    function handoffReport(metadata: unknown, markdown = BODY) {
        const session = store.sessions.getOrCreateSession(`s-${Math.random()}`, { path: '/repo' }, null, 'default')
        sessions.set(session.id, { namespace: 'default', active: false, thinking: false, path: '/repo' })
        const report = store.reports.createReport({ namespace: 'default', sessionId: session.id, title: '导出器 交接', markdown, metadata })
        return { report, sessionId: session.id }
    }

    it('copies the report word for word, lists it once, and leaves a hand-edited copy alone', async () => {
        const { report } = handoffReport({ handoff: { folder: '项目/HAQI', summary: '导出器已上线' } })
        await service.process(report.id)

        const file = join(root, '项目', 'HAQI', `导出器 交接 ${new Date(report.createdAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' })}.md`)
        const copy = readFileSync(file, 'utf8')
        expect(copy).toContain(`haqi_report: ${report.id}`)
        expect(copy).toContain('结论和数据。'.repeat(60))
        expect(copy).toContain('（图：架构图，见[网页报告](https://h/share/r/t)）')
        const index = readFileSync(join(root, '总入口.md'), 'utf8')
        expect(index).toContain('[[项目/HAQI/导出器 交接')
        expect(index).toContain('导出器已上线。[网页报告](https://h/share/r/t)')

        writeFileSync(file, `${copy}\n我手写的补充\n`)
        store.reports.updateReport({ id: report.id, namespace: 'default', markdown: `${BODY}\n新进展` })
        await service.process(report.id)

        const after = readFileSync(file, 'utf8')
        expect(after).toContain('我手写的补充')
        expect(after).toMatch(/## HAQI 更新 .*\n\n[\s\S]*新进展/)
        expect(readFileSync(join(root, '总入口.md'), 'utf8').split('\n').filter((line) => line.includes('[[项目/HAQI/')).length).toBe(1)
    })

    it('asks a live session to bring a stale report up to date before copying, once per version', async () => {
        const { report, sessionId } = handoffReport({ handoff: { folder: '项目/HAQI', summary: 's' } })
        sessions.set(sessionId, { namespace: 'default', active: true, thinking: false, path: '/repo' })
        activity.set(sessionId, report.updatedAt + 60 * 60_000)

        await service.process(report.id)
        expect(sent).toHaveLength(1)
        expect(sent[0]!.text).toContain('report_update')
        expect(readdirSync(join(root, '项目', 'HAQI'))).toHaveLength(0)

        await service.process(report.id)
        expect(sent).toHaveLength(1)
        expect(readFileSync(join(root, '总入口.md'), 'utf8')).toContain('【报告可能过时】')
    })

    it('files a report with no usable folder in the inbox and does not copy an empty one', async () => {
        const { report } = handoffReport({ handoff: { folder: '../outside' } })
        await service.process(report.id)
        expect(readdirSync(join(root, '待归档'))).toHaveLength(1)
        expect(readFileSync(join(root, '总入口.md'), 'utf8')).toContain('【待归档】')

        const empty = handoffReport({ handoff: { folder: '项目/HAQI' } }, '只有一句')
        await service.process(empty.report.id)
        expect(alerts).toEqual(['交接报告没有内容，没有复制到笔记库'])
        expect(store.handoffs.get(empty.report.id)?.status).toBe('empty')
    })
})
