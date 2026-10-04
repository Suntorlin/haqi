import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readClaudeTeamSnapshotForSession } from './claudeTeamSnapshot'

describe('readClaudeTeamSnapshotForSession', () => {
    let rootDir: string | null = null

    afterEach(() => {
        if (rootDir) {
            rmSync(rootDir, { recursive: true, force: true })
            rootDir = null
        }
        delete process.env.CLAUDE_CONFIG_DIR
    })

    it('reads team config and task files for the current lead session', () => {
        rootDir = mkdtempSync(join(tmpdir(), 'claude-team-snapshot-'))
        process.env.CLAUDE_CONFIG_DIR = rootDir

        mkdirSync(join(rootDir, 'teams', 'demo-team'), { recursive: true })
        mkdirSync(join(rootDir, 'tasks', 'demo-team'), { recursive: true })

        writeFileSync(join(rootDir, 'teams', 'demo-team', 'config.json'), JSON.stringify({
            name: 'demo-team',
            description: 'Parallel review team',
            leadSessionId: 'session-123',
            members: [
                { name: 'team-lead', agentType: 'team-lead' }
            ]
        }))

        writeFileSync(join(rootDir, 'tasks', 'demo-team', '1.json'), JSON.stringify({
            id: '1',
            subject: 'cli-reviewer',
            description: 'Review CLI hooks',
            status: 'in_progress'
        }))
        writeFileSync(join(rootDir, 'tasks', 'demo-team', '2.json'), JSON.stringify({
            id: '2',
            subject: 'shared-reviewer',
            description: 'Review shared schemas',
            status: 'completed'
        }))

        const snapshot = readClaudeTeamSnapshotForSession('session-123')

        expect(snapshot?.teamName).toBe('demo-team')
        expect(snapshot?.description).toBe('Parallel review team')
        expect(snapshot?.members).toEqual(expect.arrayContaining([
            { name: 'team-lead', agentType: 'team-lead' },
            { name: 'cli-reviewer', status: 'active' },
            { name: 'shared-reviewer', status: 'idle' }
        ]))
        expect(snapshot?.tasks).toEqual(expect.arrayContaining([
            {
                id: 'demo-team:1',
                title: 'cli-reviewer',
                description: 'Review CLI hooks',
                owner: 'cli-reviewer',
                status: 'in_progress'
            },
            {
                id: 'demo-team:2',
                title: 'shared-reviewer',
                description: 'Review shared schemas',
                owner: 'shared-reviewer',
                status: 'completed'
            }
        ]))
        expect(snapshot?.updatedAt).toEqual(expect.any(Number))
    })

    it('aggregates member status as active when any task is in_progress', () => {
        rootDir = mkdtempSync(join(tmpdir(), 'claude-team-snapshot-'))
        process.env.CLAUDE_CONFIG_DIR = rootDir

        mkdirSync(join(rootDir, 'teams', 'multi-task-team'), { recursive: true })
        mkdirSync(join(rootDir, 'tasks', 'multi-task-team'), { recursive: true })

        writeFileSync(join(rootDir, 'teams', 'multi-task-team', 'config.json'), JSON.stringify({
            name: 'multi-task-team',
            leadSessionId: 'session-456',
            members: []
        }))

        // Same member has a completed task and an in_progress task
        writeFileSync(join(rootDir, 'tasks', 'multi-task-team', 'a.json'), JSON.stringify({
            id: 'a',
            subject: 'worker-1',
            description: 'First task (done)',
            status: 'completed'
        }))
        writeFileSync(join(rootDir, 'tasks', 'multi-task-team', 'b.json'), JSON.stringify({
            id: 'b',
            subject: 'worker-1',
            description: 'Second task (running)',
            status: 'in_progress'
        }))

        const snapshot = readClaudeTeamSnapshotForSession('session-456')

        // Regardless of filesystem enumeration order, worker-1 should be active
        const worker = snapshot?.members?.find(m => m.name === 'worker-1')
        expect(worker?.status).toBe('active')
    })
})
