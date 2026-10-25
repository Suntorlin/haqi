import type { Database } from 'bun:sqlite'
import { randomBytes } from 'node:crypto'

import type {
    StoredReport,
    StoredReportAsset,
    StoredReportShare
} from './types'
import {
    createReport,
    createReportAsset,
    createReportShare,
    getReport,
    getReportAsset,
    getReportAssetByNamespace,
    getReportByNamespace,
    getReportShareByToken,
    listReportAssets,
    listReportAssetsByNamespace,
    listReportSharesByNamespace,
    listReportsByNamespace,
    revokeReportShareByNamespace,
    updateReport
} from './reports'

const DEFAULT_SHARE_TOKEN_BYTES = 24
/** Every public report link expires: three days is the default and the longest life. */
export const SHARE_MAX_LIFETIME_MS = 3 * 24 * 60 * 60 * 1000

export class ReportStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    createReport(options: {
        namespace: string
        sessionId?: string | null
        taskId?: string | null
        title?: string | null
        status?: string | null
        markdown?: string | null
        metadata?: unknown
    }): StoredReport {
        return createReport(this.db, options)
    }

    getReport(id: string): StoredReport | null {
        return getReport(this.db, id)
    }

    getReportByNamespace(id: string, namespace: string): StoredReport | null {
        return getReportByNamespace(this.db, id, namespace)
    }

    listReportsByNamespace(
        namespace: string,
        options?: {
            limit?: number
            sessionId?: string | null
        }
    ): StoredReport[] {
        return listReportsByNamespace(this.db, namespace, options)
    }

    updateReport(options: {
        id: string
        namespace: string
        title?: string | null
        status?: string | null
        markdown?: string | null
        metadata?: unknown
        taskId?: string | null
    }): StoredReport | null {
        return updateReport(this.db, options)
    }

    /** null removes the page; the share link shows the markdown again. */
    setPage(reportId: string, namespace: string, html: string | null): void {
        if (html === null) {
            this.db.prepare('DELETE FROM report_pages WHERE report_id = ? AND namespace = ?').run(reportId, namespace)
            return
        }
        this.db.prepare(`
            INSERT INTO report_pages (report_id, namespace, html, updated_at) VALUES (?, ?, ?, ?)
            ON CONFLICT(report_id) DO UPDATE SET html = excluded.html, updated_at = excluded.updated_at
        `).run(reportId, namespace, html, Date.now())
    }

    getPage(reportId: string): { html: string; updatedAt: number } | null {
        const row = this.db.prepare('SELECT html, updated_at FROM report_pages WHERE report_id = ?').get(reportId) as { html: string; updated_at: number } | null
        return row ? { html: row.html, updatedAt: row.updated_at } : null
    }

    hasPage(reportId: string): boolean {
        return Boolean(this.db.prepare('SELECT 1 FROM report_pages WHERE report_id = ?').get(reportId))
    }

    createAsset(options: {
        reportId: string
        namespace: string
        fileName: string
        storageKey: string
        mimeType: string
        size: number
        caption?: string | null
    }): StoredReportAsset {
        return createReportAsset(this.db, options)
    }

    listAssetsByNamespace(reportId: string, namespace: string): StoredReportAsset[] {
        return listReportAssetsByNamespace(this.db, reportId, namespace)
    }

    listAssets(reportId: string): StoredReportAsset[] {
        return listReportAssets(this.db, reportId)
    }

    getAssetByNamespace(reportId: string, assetId: string, namespace: string): StoredReportAsset | null {
        return getReportAssetByNamespace(this.db, reportId, assetId, namespace)
    }

    getAsset(reportId: string, assetId: string): StoredReportAsset | null {
        return getReportAsset(this.db, reportId, assetId)
    }

    createShare(options: {
        reportId: string
        namespace: string
        createdBy?: string | null
        expiresAt?: number | null
        token?: string
    }): StoredReportShare {
        const latestExpiresAt = Date.now() + SHARE_MAX_LIFETIME_MS
        const expiresAt = Math.min(options.expiresAt ?? latestExpiresAt, latestExpiresAt)
        const maxAttempts = 6
        let attempt = 0

        while (attempt < maxAttempts) {
            attempt += 1
            const token = options.token ?? randomBytes(DEFAULT_SHARE_TOKEN_BYTES).toString('base64url')
            try {
                return createReportShare(this.db, {
                    reportId: options.reportId,
                    namespace: options.namespace,
                    token,
                    createdBy: options.createdBy,
                    expiresAt
                })
            } catch (error) {
                const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
                const tokenConflict = message.includes('unique') && message.includes('token')
                if (!tokenConflict || options.token) {
                    throw error
                }
            }
        }

        throw new Error('Failed to create unique share token')
    }

    listSharesByNamespace(
        reportId: string,
        namespace: string,
        options?: { includeRevoked?: boolean }
    ): StoredReportShare[] {
        return listReportSharesByNamespace(this.db, reportId, namespace, options)
    }

    revokeShareByNamespace(reportId: string, shareId: string, namespace: string): StoredReportShare | null {
        return revokeReportShareByNamespace(this.db, reportId, shareId, namespace)
    }

    getShareByToken(token: string): StoredReportShare | null {
        return getReportShareByToken(this.db, token)
    }
}
