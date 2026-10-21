import { useEffect, useState } from 'react'
import type { TaskView } from '@/types/api'
import { isTaskOpen } from '@/lib/tasks'
import { BottomSheet, SheetNote, SheetSection } from '@/components/mobile/BottomSheet'
import { MobileSearchField } from '@/components/mobile/MobileSearchField'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

/**
 * Phone "Task" picker: a sheet instead of rows expanded inside the menu, so a long task list
 * scrolls and can be searched. Tasks are grouped by tag in the order given (the session's own
 * tags first); tapping one joins the session to it or takes it out, and the sheet stays open.
 */
export function SessionTaskSheet(props: {
    open: boolean
    onOpenChange: (open: boolean) => void
    tasks: TaskView[]
    taskIds: string[]
    onToggle: (task: TaskView, linked: boolean) => void
}) {
    const { t } = useTranslation()
    const [query, setQuery] = useState('')

    useEffect(() => {
        if (!props.open) setQuery('')
    }, [props.open])

    const needle = query.trim().toLowerCase().replace(/^#/, '')
    const matches = needle
        ? props.tasks.filter((task) => task.name.toLowerCase().includes(needle) || task.tag.toLowerCase().includes(needle))
        : props.tasks
    const groups = new Map<string, TaskView[]>()
    for (const task of matches) {
        groups.set(task.tag, [...(groups.get(task.tag) ?? []), task])
    }

    return (
        <BottomSheet open={props.open} onOpenChange={props.onOpenChange} title={t('session.action.task')} noAutoFocus>
            {props.tasks.length === 0 ? (
                <SheetNote>{t('session.action.noTasks')}</SheetNote>
            ) : (
                <>
                    <div className="sticky top-0 z-10 bg-[var(--social-surface)] px-4 pb-3">
                        <MobileSearchField value={query} onChange={setQuery} placeholder={t('session.action.searchTasks')} />
                    </div>
                    {groups.size === 0 ? <SheetNote>{t('session.action.noMatchingTasks')}</SheetNote> : null}
                    {Array.from(groups, ([tag, tasks]) => (
                        <SheetSection key={tag} title={`#${tag}`}>
                            {tasks.map((task) => {
                                const linked = props.taskIds.includes(task.id)
                                return (
                                    <button
                                        key={task.id}
                                        type="button"
                                        role="checkbox"
                                        aria-checked={linked}
                                        onClick={() => props.onToggle(task, !linked)}
                                        className="social-pressable flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left [&+&]:border-t [&+&]:border-[var(--social-border)]"
                                    >
                                        <span className={cn('min-w-0 flex-1 truncate text-[15px]', linked ? 'font-semibold' : '', !isTaskOpen(task) ? 'text-[var(--social-fg-muted)]' : 'text-[var(--social-fg)]')}>
                                            {task.name}
                                        </span>
                                        <svg
                                            viewBox="0 0 24 24"
                                            className={cn('h-[18px] w-[18px] shrink-0 transition-opacity', linked ? 'opacity-100' : 'opacity-0')}
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2.4"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            aria-hidden="true"
                                        >
                                            <polyline points="5 12.5 10 17.5 19 7" />
                                        </svg>
                                    </button>
                                )
                            })}
                        </SheetSection>
                    ))}
                    <div className="h-2" aria-hidden="true" />
                </>
            )}
        </BottomSheet>
    )
}
