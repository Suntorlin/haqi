import { describe, expect, it } from 'vitest'
import type { TaskDraft, TaskView } from '@/types/api'
import { confirmInputFrom, freshDraftEdits, isTaskOpen, taskIdsOfSession } from './tasks'

const draft: TaskDraft = {
    version: 2,
    goal: '创建任务时引导写验收标准',
    nonGoals: [],
    criteria: [
        { id: 'c1', text: '测试通过', source: 'repo', sourceRef: 'AGENTS.md', verify: 'bun run test' },
        { id: 'c2', text: '结论先行', source: 'principle', sourceRef: 'p1', verify: '看第一段' },
        { id: 'c3', text: '3 秒内出现', source: 'inferred', sourceRef: null, verify: '计时' }
    ],
    questions: [
        { id: 'q1', text: '截图放哪里？', options: [{ id: 'a', label: 'Linear' }, { id: 'b', label: 'Obsidian' }], default: 'a', precedentRef: 'e1' }
    ]
}

describe('task guide edits', () => {
    it('sends every criterion, a text only when changed, and the default answer when untouched', () => {
        const edits = freshDraftEdits(draft)
        expect(confirmInputFrom(draft, edits)).toEqual({
            criteria: [{ id: 'c1', kept: true }, { id: 'c2', kept: true }, { id: 'c3', kept: true }],
            answers: { q1: 'a' }
        })
        const changed = {
            ...edits,
            goal: ' 引导写验收标准 ',
            kept: { ...edits.kept, c3: false },
            texts: { c1: '测试通过', c2: ' 结论先行，带数字 ' },
            answers: { q1: 'b' }
        }
        expect(confirmInputFrom(draft, changed)).toEqual({
            goal: '引导写验收标准',
            criteria: [{ id: 'c1', kept: true }, { id: 'c2', kept: true, text: '结论先行，带数字' }, { id: 'c3', kept: false }],
            answers: { q1: 'b' }
        })
    })
})

describe('task membership', () => {
    it('reads membership from the task members, and treats guiding and active as open', () => {
        const task = (id: string, status: TaskView['status'], members: string[]) => ({ id, status, members: members.map((sessionId) => ({ sessionId, role: 'member' })) }) as TaskView
        const tasks = [task('t1', 'active', ['s1', 's2']), task('t2', 'guiding', ['s2']), task('t3', 'done', ['s1'])]
        expect(taskIdsOfSession(tasks, 's2')).toEqual(['t1', 't2'])
        expect(tasks.filter(isTaskOpen).map((t) => t.id)).toEqual(['t1', 't2'])
    })
})
