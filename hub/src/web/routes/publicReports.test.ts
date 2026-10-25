import { describe, expect, it } from 'bun:test'
import type { Database } from 'bun:sqlite'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Store } from '../../store'
import { createPublicReportsRoutes } from './publicReports'

function closeStore(store: Store): void {
    const db = (store as unknown as { db: Database }).db
    db.close()
}

describe('public report markdown rendering', () => {
    it('renders GFM markdown blocks with marked', async () => {
        const store = new Store(':memory:')

        const report = store.reports.createReport({
            namespace: 'default',
            title: 'Markdown Feature Report',
            markdown: [
                '# Heading',
                '',
                '> quote line',
                '',
                '| A | B |',
                '| --- | --- |',
                '| 1 | 2 |',
                '',
                '- [x] done',
                '- [ ] todo',
                '',
                '~~strike~~'
            ].join('\n')
        })
        const share = store.reports.createShare({
            reportId: report.id,
            namespace: 'default'
        })

        const app = createPublicReportsRoutes({
            store,
            reportsStorageDir: '/tmp'
        })
        const response = await app.request(`http://localhost/share/r/${share.token}`)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<table>')
        expect(html).toContain('<blockquote>')
        expect(html).toContain('<del>strike</del>')
        expect(html).toContain('type="checkbox"')

        closeStore(store)
    })

    it('sanitizes raw html and unsafe links while preserving asset links', async () => {
        const store = new Store(':memory:')

        const report = store.reports.createReport({
            namespace: 'default',
            title: 'Sanitize Report',
            markdown: [
                '<script>alert(1)</script>',
                '',
                '[bad](javascript:alert(1))',
                '',
                '![shot](asset://asset-123)'
            ].join('\n')
        })
        const share = store.reports.createShare({
            reportId: report.id,
            namespace: 'default'
        })

        const app = createPublicReportsRoutes({
            store,
            reportsStorageDir: '/tmp'
        })
        const response = await app.request(`http://localhost/share/r/${share.token}`)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
        expect(html).toContain('<a href="#">bad</a>')
        expect(html).toContain(`/share/r/${share.token}/assets/asset-123`)

        closeStore(store)
    })

    it('renders Assets section for text and binary assets', async () => {
        const store = new Store(':memory:')

        const report = store.reports.createReport({
            namespace: 'default',
            title: 'Asset Report',
            markdown: 'Body only'
        })
        const share = store.reports.createShare({
            reportId: report.id,
            namespace: 'default'
        })

        store.reports.createAsset({
            reportId: report.id,
            namespace: 'default',
            fileName: 'notes.md',
            storageKey: 'notes.md',
            mimeType: 'text/markdown',
            size: 12,
            caption: 'Release Notes'
        })
        store.reports.createAsset({
            reportId: report.id,
            namespace: 'default',
            fileName: 'bundle.zip',
            storageKey: 'bundle.zip',
            mimeType: 'application/zip',
            size: 12
        })

        const app = createPublicReportsRoutes({
            store,
            reportsStorageDir: '/tmp'
        })
        const response = await app.request(`http://localhost/share/r/${share.token}`)
        const html = await response.text()

        expect(response.status).toBe(200)
        expect(html).toContain('<h2>Assets</h2>')
        expect(html).toContain('Release Notes')
        expect(html).toContain('/view')
        expect(html).toContain('ZIP')
        expect(html).toContain('Download')

        closeStore(store)
    })

    it('opens text assets in a viewer page and supports download', async () => {
        const store = new Store(':memory:')

        const report = store.reports.createReport({
            namespace: 'default',
            title: 'Text Asset Report',
            markdown: 'See assets'
        })
        const share = store.reports.createShare({
            reportId: report.id,
            namespace: 'default'
        })
        const asset = store.reports.createAsset({
            reportId: report.id,
            namespace: 'default',
            fileName: 'notes.txt',
            storageKey: 'notes.txt',
            mimeType: 'text/plain',
            size: 11
        })

        const storageRoot = join(tmpdir(), `haqi-report-test-${Date.now()}`)
        await mkdir(join(storageRoot, report.id), { recursive: true })
        await writeFile(join(storageRoot, report.id, asset.storageKey), 'hello world', 'utf8')

        const app = createPublicReportsRoutes({
            store,
            reportsStorageDir: storageRoot
        })

        const viewResponse = await app.request(`http://localhost/share/r/${share.token}/assets/${asset.id}/view`)
        const viewHtml = await viewResponse.text()
        expect(viewResponse.status).toBe(200)
        expect(viewHtml).toContain('hello world')
        expect(viewHtml).toContain('Back to report')
        expect(viewHtml).toContain('Download')

        const downloadResponse = await app.request(`http://localhost/share/r/${share.token}/assets/${asset.id}?download=1`)
        expect(downloadResponse.status).toBe(200)
        expect(downloadResponse.headers.get('content-disposition')).toContain('attachment;')

        closeStore(store)
    })
})

describe('public report page', () => {
    it('shows the full HTML page at the same share link after every update, sandboxed', async () => {
        const store = new Store(':memory:')
        const report = store.reports.createReport({ namespace: 'default', title: 'Daily', markdown: '# Summary' })
        const share = store.reports.createShare({ reportId: report.id, namespace: 'default' })
        const app = createPublicReportsRoutes({ store, reportsStorageDir: tmpdir() })

        store.reports.setPage(report.id, 'default', '<!doctype html><html><body><script>1</script>day one</body></html>')
        const first = await app.request(`/share/r/${share.token}`)
        expect(first.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
        expect(await first.text()).toContain('day one')

        store.reports.setPage(report.id, 'default', '<!doctype html><html><body>day two</body></html>')
        expect(await (await app.request(`/share/r/${share.token}`)).text()).toContain('day two')
        expect(await (await app.request(`/share/r/${share.token}?view=markdown`)).text()).toContain('Summary')

        store.reports.setPage(report.id, 'default', null)
        expect(await (await app.request(`/share/r/${share.token}`)).text()).toContain('Summary')
        closeStore(store)
    })
})
