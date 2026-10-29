import type { Database } from 'bun:sqlite'

import {
    closeEmployeeIssue,
    deleteEmployee,
    getEmployee,
    getEmployeeByName,
    getEmployeeBySlug,
    getEmployeeIssue,
    getEmployeeMemoryView,
    getEmployeeReview,
    getEmployeeReviewForPeriod,
    insertEmployee,
    insertEmployeeReview,
    listAllEmployees,
    listEmployeeIssues,
    listEmployeeLessons,
    listEmployeeReviews,
    listEmployees,
    listOverdueEmployeeIssues,
    markEmployeeIssueEscalated,
    openEmployeeIssue,
    saveEmployeeMemoryView,
    scoreEmployeeReview,
    updateEmployee,
    type EmployeeDbPatch,
    type NewEmployee
} from './employees'
import type { StoredEmployee, StoredEmployeeIssue, StoredEmployeeMemoryView, StoredEmployeeReview } from './types'

export class EmployeeStore {
    constructor(private readonly db: Database) {}

    insert(input: NewEmployee): StoredEmployee { return insertEmployee(this.db, input) }
    get(id: string, namespace: string): StoredEmployee | null { return getEmployee(this.db, id, namespace) }
    getByName(name: string, namespace: string): StoredEmployee | null { return getEmployeeByName(this.db, name, namespace) }
    list(namespace: string): StoredEmployee[] { return listEmployees(this.db, namespace) }
    listAll(): StoredEmployee[] { return listAllEmployees(this.db) }
    update(id: string, namespace: string, patch: EmployeeDbPatch): StoredEmployee | null { return updateEmployee(this.db, id, namespace, patch) }
    delete(id: string, namespace: string): boolean { return deleteEmployee(this.db, id, namespace) }
    openIssue(namespace: string, employeeId: string, text: string): StoredEmployeeIssue { return openEmployeeIssue(this.db, namespace, employeeId, text) }
    closeIssue(namespace: string, employeeId: string, text: string, note?: string): StoredEmployeeIssue | null { return closeEmployeeIssue(this.db, namespace, employeeId, text, note) }
    issue(id: string, namespace: string): StoredEmployeeIssue | null { return getEmployeeIssue(this.db, id, namespace) }
    issues(namespace: string, employeeId: string, status?: 'open' | 'closed'): StoredEmployeeIssue[] { return listEmployeeIssues(this.db, namespace, employeeId, status) }
    overdueIssues(namespace: string, olderThanMs: number, remindEveryMs: number, now?: number): StoredEmployeeIssue[] { return listOverdueEmployeeIssues(this.db, namespace, olderThanMs, remindEveryMs, now) }
    markIssueEscalated(id: string, namespace: string, now?: number): void { markEmployeeIssueEscalated(this.db, id, namespace, now) }
    memoryView(employeeId: string, namespace: string): StoredEmployeeMemoryView | null { return getEmployeeMemoryView(this.db, employeeId, namespace) }
    saveMemoryView(namespace: string, employeeId: string, content: string, now?: number): void { saveEmployeeMemoryView(this.db, namespace, employeeId, content, now) }
    getBySlug(slug: string): StoredEmployee | null { return getEmployeeBySlug(this.db, slug) }
    insertReview(input: { namespace: string; employeeId: string; periodStart: number; periodEnd: number; reportPath: string | null; metrics: string }): StoredEmployeeReview { return insertEmployeeReview(this.db, input) }
    review(id: string, namespace: string): StoredEmployeeReview | null { return getEmployeeReview(this.db, id, namespace) }
    reviewForPeriod(namespace: string, employeeId: string, periodStart: number): StoredEmployeeReview | null { return getEmployeeReviewForPeriod(this.db, namespace, employeeId, periodStart) }
    reviews(namespace: string, employeeId: string, limit?: number): StoredEmployeeReview[] { return listEmployeeReviews(this.db, namespace, employeeId, limit) }
    scoreReview(id: string, namespace: string, input: { score: number; comment: string | null; lesson: string | null; skillPath: string | null }): StoredEmployeeReview | null { return scoreEmployeeReview(this.db, id, namespace, input) }
    lessons(namespace: string, employeeId: string, limit?: number): StoredEmployeeReview[] { return listEmployeeLessons(this.db, namespace, employeeId, limit) }
}
