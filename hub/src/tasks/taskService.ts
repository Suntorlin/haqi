import type { TaskDraft, TaskGuideState, TaskLoad, TaskRun, TaskView } from '@hapi/protocol/types'

import { projectNameFor } from '../memory/harvest'
import type { MemoryService } from '../memory/service'
import { realUserText } from '../memory/userMessage'
import type { Store } from '../store'
import type { StoredAcceptanceCriterion, StoredGroup, StoredTaskEvent, StoredTaskStatus } from '../store/types'
import { confirmInputSchema, draftInputSchema, toTaskDraft, type ConfirmInput } from './kernel/draft'
import { TASK_EVENT } from './kernel/events'
import { TaskKernel } from './kernel/kernel'
import { readRun } from './kernel/run'
import { TaskError } from './errors'
import { RunService, type RunHost } from './runService'
import { buildContextPack, type ContextSources } from './plugins/context/contextPack'
import { Planner, type PlannerHost } from './plugins/planner/planner'

export type TaskSession = {
    id: string
    active: boolean
    machineId: string | null
    path: string | null
    name: string | null
    tags: string[]
    updatedAt: number
}

export type TaskServiceHost = {
    planner: PlannerHost
    session: (namespace: string, sessionId: string) => TaskSession | null
    sessions: (namespace: string) => TaskSession[]
    machineOnline: (namespace: string, machineId: string) => boolean
    /** Called after a task changed. */
    changed: (namespace: string, taskId: string) => void
    /** Posts a system line to the task group's timeline, where the user follows the guide step. */
    timeline?: (namespace: string, taskId: string, text: string, extra?: { report?: { markdown: string } }) => void
    /** Stops a session that is no longer needed (the planner after the guide step). Its history stays. */
    stopSession?: (namespace: string, sessionId: string) => Promise<void>
    /** How often the user stepped in, per task; null until messages are classified. */
    load?: (namespace: string, sessionIds: string[], since: number) => TaskLoad | null
    /** What the run after the guide step needs (spawning executors, push, reports); tests may leave it out. */
    run?: Omit<RunHost, 'load' | 'timeline' | 'stopSession' | 'approve'> & { approve?: RunHost['approve'] }
}

export { TaskError }

const NAME_CHARS = 60
const RECENT_REPOS = 12
const RELATED_TASKS = 5

/**
 * Tasks: the kernel plus the plugins, put together. Creating a task starts the guide step: a planner session reads
 * the user model and drafts the goal and acceptance criteria, the user ticks and picks, and every pick becomes an
 * experience in memory.
 */
export class TaskService {
    readonly kernel: TaskKernel
    /** Split, work, observe, decide, review, report: the task after the guide step. Null without a run host. */
    readonly runs: RunService | null
    private readonly planner: Planner
    private readonly starting = new Set<Promise<void>>()

    constructor(
        private readonly store: Store,
        private readonly memory: MemoryService,
        private readonly host: TaskServiceHost
    ) {
        this.kernel = new TaskKernel(store, host.changed)
        this.planner = new Planner(host.planner)
        this.runs = host.run ? new RunService(store, this.kernel, memory, {
            ...host.run,
            timeline: (namespace, taskId, text, extra) => host.timeline?.(namespace, taskId, text, extra),
            stopSession: async (namespace, sessionId) => { await host.stopSession?.(namespace, sessionId) },
            approve: host.run.approve ?? (async () => {}),
            load: (namespace, sessionIds, since) => host.load?.(namespace, sessionIds, since) ?? null
        }) : null
    }

    list(namespace: string, tag?: string): TaskView[] {
        return this.kernel.list(namespace, tag).map((task) => this.view(namespace, task))
    }

    get(namespace: string, taskId: string): TaskView | null {
        const task = this.kernel.get(namespace, taskId)
        return task ? this.view(namespace, task) : null
    }

    /**
     * Creates a task in the guide step and starts its planner in the background. The planner decides the repository:
     * it starts in the folder that holds the user's recent repositories and names the one it picked in its draft.
     * A given directory, or the source session's, is used as is.
     */
    async create(namespace: string, input: { text: string; tag?: string; draft?: boolean; machineId?: string; directory?: string; fromSessionId?: string }): Promise<TaskView> {
        const from = input.fromSessionId ? this.host.session(namespace, input.fromSessionId) : null
        if (input.fromSessionId && !from) throw new TaskError('Session not found', 404)
        const tag = input.tag ?? ''
        const known = input.machineId && input.directory
            ? { machineId: input.machineId, directory: input.directory }
            : from?.machineId && from.path && this.host.machineOnline(namespace, from.machineId) ? { machineId: from.machineId, directory: from.path } : null
        const workspace = known ? null : this.workspaceFor(namespace)
        const task = this.kernel.create(namespace, {
            name: firstLine(input.text, NAME_CHARS),
            tag,
            repoPath: known?.directory ?? null,
            machineId: known?.machineId ?? workspace?.machineId ?? null,
            members: from ? [from.id] : []
        })
        // Without the guide step a task is a plain discussion: no goal, no acceptance list, no planner.
        if (input.draft === false) {
            this.store.groups.updateGroup({ groupId: task.id, namespace, description: input.text })
            this.kernel.move(namespace, task.id, 'active')
            return this.get(namespace, task.id)!
        }
        this.kernel.log(namespace, task.id, TASK_EVENT.guideStarted, { text: input.text, fromSessionId: from?.id ?? null, workspace: workspace?.directory ?? null })
        if (!known && !workspace) {
            this.fail(namespace, task.id, '找不到在线机器上的仓库目录：先在要改的仓库里开一个会话，再重试。')
        } else {
            this.host.timeline?.(namespace, task.id, 'HAQI 正在读你的记忆和仓库约定，起草目标和验收标准。')
            this.startInBackground(namespace, task.id)
        }
        return this.get(namespace, task.id)!
    }

    /** Starts the planner again, after it failed to start or stopped. */
    async retry(namespace: string, taskId: string, place?: { machineId?: string; directory?: string }): Promise<TaskView> {
        const task = this.requireTask(namespace, taskId)
        if (task.status !== 'guiding') throw new TaskError('The task is past the guide step', 409)
        if (place?.machineId && place.directory) {
            this.kernel.update(namespace, taskId, { machineId: place.machineId, repoPath: place.directory })
        }
        this.startInBackground(namespace, taskId)
        return this.get(namespace, taskId)!
    }

    /** The planner's draft, from task_draft_submit. Returns what the planner is told. */
    submitDraft(namespace: string, taskId: string, body: unknown): { version: number; message: string } {
        const task = this.requireTask(namespace, taskId)
        if (task.status !== 'guiding') throw new TaskError('The user already confirmed this task; do not submit another draft.', 409)
        const parsed = draftInputSchema.safeParse(body)
        if (!parsed.success) {
            throw new TaskError(`Draft rejected: ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'draft'}: ${issue.message}`).join('; ')}. Fix it and submit again.`)
        }
        const version = this.kernel.count(namespace, taskId, TASK_EVENT.draftSubmitted) + 1
        this.kernel.log(namespace, taskId, TASK_EVENT.draftSubmitted, toTaskDraft(parsed.data, version))
        // The planner tags the task; a tag the user set stays.
        if (parsed.data.tag && !task.tag) this.kernel.update(namespace, taskId, { tag: parsed.data.tag })
        // The planner names the repository; a later draft may move the task to another one.
        if (parsed.data.repoPath && parsed.data.repoPath !== task.repoPath) this.kernel.update(namespace, taskId, { repoPath: parsed.data.repoPath })
        this.host.timeline?.(namespace, taskId, `第 ${version} 版草稿好了：在任务页里勾选、修改，再确认。要改就在这里跟我说。`)
        return { version, message: `Draft ${version} submitted. Wait for the user to confirm it or ask for changes; do not start the work.` }
    }

    /** "Let HAQI change it": the user's words go to the planner, which submits a new draft. */
    async revise(namespace: string, taskId: string, text: string): Promise<TaskView> {
        const task = this.requireTask(namespace, taskId)
        if (task.status !== 'guiding') throw new TaskError('The task is past the guide step', 409)
        this.kernel.log(namespace, taskId, TASK_EVENT.draftReviseRequested, { text })
        const lead = task.leadSessionId ? this.host.session(namespace, task.leadSessionId) : null
        const sent = lead?.active ? await this.planner.revise(lead.id, taskId, text) : false
        // The planner stopped: a new one picks up the last draft and the user's words.
        if (!sent) this.startInBackground(namespace, taskId, { feedback: text })
        return this.get(namespace, taskId)!
    }

    /**
     * The user confirms: the kept criteria become the acceptance list, the task goes active, and each choice (an
     * answer, or an inferred criterion the user dropped) is stored as an experience.
     */
    async confirm(namespace: string, taskId: string, body: unknown): Promise<TaskView> {
        const task = this.requireTask(namespace, taskId)
        if (task.status !== 'guiding') throw new TaskError('The task is past the guide step', 409)
        const parsed = confirmInputSchema.safeParse(body)
        if (!parsed.success) throw new TaskError('Invalid body: criteria and answers are required')
        const draft = this.latestDraft(namespace, taskId)
        if (!draft) throw new TaskError('No draft yet', 409)
        const input: ConfirmInput = parsed.data

        const edits = new Map(input.criteria.map((c) => [c.id, c]))
        const acceptance: StoredAcceptanceCriterion[] = draft.criteria
            .filter((criterion) => edits.get(criterion.id)?.kept ?? true)
            .map((criterion) => {
                const text = edits.get(criterion.id)?.text ?? criterion.text
                // A criterion the user rewrote is theirs now.
                return text === criterion.text ? criterion : { ...criterion, text, source: 'user' as const, sourceRef: null }
            })
        input.added.forEach((added, index) => {
            acceptance.push({ id: `u${index + 1}`, text: added.text, source: 'user', sourceRef: null, verify: added.verify ?? '' })
        })
        if (acceptance.length === 0) throw new TaskError('Keep at least one acceptance criterion')
        const dropped = draft.criteria.filter((criterion) => criterion.source === 'inferred' && edits.get(criterion.id)?.kept === false)

        const project = task.repoPath ? projectNameFor(task.repoPath) : null
        const tags = task.tag ? [task.tag] : []
        const decisions: Array<{ ref: string; memoryId: string | null; action: string }> = []
        const record = async (ref: string, situation: string, options: string[], chosen: string) => {
            const result = await this.memory.recordDecision({ namespace, situation, options, chosen, project, tags, sessionId: task.leadSessionId, sourceRef: `task:${taskId}#${ref}` })
            decisions.push({ ref, memoryId: result.memoryId, action: result.action })
        }
        const answers: Record<string, string> = {}
        for (const question of draft.questions) {
            const picked = question.options.find((option) => option.id === input.answers[question.id])
                ?? question.options.find((option) => option.id === question.default)!
            answers[question.id] = picked.id
            await record(question.id, question.text, question.options.map((option) => option.label), picked.label)
        }
        for (const criterion of dropped) await record(criterion.id, `验收标准“${criterion.text}”`, ['保留', '去掉'], '去掉')

        const goal = input.goal ?? draft.goal
        const nonGoals = input.nonGoals ?? draft.nonGoals
        this.kernel.move(namespace, taskId, 'active', { goal, nonGoals, acceptance })
        this.kernel.log(namespace, taskId, TASK_EVENT.draftConfirmed, { version: draft.version, answers, acceptance, decisions })
        this.writeNote(namespace, taskId, goal, nonGoals, acceptance)
        // The lead splits the task now; without a run host (tests) it has nothing left to do.
        if (this.runs) void this.runs.start(namespace, this.kernel.get(namespace, taskId)!).catch(() => {})
        else await this.stopPlanner(namespace, task.leadSessionId)
        return this.get(namespace, taskId)!
    }

    update(namespace: string, taskId: string, patch: { status?: StoredTaskStatus; tag?: string; name?: string }): TaskView {
        this.requireTask(namespace, taskId)
        if (patch.tag !== undefined || patch.name !== undefined) this.kernel.update(namespace, taskId, { tag: patch.tag, name: patch.name })
        if (patch.status) this.kernel.move(namespace, taskId, patch.status)
        if (patch.status === 'done' || patch.status === 'abandoned') {
            void this.stopPlanner(namespace, this.kernel.get(namespace, taskId)?.leadSessionId ?? null)
            void this.runs?.stopAll(namespace, taskId)
        }
        return this.get(namespace, taskId)!
    }

    /**
     * After the guide step the planner has nothing to do until P4 hands it work, and each one holds about 185 MB. It
     * stays the task's lead (member and history); it is stopped, and resumed when needed.
     */
    private async stopPlanner(namespace: string, sessionId: string | null): Promise<void> {
        if (!sessionId || !this.host.session(namespace, sessionId)?.active) return
        await this.host.stopSession?.(namespace, sessionId).catch(() => {})
    }

    addMember(namespace: string, taskId: string, sessionId: string): TaskView {
        this.requireTask(namespace, taskId)
        if (!this.host.session(namespace, sessionId)) throw new TaskError('Session not found', 404)
        this.store.groups.addGroupMember({ groupId: taskId, namespace, sessionId, role: 'member' })
        this.kernel.log(namespace, taskId, TASK_EVENT.memberAdded, { sessionId })
        return this.get(namespace, taskId)!
    }

    removeMember(namespace: string, taskId: string, sessionId: string): TaskView {
        this.requireTask(namespace, taskId)
        if (!this.store.groups.removeGroupMember({ groupId: taskId, namespace, sessionId })) throw new TaskError('Member not found', 404)
        const task = this.kernel.get(namespace, taskId)!
        if (task.leadSessionId === sessionId) this.kernel.update(namespace, taskId, { leadSessionId: null })
        this.kernel.log(namespace, taskId, TASK_EVENT.memberRemoved, { sessionId })
        return this.get(namespace, taskId)!
    }

    delete(namespace: string, taskId: string): boolean {
        return this.kernel.delete(namespace, taskId)
    }

    /** Tasks a session belongs to. */
    tasksOfSession(namespace: string, sessionId: string): string[] {
        return this.kernel.list(namespace)
            .filter((task) => this.store.groups.getGroupMembersByNamespace(task.id, namespace).some((m) => m.sessionId === sessionId))
            .map((task) => task.id)
    }

    /** Resolves once every planner being started has started or failed. */
    async whenIdle(): Promise<void> {
        while (this.starting.size > 0) await Promise.all([...this.starting])
    }

    private startInBackground(namespace: string, taskId: string, resume?: { feedback: string }): void {
        const start = this.startPlanner(namespace, taskId, resume).finally(() => this.starting.delete(start))
        this.starting.add(start)
    }

    private async startPlanner(namespace: string, taskId: string, resume?: { feedback: string }): Promise<void> {
        const task = this.kernel.get(namespace, taskId)
        if (!task) return
        const started = this.kernel.latest(namespace, taskId, TASK_EVENT.guideStarted)?.payload as { text?: string; fromSessionId?: string | null; workspace?: string | null } | null
        const text = started?.text ?? task.name
        // Until the planner names the repository it works from the folder that holds the user's repositories.
        const directory = task.repoPath ?? started?.workspace ?? null
        if (!task.machineId || !directory) {
            this.fail(namespace, taskId, '找不到在线机器上的仓库：先在要改的仓库里开一个会话，再重试。')
            return
        }
        try {
            const project = task.repoPath ? projectNameFor(task.repoPath) : null
            const pack = await buildContextPack(
                {
                    taskId, text, tag: task.tag ?? '', project, repoPath: task.repoPath, fromSessionId: started?.fromSessionId ?? null,
                    ...(task.repoPath ? {} : { workspace: directory, repos: this.recentRepos(namespace, task.machineId) })
                },
                this.contextSources(namespace)
            )
            const result = await this.planner.start({
                taskId,
                taskName: task.name,
                tag: task.tag ?? '',
                text,
                machineId: task.machineId,
                repoPath: directory,
                chooseRepo: !task.repoPath,
                contextText: pack.text,
                ...(resume ? { resume: { draft: this.latestDraft(namespace, taskId), feedback: resume.feedback } } : {})
            })
            if ('error' in result) {
                this.fail(namespace, taskId, result.error)
                return
            }
            if (!this.kernel.get(namespace, taskId)) return
            this.store.groups.addGroupMember({ groupId: taskId, namespace, sessionId: result.sessionId, role: 'lead' })
            this.kernel.update(namespace, taskId, { leadSessionId: result.sessionId })
            this.kernel.log(namespace, taskId, TASK_EVENT.plannerStarted, {
                sessionId: result.sessionId,
                principleIds: pack.principleIds,
                experienceIds: pack.experienceIds
            })
        } catch (error) {
            this.fail(namespace, taskId, error instanceof Error ? error.message : String(error))
        }
    }

    /**
     * Where the planner starts before it has picked a repository: the machine of the newest session on an online
     * machine, in the deepest folder that holds that machine's recent repositories (so it can read each of them).
     */
    private workspaceFor(namespace: string): { machineId: string; directory: string } | null {
        const newest = this.workSessions(namespace)
            .filter((s) => s.machineId && s.path && this.host.machineOnline(namespace, s.machineId))
            .sort((a, b) => b.updatedAt - a.updatedAt)[0]
        if (!newest?.machineId) return null
        const repos = this.recentRepos(namespace, newest.machineId).map((repo) => repo.path)
        return { machineId: newest.machineId, directory: commonFolder(repos) ?? newest.path! }
    }

    /** Sessions that work in a repository: planners start in the shared folder, so they are left out. */
    private workSessions(namespace: string): TaskSession[] {
        const leads = new Set(this.kernel.list(namespace).map((task) => task.leadSessionId).filter(Boolean))
        return this.host.sessions(namespace).filter((session) => !leads.has(session.id))
    }

    /** The machine's recent repositories, newest first, with the names of their latest sessions. */
    private recentRepos(namespace: string, machineId: string): Array<{ path: string; project: string; sessions: string[] }> {
        const byPath = new Map<string, string[]>()
        for (const session of this.workSessions(namespace).sort((a, b) => b.updatedAt - a.updatedAt)) {
            if (session.machineId !== machineId || !session.path) continue
            const names = byPath.get(session.path) ?? []
            if (!byPath.has(session.path) && byPath.size >= RECENT_REPOS) continue
            if (session.name && names.length < 3) names.push(session.name)
            byPath.set(session.path, names)
        }
        return [...byPath].map(([path, sessions]) => ({ path, project: projectNameFor(path) ?? path, sessions }))
    }

    private contextSources(namespace: string): ContextSources {
        return {
            currentSession: (sessionId) => {
                const session = this.host.session(namespace, sessionId)
                if (!session) return null
                const userMessages = this.store.messages.getMessages(sessionId, 200)
                    .map((message) => realUserText(message.content as Parameters<typeof realUserText>[0]))
                    .filter((text): text is string => text !== null)
                return { name: session.name, userMessages }
            },
            // Without a repository or tag yet, the newest tasks: the planner can spot overlaps itself.
            relatedTasks: (project, tag, excludeId) => this.kernel.list(namespace)
                .filter((task) => (!project && !tag) || (tag && task.tag === tag) || (project && task.repoPath && projectNameFor(task.repoPath) === project))
                .filter((task) => task.id !== excludeId && task.status !== 'guiding')
                .slice(0, RELATED_TASKS)
                .map((task) => ({ id: task.id, name: task.name, goal: task.goal, acceptance: task.acceptance.map((c) => c.text) })),
            knownTags: () => Array.from(new Set([
                ...this.host.sessions(namespace).flatMap((s) => s.tags),
                ...this.kernel.list(namespace).map((task) => task.tag ?? '')
            ].filter((tag) => tag && !tag.includes(':')))).sort(),
            principles: (project, tag) => this.store.memories.list(namespace)
                .filter((m) => m.level === 'principle' && m.status === 'active')
                .filter((m) => m.scope === '' || m.scope === project || m.tags.includes(tag))
                .map((m) => ({ id: m.id, text: m.text, scope: m.scope })),
            experiences: async (query, project) => (await this.memory.search(namespace, query, 8, {
                levels: ['experience'],
                statuses: ['active'],
                ...(project ? { project } : {})
            })).map((hit) => ({ id: hit.memory.id, text: hit.memory.text }))
        }
    }

    private writeNote(namespace: string, taskId: string, goal: string, nonGoals: string[], acceptance: StoredAcceptanceCriterion[]): void {
        const content = [
            '## 目标', goal, '',
            ...(nonGoals.length ? ['## 不做什么', ...nonGoals.map((line) => `- ${line}`), ''] : []),
            '## 结论', '验收标准（你确认过的）：',
            ...acceptance.map((c, index) => `${index + 1}. ${c.text}${c.verify ? `（验证：${c.verify}）` : ''}`)
        ].join('\n')
        this.store.groups.updateGroupNote({ groupId: taskId, namespace, content, updatedBy: 'system:task' })
        this.host.timeline?.(namespace, taskId, `你确认了目标和 ${acceptance.length} 条验收标准。`)
    }

    private fail(namespace: string, taskId: string, error: string): void {
        this.kernel.log(namespace, taskId, TASK_EVENT.guideFailed, { error })
        this.host.timeline?.(namespace, taskId, `起草失败：${error}`)
    }

    private latestDraft(namespace: string, taskId: string): TaskDraft | null {
        return (this.kernel.latest(namespace, taskId, TASK_EVENT.draftSubmitted)?.payload as TaskDraft | undefined) ?? null
    }

    private requireTask(namespace: string, taskId: string): StoredGroup {
        const task = this.kernel.get(namespace, taskId)
        if (!task) throw new TaskError('Task not found', 404)
        return task
    }

    private view(namespace: string, task: StoredGroup): TaskView {
        const events = this.kernel.events(namespace, task.id)
        const members = this.store.groups.getGroupMembersByNamespace(task.id, namespace)
            .filter((m) => m.memberType === 'session' && m.sessionId)
            .map((m) => ({ sessionId: m.sessionId!, role: m.role }))
        const request = (findLast(events, TASK_EVENT.guideStarted)?.payload as { text?: string } | undefined)?.text ?? null
        return {
            id: task.id,
            name: task.name,
            tag: task.tag ?? '',
            status: task.status ?? 'active',
            goal: task.goal,
            nonGoals: task.nonGoals,
            acceptance: task.acceptance,
            repoPath: task.repoPath,
            machineId: task.machineId,
            leadSessionId: task.leadSessionId,
            members,
            guide: { ...guideState(task, events), request },
            draft: task.status === 'guiding' ? (findLast(events, TASK_EVENT.draftSubmitted)?.payload as TaskDraft | undefined) ?? null : null,
            load: this.host.load?.(namespace, members.map((m) => m.sessionId), task.createdAt) ?? null,
            run: task.status === 'guiding' ? null : decorate(readRun(events), this.runs),
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
            completedAt: task.completedAt
        }
    }
}

function findLast(events: StoredTaskEvent[], type: string): StoredTaskEvent | undefined {
    for (let i = events.length - 1; i >= 0; i--) if (events[i]!.type === type) return events[i]
    return undefined
}

/** The guide state is whichever of these happened last. */
function guideState(task: StoredGroup, events: StoredTaskEvent[]): { state: TaskGuideState; error: string | null } {
    if (task.status !== 'guiding') return { state: 'confirmed', error: null }
    const states: Record<string, TaskGuideState> = {
        [TASK_EVENT.guideStarted]: 'starting',
        [TASK_EVENT.plannerStarted]: 'drafting',
        [TASK_EVENT.guideFailed]: 'failed',
        [TASK_EVENT.draftSubmitted]: 'ready',
        [TASK_EVENT.draftReviseRequested]: 'drafting'
    }
    for (let i = events.length - 1; i >= 0; i--) {
        const event = events[i]!
        const state = states[event.type]
        if (!state) continue
        return { state, error: state === 'failed' ? (event.payload as { error?: string } | null)?.error ?? '规划会话没能启动' : null }
    }
    return { state: 'starting', error: null }
}

function firstLine(text: string, max: number): string {
    const line = text.trim().split('\n')[0]!.trim()
    return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

/** The deepest folder that holds every path; null when they only share the root. */
export function commonFolder(paths: string[]): string | null {
    if (paths.length === 0) return null
    const parts = paths.map((path) => path.split('/').filter(Boolean))
    const shared: string[] = []
    for (let i = 0; i < parts[0]!.length; i += 1) {
        const segment = parts[0]![i]
        if (!parts.every((p) => p[i] === segment)) break
        shared.push(segment!)
    }
    // A single repository: its parent, so a sibling repository is readable too.
    if (paths.length === 1 || new Set(paths).size === 1) shared.pop()
    return shared.length > 0 ? `/${shared.join('/')}` : null
}

/** Adds what the observer saw, when the run service is wired in. */
function decorate(run: TaskRun | null, runs: RunService | null): TaskRun | null {
    return run && runs ? runs.decorate(run) : run
}
