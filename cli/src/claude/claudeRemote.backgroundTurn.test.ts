import { afterEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EnhancedMode } from './loop'
import type { SDKMessage } from '@/claude/sdk'
import { claudeRemote } from './claudeRemote'

const previousClaudePath = process.env.HAPI_CLAUDE_PATH

afterEach(() => {
    if (previousClaudePath === undefined) {
        delete process.env.HAPI_CLAUDE_PATH
    } else {
        process.env.HAPI_CLAUDE_PATH = previousClaudePath
    }
})

// Fake Claude Code that, like a finished background task, starts a turn on its
// own after the first turn ended, without any new user input.
function writeFakeClaudeExecutable(dir: string): string {
    const fakeClaudePath = join(dir, 'fake-claude.mjs')
    writeFileSync(fakeClaudePath, `#!/usr/bin/env node
import { createInterface } from 'node:readline'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
const say = (text) => {
    send({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
    send({ type: 'result', subtype: 'success', result: text })
}

const userMessages = []
let wake = null
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
    if (!line.trim()) return
    const message = JSON.parse(line)
    if (message.type !== 'user') return
    userMessages.push(message)
    wake?.()
})
const nextUserMessage = async () => {
    while (userMessages.length === 0) {
        await new Promise((resolve) => { wake = resolve })
    }
    return userMessages.shift()
}

await nextUserMessage()
say('STARTED')
await delay(100)
say('NOTIFIED')
await nextUserMessage()
say('PONG')
rl.close()
`, 'utf8')
    chmodSync(fakeClaudePath, 0o755)
    return fakeClaudePath
}

async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (condition()) {
            return true
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
    }
    return condition()
}

function textOf(message: SDKMessage): string | null {
    if (message.type !== 'assistant') {
        return null
    }
    const content = (message as any).message?.content
    if (!Array.isArray(content)) {
        return null
    }
    return content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('')
}

describe('Claude remote turns started by Claude itself', () => {
    it('forwards a turn that starts while waiting for the next user message', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'haqi-claude-background-turn-'))
        try {
            process.env.HAPI_CLAUDE_PATH = writeFakeClaudeExecutable(dir)

            const mode: EnhancedMode = { permissionMode: 'default' }
            const texts: string[] = []
            const thinkingChanges: boolean[] = []
            let readyCount = 0
            let nextMessageCalls = 0
            let releaseSecondMessage: (() => void) | null = null

            const remoteRun = claudeRemote({
                sessionId: null,
                path: dir,
                allowedTools: [],
                mcpServers: {},
                hookSettingsPath: join(dir, 'hook-settings.json'),
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                isAborted: () => false,
                nextMessage: async () => {
                    nextMessageCalls += 1
                    if (nextMessageCalls === 1) {
                        return { message: 'Start a background task.', mode }
                    }
                    if (nextMessageCalls === 2) {
                        await new Promise<void>((resolve) => {
                            releaseSecondMessage = resolve
                        })
                        return { message: 'Reply with PONG.', mode }
                    }
                    return null
                },
                onReady: () => {
                    readyCount += 1
                },
                onSessionFound: () => {},
                onThinkingChange: (thinking) => {
                    thinkingChanges.push(thinking)
                },
                onMessage: (message) => {
                    const text = textOf(message)
                    if (text) {
                        texts.push(text)
                    }
                }
            })

            // The user has not sent anything yet, but the background turn must
            // already be visible, and the session must be ready again after it.
            const forwarded = await waitFor(() => texts.includes('NOTIFIED') && readyCount === 2, 3_000)
            expect(forwarded).toBe(true)
            expect(texts).toEqual(['STARTED', 'NOTIFIED'])
            expect(nextMessageCalls).toBe(2)
            expect(thinkingChanges).toEqual([true, false, true, false])

            // The reply to the next user message is forwarded right away, not
            // held back until yet another message arrives.
            releaseSecondMessage!()
            await remoteRun
            expect(texts).toEqual(['STARTED', 'NOTIFIED', 'PONG'])
            expect(readyCount).toBe(3)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    }, 10_000)

    it('finishes the running turn before exiting for a pending relaunch', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'haqi-claude-pending-relaunch-'))
        try {
            // First turn ends, then Claude starts a turn on its own whose
            // result only arrives after a delay.
            const fakeClaudePath = join(dir, 'fake-claude.mjs')
            writeFileSync(fakeClaudePath, `#!/usr/bin/env node
import { createInterface } from 'node:readline'

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
const say = (text) => {
    send({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
    send({ type: 'result', subtype: 'success', result: text })
}

const rl = createInterface({ input: process.stdin })
let started = false
rl.on('line', (line) => {
    if (!line.trim() || started) return
    started = true
    say('STARTED')
    send({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'NOTIFIED' }] } })
    delay(400).then(() => say('FINISHED'))
})
`, 'utf8')
            chmodSync(fakeClaudePath, 0o755)
            process.env.HAPI_CLAUDE_PATH = fakeClaudePath

            const mode: EnhancedMode = { permissionMode: 'default' }
            const texts: string[] = []
            let readyCount = 0
            let nextMessageCalls = 0

            const remoteRun = claudeRemote({
                sessionId: null,
                path: dir,
                allowedTools: [],
                mcpServers: {},
                hookSettingsPath: join(dir, 'hook-settings.json'),
                canCallTool: async () => ({ behavior: 'allow', updatedInput: {} }),
                isAborted: () => false,
                nextMessage: async () => {
                    nextMessageCalls += 1
                    if (nextMessageCalls === 1) {
                        return { message: 'Start.', mode }
                    }
                    // Simulate a mode change: the launcher asks for a relaunch
                    // while the self-started turn is still running.
                    await waitFor(() => texts.includes('NOTIFIED'), 3_000)
                    return null
                },
                onReady: () => {
                    readyCount += 1
                },
                onSessionFound: () => {},
                onMessage: (message) => {
                    const text = textOf(message)
                    if (text) {
                        texts.push(text)
                    }
                }
            })

            await remoteRun

            // The delayed end of the running turn was still forwarded; the
            // turn was not killed by the pending relaunch.
            expect(texts).toEqual(['STARTED', 'NOTIFIED', 'FINISHED'])
            expect(nextMessageCalls).toBe(2)
            // No ready event for the aborted-into-relaunch idle phase.
            expect(readyCount).toBe(1)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    }, 10_000)
})
