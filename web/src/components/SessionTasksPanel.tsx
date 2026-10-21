import { useMemo, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import type { ApiClient } from '@/api/client'
import type { SessionSummary, SessionTask } from '@/types/api'
import { useSessionTaskActions } from '@/hooks/queries/useSessionTasks'
import { useTranslation } from '@/lib/use-translation'
import { getSessionTaskIds } from '@/lib/session-pins'
import { getSessionTitle } from '@/lib/session-title'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/mobile/ContextMenu'
import { CheckIcon, ChevronDownIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, TrashIcon } from '@/components/mobile/icons'
import { EmptyState } from '@/components/ui/EmptyState'

/** Sessions of each task, keyed by task id. */
function useSessionsByTask(sessions: SessionSummary[]): Map<string, SessionSummary[]> {
    return useMemo(() => {
        const byTask = new Map<string, SessionSummary[]>()
        for (const session of sessions) {
            for (const taskId of getSessionTaskIds(session)) {
                byTask.set(taskId, [...(byTask.get(taskId) ?? []), session])
            }
        }
        return byTask
    }, [sessions])
}

/** Small uppercase caption that folds its section, same look as the list's section rows. */
function SectionCaption(props: { label: string; count: number; collapsed: boolean; onToggle: () => void }) {
    return (
        <button
            type="button"
            onClick={props.onToggle}
            aria-expanded={!props.collapsed}
            className="flex min-h-11 w-full items-center gap-2 px-5 text-left text-caption text-[var(--social-fg-muted)] transition-colors hover:text-[var(--social-fg)]"
        >
            <ChevronDownIcon className={cn('h-3.5 w-3.5 transition-transform', props.collapsed && '-rotate-90')} />
            <span className="uppercase tracking-wide">{props.label}</span>
            <span>({props.count})</span>
        </button>
    )
}

function TaskRow(props: {
    task: SessionTask
    sessions: SessionSummary[]
    selectedSessionId: string | null
    onSelectSession: (sessionId: string) => void
    onToggleDone: () => void
    onRename: () => void
    onDelete: () => void
}) {
    const { t } = useTranslation()
    const { task, sessions } = props
    const [expanded, setExpanded] = useState(false)
    const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
    const done = task.status === 'done'
    const running = sessions.filter((session) => session.active).length

    const openMenu = (event: MouseEvent<HTMLElement>) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setMenuPoint({ x: rect.left + rect.width / 2, y: rect.bottom })
    }

    return (
        <div>
            <div className="flex min-h-[52px] items-center gap-1 pl-2 pr-2 lg:mx-2 lg:rounded-2xl lg:pl-0">
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
                <button
                    type="button"
                    onClick={() => setExpanded((value) => !value)}
                    onContextMenu={(event) => {
                        event.preventDefault()
                        setMenuPoint({ x: event.clientX, y: event.clientY })
                    }}
                    aria-expanded={expanded}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-xl text-left"
                >
                    <span className="min-w-0 flex-1">
                        <span className={cn(
                            'block truncate text-body',
                            done ? 'text-[var(--social-fg-muted)] line-through' : 'text-[var(--social-fg)]'
                        )}>
                            {task.title}
                        </span>
                        <span className="block truncate text-footnote text-[var(--social-fg-muted)]">
                            {sessions.length === 0
                                ? t('tasks.noSessions')
                                : running > 0
                                    ? t('tasks.sessionCountRunning', { n: sessions.length, running })
                                    : t('tasks.sessionCount', { n: sessions.length })}
                        </span>
                    </span>
                    <ChevronDownIcon className={cn(
                        'h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform',
                        !expanded && '-rotate-90'
                    )} />
                </button>
                <IconButton label={t('tasks.more')} onClick={openMenu}>
                    <MoreHorizontalIcon className="h-5 w-5" />
                </IconButton>
            </div>
            {expanded ? (
                <div className="pb-1 pl-[3.25rem] pr-3 lg:pl-11">
                    {sessions.length === 0 ? (
                        <div className="py-2 text-footnote text-[var(--social-fg-muted)]">{t('tasks.howToAdd')}</div>
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
                            <span className="min-w-0 flex-1 truncate text-footnote text-[var(--social-fg)]">
                                {getSessionTitle(session)}
                            </span>
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

/** One-line task composer: name on the left, the tag it goes under on the right, Enter adds it. */
function TaskComposer(props: { tags: string[]; onCreate: (input: { tag: string; title: string }) => Promise<void> }) {
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
        void props.onCreate({ tag, title: trimmed })
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
                maxLength={200}
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
                        className="relative flex h-8 max-w-40 shrink-0 items-center gap-1 rounded-full bg-[var(--social-surface)] pl-3 pr-2 text-footnote text-[var(--social-fg)] after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
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
                            <span className={cn('text-body', item === tag ? 'text-[var(--social-fg)]' : 'text-transparent')} aria-hidden="true">
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
    tasks: SessionTask[]
    sessionsByTask: Map<string, SessionSummary[]>
    selectedSessionId: string | null
    onSelectSession: (sessionId: string) => void
    api: ApiClient | null
}) {
    const { t } = useTranslation()
    const { updateTask, deleteTask } = useSessionTaskActions(props.api)
    const [doneCollapsed, setDoneCollapsed] = useState(true)
    const [renaming, setRenaming] = useState<SessionTask | null>(null)
    const [deleting, setDeleting] = useState<SessionTask | null>(null)
    const [pending, setPending] = useState(false)
    const open = props.tasks.filter((task) => task.status === 'open')
    const done = props.tasks
        .filter((task) => task.status === 'done')
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))

    const renderRow = (task: SessionTask) => (
        <TaskRow
            key={task.id}
            task={task}
            sessions={props.sessionsByTask.get(task.id) ?? []}
            selectedSessionId={props.selectedSessionId}
            onSelectSession={props.onSelectSession}
            onToggleDone={() => {
                void updateTask(task.id, { status: task.status === 'done' ? 'open' : 'done' })
                    .catch((error) => console.error('Failed to update task', error))
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
                        label={t('tasks.done')}
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
                currentName={renaming?.title ?? ''}
                onRename={(title) => run(async () => {
                    if (renaming) await updateTask(renaming.id, { title })
                })}
                isPending={pending}
                title={t('tasks.rename')}
                placeholder={t('tasks.newPlaceholder')}
            />
            <ConfirmDialog
                isOpen={deleting !== null}
                onClose={() => setDeleting(null)}
                title={t('tasks.deleteTitle')}
                description={t('tasks.deleteDescription', { name: deleting?.title ?? '' })}
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
    tasks: SessionTask[]
    sessions: SessionSummary[]
    selectedSessionId: string | null
    onSelectSession: (sessionId: string) => void
    api: ApiClient | null
}) {
    const { t } = useTranslation()
    const [collapsed, setCollapsed] = useState(false)
    const sessionsByTask = useSessionsByTask(props.sessions)
    const tagTasks = props.tasks.filter((task) => task.tag === props.tag)
    const openCount = tagTasks.filter((task) => task.status === 'open').length

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
                    api={props.api}
                />
            )}
        </section>
    )
}

/** Every task, grouped by tag in the tag-filter order, with the composer on top. Tapping a tag name opens that tag's view. */
export function AllTasksView(props: {
    tasks: SessionTask[]
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
    const { createTask } = useSessionTaskActions(props.api)
    const sessionsByTask = useSessionsByTask(props.sessions)
    const tags = useMemo(() => {
        const present = new Set(props.tasks.map((task) => task.tag))
        const ordered = props.tagOrder.filter((tag) => present.has(tag))
        const rest = [...present].filter((tag) => !ordered.includes(tag)).sort((a, b) => a.localeCompare(b))
        return [...ordered, ...rest]
    }, [props.tasks, props.tagOrder])

    return (
        <div className="h-full overflow-y-auto pb-6">
            {props.header}
            <TaskComposer tags={props.tagOrder} onCreate={createTask} />
            {tags.length === 0 ? (
                props.isLoading ? (
                    <div className="px-5 py-8 text-center text-footnote text-[var(--social-fg-muted)]">{t('mobile.feed.loading')}</div>
                ) : (
                    <EmptyState variant="page" title={t('tasks.empty')} />
                )
            ) : tags.map((tag) => {
                const tagTasks = props.tasks.filter((task) => task.tag === tag)
                const openCount = tagTasks.filter((task) => task.status === 'open').length
                return (
                    <section key={tag} aria-label={`#${tag}`} className="pt-2">
                        <button
                            type="button"
                            onClick={() => props.onOpenTag(tag)}
                            className="flex min-h-11 w-full items-center gap-2 px-5 text-left text-body font-semibold text-[var(--social-fg)] lg:px-4"
                        >
                            #{tag}
                            <span className="text-footnote font-normal text-[var(--social-fg-muted)]">
                                {t('tasks.openCount', { n: openCount })}
                            </span>
                        </button>
                        <TaskList
                            tasks={tagTasks}
                            sessionsByTask={sessionsByTask}
                            selectedSessionId={props.selectedSessionId}
                            onSelectSession={props.onSelectSession}
                            api={props.api}
                        />
                    </section>
                )
            })}
        </div>
    )
}
