import { describe, expect, it } from 'vitest'
import { reportMarkdownForApp, reportParts } from './ReportSheet'

describe('reportMarkdownForApp', () => {
    it('drops the title and splits the folded blocks into parts of their own', () => {
        const markdown = '# 任务\n\n**全部达到。**\n\n<details><summary>HAQI 的核对：验收 2/2 达到</summary>\n\n## 验收标准\n\n</details>\n\n<details><summary>过程</summary>\n\n- 做了\n\n</details>\n\n> 推送 1 次'
        expect(reportParts(markdown)).toEqual([
            { text: '**全部达到。**', fold: null },
            { text: '## 验收标准', fold: 'HAQI 的核对：验收 2/2 达到' },
            { text: '- 做了', fold: '过程' },
            { text: '> 推送 1 次', fold: null }
        ])
    })

    it('turns the criteria table into a list, keeping escaped pipes in the text', () => {
        const markdown = '## 验收标准\n| # | 标准 | 结论 | 证据 |\n|---|---|---|---|\n| 1 | a \\| b | 达到 | 跑了测试 |\n| 2 | c | 没达到 |  |\n\n## 关键数字'
        expect(reportMarkdownForApp(markdown)).toBe('## 验收标准\n1. **达到**：a | b\n   证据：跑了测试\n2. **没达到**：c\n\n## 关键数字')
    })

    it('keeps paths with ~ from turning into strikethrough, but leaves code spans alone', () => {
        expect(reportMarkdownForApp('改动只在 ~/dev/a 内，`ls ~/dev` 和 ~/dev/b')).toBe('改动只在 \\~/dev/a 内，`ls ~/dev` 和 \\~/dev/b')
    })
})
