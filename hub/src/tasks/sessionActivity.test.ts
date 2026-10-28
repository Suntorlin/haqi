import { describe, expect, it } from 'bun:test'
import type { StoredMessage } from '../store/types'
import { describeStep, sessionActivity } from './sessionActivity'

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

describe('sessionActivity quota', () => {
    const reply = (seq: number, model: string, text: string): StoredMessage => ({
        id: `m${seq}`, sessionId: 's1', seq, localId: null, createdAt: seq * 1000,
        content: { role: 'agent', content: { type: 'output', data: { type: 'assistant', message: { model, role: 'assistant', content: [{ type: 'text', text }] } } } }
    } as StoredMessage)
    const ready = (seq: number): StoredMessage => ({ id: `m${seq}`, sessionId: 's1', seq, localId: null, createdAt: seq * 1000, content: { role: 'agent', content: { id: 'e', type: 'event', data: { type: 'ready' } } } } as StoredMessage)
    const limit = "You've hit your weekly limit · resets Oct 31 at 4pm (Asia/Tokyo)"

    it('reports the refusal while it is the latest reply', () => {
        expect(sessionActivity([reply(1, 'claude-opus-5-5', 'working'), reply(2, '<synthetic>', limit), ready(3)], 0).quota).toEqual({ text: limit, at: 2000 })
    })

    it('forgets it once a real reply follows, and ignores a warning', () => {
        expect(sessionActivity([reply(1, '<synthetic>', limit), reply(2, 'claude-opus-5-5', 'back')], 0).quota).toBeNull()
        expect(sessionActivity([reply(1, '<synthetic>', 'Approaching usage limit · resets at 4pm')], 0).quota).toBeNull()
    })
})
