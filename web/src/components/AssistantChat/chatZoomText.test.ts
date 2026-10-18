import { describe, expect, it } from 'vitest'
import { LeveledText } from '@/vendor/semantic-zoom'
import { extractConclusion, replyZoomVersions, stripInline, userZoomVersions } from './chatZoomText'

const PROGRESS_REPLY = [
    '进度：',
    '',
    '1. 完成了什么：修复已经提交到本地，提交是 `abc1234`，分支 `fix/date-units`，没有推送。针对性测试 34 个全部通过。',
    '2. 正在做什么：后台在重跑完整测试，我猜要 15–30 分钟。',
    '',
    '| 项目 | 修复前 | 修复后 |',
    '|---|---|---|',
    '| 日期单位 | 代码当成「天」 | 改成「年」 |'
].join('\n')

describe('extractConclusion', () => {
    it('skips a lead-in and takes the first sentence that says something', () => {
        expect(extractConclusion(PROGRESS_REPLY)).toBe('完成了什么：修复已经提交到本地，提交是 abc1234，分支 fix/date-units，没有推送。')
    })

    it('joins a too-short first sentence with the next one', () => {
        expect(extractConclusion('抱歉。前两次我都写了回答。这次直接回答：')).toBe('抱歉。前两次我都写了回答。')
    })

    it('strips Markdown and clips a long sentence', () => {
        const long = `**还在用**，${'每次收到一个新的请求都会检查一次，'.repeat(6)}`
        const brief = extractConclusion(long)
        expect(brief.startsWith('还在用，')).toBe(true)
        expect(brief.endsWith('…')).toBe(true)
        expect(brief.length).toBeLessThanOrEqual(91)
    })

    it('reads English sentences', () => {
        expect(extractConclusion('## Result\n\nThe fix is live. Tests passed.')).toBe('The fix is live.')
    })

    it('returns nothing for a reply that is only code', () => {
        expect(extractConclusion('```ts\nconst a = 1\n```')).toBe('')
    })
})

describe('replyZoomVersions', () => {
    it('marks replies with tables or code as not simple and leaves those blocks out of the prose', () => {
        const versions = replyZoomVersions(PROGRESS_REPLY)
        expect(versions.simple).toBe(false)
        expect(versions.full).not.toContain('|')
        expect(versions.full.split('\n')[1].startsWith('1. 完成了什么')).toBe(true)
    })

    it('escapes characters the morph would read as markup, and the brief morphs into the full text', () => {
        const versions = replyZoomVersions('Use `a*b` and see [docs](https://x.y). Then run \\\\ check.')
        expect(versions.simple).toBe(true)
        const text = LeveledText.fromVersions([versions.brief, versions.full])
        expect(text.textAt(0)).toBe('Use a*b and see docs.')
        expect(LeveledText.checkVersions([versions.brief, versions.full]).isStrict).toBe(true)
    })
})

describe('userZoomVersions', () => {
    it('keeps the first line, clipped', () => {
        const versions = userZoomVersions('话说这个服务我们还在用吗\n\n这个问题我问了两遍，你为什么不回答我')
        expect(versions.brief).toBe('话说这个服务我们还在用吗')
        expect(versions.full).toBe('话说这个服务我们还在用吗\n这个问题我问了两遍，你为什么不回答我')
    })
})

describe('stripInline', () => {
    it('keeps snake_case words and literal asterisks', () => {
        expect(stripInline('the email_domain set, 5 * 3')).toBe('the email_domain set, 5 * 3')
        expect(stripInline('*italic* and _also_')).toBe('italic and also')
    })
})
