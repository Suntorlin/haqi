import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from './index'

describe('SessionTaskStore', () => {
    it('creates, completes, reopens and deletes a task within its namespace', () => {
        const store = new Store(':memory:')
        const task = store.sessionTasks.create('default', { tag: 'haqi', title: 'Memory rework' })
        expect(task).toMatchObject({ tag: 'haqi', title: 'Memory rework', status: 'open', completedAt: null })
        expect(`task:${task.id}`.length).toBeLessThanOrEqual(40)
        expect(store.sessionTasks.list('other')).toEqual([])

        const done = store.sessionTasks.update('default', task.id, { status: 'done' })
        expect(done?.status).toBe('done')
        expect(done?.completedAt).toBeNumber()

        const reopened = store.sessionTasks.update('default', task.id, { status: 'open', title: 'Memory v2' })
        expect(reopened).toMatchObject({ status: 'open', title: 'Memory v2', completedAt: null })

        expect(store.sessionTasks.update('other', task.id, { status: 'done' })).toBeNull()
        expect(store.sessionTasks.delete('other', task.id)).toBe(false)
        expect(store.sessionTasks.delete('default', task.id)).toBe(true)
        expect(store.sessionTasks.list('default')).toEqual([])
    })

    it('adds the table to an existing database without changing its schema version', () => {
        const dir = mkdtempSync(join(tmpdir(), 'haqi-session-tasks-'))
        const dbPath = join(dir, 'hapi.db')
        try {
            const seeded = new Store(dbPath)
            const seededDb = (seeded as unknown as { db: Database }).db
            const version = (seededDb.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
            seededDb.exec('DROP TABLE session_tasks')
            seededDb.close()

            const reopened = new Store(dbPath)
            const reopenedDb = (reopened as unknown as { db: Database }).db
            expect(reopened.sessionTasks.create('default', { tag: 'haqi', title: 'x' }).status).toBe('open')
            expect((reopenedDb.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(version)
            reopenedDb.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })
})
