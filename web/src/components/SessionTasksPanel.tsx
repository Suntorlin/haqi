import { useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { SessionSummary, TaskView } from '@/types/api'
import { useTaskActions } from '@/hooks/queries/useTasks'
import { useTranslation } from '@/lib/use-translation'
import { isTaskOpen } from '@/lib/tasks'
import { getSessionTitle } from '@/lib/session-title'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { TaskGuideSheet } from '@/components/TaskGuideSheet'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/mobile/ContextMenu'
import { CheckIcon, ChevronDownIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, TrashIcon } from '@/components/mobile/icons'

/** Sessions of each task, keyed by task id, from the task's members. */
function useSessionsByTask(tasks: TaskView[], sessions: SessionSummary[]): Map<string, SessionSummary[]> {
    return useMemo(() => {
        const byId = new Map(sessions.map((session) => [session.id, session]))
        return new Map(tasks.map((task) => [
            task.id,
            task.members.map((member) => byId.get(member.sessionId)).filter((session): session is SessionSummary => Boolean(session))
        ]))
    }, [tasks, sessions])
}

/** The guide sheet of one task at a time; the task is read live from the list, so a new draft shows at once. */
function useGuideSheet(tasks: TaskView[], api: ApiClient | null): { open: (taskId: string) => void; sheet: ReactNode } {
    const [taskId, setTaskId] = useState<string | null>(null)
    const task = taskId ? tasks.find((item) => item.id === taskId) ?? null : null
    return {
        open: setTaskId,
        sheet: (
            <TaskGuideSheet
                task={task}
                open={task !== null}
                onOpenChange={(open) => { if (!open) setTaskId(null) }}
                api={api}
            />
        )
    }
}

/** Small uppercase caption that folds its section, same look as the list's section rows. */
function SectionCaption(props: { label: string; count: number; collapsed: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={props.onToggle}
            aria-expanded={!props.collapsed}
            className="flex min-h-11 w-full items-center gap-2 px-5 text-left text-[12px] text-[var(--social-fg-muted)] transition-colors hover:text-[var(--social-fg)]"
        >
            <ChevronDownIcon className={cn('h-3.5 w-3.5 transition-transform', props.collapsed && '-rotate-90')} />
            <span className="uppercase tracking-wide">{props.label}</span>
            <span>({props.count})</span>
        </button>
    )
}

/** One line under a task's name: its guide state while guiding, else its sessions. */
function taskSubtitle(task: TaskView, sessions: SessionSummary[], t: ReturnType<typeof useTranslation>['t']): string {
    if (task.status === 'guiding') {
        if (task.guide.state === 'ready') return t('tasks.guideReady')
        if (task.guide.state === 'failed') return t('tasks.guideFailed')
        return t('tasks.guideWorking')
    }
    const running = sessions.filter((session) => session.active).length
    if (sessions.length === 0) return t('tasks.noSessions')
    return running > 0 ? t('tasks.sessionCountRunning', { n: sessions.length, running }) : t('tasks.sessionCount', { n: sessions.length })
}

function TaskRow(props: {
    task: TaskView
    sessions: SessionSummary[]
    selectedSessionId: string | null
    onSelectSession: (sessionId: string) => void
    onToggleDone: () => void
    onOpenGuide: () => void
    onRename: () => void
    onAbandon: () => void
    onDelete: () => void
}) {
    const { t } = useTranslation()
    const { task, sessions } = props
    const [expanded, setExpanded] = useState(false)
    const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
    const done = task.status === 'done'
    const closed = !isTaskOpen(task)
    const guiding = task.status === 'guiding'
    const leadId = task.leadSessionId
    const load = task.load

    const openMenu = (event: MouseEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setMenuPoint({ x: rect.left + rect.width / 2, y: rect.bottom })
    }

    return (
        <div>
            <div className="flex min-h-[52px] items-center gap-1 pl-2 pr-2 lg:mx-2 lg:rounded-2xl lg:pl-0">
                {guiding ? (
                    <button
                        type="button"
                        onClick={props.onOpenGuide}
                        aria-label={t('tasks.openGuide')}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent]"
                    >
                        <span className={cn(
                            'h-2.5 w-2.5 rounded-full',
                            task.guide.state === 'ready'
                                ? 'bg-[var(--social-badge)]'
                                : task.guide.state === 'failed'
                                    ? 'bg-[var(--social-danger)]'
                                    : 'animate-pulse bg-[var(--social-fg-muted)]'
                        )} />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={props.onToggleDone}
                        aria-pressed={done}
                        aria-label={done ? t('tasks.reopen') : t('tasks.complete')}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent]"
                    >
                        <span className={cn(
                            'flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
                            done
                                ? 'border-[var(--social-fg-muted)] bg-[var(--social-fg-muted)] text-[var(--social-surface)]'
                                : 'border-[var(--social-fg-subtle)] hover:border-[var(--social-fg)]'
                        )}>
                            {done ? <CheckIcon className="h-3 w-3" /> : null}
                        </span>
                    </button>
                )}
                <button
                    type="button"
                    onClick={() => guiding ? props.onOpenGuide() : setExpanded((value) => !value)}
                    onContextMenu={(event) => {
                        event.preventDefault()
                        setMenuPoint({ x: event.clientX, y: event.clientY })
                    }}
                    aria-expanded={expanded}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl text-left"
                >
                    <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                            <span className={cn(
                                'block truncate text-[15px]',
                                closed ? 'text-[var(--social-fg-muted)] line-through' : 'text-[var(--social-fg)]'
                            )}>
                                {task.name}
                            </span>
                            {guiding ? <Badge variant={task.guide.state === 'failed' ? 'destructive' : 'default'}>{t('tasks.guiding')}</Badge> : null}
                        </span>
                        <span className="block truncate text-[13px] text-[var(--social-fg-muted)]">
                            {taskSubtitle(task, sessions, t)}
                        </span>
                    </span>
                    {guiding ? null : (
                        <ChevronDownIcon className={cn(
                            'h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform',
                            !expanded && '-rotate-90'
                        )} />
                    )}
                </button>
                <IconButton label={t('tasks.more')} onClick={openMenu}>
                    <MoreHorizontalIcon className="h-5 w-5" />
                </IconButton>
            </div>
            {expanded && !guiding ? (
                <div className="pb-1 pl-[3.25rem] pr-3 lg:pl-11">
                    {task.goal ? (
                        <p className="pb-1 text-[13px] text-[var(--social-fg)]">
                            <span className="text-[var(--social-fg-muted)]">{t('tasks.goal')}：</span>{task.goal}
                        </p>
                    ) : null}
                    {task.acceptance.length > 0 ? (
                        <ol aria-label={t('tasks.acceptance')} className="list-decimal space-y-0.5 pb-2 pl-4 text-[13px] text-[var(--social-fg)]">
                            {task.acceptance.map((criterion) => <li key={criterion.id}>{criterion.text}</li>)}
                        </ol>
                    ) : null}
                    {load ? (
                        <p className="pb-2 text-[12px] text-[var(--social-fg-muted)]">
                            {t('tasks.load', { n: load.progress + load.correction + load.decision, progress: load.progress, correction: load.correction, decision: load.decision })}
                        </p>
                    ) : null}
                    {sessions.length === 0 ? (
                        <div className="py-2 text-[13px] text-[var(--social-fg-muted)]">{t('tasks.howToAdd')}</div>
                    ) : sessions.map((session) => (
                        <button
                            key={session.id}
                            type="button"
                            onClick={() => props.onSelectSession(session.id)}
                            aria-current={props.selectedSessionId === session.id ? 'page' : undefined}
                            className={cn(
                                'flex min-h-11 w-full items-center gap-2.5 rounded-xl px-2 text-left transition-colors hover:bg-[var(--social-hover)]',
                                props.selectedSessionId === session.id && 'bg-[var(--social-muted)]'
                            )}
                        >
                            <span className={cn(
                                'h-2 w-2 shrink-0 rounded-full',
                                session.active ? 'bg-[var(--social-success)]' : 'bg-[var(--social-fg-subtle)]'
                            )} />
                            <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--social-fg)]">
                                {getSessionTitle(session)}
                            </span>
                            {session.id === leadId ? <Badge>{t('tasks.lead')}</Badge> : null}
                        </button>
                    ))}
                </div>
            ) : null}
            <ContextMenu
                open={menuPoint !== null}
                anchorPoint={menuPoint ?? { x: 0, y: 0 }}
                onClose={() => setMenuPoint(null)}
                label={t('tasks.more')}
            >
                <ContextMenuItem
                    icon={<PencilIcon />}
                    label={t('tasks.rename')}
                    onSelect={() => {
                        setMenuPoint(null)
                        props.onRename()
                    }}
                />
                {isTaskOpen(task) ? (
                    <ContextMenuItem
                        label={t('tasks.abandon')}
                        onSelect={() => {
                            setMenuPoint(null)
                            props.onAbandon()
                        }}
                    />
                ) : null}
                <ContextMenuSeparator />
                <ContextMenuItem
                    icon={<TrashIcon />}
                    label={t('tasks.delete')}
                    destructive
                    onSelect={() => {
                        setMenuPoint(null)
                        props.onDelete()
                    }}
                />
            </ContextMenu>
        </div>
    )
}

const LAST_TASK_TAG_KEY = 'hapi:lastTaskTag:v1'

function loadLastTaskTag(): string | null {
    try {
        return window.localStorage.getItem(LAST_TASK_TAG_KEY)
    } catch {
        return null
    }
}

/** One-line task composer: what should be done on the left, the tag it goes under on the right; Enter starts the guide step. */
function TaskComposer(props: { tags: string[]; onCreate: (input: { tag: string; text: string }) => Promise<void> }) {
    const { t } = useTranslation()
    const [title, setTitle] = useState('')
    const [pickedTag, setPickedTag] = useState<string | null>(loadLastTaskTag)
    const [pending, setPending] = useState(false)
    const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
    // The tag picked last, while it still exists; else the first tag in the filter order.
    const tag = pickedTag && props.tags.includes(pickedTag) ? pickedTag : (props.tags[0] ?? null)

    const pickTag = (next: string) => {
        setPickedTag(next)
        setMenuPoint(null)
        try {
            window.localStorage.setItem(LAST_TASK_TAG_KEY, next)
        } catch {
        }
    }

    const submit = (event: FormEvent) => {
        event.preventDefault()
        const trimmed = title.trim()
        if (!trimmed || !tag || pending) return
        setPending(true)
        void props.onCreate({ tag, text: trimmed })
            .then(() => setTitle(''))
            .catch((error) => console.error('Failed to create task', error))
            .finally(() => setPending(false))
    }

    return (
        <form onSubmit={submit} className="px-5 pb-1 pt-2 lg:px-4">
            <TextField
                variant="pill"
                value={title}
                disabled={!tag}
                readOnly={pending}
                maxLength={1000}
                enterKeyHint="done"
                aria-label={t('tasks.new')}
                placeholder={tag ? t('tasks.newPlaceholder') : t('tasks.needTag')}
                onChange={(event) => setTitle(event.target.value)}
                leading={<PlusIcon className="h-4 w-4" />}
                trailing={tag ? (
                    <button
                        type="button"
                        onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect()
                            setMenuPoint({ x: rect.left + rect.width / 2, y: rect.bottom })
                        }}
                        aria-haspopup="menu"
                        aria-expanded={menuPoint !== null}
                        aria-label={t('tasks.pickTag')}
                        className="relative flex h-8 max-w-40 shrink-0 items-center gap-1 rounded-full bg-[var(--social-surface)] pl-3 pr-2 text-[13px] text-[var(--social-fg)] after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
                    >
                        <span className="truncate">#{tag}</span>
                        <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-[var(--social-fg-muted)]" />
                    </button>
                ) : null}
            />
            <ContextMenu
                open={menuPoint !== null}
                anchorPoint={menuPoint ?? { x: 0, y: 0 }}
                onClose={() => setMenuPoint(null)}
                label={t('tasks.pickTag')}
            >
                {props.tags.map((item) => (
                    <ContextMenuItem
                        key={item}
                        label={`#${item}`}
                        checked={item === tag}
                        onSelect={() => pickTag(item)}
                        trailing={(
                            <span className={cn('text-[15px]', item === tag ? 'text-[var(--social-fg)]' : 'text-transparent')} aria-hidden="true">
                                ✓
                            </span>
                        )}
                    />
                ))}
            </ContextMenu>
        </form>
    )
}

/** Rows of a task list: open tasks, then the done ones folded under one caption. */
function TaskList(props: {
    tasks: TaskView[]
    sessionsByTask: Map<string, SessionSummary[]>
    selectedSessionId: string | null
    onSelectSession: (sessionId: string) => void
    onOpenGuide: (taskId: string) => void
    api: ApiClient | null
}) {
    const { t } = useTranslation()
    const { updateTask, deleteTask } = useTaskActions(props.api)
    const [doneCollapsed, setDoneCollapsed] = useState(true)
    const [renaming, setRenaming] = useState<TaskView | null>(null)
    const [deleting, setDeleting] = useState<TaskView | null>(null)
    const [pending, setPending] = useState(false)
    const open = props.tasks.filter(isTaskOpen)
    const done = props.tasks
        .filter((task) => !isTaskOpen(task))
        .sort((a, b) => (b.completedAt ?? b.updatedAt) - (a.completedAt ?? a.updatedAt))

    const renderRow = (task: TaskView) => (
        <TaskRow
            key={task.id}
            task={task}
            sessions={props.sessionsByTask.get(task.id) ?? []}
            selectedSessionId={props.selectedSessionId}
            onSelectSession={props.onSelectSession}
            onToggleDone={() => {
                void updateTask(task.id, { status: task.status === 'active' ? 'done' : 'active' })
                    .catch((error: unknown) => console.error('Failed to update task', error))
            }}
            onOpenGuide={() => props.onOpenGuide(task.id)}
            onAbandon={() => {
                void updateTask(task.id, { status: 'abandoned' })
                    .catch((error: unknown) => console.error('Failed to abandon task', error))
            }}
            onRename={() => setRenaming(task)}
            onDelete={() => setDeleting(task)}
        />
    )

    const run = async (action: () => Promise<void>) => {
        setPending(true)
        try {
            await action()
        } finally {
            setPending(false)
        }
    }

    return (
        <>
            {open.map(renderRow)}
            {done.length > 0 ? (
                <>
                    <SectionCaption
                        label={t('tasks.closed')}
                        count={done.length}
                        collapsed={doneCollapsed}
                        onToggle={() => setDoneCollapsed((value) => !value)}
                    />
                    {doneCollapsed ? null : done.map(renderRow)}
                </>
            ) : null}
            <RenameSessionDialog
                isOpen={renaming !== null}
                onClose={() => setRenaming(null)}
                currentName={renaming?.name ?? ''}
                onRename={(name) => run(async () => {
                    if (renaming) await updateTask(renaming.id, { name })
                })}
                isPending={pending}
                title={t('tasks.rename')}
                placeholder={t('tasks.newPlaceholder')}
            />
            <ConfirmDialog
                isOpen={deleting !== null}
                onClose={() => setDeleting(null)}
                title={t('tasks.deleteTitle')}
                description={t('tasks.deleteDescription', { name: deleting?.name ?? '' })}
                confirmLabel={t('tasks.delete')}
                confirmingLabel={t('tasks.deleting')}
                onConfirm={() => run(async () => {
                    if (deleting) await deleteTask(deleting.id)
                })}
                isPending={pending}
                destructive
            />
        </>
    )
}

/** The "Task" section on top of one tag's view. Hidden while the tag has no task; tasks are added in "All tasks". */
export function TagTasksSection(props: {
    tag: string
    tasks: TaskView[]
    sessions: SessionSummary[]
    selectedSessionId: string | null
    onSelectSession: (sessionId: string) => void
    api: ApiClient | null
}) {
    const { t } = useTranslation()
    const [collapsed, setCollapsed] = useState(false)
    const tagTasks = props.tasks.filter((task) => task.tag === props.tag)
    const sessionsByTask = useSessionsByTask(tagTasks, props.sessions)
    const guide = useGuideSheet(tagTasks, props.api)
    const openCount = tagTasks.filter(isTaskOpen).length

    if (tagTasks.length === 0) return null

    return (
        <section aria-label={t('tasks.section')} className="border-b border-[var(--social-divider)] pb-1">
            <SectionCaption
                label={t('tasks.section')}
                count={openCount}
                collapsed={collapsed}
                onToggle={() => setCollapsed((value) => !value)}
            />
            {collapsed ? null : (
                <TaskList
                    tasks={tagTasks}
                    sessionsByTask={sessionsByTask}
                    selectedSessionId={props.selectedSessionId}
                    onSelectSession={props.onSelectSession}
                    onOpenGuide={guide.open}
                    api={props.api}
                />
            )}
            {guide.sheet}
        </section>
    )
}

/** Every task, grouped by tag in the tag-filter order, with the composer on top. Tapping a tag name opens that tag's view. */
export function AllTasksView(props: {
    tasks: TaskView[]
    tagOrder: string[]
    sessions: SessionSummary[]
    selectedSessionId: string | null
    onSelectSession: (sessionId: string) => void
    onOpenTag: (tag: string) => void
    api: ApiClient | null
    isLoading: boolean
    header?: ReactNode
}) {
    const { t } = useTranslation()
    const { createTask } = useTaskActions(props.api)
    const sessionsByTask = useSessionsByTask(props.tasks, props.sessions)
    const guide = useGuideSheet(props.tasks, props.api)
    // A new task opens its guide sheet; the selected session is its context.
    const create = async (input: { tag: string; text: string }) => {
        const task = await createTask({ ...input, ...(props.selectedSessionId ? { fromSessionId: props.selectedSessionId } : {}) })
        guide.open(task.id)
    }
    const tags = useMemo(() => {
        const present = new Set(props.tasks.map((task) => task.tag))
        const ordered = props.tagOrder.filter((tag) => present.has(tag))
        const rest = [...present].filter((tag) => !ordered.includes(tag)).sort((a, b) => a.localeCompare(b))
        return [...ordered, ...rest]
    }, [props.tasks, props.tagOrder])

    return (
        <div className="h-full overflow-y-auto pb-6">
            {props.header}
            <TaskComposer tags={props.tagOrder} onCreate={create} />
            {tags.length === 0 ? (
                <div className="px-5 py-8 text-center text-[13px] text-[var(--social-fg-muted)]">
                    {props.isLoading ? t('mobile.feed.loading') : t('tasks.empty')}
                </div>
            ) : tags.map((tag) => {
                const tagTasks = props.tasks.filter((task) => task.tag === tag)
                const openCount = tagTasks.filter(isTaskOpen).length
                return (
                    <section key={tag} aria-label={`#${tag}`} className="pt-2">
                        <button
                            type="button"
                            onClick={() => props.onOpenTag(tag)}
                            className="flex min-h-11 w-full items-center gap-2 px-5 text-left text-[15px] font-semibold text-[var(--social-fg)] lg:px-4"
                        >
                            #{tag}
                            <span className="text-[13px] font-normal text-[var(--social-fg-muted)]">
                                {t('tasks.openCount', { n: openCount })}
                            </span>
                        </button>
                        <TaskList
                            tasks={tagTasks}
                            sessionsByTask={sessionsByTask}
                            selectedSessionId={props.selectedSessionId}
                            onSelectSession={props.onSelectSession}
                            onOpenGuide={guide.open}
                            api={props.api}
                        />
                    </section>
                )
            })}
            {guide.sheet}
        </div>
    )
}
