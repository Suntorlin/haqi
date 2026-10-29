import { randomUUID } from 'node:crypto'

import type { Store } from '../../store'
import type { TaskFieldsPatch } from '../../store/groups'
import type { StoredGroup, StoredTaskEvent, StoredTaskStatus } from '../../store/types'
import { TASK_EVENT, type TaskEventType } from './events'
import { assertMove } from './stateMachine'

/** 12 lowercase characters, the same as the session tasks that were merged in. */
export function newTaskId(): string {
    return randomUUID().replace(/-/g, '').slice(0, 12)
}

/**
 * The task kernel: a task's row, its state machine and its event log. It knows nothing about sessions, memory or
 * models; the plugins and the task service bring those.
 */
export class TaskKernel {
    constructor(
        private readonly store: Store,
        /** Called after any change, so the web can refetch the task. */
        private readonly changed: (namespace: string, taskId: string) => void
    ) {}

    create(namespace: string, input: { name: string; tag: string; repoPath: string | null; machineId: string | null; employeeId?: string | null; members?: string[] }): StoredGroup {
        const task = this.store.groups.createGroup({
            namespace,
            name: input.name,
            task: { id: newTaskId(), tag: input.tag, status: 'guiding', repoPath: input.repoPath, machineId: input.machineId, employeeId: input.employeeId ?? null },
            members: (input.members ?? []).map((sessionId) => ({ memberType: 'session' as const, sessionId }))
        })
        this.changed(namespace, task.id)
        return task
    }

    get(namespace: string, taskId: string): StoredGroup | null {
        const group = this.store.groups.getGroupByNamespace(taskId, namespace)
        return group?.kind === 'task' ? group : null
    }

    list(namespace: string, tag?: string): StoredGroup[] {
        const tasks = this.store.groups.getGroupsByNamespace(namespace, 'task')
        return tag ? tasks.filter((task) => task.tag === tag) : tasks
    }

    /** Changes fields other than the status. */
    update(namespace: string, taskId: string, patch: Omit<TaskFieldsPatch, 'status'>): StoredGroup {
        const task = this.store.groups.updateTaskFields({ groupId: taskId, namespace, patch })
        if (!task) throw new Error('Task not found')
        this.changed(namespace, taskId)
        return task
    }

    /** Moves the task along its state machine; an illegal move throws TaskTransitionError. */
    move(namespace: string, taskId: string, to: StoredTaskStatus, patch: Omit<TaskFieldsPatch, 'status'> = {}): StoredGroup {
        const current = this.get(namespace, taskId)
        if (!current) throw new Error('Task not found')
        const from = current.status ?? 'active'
        assertMove(from, to)
        const task = this.store.groups.updateTaskFields({ groupId: taskId, namespace, patch: { ...patch, status: to } })!
        if (from !== to) this.store.taskEvents.add({ namespace, groupId: taskId, type: TASK_EVENT.statusChanged, payload: { from, to } })
        this.changed(namespace, taskId)
        return task
    }

    delete(namespace: string, taskId: string): boolean {
        if (!this.get(namespace, taskId)) return false
        this.store.taskEvents.deleteForGroup(namespace, taskId)
        const deleted = this.store.groups.deleteGroup({ groupId: taskId, namespace })
        this.changed(namespace, taskId)
        return deleted
    }

    /** Tells the pages a task changed without writing anything, e.g. after the observer's look. */
    touch(namespace: string, taskId: string): void {
        this.changed(namespace, taskId)
    }

    log(namespace: string, taskId: string, type: TaskEventType, payload?: unknown): StoredTaskEvent {
        const event = this.store.taskEvents.add({ namespace, groupId: taskId, type, payload })
        this.changed(namespace, taskId)
        return event
    }

    events(namespace: string, taskId: string): StoredTaskEvent[] {
        return this.store.taskEvents.list(namespace, taskId)
    }

    latest(namespace: string, taskId: string, type: TaskEventType): StoredTaskEvent | null {
        return this.store.taskEvents.latest(namespace, taskId, type)
    }

    count(namespace: string, taskId: string, type: TaskEventType): number {
        return this.store.taskEvents.count(namespace, taskId, type)
    }
}
