import { describe, expect, it } from 'bun:test'
import { realUserText } from './userMessage'

function message(text: string, meta: Record<string, unknown> = { sentFrom: 'webapp' }, role = 'user') {
    return JSON.stringify({ role, content: { type: 'text', text }, meta })
}

describe('realUserText', () => {
    it('keeps what the user typed, from the web or the terminal', () => {
        expect(realUserText(message('先查线上版本再修这个 bug'))).toBe('先查线上版本再修这个 bug')
        expect(realUserText(message('push it after the tests pass', { sentFrom: 'cli' }))).toBe('push it after the tests pass')
    })

    it('drops messages HAQI sent with a marker in meta', () => {
        expect(realUserText(message('do the review now', { routeContext: { groupId: 'g1', source: 'group' } }))).toBeNull()
        expect(realUserText(message('nudge the teammate please', { teamControl: { action: 'nudge_member' } }))).toBeNull()
        expect(realUserText(message('write the acceptance draft', { taskGuide: { taskId: 'abc' } }))).toBeNull()
    })

    it('drops injected messages that Claude echoed back without their meta', () => {
        expect(realUserText(message('@all review dev\n[HAQI_GROUP_TASK_CONTEXT]\n- Group ID: g1\n[/HAQI_GROUP_TASK_CONTEXT]', { sentFrom: 'cli' }))).toBeNull()
        expect(realUserText(message('[SYSTEM] You are in a ReviewLoop (loop=l1, round=r1). Execute the instruction below.'))).toBeNull()
        expect(realUserText(message('[SYSTEM] You are a ReviewLoop Reviewer (loop=l1, round=r1). Review the output.'))).toBeNull()
        expect(realUserText(message('📝 **Group Note Broadcast**\n\n**Group**: g'))).toBeNull()
        expect(realUserText(message('You are coordinating the Claude agent team "a". Check teammate "b" and nudge them.'))).toBeNull()
        expect(realUserText(message('[HAQI_TASK_GUIDE] Draft the acceptance criteria for task abc.'))).toBeNull()
    })

    it('drops a message that is only a slash command, but keeps a path or a sentence about one', () => {
        expect(realUserText(message('/compact'))).toBeNull()
        expect(realUserText(message('/note refresh'))).toBeNull()
        expect(realUserText(message('/plugin:skill run it'))).toBeNull()
        expect(realUserText(message('/var/log/hub.log 里报错了，看看'))).toBe('/var/log/hub.log 里报错了，看看')
        expect(realUserText(message('跑一下 /compact 再继续'))).toBe('跑一下 /compact 再继续')
    })

    it('drops what is not a typed user message', () => {
        expect(realUserText(message('the agent said this one', {}, 'agent'))).toBeNull()
        expect(realUserText(JSON.stringify({ role: 'user', content: { type: 'event', text: 'x' } }))).toBeNull()
        expect(realUserText(message('This session is being continued from a previous conversation that ran out of context.'))).toBeNull()
        expect(realUserText('not json')).toBeNull()
    })
})
