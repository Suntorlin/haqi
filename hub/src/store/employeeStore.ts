import type { Database } from 'bun:sqlite'

import {
    closeEmployeeIssue,
    deleteEmployee,
    getEmployee,
    getEmployeeByName,
    getEmployeeIssue,
    getEmployeeMemoryView,
    insertEmployee,
    listAllEmployees,
    listEmployeeIssues,
    listEmployees,
    listOverdueEmployeeIssues,
    markEmployeeIssueEscalated,
    openEmployeeIssue,
    saveEmployeeMemoryView,
    updateEmployee,
    type EmployeeDbPatch,
    type NewEmployee
} from './employees'
import type { StoredEmployee, StoredEmployeeIssue, StoredEmployeeMemoryView } from './types'

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
}
