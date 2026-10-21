import { describe, expect, it } from 'vitest'
import { reportMarkdownForApp } from './ReportSheet'

describe('reportMarkdownForApp', () => {
    it('drops the title and turns the process block into a section', () => {
        const markdown = '# 任务\n\n**全部达到。**\n\n<details><summary>过程</summary>\n\n- 做了\n\n</details>\n'
        expect(reportMarkdownForApp(markdown)).toBe('**全部达到。**\n\n## 过程\n\n- 做了\n\n\n')
    })

    it('turns the criteria table into a list, keeping escaped pipes in the text', () => {
        const markdown = '## 验收标准\n| # | 标准 | 结论 | 证据 |\n|---|---|---|---|\n| 1 | a \\| b | 达到 | 跑了测试 |\n| 2 | c | 没达到 |  |\n\n## 关键数字'
        expect(reportMarkdownForApp(markdown)).toBe('## 验收标准\n1. **达到**：a | b\n   证据：跑了测试\n2. **没达到**：c\n\n## 关键数字')
    })
})
