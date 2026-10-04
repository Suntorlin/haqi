import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from './index'

const GROUP_TABLES = [
    'project_offline_preferences',
    'groups',
    'group_members',
    'group_messages',
    'group_conversation_turns',
    'group_tasks',
    'group_notes'
] as const

const REPORT_TABLES = [
    'reports',
    'report_assets',
    'report_shares'
] as const

function closeStore(store: Store): void {
    const db = (store as unknown as { db: Database }).db
    db.close()
}

describe('Store schema repair', () => {
    it('auto-repairs missing group tables when user_version is already current', () => {
        const dir = mkdtempSync(join(tmpdir(), 'haqi-store-repair-'))
        const dbPath = join(dir, 'hapi.db')

        const seeded = new Store(dbPath)
        const seededDb = (seeded as unknown as { db: Database }).db
        seededDb.exec(`
            DROP TABLE IF EXISTS project_offline_preferences;
            DROP TABLE IF EXISTS group_notes;
            DROP TABLE IF EXISTS group_tasks;
            DROP TABLE IF EXISTS group_conversation_turns;
            DROP TABLE IF EXISTS group_messages;
            DROP TABLE IF EXISTS group_members;
            DROP TABLE IF EXISTS groups;
            PRAGMA user_version = 6;
        `)
        closeStore(seeded)

        const repaired = new Store(dbPath)
        const repairedDb = (repaired as unknown as { db: Database }).db

        const placeholders = GROUP_TABLES.map(() => '?').join(', ')
        const rows = repairedDb.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...GROUP_TABLES) as Array<{ name: string }>
        const tableSet = new Set(rows.map((row) => row.name))
        for (const table of GROUP_TABLES) {
            expect(tableSet.has(table)).toBe(true)
        }

        const group = repaired.groups.createGroup({
            namespace: 'default',
            name: 'Schema Repair Smoke Test'
        })
        expect(group.name).toBe('Schema Repair Smoke Test')
        const note = repaired.groups.getGroupNote(group.id, 'default')
        expect(note).not.toBeNull()

        closeStore(repaired)
        rmSync(dir, { recursive: true, force: true })
    })

    it('runs the v8+ migration chain to the current version and creates report tables', () => {
        const dir = mkdtempSync(join(tmpdir(), 'haqi-store-repair-'))
        const dbPath = join(dir, 'hapi.db')

        const seeded = new Store(dbPath)
        const seededDb = (seeded as unknown as { db: Database }).db
        seededDb.exec(`
            DROP TABLE IF EXISTS report_shares;
            DROP TABLE IF EXISTS report_assets;
            DROP TABLE IF EXISTS reports;
            PRAGMA user_version = 8;
        `)
        closeStore(seeded)

        const migrated = new Store(dbPath)
        const migratedDb = (migrated as unknown as { db: Database }).db
        const versionRow = migratedDb.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        expect(versionRow?.user_version).toBe(13)

        const placeholders = REPORT_TABLES.map(() => '?').join(', ')
        const rows = migratedDb.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...REPORT_TABLES) as Array<{ name: string }>
        const tableSet = new Set(rows.map((row) => row.name))
        for (const table of REPORT_TABLES) {
            expect(tableSet.has(table)).toBe(true)
        }

        closeStore(migrated)
        rmSync(dir, { recursive: true, force: true })
    })
})
