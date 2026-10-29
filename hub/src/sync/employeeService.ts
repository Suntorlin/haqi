import { randomUUID } from 'node:crypto'

import type { EmployeeInput, EmployeeLogKind, EmployeePatch } from '@hapi/protocol/schemas'
import type { Store, StoredEmployee, StoredEmployeeIssue } from '../store'
import { changedLines, dayInZone, diffMemoryView, hourInZone, renderMemoryView, timeInZone } from './employeeMemoryView'

/** Open this long without a fix, the user hears about it once; then again after every reminder gap. */
const ISSUE_ESCALATE_AFTER_MS = 3 * 24 * 60 * 60 * 1000
const ISSUE_REMIND_EVERY_MS = 24 * 60 * 60 * 1000

/** How often the background sweep runs: file write-back, the nightly pass, overdue issues. */
export const EMPLOYEE_SWEEP_INTERVAL_MS = 5 * 60 * 1000

const MEMORY_FILE = 'MEMORY.md'
const CHANGES_FILE = 'CHANGES.md'

export class EmployeeError extends Error {
    constructor(message: string, readonly status: number = 400) {
        super(message)
    }
}

export type EmployeeSessionState = {
    active: boolean
    /** Mid-turn or waiting on a permission: the daily reset leaves a busy main session alone. */
    busy: boolean
    summaryText: string | null
}

/** After this many compactions the next wake starts a fresh main session (repeated summaries drift). */
const MAX_MAIN_SESSION_COMPACTIONS = 3

export type EmployeeWakeResult = {
    sessionId: string
    /** What the wake did: sent into the live session, resumed it, or started a fresh one with the state package. */
    outcome: 'sent' | 'resumed' | 'created'
}

export type EmployeeFs = {
    init(machineId: string, params: { home: string; name: string; emoji?: string | null }): Promise<void>
    read(machineId: string, params: { home: string; path: string }): Promise<{ exists: boolean; content: string; mtimeMs: number }>
    write(machineId: string, params: { home: string; path: string; content: string; append?: boolean }): Promise<{ mtimeMs: number }>
    stat(machineId: string, params: { home: string; path: string }): Promise<{ exists: boolean; mtimeMs: number }>
    list(machineId: string, params: { home: string; path: string }): Promise<Array<{ name: string; dir: boolean }>>
}

export interface EmployeeHost {
    machineOnline(namespace: string, machineId: string): boolean
    spawn(input: { namespace: string; employee: StoredEmployee; text: string }): Promise<{ sessionId: string } | { error: string }>
    /** Resume a hub session; null when it could not come back. Returns the session's id, which may be a new one. */
    resume(namespace: string, sessionId: string): Promise<string | null>
    send(sessionId: string, text: string): Promise<boolean>
    /** Stops a session; its history stays. Used by the daily reset and the over-compacted main session swap. */
    archive(sessionId: string): Promise<void>
    session(namespace: string, sessionId: string): EmployeeSessionState | null
    /** The employee a session belongs to, from its metadata. */
    sessionEmployeeId(namespace: string, sessionId: string): string | null
    rename(sessionId: string, name: string): Promise<void>
    tag(sessionId: string, tags: string[]): Promise<void>
    fs: EmployeeFs
    /** The memory housekeeping pass (MemoryService.maintain), reused for the nightly consolidation. */
    maintain(namespace: string): Promise<unknown>
    changed(namespace: string, employeeId: string): void
    alert(namespace: string, alert: { title: string; body: string; url: string }): Promise<void>
    /** The hub machine's timezone; new employees default to it (not baked into the DDL). */
    timezone(): string
    now?(): number
}

type MemorySyncResult =
    | { state: 'offline' | 'no-snapshot' | 'missing' | 'unchanged' }
    | { state: 'synced'; updated: number; archived: number; added: number; closedIssues: number }

export class EmployeeService {
    /** Wake calls for one employee run one at a time: the tail of this chain is the lock (design: wake is serialized per employee). */
    private readonly wakeLocks = new Map<string, Promise<unknown>>()
    /** The run-log file of each session, under the employee home; created on wake and on the first log line. */
    private readonly runLogs = new Map<string, { employeeId: string; path: string }>()
    /** The day (employee timezone) each employee's nightly pass last ran; in memory, so a hub restart reruns it once at most. */
    private readonly nightlyDone = new Map<string, string>()
    /** The day the daily main-session reset last ran per employee. */
    private readonly dailyResetDone = new Map<string, string>()
    /** The main session the daily reset archived, so the next state package still carries its summary. */
    private readonly previousMainSessions = new Map<string, string>()
    private sweeping = false

    constructor(
        private readonly store: Store,
        private readonly host: EmployeeHost
    ) {}

    private now(): number {
        return this.host.now?.() ?? Date.now()
    }

    // ─── CRUD ────────────────────────────────────────────────────────────────────

    async create(namespace: string, input: EmployeeInput): Promise<StoredEmployee> {
        if (this.store.employees.getByName(input.name, namespace)) {
            throw new EmployeeError(`已有同名员工：${input.name}`, 409)
        }
        if (!this.host.machineOnline(namespace, input.machineId)) {
            throw new EmployeeError('员工的默认机器不在线，无法初始化员工目录', 503)
        }
        const id = randomUUID().slice(0, 8)
        const homePath = input.homePath ?? `HAQI/员工/${sanitizePathSegment(input.name) || id}`
        await this.host.fs.init(input.machineId, { home: homePath, name: input.name, emoji: input.emoji ?? null })
        const employee = this.store.employees.insert({
            id,
            namespace,
            name: input.name,
            emoji: input.emoji ?? null,
            status: input.status ?? 'active',
            homePath,
            machineId: input.machineId,
            directory: input.directory,
            agent: input.agent,
            model: input.model ?? null,
            permissionMode: input.permissionMode ?? null,
            accountGroup: input.accountGroup ?? null,
            timezone: input.timezone ?? this.host.timezone(),
            dailyResetHour: input.dailyResetHour ?? 4,
            compactThreshold: input.compactThreshold ?? 0.75,
            webhookSlug: null
        })
        await this.generateMemoryView(namespace, id, '初始生成').catch(() => {})
        this.host.changed(namespace, id)
        return employee
    }

    list(namespace: string): StoredEmployee[] {
        return this.store.employees.list(namespace)
    }

    get(namespace: string, id: string): StoredEmployee {
        const employee = this.store.employees.get(id, namespace)
        if (!employee) throw new EmployeeError('没有这个员工', 404)
        return employee
    }

    update(namespace: string, id: string, patch: EmployeePatch): StoredEmployee {
        this.get(namespace, id)
        const updated = this.store.employees.update(id, namespace, patch)
        if (!updated) throw new EmployeeError('没有这个员工', 404)
        this.host.changed(namespace, id)
        return updated
    }

    delete(namespace: string, id: string): void {
        this.get(namespace, id)
        this.store.employees.delete(id, namespace)
        this.host.changed(namespace, id)
    }

    issues(namespace: string, id: string, status?: 'open' | 'closed'): StoredEmployeeIssue[] {
        this.get(namespace, id)
        return this.store.employees.issues(namespace, id, status)
    }

    // ─── Wake ────────────────────────────────────────────────────────────────────

    /**
     * One wake at a time per employee. The lock covers choosing the session, resuming or spawning, and writing
     * main_session_id back, so two triggers cannot race into two main sessions.
     */
    async wake(namespace: string, employeeId: string, options: { source: string; text?: string }): Promise<EmployeeWakeResult> {
        const previous = this.wakeLocks.get(employeeId) ?? Promise.resolve()
        const run = previous.catch(() => {}).then(() => this.wakeLocked(namespace, employeeId, options))
        this.wakeLocks.set(employeeId, run.catch(() => {}))
        return await run
    }

    private async wakeLocked(namespace: string, employeeId: string, options: { source: string; text?: string }): Promise<EmployeeWakeResult> {
        const employee = this.get(namespace, employeeId)
        if (employee.status !== 'active') throw new EmployeeError(`员工状态是 ${employee.status}，不能唤醒`, 409)
        const text = options.text?.trim()

        // Compacted over the limit: the next wake starts fresh with the state package instead of resuming.
        if (employee.mainSessionId && employee.mainSessionCompactions > MAX_MAIN_SESSION_COMPACTIONS) {
            await this.host.archive(employee.mainSessionId).catch(() => {})
        } else if (employee.mainSessionId) {
            const state = this.host.session(namespace, employee.mainSessionId)
            if (state?.active) {
                if (text) await this.host.send(employee.mainSessionId, text)
                return { sessionId: employee.mainSessionId, outcome: 'sent' }
            }
            if (state) {
                const resumedId = await this.host.resume(namespace, employee.mainSessionId)
                if (resumedId) {
                    if (resumedId !== employee.mainSessionId) {
                        this.store.employees.update(employeeId, namespace, { mainSessionId: resumedId })
                        this.moveRunLog(employee.mainSessionId, resumedId)
                        this.host.changed(namespace, employeeId)
                    }
                    if (text) await this.host.send(resumedId, text)
                    return { sessionId: resumedId, outcome: 'resumed' }
                }
            }
        }

        if (!this.host.machineOnline(namespace, employee.machineId)) {
            throw new EmployeeError('员工的默认机器不在线，无法新开主会话', 503)
        }
        const statePackage = await this.buildStatePackage(namespace, employee)
        const first = [statePackage, text].filter(Boolean).join('\n\n')
        const spawned = await this.host.spawn({ namespace, employee, text: first })
        if ('error' in spawned) throw new EmployeeError(`主会话启动失败：${spawned.error}`, 502)
        this.store.employees.update(employeeId, namespace, {
            mainSessionId: spawned.sessionId,
            mainSessionStartedAt: this.now(),
            mainSessionCompactions: 0
        })
        await this.host.rename(spawned.sessionId, `${employee.emoji ? `${employee.emoji} ` : ''}${employee.name}`).catch(() => {})
        await this.host.tag(spawned.sessionId, [`employee:${employee.id}`]).catch(() => {})
        this.registerRunLog(spawned.sessionId, employee)
        this.host.changed(namespace, employeeId)
        return { sessionId: spawned.sessionId, outcome: 'created' }
    }

    /**
     * The state package: what a fresh main session is told first. v0 is who I am, where my home is and the last main
     * session's one-line summary; the full package (P2) adds the open issues and the latest run logs.
     */
    async buildStatePackage(namespace: string, employee: StoredEmployee): Promise<string> {
        const lines: string[] = [
            '[HAQI 状态包]',
            `你是数字员工「${employee.name}」（id ${employee.id}）。`,
            `你的员工目录（SOUL.md、AGENTS.md、MEMORY.md、运行日志都在这里）：vault 内的 ${employee.homePath}。`
        ]
        const previousId = employee.mainSessionId ?? this.previousMainSessions.get(employee.id)
        if (previousId) {
            const previous = this.host.session(namespace, previousId)
            if (previous?.summaryText) lines.push(`上一个主会话的摘要：${previous.summaryText}`)
        }
        const open = this.store.employees.issues(namespace, employee.id, 'open')
        if (open.length > 0) {
            lines.push('当前的遗留问题（先检查旧问题有没有解决）：')
            for (const issue of open.slice(0, 10)) {
                lines.push(`- [${dayInZone(issue.firstSeen, employee.timezone)} · ${issue.seenCount} 次] ${issue.text}`)
            }
        }
        const logs = await this.recentRunLogExcerpts(namespace, employee, 2)
        if (logs.length > 0) {
            lines.push('最近的运行日志摘要：')
            lines.push(...logs)
        }
        return lines.join('\n')
    }

    /** The tail of the latest run-log files, best effort: offline or empty folders just mean no excerpt. */
    private async recentRunLogExcerpts(namespace: string, employee: StoredEmployee, count: number): Promise<string[]> {
        if (!this.host.machineOnline(namespace, employee.machineId)) return []
        try {
            const days = (await this.host.fs.list(employee.machineId, { home: employee.homePath, path: 'memory' }))
                .filter((entry) => entry.dir)
                .map((entry) => entry.name)
                .sort()
                .reverse()
                .slice(0, 2)
            const files: Array<{ day: string; name: string }> = []
            for (const day of days) {
                const entries = await this.host.fs.list(employee.machineId, { home: employee.homePath, path: `memory/${day}` })
                for (const entry of entries) if (!entry.dir) files.push({ day, name: entry.name })
            }
            files.sort((a, b) => `${b.day}/${b.name}`.localeCompare(`${a.day}/${a.name}`))
            const excerpts: string[] = []
            for (const file of files.slice(0, count)) {
                const read = await this.host.fs.read(employee.machineId, { home: employee.homePath, path: `memory/${file.day}/${file.name}` })
                if (!read.exists) continue
                const tail = read.content.trim().split('\n').slice(-8).join('\n  ')
                excerpts.push(`- ${file.day}/${file.name}:\n  ${tail}`)
            }
            return excerpts
        } catch {
            return []
        }
    }

    // ─── Run log and issues ──────────────────────────────────────────────────────

    private registerRunLog(sessionId: string, employee: StoredEmployee): void {
        const now = this.now()
        const path = `memory/${dayInZone(now, employee.timezone)}/${timeInZone(now, employee.timezone).replace(':', '')}-${sessionId.slice(0, 8)}.md`
        this.runLogs.set(sessionId, { employeeId: employee.id, path })
    }

    private moveRunLog(fromSessionId: string, toSessionId: string): void {
        const entry = this.runLogs.get(fromSessionId)
        if (!entry) return
        this.runLogs.delete(fromSessionId)
        this.runLogs.set(toSessionId, entry)
    }

    /** The employee a session acts as, from its metadata; sessions without one get an error from the tools. */
    employeeForSession(namespace: string, sessionId: string): StoredEmployee {
        const employeeId = this.host.sessionEmployeeId(namespace, sessionId)
        const employee = employeeId ? this.store.employees.get(employeeId, namespace) : null
        if (!employee) throw new EmployeeError('这个会话不属于任何数字员工', 404)
        return employee
    }

    /**
     * One run-log line; issue_open and issue_close also keep the employee_issues table. The same open problem adds
     * seen_count instead of a second row, so it never alerts twice.
     */
    async log(namespace: string, sessionId: string, kind: EmployeeLogKind, text: string, ref?: string): Promise<{ message: string; issue: StoredEmployeeIssue | null; logged: boolean }> {
        const employee = this.employeeForSession(namespace, sessionId)
        let issue: StoredEmployeeIssue | null = null
        let message = '已写入运行日志。'
        if (kind === 'issue_open') {
            issue = this.store.employees.openIssue(namespace, employee.id, text)
            message = issue.seenCount > 1
                ? `同一个问题第 ${issue.seenCount} 次出现（首次 ${dayInZone(issue.firstSeen, employee.timezone)}），没有重复建条。`
                : '已记为新的遗留问题。'
            this.host.changed(namespace, employee.id)
        } else if (kind === 'issue_close') {
            issue = this.store.employees.closeIssue(namespace, employee.id, text, ref)
            message = issue ? `已关闭遗留问题（出现过 ${issue.seenCount} 次）。` : '没找到对应的 open 问题，只写了日志。'
            if (issue) this.host.changed(namespace, employee.id)
        }
        const logged = await this.appendRunLog(namespace, employee, sessionId, kind, text, ref)
        if (!logged) message += ' 日志文件暂时写不进去（机器离线）。'
        return { message, issue, logged }
    }

    /**
     * A compaction the CLI saw in an employee session. post on the main session bumps the count (past
     * MAX_MAIN_SESSION_COMPACTIONS the next wake starts fresh) and saves the summary into the run log.
     */
    async noteCompaction(namespace: string, sessionId: string, input: { phase: 'pre' | 'post'; trigger: string; summary?: string }): Promise<{ compactions: number }> {
        const employee = this.employeeForSession(namespace, sessionId)
        let compactions = employee.mainSessionCompactions
        if (input.phase === 'post' && employee.mainSessionId === sessionId) {
            compactions += 1
            this.store.employees.update(employee.id, namespace, { mainSessionCompactions: compactions })
            this.host.changed(namespace, employee.id)
        }
        const summary = input.summary?.trim().slice(0, 4000).replace(/\n/g, '\n  ')
        const text = input.phase === 'pre'
            ? `压缩开始（${input.trigger}）`
            : `压缩完成（${input.trigger}）${employee.mainSessionId === sessionId ? `，主会话第 ${compactions} 次` : ''}${summary ? `\n  压缩摘要：\n  ${summary}` : ''}`
        await this.appendRunLog(namespace, employee, sessionId, 'compact', text)
        return { compactions }
    }

    /** A scheduled run spawned under this employee: open its run log with the goal line. */
    async noteRunStart(namespace: string, employeeId: string, sessionId: string, text: string): Promise<void> {
        const employee = this.get(namespace, employeeId)
        this.registerRunLog(sessionId, employee)
        await this.appendRunLog(namespace, employee, sessionId, 'goal', text)
    }

    /**
     * A scheduled run's result. It goes into the run log only — never into the main session — so the main context
     * stays clean; the next wake's state package carries it (design §9.2).
     */
    async noteRunResult(namespace: string, sessionId: string, status: string, summary: string): Promise<boolean> {
        const employee = this.employeeForSession(namespace, sessionId)
        return await this.appendRunLog(namespace, employee, sessionId, 'done', `[${status}] ${summary}`)
    }

    private async appendRunLog(namespace: string, employee: StoredEmployee, sessionId: string, kind: EmployeeLogKind | 'compact', text: string, ref?: string): Promise<boolean> {
        if (!this.host.machineOnline(namespace, employee.machineId)) return false
        let entry = this.runLogs.get(sessionId)
        if (!entry || entry.employeeId !== employee.id) {
            this.registerRunLog(sessionId, employee)
            entry = this.runLogs.get(sessionId)!
        }
        const line = `- ${timeInZone(this.now(), employee.timezone)} ${kind}: ${text}${ref ? `（${ref}）` : ''}\n`
        try {
            const stat = await this.host.fs.stat(employee.machineId, { home: employee.homePath, path: entry.path })
            const content = stat.exists ? line : `# 运行日志 ${dayInZone(this.now(), employee.timezone)} · 会话 ${sessionId.slice(0, 8)}\n\n${line}`
            await this.host.fs.write(employee.machineId, { home: employee.homePath, path: entry.path, content, append: stat.exists })
            return true
        } catch {
            return false
        }
    }

    // ─── MEMORY.md: generate, write back, nightly pass ───────────────────────────

    /**
     * Renders MEMORY.md from the database, writes it to the employee's machine, saves the text as the new diff
     * baseline (employee_memory_views) and appends what changed to CHANGES.md.
     */
    async generateMemoryView(namespace: string, employeeId: string, label: string): Promise<{ content: string; changed: boolean }> {
        const employee = this.get(namespace, employeeId)
        if (!this.host.machineOnline(namespace, employee.machineId)) {
            throw new EmployeeError('员工的默认机器不在线，生成暂停（回线后补跑）', 503)
        }
        const memories = this.store.memories.list(namespace).filter((m) => m.employeeId === employeeId)
        const issues = this.store.employees.issues(namespace, employeeId, 'open')
        const content = renderMemoryView(employee, memories, issues, employee.timezone)
        const previous = this.store.employees.memoryView(employeeId, namespace)
        const written = await this.host.fs.write(employee.machineId, { home: employee.homePath, path: MEMORY_FILE, content })
        this.store.employees.saveMemoryView(namespace, employeeId, content, written.mtimeMs)
        const changed = previous !== null && previous.content !== content
        if (changed && previous) {
            const lines = changedLines(previous.content, content)
            const section = [
                `## ${dayInZone(this.now(), employee.timezone)} ${timeInZone(this.now(), employee.timezone)} ${label}`,
                ...lines.added.map((line) => `- 新增：${line.slice(2)}`),
                ...lines.removed.map((line) => `- 移除：${line.slice(2)}`),
                ''
            ].join('\n')
            await this.host.fs.write(employee.machineId, { home: employee.homePath, path: CHANGES_FILE, content: section, append: true }).catch(() => {})
        }
        this.host.changed(namespace, employeeId)
        return { content, changed }
    }

    /**
     * File → database. Only the employee's own machine is read (the single reader-writer rule); offline means the
     * sync pauses and resumes when the machine is back, it never moves to another machine. The diff baseline is the
     * snapshot from the last generation: a line gone from the file means the user archived it, a line that was never
     * in the snapshot means the user wrote it.
     */
    async syncMemoryFile(namespace: string, employeeId: string): Promise<MemorySyncResult> {
        const employee = this.get(namespace, employeeId)
        if (!this.host.machineOnline(namespace, employee.machineId)) return { state: 'offline' }
        const snapshot = this.store.employees.memoryView(employeeId, namespace)
        if (!snapshot) return { state: 'no-snapshot' }
        const stat = await this.host.fs.stat(employee.machineId, { home: employee.homePath, path: MEMORY_FILE })
        if (!stat.exists) return { state: 'missing' }
        if (stat.mtimeMs <= snapshot.generatedAt) return { state: 'unchanged' }
        const file = await this.host.fs.read(employee.machineId, { home: employee.homePath, path: MEMORY_FILE })
        if (!file.exists || file.content === snapshot.content) {
            this.store.employees.saveMemoryView(namespace, employeeId, snapshot.content, stat.mtimeMs)
            return { state: 'unchanged' }
        }

        const diff = diffMemoryView(snapshot.content, file.content)
        let updated = 0
        let archived = 0
        let added = 0
        let closedIssues = 0
        for (const change of diff.updated) {
            const memory = this.store.memories.get(change.id, namespace)
            if (!memory || memory.employeeId !== employeeId) continue
            // The user's version wins; user_edit keeps it active under the memory rules.
            this.store.memories.update(change.id, namespace, { text: change.text, pinned: change.pinned, bumpVersion: true })
            this.store.memories.addEvent({
                namespace, memoryId: change.id, action: 'updated', text: change.text, reason: '在 MEMORY.md 里改的',
                source: 'user_edit', sourceLabel: '你（MEMORY.md）', sourceRef: null, hash: null, sessionId: null,
                jev: null, costUsd: 0, latencyMs: 0
            })
            updated += 1
        }
        for (const id of diff.removedMemoryIds) {
            const memory = this.store.memories.get(id, namespace)
            if (!memory || memory.employeeId !== employeeId || memory.status === 'archived') continue
            this.store.memories.update(id, namespace, { status: 'archived', reason: '在 MEMORY.md 里删掉了这行' })
            this.store.memories.addEvent({
                namespace, memoryId: id, action: 'archived', text: memory.text, reason: '在 MEMORY.md 里删掉了这行',
                source: 'user_edit', sourceLabel: '你（MEMORY.md）', sourceRef: null, hash: null, sessionId: null,
                jev: null, costUsd: 0, latencyMs: 0
            })
            archived += 1
        }
        for (const line of diff.added) {
            if (line.section === 'issues') {
                this.store.employees.openIssue(namespace, employeeId, line.body)
                continue
            }
            // A hand-written line is the user's word: it lands active and pinned, so housekeeping leaves it alone.
            this.store.memories.insert({
                namespace, text: line.body, level: line.section, scope: '', status: 'active', reason: '你写在 MEMORY.md 里',
                source: 'user_edit', sourceLabel: '你（MEMORY.md）', sessionId: null, said: true, support: 1,
                jev: null, overridden: null, replaces: null, employeeId, pinned: true
            })
            added += 1
        }
        for (const id of diff.removedIssueIds) {
            const issue = this.store.employees.issue(id, namespace)
            if (!issue || issue.employeeId !== employeeId || issue.status === 'closed') continue
            this.store.employees.closeIssue(namespace, employeeId, issue.text, '在 MEMORY.md 里删掉了这行')
            closedIssues += 1
        }
        this.store.employees.saveMemoryView(namespace, employeeId, file.content, stat.mtimeMs)
        this.host.changed(namespace, employeeId)
        return { state: 'synced', updated, archived, added, closedIssues }
    }

    /**
     * The nightly pass for one employee: read the user's edits back, run the memory housekeeping, write MEMORY.md
     * and CHANGES.md again. Runs on the employee's machine only; offline pauses it until the machine returns.
     */
    async consolidate(namespace: string, employeeId: string): Promise<{ sync: MemorySyncResult; changed: boolean }> {
        const employee = this.get(namespace, employeeId)
        if (!this.host.machineOnline(namespace, employee.machineId)) {
            throw new EmployeeError('员工的默认机器不在线，整理暂停（回线后补跑）', 503)
        }
        const sync = await this.syncMemoryFile(namespace, employeeId)
        await this.host.maintain(namespace)
        const generated = await this.generateMemoryView(namespace, employeeId, '每晚整理')
        return { sync, changed: generated.changed }
    }

    // ─── Background sweep ────────────────────────────────────────────────────────

    /** One pass over every employee: write-back, the nightly window, overdue issues. Called every EMPLOYEE_SWEEP_INTERVAL_MS. */
    async sweep(): Promise<void> {
        if (this.sweeping) return
        this.sweeping = true
        try {
            for (const employee of this.store.employees.listAll()) {
                if (employee.status === 'retired') continue
                await this.syncMemoryFile(employee.namespace, employee.id).catch(() => {})
                await this.nightlyIfDue(employee).catch(() => {})
                await this.dailyResetIfDue(employee).catch(() => {})
            }
            await this.escalateOverdueIssues().catch(() => {})
        } finally {
            this.sweeping = false
        }
    }

    /** Once a day, in the hour before the employee's daily reset; an offline machine just leaves it due (补跑). */
    private async nightlyIfDue(employee: StoredEmployee): Promise<void> {
        const now = this.now()
        const today = dayInZone(now, employee.timezone)
        if (this.nightlyDone.get(employee.id) === today) return
        const windowStart = (employee.dailyResetHour + 23) % 24
        if (hourInZone(now, employee.timezone) < windowStart) return
        if (!this.host.machineOnline(employee.namespace, employee.machineId)) return
        await this.consolidate(employee.namespace, employee.id)
        this.nightlyDone.set(employee.id, today)
    }

    /**
     * At the employee's daily reset hour, an idle main session is archived and forgotten (its compaction count
     * with it), so the next wake starts a fresh session with the state package (§8.4). A busy session gets another
     * chance on the next sweep inside the hour.
     */
    private async dailyResetIfDue(employee: StoredEmployee): Promise<void> {
        if (!employee.mainSessionId) return
        const now = this.now()
        const today = dayInZone(now, employee.timezone)
        if (this.dailyResetDone.get(employee.id) === today) return
        if (hourInZone(now, employee.timezone) !== employee.dailyResetHour) return
        const state = this.host.session(employee.namespace, employee.mainSessionId)
        if (state?.active && state.busy) return
        this.dailyResetDone.set(employee.id, today)
        this.previousMainSessions.set(employee.id, employee.mainSessionId)
        if (state?.active) await this.host.archive(employee.mainSessionId).catch(() => {})
        this.store.employees.update(employee.id, employee.namespace, { mainSessionId: null, mainSessionCompactions: 0 })
        this.host.changed(employee.namespace, employee.id)
    }

    private async escalateOverdueIssues(): Promise<void> {
        const byNamespace = new Map<string, StoredEmployee[]>()
        for (const employee of this.store.employees.listAll()) {
            byNamespace.set(employee.namespace, [...(byNamespace.get(employee.namespace) ?? []), employee])
        }
        for (const [namespace, employees] of byNamespace) {
            const names = new Map(employees.map((employee) => [employee.id, employee.name]))
            for (const issue of this.store.employees.overdueIssues(namespace, ISSUE_ESCALATE_AFTER_MS, ISSUE_REMIND_EVERY_MS, this.now())) {
                const name = names.get(issue.employeeId)
                if (!name) continue
                this.store.employees.markIssueEscalated(issue.id, namespace, this.now())
                const days = Math.floor((this.now() - issue.firstSeen) / (24 * 60 * 60 * 1000))
                await this.host.alert(namespace, {
                    title: `员工 ${name} 的遗留问题 ${days} 天没解决`,
                    body: issue.text,
                    url: `/employees/${issue.employeeId}`
                }).catch(() => {})
            }
        }
    }
}

function sanitizePathSegment(name: string): string {
    return name.trim().replace(/[/\\:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 60)
}
