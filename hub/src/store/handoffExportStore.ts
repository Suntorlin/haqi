import type { Database } from 'bun:sqlite'

import type { StoredHandoffExport } from './types'

/** One row per handoff report: where its notes copy lives, what was written last, and the retry state. */
export const HANDOFF_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS handoff_exports (
        report_id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        session_id TEXT,
        project TEXT,
        folder TEXT,
        file_path TEXT,
        rendered_hash TEXT,
        written_hash TEXT,
        mode TEXT NOT NULL DEFAULT 'own',
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_at INTEGER,
        last_error TEXT,
        nudged_version INTEGER,
        exported_at INTEGER,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_handoff_exports_namespace_project ON handoff_exports(namespace, project);
`

type HandoffRow = {
    report_id: string
    namespace: string
    session_id: string | null
    project: string | null
    folder: string | null
    file_path: string | null
    rendered_hash: string | null
    written_hash: string | null
    mode: string
    status: string
    attempts: number
    next_at: number | null
    last_error: string | null
    nudged_version: number | null
    exported_at: number | null
    updated_at: number
}

function toExport(row: HandoffRow): StoredHandoffExport {
    return {
        reportId: row.report_id,
        namespace: row.namespace,
        sessionId: row.session_id,
        project: row.project,
        folder: row.folder,
        filePath: row.file_path,
        renderedHash: row.rendered_hash,
        writtenHash: row.written_hash,
        mode: row.mode === 'append' ? 'append' : 'own',
        status: row.status === 'ok' || row.status === 'failed' || row.status === 'empty' ? row.status : 'pending',
        attempts: row.attempts,
        nextAt: row.next_at,
        lastError: row.last_error,
        nudgedVersion: row.nudged_version,
        exportedAt: row.exported_at,
        updatedAt: row.updated_at
    }
}

export class HandoffExportStore {
    constructor(private readonly db: Database) {}

    get(reportId: string): StoredHandoffExport | null {
        const row = this.db.prepare('SELECT * FROM handoff_exports WHERE report_id = ?').get(reportId) as HandoffRow | undefined
        return row ? toExport(row) : null
    }

    /** Handoff reports (metadata carries `handoff`) of one session, or of every session when none is given. */
    handoffReportIds(options: { sessionId?: string; updatedSince?: number }): string[] {
        const clauses = ["json_extract(metadata, '$.handoff') IS NOT NULL"]
        const params: Array<string | number> = []
        if (options.sessionId) {
            clauses.push('session_id = ?')
            params.push(options.sessionId)
        }
        if (options.updatedSince !== undefined) {
            clauses.push('updated_at >= ?')
            params.push(options.updatedSince)
        }
        const rows = this.db.prepare(`SELECT id FROM reports WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC`).all(...params) as Array<{ id: string }>
        return rows.map((row) => row.id)
    }

    /** Rows whose failed write is due for another try. */
    listDue(now: number): StoredHandoffExport[] {
        const rows = this.db.prepare("SELECT * FROM handoff_exports WHERE status = 'failed' AND next_at IS NOT NULL AND next_at <= ?").all(now) as HandoffRow[]
        return rows.map(toExport)
    }

    /** How often each folder took a handoff of this project. */
    folderCounts(namespace: string, project: string): Array<{ folder: string; count: number }> {
        return this.db.prepare(`
            SELECT folder, COUNT(*) AS count FROM handoff_exports
            WHERE namespace = ? AND project = ? AND folder IS NOT NULL AND status = 'ok'
            GROUP BY folder ORDER BY count DESC
        `).all(namespace, project) as Array<{ folder: string; count: number }>
    }

    upsert(row: StoredHandoffExport): void {
        this.db.prepare(`
            INSERT INTO handoff_exports (report_id, namespace, session_id, project, folder, file_path, rendered_hash, written_hash,
                mode, status, attempts, next_at, last_error, nudged_version, exported_at, updated_at)
            VALUES (@report_id, @namespace, @session_id, @project, @folder, @file_path, @rendered_hash, @written_hash,
                @mode, @status, @attempts, @next_at, @last_error, @nudged_version, @exported_at, @updated_at)
            ON CONFLICT(report_id) DO UPDATE SET
                session_id = excluded.session_id, project = excluded.project, folder = excluded.folder,
                file_path = excluded.file_path, rendered_hash = excluded.rendered_hash, written_hash = excluded.written_hash,
                mode = excluded.mode, status = excluded.status, attempts = excluded.attempts, next_at = excluded.next_at,
                last_error = excluded.last_error, nudged_version = excluded.nudged_version, exported_at = excluded.exported_at,
                updated_at = excluded.updated_at
        `).run({
            report_id: row.reportId,
            namespace: row.namespace,
            session_id: row.sessionId,
            project: row.project,
            folder: row.folder,
            file_path: row.filePath,
            rendered_hash: row.renderedHash,
            written_hash: row.writtenHash,
            mode: row.mode,
            status: row.status,
            attempts: row.attempts,
            next_at: row.nextAt,
            last_error: row.lastError,
            nudged_version: row.nudgedVersion,
            exported_at: row.exportedAt,
            updated_at: row.updatedAt
        })
    }
}
