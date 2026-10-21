import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Session } from './session'
import { MessageQueue2 } from '@/utils/MessageQueue2'
import type { AgentState } from '@/api/types'
import type { EnhancedMode } from './loop'

type FakeClient = {
    keepAlive: ReturnType<typeof vi.fn>
    updateMetadata: ReturnType<typeof vi.fn>
    updateAgentState: ReturnType<typeof vi.fn>
    updateTeamState: ReturnType<typeof vi.fn>
    sendSessionEvent: ReturnType<typeof vi.fn>
}

function createSession() {
    let agentState: AgentState = {}
    const client: FakeClient = {
        keepAlive: vi.fn(),
        updateMetadata: vi.fn((handler: (state: Record<string, unknown>) => Record<string, unknown>) => handler({})),
        updateAgentState: vi.fn((handler: (state: AgentState) => AgentState) => {
            agentState = handler(agentState)
            return agentState
        }),
        updateTeamState: vi.fn(),
        sendSessionEvent: vi.fn()
    }

    const session = new Session({
        api: {} as never,
        client: client as never,
        path: '/tmp/project',
        logPath: '/tmp/project.log',
        sessionId: null,
        mcpServers: {},
        messageQueue: new MessageQueue2<EnhancedMode>(() => 'mode'),
        onModeChange: () => {},
        startedBy: 'terminal',
        startingMode: 'remote',
        hookSettingsPath: '/tmp/hook-settings.json'
    })

    return {
        session,
        client,
        getAgentState: () => agentState
    }
}

afterEach(() => {
    vi.useRealTimers()
    delete process.env.CLAUDE_CONFIG_DIR
})

describe('Claude Session running agent state', () => {
    it('notifies permission mode listeners when the mode changes', () => {
        const { session } = createSession()
        const listener = vi.fn()
        const unsubscribe = session.addPermissionModeChangeListener(listener)

        session.setPermissionMode('acceptEdits')
        session.setPermissionMode('acceptEdits')
        expect(listener).toHaveBeenCalledTimes(1)
        expect(listener).toHaveBeenLastCalledWith('acceptEdits')

        unsubscribe()
        session.setPermissionMode('bypassPermissions')
        expect(listener).toHaveBeenCalledTimes(1)
        session.stopKeepAlive()
    })

    it('keeps the session thinking while a background task agent is running', () => {
        vi.useFakeTimers()
        const { session, client } = createSession()

        client.keepAlive.mockClear()

        session.onThinkingChange(false)
        session.setRunningAgent('task-1', {
            name: 'test-launcher',
            task: 'Write lifecycle tests',
            startedAt: 123
        })

        expect(session.thinking).toBe(true)
        expect(client.keepAlive).toHaveBeenLastCalledWith(true, 'local', undefined)

        session.setRunningAgent('task-1', null)

        expect(session.thinking).toBe(false)
        expect(client.keepAlive).toHaveBeenLastCalledWith(false, 'local', undefined)
        session.stopKeepAlive()
    })

    it('stores the first running agent in agentState', () => {
        const { session, getAgentState } = createSession()

        session.setRunningAgent('task-1', {
            name: 'test-appserver',
            task: 'Write appServer tests',
            toolUseId: 'task-1',
            startedAt: 111
        })

        expect(getAgentState().runningAgent).toEqual({
            name: 'test-appserver',
            task: 'Write appServer tests',
            toolUseId: 'task-1',
            startedAt: 111
        })
        expect(getAgentState().runningAgents).toEqual([{
            name: 'test-appserver',
            task: 'Write appServer tests',
            toolUseId: 'task-1',
            startedAt: 111
        }])

        session.setRunningAgent('task-2', {
            name: 'test-launcher',
            task: 'Write lifecycle tests',
            toolUseId: 'task-2',
            startedAt: 222
        })
        expect(getAgentState().runningAgent).toEqual({
            name: 'test-launcher',
            task: 'Write lifecycle tests',
            toolUseId: 'task-2',
            startedAt: 222
        })
        expect(getAgentState().runningAgents).toEqual([
            {
                name: 'test-appserver',
                task: 'Write appServer tests',
                toolUseId: 'task-1',
                startedAt: 111
            },
            {
                name: 'test-launcher',
                task: 'Write lifecycle tests',
                toolUseId: 'task-2',
                startedAt: 222
            }
        ])

        session.setRunningAgent('task-1', null)
        expect(getAgentState().runningAgent).toEqual({
            name: 'test-launcher',
            task: 'Write lifecycle tests',
            toolUseId: 'task-2',
            startedAt: 222
        })
        expect(getAgentState().runningAgents).toEqual([{
            name: 'test-launcher',
            task: 'Write lifecycle tests',
            toolUseId: 'task-2',
            startedAt: 222
        }])

        session.setRunningAgent('task-2', null)
        expect(getAgentState().runningAgent).toBeUndefined()
        expect(getAgentState().runningAgents).toBeUndefined()
        session.stopKeepAlive()
    })


    it('turns Claude hooks into local monitor readiness and tool activity', () => {
        const { session, client } = createSession()
        client.keepAlive.mockClear()

        session.applyClaudeHookEvent({
            hook_event_name: 'PreToolUse',
            session_id: 'claude-session-1',
            tool_name: 'Bash',
            tool_input: { command: 'echo ok' },
            tool_use_id: 'tool-1'
        })
        expect(session.thinking).toBe(true)

        session.applyClaudeHookEvent({
            hook_event_name: 'PostToolUse',
            session_id: 'claude-session-1',
            tool_name: 'Bash',
            tool_input: { command: 'echo ok' },
            tool_response: 'ok',
            tool_use_id: 'tool-1'
        })
        expect(session.thinking).toBe(false)

        session.applyClaudeHookEvent({
            hook_event_name: 'Notification',
            session_id: 'claude-session-1',
            message: 'Claude is waiting for your input',
            notification_type: 'idle_prompt'
        })
        expect(client.sendSessionEvent).toHaveBeenLastCalledWith({ type: 'ready' })
        session.stopKeepAlive()
    })

    it('emits ready on Stop and StopFailure hooks', () => {
        const { session, client } = createSession()

        session.applyClaudeHookEvent({
            hook_event_name: 'Stop',
            session_id: 'claude-session-1'
        })
        expect(client.sendSessionEvent).toHaveBeenLastCalledWith({ type: 'ready' })

        client.sendSessionEvent.mockClear()
        session.applyClaudeHookEvent({
            hook_event_name: 'StopFailure',
            session_id: 'claude-session-1',
            error: 'rate_limit'
        })
        expect(client.sendSessionEvent).toHaveBeenLastCalledWith({ type: 'ready' })
        session.stopKeepAlive()
    })

    it('clears a tool call a PreToolUse hook blocked when the turn stops', () => {
        const { session } = createSession()

        // Another hook denies the call: Claude Code sends no PostToolUse for it.
        session.applyClaudeHookEvent({
            hook_event_name: 'PreToolUse',
            session_id: 'claude-session-1',
            tool_name: 'Bash',
            tool_input: { command: 'git push' },
            tool_use_id: 'tool-blocked'
        })
        session.setAuxiliaryActivity('claude-compact', true)
        session.applyClaudeHookEvent({
            hook_event_name: 'Stop',
            session_id: 'claude-session-1'
        })
        expect(session.thinking).toBe(true)

        session.setAuxiliaryActivity('claude-compact', false)
        expect(session.thinking).toBe(false)
        session.stopKeepAlive()
    })

    it('treats permission_prompt notifications as ready', () => {
        const { session, client } = createSession()

        session.applyClaudeHookEvent({
            hook_event_name: 'Notification',
            session_id: 'claude-session-1',
            message: 'Claude needs permission to run Bash',
            notification_type: 'permission_prompt'
        })
        expect(client.sendSessionEvent).toHaveBeenLastCalledWith({ type: 'ready' })
        session.stopKeepAlive()
    })

    it('ignores other Notification subtypes without emitting ready', () => {
        const { session, client } = createSession()

        session.applyClaudeHookEvent({
            hook_event_name: 'Notification',
            session_id: 'claude-session-1',
            message: 'login successful',
            notification_type: 'auth_success'
        })
        expect(client.sendSessionEvent).not.toHaveBeenCalled()
        session.stopKeepAlive()
    })

    it('clears tool activity and emits ready on SessionEnd', () => {
        const { session, client } = createSession()

        session.applyClaudeHookEvent({
            hook_event_name: 'PreToolUse',
            session_id: 'claude-session-1',
            tool_name: 'Bash',
            tool_input: { command: 'echo ok' },
            tool_use_id: 'tool-1'
        })
        expect(session.thinking).toBe(true)

        // Simulate cc dying mid-tool: PostToolUse never arrives.
        client.sendSessionEvent.mockClear()
        session.applyClaudeHookEvent({
            hook_event_name: 'SessionEnd',
            session_id: 'claude-session-1',
            reason: 'other'
        })
        expect(session.thinking).toBe(false)
        expect(client.sendSessionEvent).toHaveBeenLastCalledWith({ type: 'ready' })
        session.stopKeepAlive()
    })

    it('toggles thinking around PreCompact/PostCompact and emits ready when compaction completes', () => {
        const { session, client } = createSession()

        session.applyClaudeHookEvent({
            hook_event_name: 'PreCompact',
            session_id: 'claude-session-1',
            trigger: 'manual',
            custom_instructions: null
        })
        expect(session.thinking).toBe(true)

        client.sendSessionEvent.mockClear()
        session.applyClaudeHookEvent({
            hook_event_name: 'PostCompact',
            session_id: 'claude-session-1',
            trigger: 'manual',
            compact_summary: 'summary'
        })
        expect(session.thinking).toBe(false)
        expect(client.sendSessionEvent).toHaveBeenLastCalledWith({ type: 'ready' })
        session.stopKeepAlive()
    })

    it('forwards Elicitation as a session message and signals ready', () => {
        const { session, client } = createSession()

        session.applyClaudeHookEvent({
            hook_event_name: 'Elicitation',
            session_id: 'claude-session-1',
            mcp_server_name: 'demo-server',
            message: 'pick an option',
            mode: 'form'
        })
        expect(client.sendSessionEvent).toHaveBeenNthCalledWith(1, { type: 'message', message: 'pick an option' })
        expect(client.sendSessionEvent).toHaveBeenLastCalledWith({ type: 'ready' })
        session.stopKeepAlive()
    })

    it('tracks Claude subagents from hooks and clears them on stop', () => {
        const { session, getAgentState, client } = createSession()

        client.keepAlive.mockClear()

        session.applyClaudeHookEvent({
            hook_event_name: 'SubagentStart',
            session_id: 'claude-session-1',
            agent_id: 'agent-1',
            agent_name: 'shared-reviewer',
            task_title: 'Review shared schema changes'
        })

        expect(session.thinking).toBe(true)
        expect(getAgentState().runningAgent).toEqual({
            name: 'shared-reviewer',
            task: 'Review shared schema changes',
            startedAt: expect.any(Number)
        })
        expect(client.updateTeamState).toHaveBeenLastCalledWith({
            teamName: 'Claude Team',
            members: [{
                name: 'shared-reviewer',
                status: 'active'
            }],
            tasks: [],
            updatedAt: expect.any(Number)
        })

        session.applyClaudeHookEvent({
            hook_event_name: 'SubagentStop',
            session_id: 'claude-session-1',
            agent_id: 'agent-1'
        })

        expect(session.thinking).toBe(false)
        expect(getAgentState().runningAgent).toBeUndefined()
        expect(getAgentState().runningAgents).toBeUndefined()
        session.stopKeepAlive()
    })

    it('syncs hook task completion into team state', () => {
        const { session, client } = createSession()

        session.applyClaudeHookEvent({
            hook_event_name: 'SubagentStart',
            session_id: 'claude-session-1',
            agent_id: 'agent-2',
            agent_name: 'cli-reviewer',
            task_id: 'task-7',
            task_title: 'Review cli session hooks'
        })

        session.applyClaudeHookEvent({
            hook_event_name: 'TaskCompleted',
            session_id: 'claude-session-1',
            agent_id: 'agent-2',
            agent_name: 'cli-reviewer',
            task_id: 'task-7',
            task_title: 'Review cli session hooks'
        })

        expect(client.updateTeamState).toHaveBeenLastCalledWith({
            teamName: 'Claude Team',
            members: [{
                name: 'cli-reviewer',
                status: 'idle'
            }],
            tasks: [{
                id: 'task-7',
                title: 'Review cli session hooks',
                owner: 'cli-reviewer',
                status: 'completed'
            }],
            updatedAt: expect.any(Number)
        })
        session.stopKeepAlive()
    })

    it('updates Claude session id from SessionStart hooks', () => {
        const { session, client } = createSession()

        session.applyClaudeHookEvent({
            hook_event_name: 'SessionStart',
            session_id: 'claude-session-42'
        })

        expect(session.sessionId).toBe('claude-session-42')
        expect(client.updateMetadata).toHaveBeenCalled()
        session.stopKeepAlive()
    })

    it('keeps thinking from Claude team snapshot while tasks are in progress', () => {
        const rootDir = mkdtempSync(join(tmpdir(), 'claude-session-snapshot-'))
        process.env.CLAUDE_CONFIG_DIR = rootDir

        mkdirSync(join(rootDir, 'teams', 'demo-team'), { recursive: true })
        mkdirSync(join(rootDir, 'tasks', 'demo-team'), { recursive: true })
        writeFileSync(join(rootDir, 'teams', 'demo-team', 'config.json'), JSON.stringify({
            name: 'demo-team',
            leadSessionId: 'claude-session-99'
        }))
        writeFileSync(join(rootDir, 'tasks', 'demo-team', '1.json'), JSON.stringify({
            id: '1',
            subject: 'web-reviewer',
            description: 'Review web UI',
            status: 'in_progress'
        }))

        try {
            const { session, client } = createSession()
            client.keepAlive.mockClear()

            session.applyClaudeHookEvent({
                hook_event_name: 'SessionStart',
                session_id: 'claude-session-99'
            })

            expect(session.thinking).toBe(true)
            expect(client.updateTeamState).toHaveBeenCalledWith(expect.objectContaining({
                teamName: 'demo-team',
                tasks: expect.arrayContaining([
                    expect.objectContaining({
                        id: 'demo-team:1',
                        status: 'in_progress'
                    })
                ])
            }))
            session.stopKeepAlive()
        } finally {
            rmSync(rootDir, { recursive: true, force: true })
        }
    })
})

describe('Claude Session one-time flags', () => {
    it('keeps the --resume session ID when the launch ended before Claude reported one', () => {
        const { session, client } = createSession()
        session.claudeArgs = ['--resume', '6eef50e8-b5d3-4ebc-b3c6-69257a241bb7', '--model', 'sonnet']

        session.consumeOneTimeFlags()

        expect(session.claudeArgs).toEqual(['--model', 'sonnet'])
        expect(session.sessionId).toBe('6eef50e8-b5d3-4ebc-b3c6-69257a241bb7')
        expect(client.updateMetadata).toHaveBeenCalled()
    })

    it('does not overwrite a session ID that Claude already reported', () => {
        const { session } = createSession()
        session.claudeArgs = ['--resume', '6eef50e8-b5d3-4ebc-b3c6-69257a241bb7']
        session.onSessionFound('29c4f805-8bab-4329-bac0-59a447153801')

        session.consumeOneTimeFlags()

        expect(session.claudeArgs).toBeUndefined()
        expect(session.sessionId).toBe('29c4f805-8bab-4329-bac0-59a447153801')
    })
})
