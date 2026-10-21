import { useEffect, useState } from 'react'
import type { TaskView } from '@/types/api'
import { isTaskOpen } from '@/lib/tasks'
import { BottomSheet, SheetNote, SheetOption, SheetSection } from '@/components/mobile/BottomSheet'
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
                                    <SheetOption
                                        key={task.id}
                                        multiple
                                        selected={linked}
                                        onSelect={() => props.onToggle(task, !linked)}
                                        label={(
                                            <span className={cn('block truncate', !isTaskOpen(task) ? 'text-[var(--social-fg-muted)]' : null)}>
                                                {task.name}
                                            </span>
                                        )}
                                    />
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
