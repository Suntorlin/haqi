import { describe, expect, it } from 'bun:test'
import { describeStep } from './sessionActivity'

describe('describeStep', () => {
    it('says what a tool call does in a few words', () => {
        expect(describeStep('Bash', { command: 'npm test\nnpm run lint' })).toBe('运行 npm test')
        expect(describeStep('Edit', { file_path: '/repo/src/todo.js' })).toBe('改 todo.js')
        expect(describeStep('Read', { file_path: '/repo/README.md' })).toBe('读 README.md')
        expect(describeStep('Grep', { pattern: 'count\\(' })).toBe('搜索 count\\(')
        expect(describeStep('mcp__hapi__subtask_done', {})).toBe('调用 subtask_done')
    })

    it('keeps a long command to one short line', () => {
        expect(describeStep('Bash', { command: `echo ${'x'.repeat(200)}` })!.length).toBe(80)
    })
})
