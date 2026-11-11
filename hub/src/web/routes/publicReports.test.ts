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

describe('public report inline media', () => {
    it('plays video and audio in the text and keeps only unused assets in the Assets list', async () => {
        const store = new Store(':memory:')
        const report = store.reports.createReport({ namespace: 'default', title: 'Media Report', markdown: '' })
        const share = store.reports.createShare({ reportId: report.id, namespace: 'default' })
        const add = (fileName: string, mimeType: string) => store.reports.createAsset({
            reportId: report.id, namespace: 'default', fileName, storageKey: fileName, mimeType, size: 1
        })
        const video = add('demo.mp4', 'video/mp4')
        const audio = add('voice.mp3', 'audio/mpeg')
        const shot = add('shot.png', 'image/png')
        const pdf = add('spec.pdf', 'application/pdf')
        const unused = add('extra.png', 'image/png')
        store.reports.updateReport({
            id: report.id,
            namespace: 'default',
            markdown: [
                '![Demo run](asset://' + video.id + ')',
                '![Voice](asset://' + audio.id + ')',
                // An agent pasted the share asset link of another share in place of asset://<id>.
                '![Shot](https://haqi.example.com/share/r/old-token/assets/' + shot.id + ')',
                '![Spec](asset://' + pdf.id + ')'
            ].join('\n\n')
        })

        const app = createPublicReportsRoutes({ store, reportsStorageDir: '/tmp' })
        const html = await (await app.request(`http://localhost/share/r/${share.token}`)).text()
        const [body, assetsList = ''] = html.split('<h2>Assets</h2>')

        expect(body).toContain(`<video controls playsinline preload="metadata" src="/share/r/${share.token}/assets/${video.id}"></video><figcaption>Demo run</figcaption>`)
        expect(body).toContain(`<audio controls preload="metadata" src="/share/r/${share.token}/assets/${audio.id}"></audio>`)
        expect(body).toContain(`<img src="/share/r/${share.token}/assets/${shot.id}"`)
        expect(body).toContain(`<a href="/share/r/${share.token}/assets/${pdf.id}" target="_blank" rel="noreferrer">Spec</a>`)
        expect(assetsList).toContain(unused.id)
        for (const used of [video, audio, shot, pdf]) expect(assetsList).not.toContain(used.id)

        closeStore(store)
    })

    it('answers a byte range with 206 so Safari can play video', async () => {
        const store = new Store(':memory:')
        const report = store.reports.createReport({ namespace: 'default', title: 'Range Report', markdown: '' })
        const share = store.reports.createShare({ reportId: report.id, namespace: 'default' })
        const asset = store.reports.createAsset({
            reportId: report.id, namespace: 'default', fileName: 'demo.mp4', storageKey: 'demo.mp4', mimeType: 'video/mp4', size: 10
        })
        const storageRoot = join(tmpdir(), `haqi-report-range-${Date.now()}`)
        await mkdir(join(storageRoot, report.id), { recursive: true })
        await writeFile(join(storageRoot, report.id, asset.storageKey), '0123456789', 'utf8')
        const app = createPublicReportsRoutes({ store, reportsStorageDir: storageRoot })
        const url = `http://localhost/share/r/${share.token}/assets/${asset.id}`

        const partial = await app.request(url, { headers: { Range: 'bytes=2-5' } })
        expect(partial.status).toBe(206)
        expect(partial.headers.get('content-range')).toBe('bytes 2-5/10')
        expect(await partial.text()).toBe('2345')

        const full = await app.request(url)
        expect(full.status).toBe(200)
        expect(full.headers.get('accept-ranges')).toBe('bytes')
        expect(await full.text()).toBe('0123456789')

        expect((await app.request(url, { headers: { Range: 'bytes=20-' } })).status).toBe(416)

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
