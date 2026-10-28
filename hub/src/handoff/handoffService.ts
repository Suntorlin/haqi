import { existsSync, realpathSync, statSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { basename, dirname, join, posix, sep } from 'node:path'

import type { Store, StoredHandoffExport, StoredReport } from '../store'
import {
    appendSection,
    dateParts,
    fileNameFor,
    folderFromHistory,
    folderOf,
    HANDOFF,
    hashText,
    indexFolders,
    indexLine,
    linkPathOf,
    normalizeFolder,
    nudgeText,
    readHandoffMeta,
    renderBody,
    renderCopy,
    upsertIndexLine,
    type NotesConfig
} from './handoff'

export type HandoffSession = { namespace: string; active: boolean; thinking: boolean; path: string | null }

export type HandoffHost = {
    /** Null turns the export off. */
    config: () => Promise<NotesConfig | null>
    session: (sessionId: string) => HandoffSession | null
    /** When the session last showed work. */
    lastActivity: (sessionId: string) => number | null
    /** Sends a message into a live session; false when it could not. */
    send: (sessionId: string, text: string) => Promise<boolean>
    shareUrl: (reportId: string) => string | null
    project: (path: string) => string | null
    alert: (namespace: string, alert: { reportId: string; sessionId: string | null; title: string; body: string }) => Promise<void>
}

export type FolderCheck = { folder: string | null; problem: string | null; candidates: string[] }

/** Where a handoff will go, as the agent sees it after create/update. */
export type HandoffCheck = FolderCheck & { enabled: boolean; summaryMissing: boolean }

/**
 * Copies handoff reports into the user's notes folder once their session ends: ten quiet minutes after a turn,
 * when the session is archived, or at the hourly sweep. A report the session kept working past is sent back to
 * the session once to be brought up to date. Failed writes retry after 1, 5 and 30 minutes, then alert.
 */
export class HandoffService {
    private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly running = new Set<string>()
    private sweepTimer: ReturnType<typeof setInterval> | null = null
    private retryTimer: ReturnType<typeof setInterval> | null = null
    private stopped = false

    constructor(private readonly store: Store, private readonly host: HandoffHost) {}

    start(): void {
        this.sweepTimer = setInterval(() => { void this.sweep() }, HANDOFF.sweepMs)
        this.retryTimer = setInterval(() => { void this.retryDue() }, HANDOFF.retryTickMs)
    }

    stop(): void {
        this.stopped = true
        for (const timer of this.idleTimers.values()) clearTimeout(timer)
        this.idleTimers.clear()
        if (this.sweepTimer) clearInterval(this.sweepTimer)
        if (this.retryTimer) clearInterval(this.retryTimer)
    }

    /** A turn ended; when the session stays quiet for a while, its handoff reports are copied. */
    noteTurnEnd(sessionId: string): void {
        if (this.stopped || this.store.handoffs.handoffReportIds({ sessionId }).length === 0) return
        const existing = this.idleTimers.get(sessionId)
        if (existing) clearTimeout(existing)
        this.idleTimers.set(sessionId, setTimeout(() => {
            this.idleTimers.delete(sessionId)
            void this.settleSession(sessionId)
        }, HANDOFF.idleMs))
    }

    /** The session was archived or its process ended: copy now. */
    noteSessionEnd(sessionId: string): void {
        if (this.stopped) return
        const existing = this.idleTimers.get(sessionId)
        if (existing) clearTimeout(existing)
        this.idleTimers.delete(sessionId)
        void this.settleSession(sessionId)
    }

    async settleSession(sessionId: string): Promise<void> {
        for (const reportId of this.store.handoffs.handoffReportIds({ sessionId })) {
            await this.process(reportId)
        }
    }

    /** Hourly: every recent handoff whose session is over or quiet. */
    async sweep(now = Date.now()): Promise<void> {
        for (const reportId of this.store.handoffs.handoffReportIds({ updatedSince: now - HANDOFF.sweepWindowMs })) {
            const report = this.store.reports.getReport(reportId)
            if (!report) continue
            const session = report.sessionId ? this.host.session(report.sessionId) : null
            if (session?.active) {
                const last = this.host.lastActivity(report.sessionId!) ?? 0
                if (session.thinking || now - last < HANDOFF.idleMs) continue
            }
            await this.process(reportId, now)
        }
    }

    async retryDue(now = Date.now()): Promise<void> {
        for (const row of this.store.handoffs.listDue(now)) await this.process(row.reportId, now)
    }

    /** Folder choices for a session's project: its own history first, then what the index already links into. */
    async candidates(namespace: string, sessionId: string | null): Promise<{ enabled: boolean; candidates: string[] }> {
        const config = await this.host.config()
        if (!config) return { enabled: false, candidates: [] }
        return { enabled: true, candidates: await this.listCandidates(config, namespace, this.projectOf(sessionId)) }
    }

    /** How a report's handoff stands now: the folder it will go to, what is wrong, the choices. */
    async check(report: StoredReport): Promise<HandoffCheck | null> {
        const meta = readHandoffMeta(report.metadata)
        if (!meta) return null
        const config = await this.host.config()
        if (!config) return { enabled: false, folder: null, problem: null, candidates: [], summaryMissing: false }
        const folder = this.checkFolder(config, meta.folder)
        const candidates = folder.problem ? await this.listCandidates(config, report.namespace, this.projectOf(report.sessionId)) : []
        return { enabled: true, ...folder, candidates, summaryMissing: !meta.summary }
    }

    async process(reportId: string, now = Date.now()): Promise<void> {
        if (this.running.has(reportId)) return
        this.running.add(reportId)
        try {
            await this.processReport(reportId, now)
        } finally {
            this.running.delete(reportId)
        }
    }

    private projectOf(sessionId: string | null): string | null {
        const path = sessionId ? this.host.session(sessionId)?.path : null
        return path ? this.host.project(path) : null
    }

    private checkFolder(config: NotesConfig, folder: string | null): Omit<FolderCheck, 'candidates'> {
        if (!folder) return { folder: null, problem: '报告没有给出目录。' }
        const normalized = normalizeFolder(folder)
        if (!normalized) return { folder: null, problem: `目录「${folder}」不在笔记库里（不能是绝对路径，也不能含 ..）。` }
        const absolute = join(config.root, ...normalized.split('/'))
        try {
            const root = realpathSync(config.root)
            const real = realpathSync(absolute)
            if (real !== root && !real.startsWith(root + sep)) return { folder: null, problem: `目录「${folder}」指到了笔记库外面。` }
            if (!statSync(real).isDirectory()) return { folder: null, problem: `「${folder}」不是目录。` }
        } catch {
            return { folder: null, problem: `笔记库里没有目录「${folder}」。` }
        }
        return { folder: normalized, problem: null }
    }

    private async listCandidates(config: NotesConfig, namespace: string, project: string | null): Promise<string[]> {
        const seen = new Set<string>()
        const add = (folder: string) => {
            if (seen.size < 20 && !this.checkFolder(config, folder).problem) seen.add(folder)
        }
        if (project) for (const entry of this.store.handoffs.folderCounts(namespace, project)) add(entry.folder)
        const index = await readFile(join(config.root, config.index), 'utf8').catch(() => '')
        const indexDir = folderOf(config.index)
        const resolve = (linkPath: string): string | null => {
            for (const base of ['', indexDir]) {
                const folder = folderOf(posix.join(base, linkPath))
                if (folder && !this.checkFolder(config, folder).problem) return folder
            }
            return null
        }
        for (const entry of indexFolders(index, resolve)) add(entry.folder)
        return [...seen]
    }

    private async processReport(reportId: string, now: number): Promise<void> {
        const report = this.store.reports.getReport(reportId)
        const meta = report ? readHandoffMeta(report.metadata) : null
        if (!report || !meta) return
        const config = await this.host.config()
        if (!config) return

        const session = report.sessionId ? this.host.session(report.sessionId) : null
        if (session?.active && session.thinking) return
        const project = this.projectOf(report.sessionId)
        const previous = this.store.handoffs.get(reportId)
        const row: StoredHandoffExport = previous ?? {
            reportId, namespace: report.namespace, sessionId: report.sessionId, project, folder: null, filePath: null,
            renderedHash: null, writtenHash: null, mode: 'own', status: 'pending', attempts: 0, nextAt: null,
            lastError: null, nudgedVersion: null, exportedAt: null, updatedAt: now
        }
        row.project = project ?? row.project
        row.sessionId = report.sessionId

        if (report.markdown.trim().length < HANDOFF.minChars) {
            const marker = `empty:${report.updatedAt}`
            if (row.renderedHash !== marker) {
                await this.host.alert(report.namespace, {
                    reportId, sessionId: report.sessionId, title: '交接报告没有内容，没有复制到笔记库',
                    body: `「${report.title}」的 markdown 不到 ${HANDOFF.minChars} 字（整页 HTML 的报告也要带完整 markdown）。`
                }).catch(() => {})
            }
            this.store.handoffs.upsert({ ...row, status: 'empty', renderedHash: marker, updatedAt: now })
            return
        }

        const last = report.sessionId ? this.host.lastActivity(report.sessionId) : null
        const stale = last !== null && last - report.updatedAt > HANDOFF.staleMs
        const chosen = this.checkFolder(config, meta.folder)
        const kept = row.folder && row.folder !== config.inbox && !this.checkFolder(config, row.folder).problem ? row.folder : null
        const history = project ? folderFromHistory(this.store.handoffs.folderCounts(report.namespace, project)) : null
        const folder = chosen.folder ?? kept ?? history
        const inbox = !folder

        if (session?.active && row.nudgedVersion !== report.updatedAt) {
            const candidates = inbox ? await this.listCandidates(config, report.namespace, project) : []
            // Folder and summary are asked for once; being out of date is asked again for each new version.
            const firstAsk = row.nudgedVersion === null
            const message = nudgeText({
                title: report.title, stale, candidates,
                folderProblem: inbox && firstAsk ? chosen.problem : null,
                summaryMissing: !meta.summary && firstAsk
            })
            if (message && await this.host.send(report.sessionId!, message).catch(() => false)) {
                this.store.handoffs.upsert({ ...row, nudgedVersion: report.updatedAt, updatedAt: now })
                return
            }
        }

        const shareUrl = this.host.shareUrl(reportId)
        const copyInput = {
            reportId, sessionId: report.sessionId, project, markdown: report.markdown, shareUrl,
            updatedAt: report.updatedAt, stale, inbox, timeZone: config.timeZone, zoneLabel: config.zoneLabel
        }
        const targetFolder = folder ?? config.inbox
        const fileName = row.filePath ? basename(row.filePath) : fileNameFor(report.title, dateParts(report.createdAt, config.timeZone).date)
        const rendered = renderCopy(copyInput)
        const renderedHash = hashText(`${meta.summary ?? ''}\n${meta.shortTitle ?? ''}\n${report.title}\n${rendered}`)
        // A copy the user edited stays where it is, so only its content counts there.
        const placed = row.folder === targetFolder || row.mode === 'append'
        if (row.status === 'ok' && row.renderedHash === renderedHash && placed) return

        try {
            const written = await this.write(config, row, targetFolder, fileName, rendered, renderBody(copyInput), now)
            const when = dateParts(report.updatedAt, config.timeZone)
            const line = indexLine({
                date: when.date, time: when.time, zoneLabel: config.zoneLabel, linkPath: linkPathOf(written.filePath),
                shortTitle: meta.shortTitle ?? report.title, summary: meta.summary, shareUrl, stale, inbox
            })
            const indexPath = join(config.root, config.index)
            const index = await readFile(indexPath, 'utf8').catch(() => '')
            const linkPaths = [linkPathOf(written.filePath), ...(row.filePath && row.filePath !== written.filePath ? [linkPathOf(row.filePath)] : [])]
            await atomicWrite(indexPath, upsertIndexLine(index, linkPaths, line))
            this.store.handoffs.upsert({
                ...row, folder: folderOf(written.filePath), filePath: written.filePath, renderedHash, writtenHash: written.hash, mode: written.mode,
                status: 'ok', attempts: 0, nextAt: null, lastError: null, exportedAt: now, updatedAt: now
            })
        } catch (error) {
            const attempts = row.attempts + 1
            const message = error instanceof Error ? error.message : String(error)
            this.store.handoffs.upsert({
                ...row, status: 'failed', attempts, lastError: message.slice(0, 500),
                nextAt: attempts <= HANDOFF.retryMs.length ? now + HANDOFF.retryMs[attempts - 1]! : null, updatedAt: now
            })
            if (attempts === HANDOFF.alertAfter) {
                await this.host.alert(report.namespace, {
                    reportId, sessionId: report.sessionId, title: '交接报告复制到笔记库失败',
                    body: `「${report.title}」连续 ${attempts} 次没写进去：${message.slice(0, 200)}。之后每小时再试一次。`
                }).catch(() => {})
            }
        }
    }

    /** Writes the copy: the whole file while it is ours, only an added section once the user has edited it. */
    private async write(
        config: NotesConfig, row: StoredHandoffExport, folder: string, fileName: string, rendered: string, body: string, now: number
    ): Promise<{ filePath: string; hash: string; mode: 'own' | 'append' }> {
        const moving = row.filePath !== null && folderOf(row.filePath) !== folder && row.mode === 'own'
        let filePath = row.filePath && !moving ? row.filePath : posix.join(folder, fileName)
        let mode = row.mode
        let current: string | null = await readFile(join(config.root, filePath), 'utf8').catch(() => null)

        if (current !== null && (row.filePath === null || moving)) {
            // A file of the same name that is not this report's copy: never touch it, pick another name.
            filePath = await freeName(config.root, filePath)
            current = null
        } else if (current !== null && mode === 'own' && row.writtenHash && hashText(current) !== row.writtenHash) {
            mode = 'append'
        }
        if (current === null && row.filePath && !moving) mode = 'own'

        const content = mode === 'append' && current !== null
            ? appendSection(current, body, dateParts(now, config.timeZone), config.zoneLabel)
            : rendered
        const absolute = join(config.root, filePath)
        await atomicWrite(absolute, content)
        if (await readFile(absolute, 'utf8') !== content) throw new Error(`Read-back of ${filePath} does not match what was written`)

        if (moving && row.filePath) {
            const old = join(config.root, row.filePath)
            const oldContent = await readFile(old, 'utf8').catch(() => null)
            if (oldContent !== null && hashText(oldContent) === row.writtenHash) await unlink(old).catch(() => {})
        }
        return { filePath, hash: hashText(content), mode }
    }
}

async function freeName(root: string, filePath: string): Promise<string> {
    const base = filePath.replace(/\.md$/i, '')
    for (let n = 1; n < 100; n++) {
        const candidate = `${base} (HAQI${n > 1 ? ` ${n}` : ''}).md`
        if (!existsSync(join(root, candidate))) return candidate
    }
    throw new Error(`No free file name next to ${filePath}`)
}

/** Writes beside the target and renames over it, so a reader never sees half a file. */
async function atomicWrite(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true })
    const temp = join(dirname(path), `.${basename(path)}.haqi-tmp`)
    await writeFile(temp, content, 'utf8')
    await rename(temp, path)
}

