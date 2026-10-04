import { describe, expect, it } from 'bun:test'

import { Store } from './index'

function makeUserMessage(text: string): unknown {
    return {
        role: 'user',
        content: {
            type: 'text',
            text
        }
    }
}

function makeAgentTextMessage(text: string): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [
                        {
                            type: 'text',
                            text
                        }
                    ]
                }
            }
        }
    }
}

function makeAgentThinkingAndTextMessage(thinking: string, text: string): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', thinking },
                        { type: 'text', text }
                    ]
                }
            }
        }
    }
}

function makeAgentThinkingOnlyMessage(thinking: string): unknown {
    return {
        role: 'agent',
        content: {
            type: 'output',
            data: {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'thinking', thinking }
                    ]
                }
            }
        }
    }
}

function makeCodexMessage(data: Record<string, unknown>): unknown {
    return {
        role: 'agent',
        content: {
            type: 'codex',
            data
        }
    }
}

describe('TurnStore projection', () => {
    it('groups multiple agent chunks into one turn and opens a new turn on next user message', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-test', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('user prompt #1'))
        store.messages.addMessage(session.id, makeAgentTextMessage('assistant chunk #1'))
        store.messages.addMessage(session.id, makeAgentTextMessage('assistant chunk #2'))
        store.messages.addMessage(session.id, makeAgentTextMessage('assistant chunk #3'))
        store.messages.addMessage(session.id, makeAgentTextMessage('assistant chunk #4'))
        store.messages.addMessage(session.id, makeUserMessage('user prompt #2'))

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(2)

        const first = turns[0]
        expect(first.turnIndex).toBe(1)
        expect(first.status).toBe('closed')
        expect(first.userSeq).toBe(1)
        expect(first.agentStartSeq).toBe(2)
        expect(first.agentEndSeq).toBe(5)
        expect(first.messageCount).toBe(5)
        expect(first.userPreview).toContain('user prompt #1')
        expect(first.assistantPreview).toContain('assistant chunk #1')
        expect(first.assistantPreview).toContain('assistant chunk #2')
        expect(first.assistantPreview).toContain('assistant chunk #3')
        expect(first.assistantPreview).toContain('assistant chunk #4')

        const second = turns[1]
        expect(second.turnIndex).toBe(2)
        expect(second.status).toBe('open')
        expect(second.userSeq).toBe(6)
        expect(second.agentStartSeq).toBeNull()
        expect(second.agentEndSeq).toBeNull()
        expect(second.messageCount).toBe(1)
        expect(second.userPreview).toContain('user prompt #2')
    })

    it('supports agent-only turn before first user turn', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-agent-first', {}, null, 'default')

        store.messages.addMessage(session.id, makeAgentTextMessage('assistant first'))
        store.messages.addMessage(session.id, makeUserMessage('hello user'))

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(2)

        const first = turns[0]
        expect(first.status).toBe('closed')
        expect(first.userSeq).toBeNull()
        expect(first.agentStartSeq).toBe(1)
        expect(first.agentEndSeq).toBe(1)

        const second = turns[1]
        expect(second.status).toBe('open')
        expect(second.userSeq).toBe(2)
    })

    it('returns raw turn messages by turn id', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-messages', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('user prompt'))
        store.messages.addMessage(session.id, makeAgentTextMessage('assistant chunk #1'))
        store.messages.addMessage(session.id, makeAgentTextMessage('assistant chunk #2'))

        const turns = store.turns.getTurns(session.id, 20)
        const turn = turns[0]
        const page = store.turns.getTurnMessagesPage(session.id, turn.id, { limit: 50, beforeSeq: null })

        expect(page).not.toBeNull()
        expect(page?.messages.map((message) => message.seq)).toEqual([1, 2, 3])
        expect(page?.page.startSeq).toBe(1)
        expect(page?.page.endSeq).toBe(3)
        expect(page?.page.hasMore).toBe(false)
    })

    it('keeps brief preview on the latest codex final message instead of intermediate events', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-codex-preview', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('summarize changes'))
        store.messages.addMessage(session.id, makeCodexMessage({
            type: 'tool-call',
            name: 'exec_command',
            callId: 'call_1',
            input: {
                command: 'git status'
            }
        }))
        store.messages.addMessage(session.id, makeCodexMessage({
            type: 'tool-call-result',
            callId: 'call_1',
            output: {
                stdout: 'M src/file.ts'
            }
        }))
        store.messages.addMessage(session.id, makeCodexMessage({
            type: 'message',
            message: 'First draft response'
        }))
        store.messages.addMessage(session.id, makeCodexMessage({
            type: 'message',
            message: 'Final answer from Codex'
        }))

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.assistantPreview).toBe('Final answer from Codex')
        expect(turns[0]?.assistantPreview).not.toContain('git status')
        expect(turns[0]?.assistantPreview).not.toContain('First draft response')
    })

    it('rebuild preserves latest codex final preview behavior', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-codex-rebuild', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('check formatting'))
        store.messages.addMessage(session.id, makeCodexMessage({
            type: 'message',
            message: 'intermediate summary'
        }))
        store.messages.addMessage(session.id, makeCodexMessage({
            type: 'message',
            message: 'final polished output'
        }))

        store.turns.rebuildSessionTurns(session.id)

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.assistantPreview).toBe('final polished output')
    })

    it('keeps line breaks in brief previews', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-preserve-newline', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('line-1\nline-2'))
        store.messages.addMessage(session.id, makeAgentTextMessage('answer-1\nanswer-2'))

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.userPreview).toBe('line-1\nline-2')
        expect(turns[0]?.assistantPreview).toContain('answer-1\nanswer-2')
    })

    it('preserves nested markdown list indentation across multiple assistant chunks', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-preserve-list-indent', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('show steps'))
        store.messages.addMessage(session.id, makeAgentTextMessage('1. Parent'))
        store.messages.addMessage(session.id, makeAgentTextMessage('   - Child'))
        store.messages.addMessage(session.id, makeAgentTextMessage('2. Next'))

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.assistantPreview).toBe('1. Parent\n   - Child\n2. Next')
    })

    it('rebuild preserves nested markdown list indentation', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-rebuild-list-indent', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('show steps'))
        store.messages.addMessage(session.id, makeAgentTextMessage('1. Parent'))
        store.messages.addMessage(session.id, makeAgentTextMessage('   - Child'))
        store.messages.addMessage(session.id, makeAgentTextMessage('2. Next'))

        store.turns.rebuildAllTurns()

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.assistantPreview).toBe('1. Parent\n   - Child\n2. Next')
    })

    it('excludes reasoning blocks from assistant preview when text is also present', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-reasoning-with-text', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('explain something'))
        store.messages.addMessage(session.id, makeAgentThinkingAndTextMessage(
            'Let me think about this step by step...',
            'Here is the actual answer.'
        ))

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.assistantPreview).toBe('Here is the actual answer.')
        expect(turns[0]?.assistantPreview).not.toContain('step by step')
    })

    it('does not add reasoning-only messages to assistant preview', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-reasoning-only', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('think about it'))
        store.messages.addMessage(session.id, makeAgentThinkingOnlyMessage('Internal reasoning only'))
        store.messages.addMessage(session.id, makeAgentTextMessage('Final response'))

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.assistantPreview).toBe('Final response')
        expect(turns[0]?.assistantPreview).not.toContain('Internal reasoning')
    })

    it('excludes codex reasoning messages from assistant preview', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-codex-reasoning', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('do something'))
        store.messages.addMessage(session.id, makeCodexMessage({
            type: 'reasoning',
            message: 'Codex internal reasoning'
        }))
        store.messages.addMessage(session.id, makeCodexMessage({
            type: 'message',
            message: 'Codex final answer'
        }))

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.assistantPreview).toBe('Codex final answer')
        expect(turns[0]?.assistantPreview).not.toContain('internal reasoning')
    })

    it('rebuild excludes reasoning blocks from assistant preview', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-rebuild-reasoning', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('explain'))
        store.messages.addMessage(session.id, makeAgentThinkingAndTextMessage(
            'Deep reasoning here...',
            'The answer is 42.'
        ))

        store.turns.rebuildAllTurns()

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.assistantPreview).toBe('The answer is 42.')
        expect(turns[0]?.assistantPreview).not.toContain('Deep reasoning')
    })

    it('keeps tool machinery, model ids, and heartbeats out of previews', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('turn-preview-garbage', {}, null, 'default')

        store.messages.addMessage(session.id, makeUserMessage('run the build'))
        // Thinking-only message whose model id sits right next to the content.
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: { model: 'claude-fable-5', role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] }
                }
            }
        })
        // Tool call with a shell command in its input.
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        model: 'claude-fable-5',
                        role: 'assistant',
                        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'make build' } }]
                    }
                }
            }
        })
        // Tool result with shell output.
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    message: {
                        role: 'user',
                        content: [{
                            type: 'tool_result',
                            tool_use_id: 'toolu_1',
                            content: [{ type: 'text', text: '15:- grep output\nShell cwd was reset to /tmp' }]
                        }]
                    }
                }
            }
        })
        // Heartbeat frame for the running tool.
        store.messages.addMessage(session.id, {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'tool_progress',
                    tool_use_id: 'toolu_1-heartbeat-0',
                    tool_name: 'Bash',
                    parent_tool_use_id: 'toolu_1',
                    elapsed_time_seconds: 30,
                    heartbeat: true
                }
            }
        })
        store.messages.addMessage(session.id, makeAgentTextMessage('Build finished.'))

        const turns = store.turns.getTurns(session.id, 20)
        expect(turns).toHaveLength(1)
        expect(turns[0]?.userPreview).toBe('run the build')
        expect(turns[0]?.assistantPreview).toBe('Build finished.')
    })
})
