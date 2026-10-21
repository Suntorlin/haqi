import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from './index'

function dbOf(store: Store): Database {
    return (store as unknown as { db: Database }).db
}

function withDbPath(run: (dbPath: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), 'haqi-task-groups-'))
    try {
        run(join(dir, 'hapi.db'))
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

/** A database as the current main build leaves it: no task columns, no new tables, two session tasks. */
function seedOldDatabase(dbPath: string): void {
    const seeded = new Store(dbPath)
    const db = dbOf(seeded)
    db.exec(`
        DROP TABLE task_events;
        DROP TABLE message_classes;
        DROP TABLE memory_tags;
        DROP INDEX idx_groups_namespace_kind;
        ALTER TABLE groups DROP COLUMN kind;
        ALTER TABLE groups DROP COLUMN tag;
        ALTER TABLE groups DROP COLUMN status;
        ALTER TABLE groups DROP COLUMN goal;
        ALTER TABLE groups DROP COLUMN non_goals;
        ALTER TABLE groups DROP COLUMN acceptance;
        ALTER TABLE groups DROP COLUMN repo_path;
        ALTER TABLE groups DROP COLUMN machine_id;
        ALTER TABLE groups DROP COLUMN lead_session_id;
        ALTER TABLE groups DROP COLUMN completed_at;
    `)
    const now = Date.now()
    db.prepare("INSERT INTO groups (id, namespace, name, created_at, updated_at) VALUES ('chat-1', 'default', 'Chat', ?, ?)").run(now, now)
    db.prepare("INSERT INTO session_tasks (id, namespace, tag, title, status, created_at, updated_at, completed_at) VALUES ('aaaaaaaaaaaa', 'default', 'agent', 'Creator', 'open', ?, ?, NULL)").run(now, now)
    db.prepare("INSERT INTO session_tasks (id, namespace, tag, title, status, created_at, updated_at, completed_at) VALUES ('bbbbbbbbbbbb', 'default', 'prod', 'Voice', 'done', ?, ?, ?)").run(now, now, now)
    const session = (id: string, tags: string[]) => db.prepare(
        "INSERT INTO sessions (id, tag, namespace, created_at, updated_at, metadata, metadata_version, agent_state_version, active, active_at, seq) VALUES (?, NULL, 'default', ?, ?, ?, 1, 1, 0, ?, 0)"
    ).run(id, now, now, JSON.stringify({ path: '/tmp/x', tags }), now)
    session('s1', ['agent', 'task:aaaaaaaaaaaa'])
    session('s2', ['task:aaaaaaaaaaaa', 'task:bbbbbbbbbbbb'])
    session('s3', ['agent'])
    db.prepare("INSERT INTO sessions (id, tag, namespace, created_at, updated_at, metadata, metadata_version, agent_state_version, active, active_at, seq) VALUES ('s4', NULL, 'default', ?, ?, 'not json', 1, 1, 0, ?, 0)").run(now, now, now)
    db.close()
}

describe('tasks as groups', () => {
    it('adds the task columns and tables to an old database and merges its session tasks with their members', () => {
        withDbPath((dbPath) => {
            seedOldDatabase(dbPath)
            const store = new Store(dbPath)
            expect(store.groups.getGroupsByNamespace('default', 'chat').map((g) => g.id)).toEqual(['chat-1'])
            const tasks = store.groups.getGroupsByNamespace('default', 'task')
            expect(tasks.map((g) => [g.id, g.name, g.tag, g.status]).sort()).toEqual([
                ['aaaaaaaaaaaa', 'Creator', 'agent', 'active'],
                ['bbbbbbbbbbbb', 'Voice', 'prod', 'done']
            ])
            const members = (id: string) => store.groups.getGroupMembersByNamespace(id, 'default').map((m) => m.sessionId).sort()
            expect(members('aaaaaaaaaaaa')).toEqual(['s1', 's2'])
            expect(members('bbbbbbbbbbbb')).toEqual(['s2'])
            expect(store.groups.getGroupNote('aaaaaaaaaaaa', 'default')).not.toBeNull()
            // The old table and tags stay for an older build.
            expect(store.sessionTasks.list('default')).toHaveLength(2)
            dbOf(store).close()
        })
    })

    it('merges once: a member removed later is not added back at the next startup', () => {
        withDbPath((dbPath) => {
            seedOldDatabase(dbPath)
            const first = new Store(dbPath)
            first.groups.removeGroupMember({ groupId: 'aaaaaaaaaaaa', namespace: 'default', sessionId: 's1' })
            dbOf(first).close()
            const second = new Store(dbPath)
            expect(second.groups.getGroupMembersByNamespace('aaaaaaaaaaaa', 'default').map((m) => m.sessionId)).toEqual(['s2'])
            expect(second.groups.getGroupsByNamespace('default', 'task')).toHaveLength(2)
            dbOf(second).close()
        })
    })

    it('adds a session to a group once, though the unique index ignores NULL user ids', () => {
        withDbPath((dbPath) => {
            const store = new Store(dbPath)
            const now = Date.now()
            dbOf(store).prepare("INSERT INTO sessions (id, tag, namespace, created_at, updated_at, metadata, metadata_version, agent_state_version, active, active_at, seq) VALUES ('s1', NULL, 'default', ?, ?, '{}', 1, 1, 0, ?, 0)").run(now, now, now)
            const group = store.groups.createGroup({
                namespace: 'default',
                name: 'G',
                members: [{ memberType: 'session', sessionId: 's1' }, { memberType: 'session', sessionId: 's1' }]
            })
            store.groups.addGroupMember({ groupId: group.id, namespace: 'default', sessionId: 's1' })
            expect(store.groups.getGroupMembersByNamespace(group.id, 'default')).toHaveLength(1)
            dbOf(store).close()
        })
    })

    it('creates a task group with a short id and keeps completedAt in step with the status', () => {
        withDbPath((dbPath) => {
            const store = new Store(dbPath)
            const task = store.groups.createGroup({ namespace: 'default', name: 'Guide', task: { id: 'cccccccccccc', tag: 'haqi', status: 'guiding' } })
            expect([task.id, task.kind, task.status, task.acceptance]).toEqual(['cccccccccccc', 'task', 'guiding', []])
            const done = store.groups.updateTaskFields({
                groupId: task.id,
                namespace: 'default',
                patch: { status: 'done', goal: 'Ship it', acceptance: [{ id: 'c1', text: 'Tests pass', source: 'repo', sourceRef: 'AGENTS.md', verify: 'bun run test' }] }
            })
            expect(done?.completedAt).toBeNumber()
            expect(done?.acceptance[0]?.sourceRef).toBe('AGENTS.md')
            const reopened = store.groups.updateTaskFields({ groupId: task.id, namespace: 'default', patch: { status: 'active' } })
            expect(reopened?.completedAt).toBeNull()
            expect(reopened?.goal).toBe('Ship it')
            const chat = store.groups.createGroup({ namespace: 'default', name: 'Chat' })
            expect(store.groups.updateTaskFields({ groupId: chat.id, namespace: 'default', patch: { status: 'done' } })).toBeNull()
            dbOf(store).close()
        })
    })

    it('keeps task events in order and finds the latest of a type', () => {
        withDbPath((dbPath) => {
            const store = new Store(dbPath)
            store.taskEvents.add({ namespace: 'default', groupId: 't1', type: 'draft_submitted', payload: { version: 1 } })
            store.taskEvents.add({ namespace: 'default', groupId: 't1', type: 'draft_submitted', payload: { version: 2 } })
            store.taskEvents.add({ namespace: 'default', groupId: 't1', type: 'draft_confirmed' })
            expect(store.taskEvents.list('default', 't1').map((e) => e.type)).toEqual(['draft_submitted', 'draft_submitted', 'draft_confirmed'])
            expect(store.taskEvents.latest('default', 't1', 'draft_submitted')?.payload).toEqual({ version: 2 })
            expect(store.taskEvents.count('default', 't1', 'draft_submitted')).toBe(2)
            dbOf(store).close()
        })
    })
})
