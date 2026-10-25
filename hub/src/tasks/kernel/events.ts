import { RUN_EVENT } from './run'

/** The task event types. A task's state is its row plus this log; the newest draft is the last draft_submitted. */
export const TASK_EVENT = {
    guideStarted: 'guide_started',
    plannerStarted: 'planner_started',
    guideFailed: 'guide_failed',
    /** The machines and repository paths the planner was shown; its draft picks one of them. */
    machinesOffered: 'machines_offered',
    draftSubmitted: 'draft_submitted',
    draftReviseRequested: 'draft_revise_requested',
    draftConfirmed: 'draft_confirmed',
    statusChanged: 'status_changed',
    memberAdded: 'member_added',
    memberRemoved: 'member_removed',
    /** The task's default session settings (model, thinking, permission), picked in the new-task box. */
    sessionSettings: 'session_settings'
} as const

export type TaskEventType = typeof TASK_EVENT[keyof typeof TASK_EVENT] | typeof RUN_EVENT[keyof typeof RUN_EVENT]
