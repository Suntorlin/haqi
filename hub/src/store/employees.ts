import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredEmployee, StoredEmployeeIssue, StoredEmployeeMemoryView, StoredEmployeeReview } from './types'

/**
 * Digital employees, their open loose ends (issues live apart from memories: an issue opens, repeats and closes,
 * a memory dedupes, promotes and retires), and the MEMORY.md snapshot that file edits are diffed against.
 */
export const EMPLOYEE_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS employees (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        emoji TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        home_path TEXT NOT NULL,
        machine_id TEXT NOT NULL,
        directory TEXT NOT NULL,
        agent TEXT NOT NULL,
        model TEXT,
        permission_mode TEXT,
        account_group TEXT,
        timezone TEXT NOT NULL,
        main_session_id TEXT,
        main_session_started_at INTEGER,
        main_session_compactions INTEGER NOT NULL DEFAULT 0,
        daily_reset_hour INTEGER NOT NULL DEFAULT 4,
        compact_threshold REAL NOT NULL DEFAULT 0.75,
        webhook_slug TEXT UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_employees_namespace ON employees(namespace, status);

    CREATE TABLE IF NOT EXISTS employee_issues (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        employee_id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        first_seen INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        seen_count INTEGER NOT NULL DEFAULT 1,
        escalated_at INTEGER,
        closed_at INTEGER,
        close_note TEXT,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_employee_issues_open
        ON employee_issues(employee_id, status, last_seen);

    CREATE TABLE IF NOT EXISTS employee_memory_views (
        employee_id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        content TEXT NOT NULL,
        generated_at INTEGER NOT NULL,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS employee_reviews (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        employee_id TEXT NOT NULL,
        period_start INTEGER NOT NULL,
        period_end INTEGER NOT NULL,
        report_path TEXT,
        metrics TEXT NOT NULL,
        score INTEGER,
        comment TEXT,
        lesson TEXT,
        skill_path TEXT,
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER,
        FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_reviews_period
        ON employee_reviews(employee_id, period_start);
`

type DbEmployeeRow = {
    id: string
    namespace: string
    name: string
    emoji: string | null
    status: string
    home_path: string
    machine_id: string
    directory: string
    agent: string
    model: string | null
    permission_mode: string | null
    account_group: string | null
    timezone: string
    main_session_id: string | null
    main_session_started_at: number | null
    main_session_compactions: number
    daily_reset_hour: number
    compact_threshold: number
    webhook_slug: string | null
    created_at: number
    updated_at: number
}

type DbIssueRow = {
    id: string
    namespace: string
    employee_id: string
    text: string
    status: string
    first_seen: number
    last_seen: number
    seen_count: number
    escalated_at: number | null
    closed_at: number | null
    close_note: string | null
}

function toStoredEmployee(row: DbEmployeeRow): StoredEmployee {
    return {
        id: row.id,
        namespace: row.namespace,
        name: row.name,
        emoji: row.emoji,
        status: row.status as StoredEmployee['status'],
        homePath: row.home_path,
        machineId: row.machine_id,
        directory: row.directory,
        agent: row.agent,
        model: row.model,
        permissionMode: row.permission_mode,
        accountGroup: row.account_group,
        timezone: row.timezone,
        mainSessionId: row.main_session_id,
        mainSessionStartedAt: row.main_session_started_at,
        mainSessionCompactions: row.main_session_compactions,
        dailyResetHour: row.daily_reset_hour,
        compactThreshold: row.compact_threshold,
        webhookSlug: row.webhook_slug,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

function toStoredIssue(row: DbIssueRow): StoredEmployeeIssue {
    return {
        id: row.id,
        namespace: row.namespace,
        employeeId: row.employee_id,
        text: row.text,
        status: row.status as StoredEmployeeIssue['status'],
        firstSeen: row.first_seen,
        lastSeen: row.last_seen,
        seenCount: row.seen_count,
        escalatedAt: row.escalated_at,
        closedAt: row.closed_at,
        closeNote: row.close_note
    }
}

export type NewEmployee = Omit<StoredEmployee, 'id' | 'mainSessionId' | 'mainSessionStartedAt' | 'mainSessionCompactions' | 'createdAt' | 'updatedAt'> & { id?: string }

export function insertEmployee(db: Database, input: NewEmployee): StoredEmployee {
    const now = Date.now()
    const id = input.id ?? randomUUID()
    db.prepare(`
        INSERT INTO employees (id, namespace, name, emoji, status, home_path, machine_id, directory, agent, model,
            permission_mode, account_group, timezone, daily_reset_hour, compact_threshold, webhook_slug, created_at, updated_at)
        VALUES (@id, @namespace, @name, @emoji, @status, @home_path, @machine_id, @directory, @agent, @model,
            @permission_mode, @account_group, @timezone, @daily_reset_hour, @compact_threshold, @webhook_slug, @now, @now)
    `).run({
        id,
        namespace: input.namespace,
        name: input.name,
        emoji: input.emoji,
        status: input.status,
        home_path: input.homePath,
        machine_id: input.machineId,
        directory: input.directory,
        agent: input.agent,
        model: input.model,
        permission_mode: input.permissionMode,
        account_group: input.accountGroup,
        timezone: input.timezone,
        daily_reset_hour: input.dailyResetHour,
        compact_threshold: input.compactThreshold,
        webhook_slug: input.webhookSlug,
        now
    })
    const stored = getEmployee(db, id, input.namespace)
    if (!stored) throw new Error('Failed to insert employee')
    return stored
}

export function getEmployee(db: Database, id: string, namespace: string): StoredEmployee | null {
    const row = db.prepare('SELECT * FROM employees WHERE id = ? AND namespace = ?').get(id, namespace) as DbEmployeeRow | null
    return row ? toStoredEmployee(row) : null
}

/** The employee behind an inbound webhook token; the slug is the secret, so it looks across namespaces. */
export function getEmployeeBySlug(db: Database, slug: string): StoredEmployee | null {
    const row = db.prepare('SELECT * FROM employees WHERE webhook_slug = ? LIMIT 1').get(slug) as DbEmployeeRow | null
    return row ? toStoredEmployee(row) : null
}

export function getEmployeeByName(db: Database, name: string, namespace: string): StoredEmployee | null {
    const row = db.prepare('SELECT * FROM employees WHERE namespace = ? AND lower(name) = lower(?) LIMIT 1').get(namespace, name) as DbEmployeeRow | null
    return row ? toStoredEmployee(row) : null
}

export function listEmployees(db: Database, namespace: string): StoredEmployee[] {
    const rows = db.prepare('SELECT * FROM employees WHERE namespace = ? ORDER BY created_at').all(namespace) as DbEmployeeRow[]
    return rows.map(toStoredEmployee)
}

/** Every employee in every namespace, for the background sweeps. */
export function listAllEmployees(db: Database): StoredEmployee[] {
    const rows = db.prepare('SELECT * FROM employees ORDER BY created_at').all() as DbEmployeeRow[]
    return rows.map(toStoredEmployee)
}

export type EmployeeDbPatch = Partial<Omit<StoredEmployee, 'id' | 'namespace' | 'createdAt' | 'updatedAt'>>

const EMPLOYEE_PATCH_COLUMNS: Record<string, string> = {
    name: 'name',
    emoji: 'emoji',
    status: 'status',
    homePath: 'home_path',
    machineId: 'machine_id',
    directory: 'directory',
    agent: 'agent',
    model: 'model',
    permissionMode: 'permission_mode',
    accountGroup: 'account_group',
    timezone: 'timezone',
    mainSessionId: 'main_session_id',
    mainSessionStartedAt: 'main_session_started_at',
    mainSessionCompactions: 'main_session_compactions',
    dailyResetHour: 'daily_reset_hour',
    compactThreshold: 'compact_threshold',
    webhookSlug: 'webhook_slug'
}

export function updateEmployee(db: Database, id: string, namespace: string, patch: EmployeeDbPatch): StoredEmployee | null {
    const sets: string[] = []
    const params: Record<string, unknown> = { id, namespace, now: Date.now() }
    for (const [key, column] of Object.entries(EMPLOYEE_PATCH_COLUMNS)) {
        if (!(key in patch)) continue
        sets.push(`${column} = @${column}`)
        params[column] = (patch as Record<string, unknown>)[key]
    }
    if (sets.length === 0) return getEmployee(db, id, namespace)
    db.prepare(`UPDATE employees SET ${sets.join(', ')}, updated_at = @now WHERE id = @id AND namespace = @namespace`).run(params as never)
    return getEmployee(db, id, namespace)
}

export function deleteEmployee(db: Database, id: string, namespace: string): boolean {
    return db.prepare('DELETE FROM employees WHERE id = ? AND namespace = ?').run(id, namespace).changes > 0
}

/** Lowercased, NFKC, no whitespace and no punctuation: the matching key behind the issue dedupe. */
function issueKey(text: string): string {
    return text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
}

/** Character-bigram Dice coefficient of the issue keys: 1 is identical, 0 shares nothing. */
function issueSimilarity(a: string, b: string): number {
    if (a === b) return 1
    if (a.length < 2 || b.length < 2) return 0
    const bigrams = (s: string) => {
        const grams = new Map<string, number>()
        for (let i = 0; i < s.length - 1; i += 1) {
            const gram = s.slice(i, i + 2)
            grams.set(gram, (grams.get(gram) ?? 0) + 1)
        }
        return grams
    }
    const aGrams = bigrams(a)
    const bGrams = bigrams(b)
    let shared = 0
    for (const [gram, count] of aGrams) shared += Math.min(count, bGrams.get(gram) ?? 0)
    return (2 * shared) / (a.length - 1 + b.length - 1)
}

/** Reworded repeats still dedupe when the keys nearly coincide; distinct problems stay below this. */
const ISSUE_DEDUPE_SIMILARITY = 0.75

/** The digit runs, in order: two issues telling different numbers (a date, a count) are different problems. */
function issueDigits(key: string): string {
    return (key.match(/\d+/gu) ?? []).join(',')
}

/** The open issue the text means: the same key first, then — numbers matching — a near-identical key. */
function findOpenIssue(db: Database, namespace: string, employeeId: string, text: string): DbIssueRow | null {
    const key = issueKey(text)
    const open = db.prepare(
        "SELECT * FROM employee_issues WHERE namespace = ? AND employee_id = ? AND status = 'open' ORDER BY last_seen DESC"
    ).all(namespace, employeeId) as DbIssueRow[]
    const exact = open.find((row) => issueKey(row.text) === key)
    if (exact) return exact
    return open.find((row) => {
        const rowKey = issueKey(row.text)
        return issueDigits(rowKey) === issueDigits(key) && issueSimilarity(rowKey, key) >= ISSUE_DEDUPE_SIMILARITY
    }) ?? null
}

/**
 * Opens an issue, or bumps the existing open row that means the same problem: lastSeen moves, seenCount grows,
 * no second row and no second alert. Matching is normalized (case, spacing, punctuation) plus a bigram
 * similarity, so a slightly reworded repeat still lands on the same row.
 */
export function openEmployeeIssue(db: Database, namespace: string, employeeId: string, text: string): StoredEmployeeIssue {
    const normalized = text.trim()
    const existing = findOpenIssue(db, namespace, employeeId, normalized)
    const now = Date.now()
    if (existing) {
        db.prepare('UPDATE employee_issues SET last_seen = ?, seen_count = seen_count + 1 WHERE id = ?').run(now, existing.id)
        return toStoredIssue({ ...existing, last_seen: now, seen_count: existing.seen_count + 1 })
    }
    const id = randomUUID()
    db.prepare(`
        INSERT INTO employee_issues (id, namespace, employee_id, text, status, first_seen, last_seen, seen_count)
        VALUES (?, ?, ?, ?, 'open', ?, ?, 1)
    `).run(id, namespace, employeeId, normalized, now, now)
    const row = db.prepare('SELECT * FROM employee_issues WHERE id = ?').get(id) as DbIssueRow
    return toStoredIssue(row)
}

/** Closes the open issue whose text matches (normalized/similar first, then substring); null when nothing matches. */
export function closeEmployeeIssue(db: Database, namespace: string, employeeId: string, text: string, note?: string): StoredEmployeeIssue | null {
    const normalized = text.trim()
    let row = findOpenIssue(db, namespace, employeeId, normalized)
    if (!row) {
        row = db.prepare(
            "SELECT * FROM employee_issues WHERE namespace = ? AND employee_id = ? AND status = 'open' AND instr(text, ?) > 0 ORDER BY last_seen DESC LIMIT 1"
        ).get(namespace, employeeId, normalized) as DbIssueRow | null
    }
    if (!row) return null
    const now = Date.now()
    db.prepare("UPDATE employee_issues SET status = 'closed', closed_at = ?, close_note = ? WHERE id = ?").run(now, note ?? null, row.id)
    return toStoredIssue({ ...row, status: 'closed', closed_at: now, close_note: note ?? null })
}

export function getEmployeeIssue(db: Database, id: string, namespace: string): StoredEmployeeIssue | null {
    const row = db.prepare('SELECT * FROM employee_issues WHERE id = ? AND namespace = ?').get(id, namespace) as DbIssueRow | null
    return row ? toStoredIssue(row) : null
}

export function listEmployeeIssues(db: Database, namespace: string, employeeId: string, status?: 'open' | 'closed'): StoredEmployeeIssue[] {
    const rows = status
        ? db.prepare('SELECT * FROM employee_issues WHERE namespace = ? AND employee_id = ? AND status = ? ORDER BY last_seen DESC').all(namespace, employeeId, status) as DbIssueRow[]
        : db.prepare('SELECT * FROM employee_issues WHERE namespace = ? AND employee_id = ? ORDER BY last_seen DESC').all(namespace, employeeId) as DbIssueRow[]
    return rows.map(toStoredIssue)
}

/** Open issues older than `olderThanMs` whose last reminder is absent or older than `remindEveryMs`. */
export function listOverdueEmployeeIssues(db: Database, namespace: string, olderThanMs: number, remindEveryMs: number, now = Date.now()): StoredEmployeeIssue[] {
    const rows = db.prepare(`
        SELECT * FROM employee_issues
        WHERE namespace = ? AND status = 'open' AND first_seen <= ?
          AND (escalated_at IS NULL OR escalated_at <= ?)
        ORDER BY first_seen
    `).all(namespace, now - olderThanMs, now - remindEveryMs) as DbIssueRow[]
    return rows.map(toStoredIssue)
}

export function markEmployeeIssueEscalated(db: Database, id: string, namespace: string, now = Date.now()): void {
    db.prepare('UPDATE employee_issues SET escalated_at = ? WHERE id = ? AND namespace = ?').run(now, id, namespace)
}

// ─── Weekly reviews ──────────────────────────────────────────────────────────────

type DbReviewRow = {
    id: string
    namespace: string
    employee_id: string
    period_start: number
    period_end: number
    report_path: string | null
    metrics: string
    score: number | null
    comment: string | null
    lesson: string | null
    skill_path: string | null
    created_at: number
    reviewed_at: number | null
}

function toStoredReview(row: DbReviewRow): StoredEmployeeReview {
    return {
        id: row.id,
        namespace: row.namespace,
        employeeId: row.employee_id,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        reportPath: row.report_path,
        metrics: row.metrics,
        score: row.score,
        comment: row.comment,
        lesson: row.lesson,
        skillPath: row.skill_path,
        createdAt: row.created_at,
        reviewedAt: row.reviewed_at
    }
}

export function insertEmployeeReview(db: Database, input: { namespace: string; employeeId: string; periodStart: number; periodEnd: number; reportPath: string | null; metrics: string }): StoredEmployeeReview {
    const id = randomUUID().slice(0, 8)
    db.prepare(`
        INSERT INTO employee_reviews (id, namespace, employee_id, period_start, period_end, report_path, metrics, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, input.namespace, input.employeeId, input.periodStart, input.periodEnd, input.reportPath, input.metrics, Date.now())
    return getEmployeeReview(db, id, input.namespace)!
}

export function getEmployeeReview(db: Database, id: string, namespace: string): StoredEmployeeReview | null {
    const row = db.prepare('SELECT * FROM employee_reviews WHERE id = ? AND namespace = ?').get(id, namespace) as DbReviewRow | null
    return row ? toStoredReview(row) : null
}

export function getEmployeeReviewForPeriod(db: Database, namespace: string, employeeId: string, periodStart: number): StoredEmployeeReview | null {
    const row = db.prepare('SELECT * FROM employee_reviews WHERE namespace = ? AND employee_id = ? AND period_start = ?')
        .get(namespace, employeeId, periodStart) as DbReviewRow | null
    return row ? toStoredReview(row) : null
}

export function listEmployeeReviews(db: Database, namespace: string, employeeId: string, limit = 20): StoredEmployeeReview[] {
    const rows = db.prepare('SELECT * FROM employee_reviews WHERE namespace = ? AND employee_id = ? ORDER BY period_start DESC LIMIT ?')
        .all(namespace, employeeId, limit) as DbReviewRow[]
    return rows.map(toStoredReview)
}

/** The user's verdict on one week; the lesson and the skill path are written by the service, not the user. */
export function scoreEmployeeReview(db: Database, id: string, namespace: string, input: { score: number; comment: string | null; lesson: string | null; skillPath: string | null }): StoredEmployeeReview | null {
    db.prepare('UPDATE employee_reviews SET score = ?, comment = ?, lesson = ?, skill_path = ?, reviewed_at = ? WHERE id = ? AND namespace = ?')
        .run(input.score, input.comment, input.lesson, input.skillPath, Date.now(), id, namespace)
    return getEmployeeReview(db, id, namespace)
}

/** The low-score lessons a fresh main session must hear again, newest first. */
export function listEmployeeLessons(db: Database, namespace: string, employeeId: string, limit = 3): StoredEmployeeReview[] {
    const rows = db.prepare(`
        SELECT * FROM employee_reviews
        WHERE namespace = ? AND employee_id = ? AND score IS NOT NULL AND score <= 2 AND lesson IS NOT NULL
        ORDER BY reviewed_at DESC LIMIT ?
    `).all(namespace, employeeId, limit) as DbReviewRow[]
    return rows.map(toStoredReview)
}

export function getEmployeeMemoryView(db: Database, employeeId: string, namespace: string): StoredEmployeeMemoryView | null {
    const row = db.prepare('SELECT * FROM employee_memory_views WHERE employee_id = ? AND namespace = ?').get(employeeId, namespace) as
        | { employee_id: string; namespace: string; content: string; generated_at: number }
        | null
    if (!row) return null
    return { employeeId: row.employee_id, namespace: row.namespace, content: row.content, generatedAt: row.generated_at }
}

export function saveEmployeeMemoryView(db: Database, namespace: string, employeeId: string, content: string, now = Date.now()): void {
    db.prepare(`
        INSERT INTO employee_memory_views (employee_id, namespace, content, generated_at)
        VALUES (@employee_id, @namespace, @content, @now)
        ON CONFLICT(employee_id) DO UPDATE SET content = @content, generated_at = @now, namespace = @namespace
    `).run({ employee_id: employeeId, namespace, content, now })
}
