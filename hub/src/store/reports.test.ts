import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'

import { Store } from './index'
import { SHARE_MAX_LIFETIME_MS } from './reportStore'

function closeStore(store: Store): void {
    const db = (store as unknown as { db: Database }).db
    db.close()
}

describe('ReportStore', () => {
    it('creates reports and enforces namespace isolation', () => {
        const store = new Store(':memory:')

        const report = store.reports.createReport({
            namespace: 'team-a',
            title: 'Smoke Report',
            status: 'draft',
            markdown: '# Smoke\nAll good',
            metadata: { source: 'e2e' }
        })

        const found = store.reports.getReportByNamespace(report.id, 'team-a')
        expect(found).not.toBeNull()
        expect(found?.title).toBe('Smoke Report')
        expect(found?.metadata).toEqual({ source: 'e2e' })

        const wrongNamespace = store.reports.getReportByNamespace(report.id, 'team-b')
        expect(wrongNamespace).toBeNull()

        const updated = store.reports.updateReport({
            id: report.id,
            namespace: 'team-a',
            status: 'pass',
            markdown: '# Smoke\nPASS',
            taskId: 'task-123'
        })

        expect(updated?.status).toBe('pass')
        expect(updated?.taskId).toBe('task-123')
        expect(updated?.markdown).toContain('PASS')

        const listed = store.reports.listReportsByNamespace('team-a')
        expect(listed).toHaveLength(1)
        expect(listed[0]?.id).toBe(report.id)

        closeStore(store)
    })

    it('tracks report assets and share lifecycle', () => {
        const store = new Store(':memory:')

        const report = store.reports.createReport({
            namespace: 'default',
            title: 'Visual Report',
            markdown: '![shot](asset://pending)'
        })

        const asset = store.reports.createAsset({
            reportId: report.id,
            namespace: 'default',
            fileName: 'home.png',
            storageKey: '1-home.png',
            mimeType: 'image/png',
            size: 1234,
            caption: 'Home screen'
        })

        const assets = store.reports.listAssetsByNamespace(report.id, 'default')
        expect(assets).toHaveLength(1)
        expect(assets[0]?.id).toBe(asset.id)
        expect(assets[0]?.caption).toBe('Home screen')

        const share = store.reports.createShare({
            reportId: report.id,
            namespace: 'default',
            createdBy: 'user:test',
            expiresAt: Date.now() + 60_000
        })

        const shareByToken = store.reports.getShareByToken(share.token)
        expect(shareByToken).not.toBeNull()
        expect(shareByToken?.id).toBe(share.id)

        const revoked = store.reports.revokeShareByNamespace(report.id, share.id, 'default')
        expect(revoked).not.toBeNull()
        expect(revoked?.revokedAt).not.toBeNull()

        const shares = store.reports.listSharesByNamespace(report.id, 'default', { includeRevoked: true })
        expect(shares).toHaveLength(1)
        expect(shares[0]?.id).toBe(share.id)
        expect(shares[0]?.revokedAt).not.toBeNull()

        closeStore(store)
    })

    it('gives every share link at most three days', () => {
        const store = new Store(':memory:')
        const report = store.reports.createReport({ namespace: 'default', title: 'Expiry', markdown: '# x' })
        const before = Date.now()

        const byDefault = store.reports.createShare({ reportId: report.id, namespace: 'default' })
        const tooLong = store.reports.createShare({ reportId: report.id, namespace: 'default', expiresAt: before + 30 * SHARE_MAX_LIFETIME_MS })
        const shorter = store.reports.createShare({ reportId: report.id, namespace: 'default', expiresAt: before + 60_000 })

        const after = Date.now()
        for (const share of [byDefault, tooLong]) {
            expect(share.expiresAt).toBeGreaterThanOrEqual(before + SHARE_MAX_LIFETIME_MS)
            expect(share.expiresAt).toBeLessThanOrEqual(after + SHARE_MAX_LIFETIME_MS)
        }
        expect(shorter.expiresAt).toBe(before + 60_000)

        closeStore(store)
    })
})
