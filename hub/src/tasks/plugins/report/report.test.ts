import { describe, expect, it } from 'bun:test'
import type { TaskRun } from '@hapi/protocol/types'
import { composeReport } from './report'

const acceptance = [
    { id: 'c1', text: '测试通过', source: 'repo' as const, sourceRef: null, verify: 'bun run test' },
    { id: 'c2', text: '手机能用', source: 'inferred' as const, sourceRef: null, verify: '截图' }
]
const run = (results: TaskRun['review']): TaskRun => ({
    phase: 'reporting',
    subtasks: [{ id: 'a', title: '接口', brief: '', criteria: ['c1'], dependsOn: [], fix: false, state: 'done', sessionId: 's', branch: 'hapi-a', summary: '加了接口', startedAt: 0, doneAt: 1 }],
    decisions: [
        { id: 'd1', question: '放哪里', context: null, options: [{ label: 'A' }, { label: 'B' }], recommended: 'A', askedBy: 's', subtaskId: 'a', askedAt: 0, answer: { label: 'B', by: 'precedent', memoryId: 'm9', at: 1 } }
    ],
    signals: [],
    integration: { branch: 'task/t1', worktree: '/r-worktrees/task-t1', summary: '合并好了' },
    review: results,
    report: null
})

describe('report', () => {
    it('puts the conclusion and what the user has to do first', () => {
        const { conclusion, markdown } = composeReport({ name: '任务', goal: '目标', acceptance, run: run({ round: 1, results: [{ criterionId: 'c1', status: 'met', evidence: '全过' }, { criterionId: 'c2', status: 'met', evidence: '截图' }], suggestions: ['加个缓存'] }), load: null, startedAt: 0, now: 30 * 60_000 })
        expect(conclusion).toBe('2 条验收标准全部达到，结果在本地分支 task/t1（未推送）。')
        const order = ['**2 条', '## 要你做的事', '## 验收标准', '## 关键数字', '## 风险和不一致', '## 按先例做的决定', '## 评审的建议', '<details>', '> HAQI 推送提醒']
        const positions = order.map((part) => markdown.indexOf(part))
        expect(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1]!))).toBe(true)
        expect(markdown).toContain('放哪里 → B（经验 m9）')
        expect(markdown).toContain('用时 30 分钟')
    })

    it('lists failed criteria as risks and as things to decide', () => {
        const { conclusion, markdown } = composeReport({ name: '任务', goal: '目标', acceptance, run: run({ round: 2, results: [{ criterionId: 'c1', status: 'met', evidence: '全过' }, { criterionId: 'c2', status: 'not_met', evidence: '按钮被挡住' }], suggestions: [] }), load: { progress: 0, correction: 1, decision: 2, request: 1 }, startedAt: 0, now: 1 })
        expect(conclusion).toBe('2 条验收标准达到 1 条，1 条没达到或说不清。')
        expect(markdown).toContain('「手机能用」没达到：要不要接受？')
        expect(markdown).toContain('- 「手机能用」：按钮被挡住')
        expect(markdown).toContain('你开口 4 次：拍板 2、纠正 1、追问 0、新要求 1')
    })
})
