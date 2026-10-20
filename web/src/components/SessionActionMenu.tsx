import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import type { SessionTask } from '@/types/api'
import { formatSnoozeWake, getSnoozePresets } from '@/lib/session-snooze'
import { CONTEXT_MENU_SURFACE, ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/mobile/ContextMenu'
import {
    ArchiveBoxIcon,
    ChevronDownIcon,
    ChevronRightIcon,
    DuplicateIcon,
    MoonIcon,
    NewSessionIcon,
    PencilIcon,
    PinIcon,
    PinOffIcon,
    QueueListIcon,
    SunIcon,
    TagIcon,
    TrashIcon
} from '@/components/mobile/icons'

type SessionActionMenuProps = {
    isOpen: boolean
    onClose: () => void
    sessionActive: boolean
    /** Set to offer "pin to top" / "unpin" as the first action. */
    pinned?: boolean
    onTogglePin?: () => void
    /** Set to offer "snooze" (a submenu of wake times) right after the pin action. */
    onSnooze?: (until: number) => void
    /** "Custom time…" at the end of the snooze submenu. */
    onSnoozeCustom?: () => void
    /** Set while snoozed: offers "wake up", with `snoozeStatus` (when it comes back) as its second line. */
    onUnsnooze?: () => void
    snoozeStatus?: string
    onRename: () => void
    onTags?: () => void
    tags?: string[]
    availableTags?: string[]
    onTagsChange?: (tags: string[]) => Promise<void>
    tagsPending?: boolean
    /** Open tasks offered under "Task"; the checked ones are those in `taskIds`. */
    tasks?: SessionTask[]
    taskIds?: string[]
    onTaskToggle?: (task: SessionTask, linked: boolean) => void
    onSpawnSameConfig?: () => void
    onDuplicate?: () => void
    onArchive: () => void
    onDelete: () => void
    anchorPoint: { x: number; y: number }
    menuId?: string
}

/** Desktop "manage tags" flyout: quick toggles next to the menu, plus "edit tags…". */
function TagsSubmenu(props: {
    tags: string[]
    availableTags: string[]
    pending: boolean
    onTagsChange?: (tags: string[]) => Promise<void>
    onEdit: () => void
    onClose: () => void
}) {
    const { t } = useTranslation()
    const [selected, setSelected] = useState(props.tags)
    const quickSelectTags = Array.from(new Set([...props.availableTags, ...props.tags]))
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))

    const toggle = (tag: string) => {
        if (!props.onTagsChange || props.pending) return
        const next = selected.includes(tag) ? selected.filter((item) => item !== tag) : [...selected, tag]
        setSelected(next)
        void props.onTagsChange(next).catch(() => setSelected(props.tags))
    }

    return (
        <div role="menu" aria-label={t('session.action.tags')} className={cn('flex min-w-[220px] flex-col', CONTEXT_MENU_SURFACE)}>
            {quickSelectTags.length ? quickSelectTags.map((tag) => (
                <ContextMenuItem
                    key={tag}
                    label={`#${tag}`}
                    checked={selected.includes(tag)}
                    disabled={!props.onTagsChange || props.pending}
                    onSelect={() => toggle(tag)}
                    trailing={(
                        <span className={cn('text-[15px]', selected.includes(tag) ? 'text-[var(--social-fg)]' : 'text-transparent')} aria-hidden="true">
                            ✓
                        </span>
                    )}
                />
            )) : (
                <div className="px-3 py-2.5 text-[15px] text-[var(--social-fg-muted)]">{t('session.action.noTags')}</div>
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
                icon={<PencilIcon />}
                label={t('session.action.editTags')}
                onSelect={() => {
                    props.onClose()
                    props.onEdit()
                }}
            />
        </div>
    )
}

/** Task choices: tapping one joins the session to it, or takes it out. */
function TaskOptions(props: {
    tasks: SessionTask[]
    taskIds: string[]
    onToggle: (task: SessionTask, linked: boolean) => void
    indent?: boolean
}) {
    const { t } = useTranslation()
    const spacer = props.indent ? <span aria-hidden="true" /> : undefined
    if (props.tasks.length === 0) {
        return <div className="px-3 py-2.5 text-[15px] text-[var(--social-fg-muted)]">{t('session.action.noTasks')}</div>
    }
    return (
        <>
            {props.tasks.map((task) => {
                const linked = props.taskIds.includes(task.id)
                return (
                    <ContextMenuItem
                        key={task.id}
                        icon={spacer}
                        label={task.title}
                        description={`#${task.tag}`}
                        checked={linked}
                        onSelect={() => props.onToggle(task, !linked)}
                        trailing={(
                            <span className={cn('text-[15px]', linked ? 'text-[var(--social-fg)]' : 'text-transparent')} aria-hidden="true">
                                ✓
                            </span>
                        )}
                    />
                )
            })}
        </>
    )
}

/** Desktop row that opens a side flyout on hover or click. */
function FlyoutItem(props: {
    icon: ReactNode
    label: ReactNode
    open: boolean
    onOpenChange: (open: boolean) => void
    children: ReactNode
}) {
    const { open, onOpenChange } = props
    const [position, setPosition] = useState<{ top: number; left?: number; right?: number } | null>(null)
    const wrapperRef = useRef<HTMLDivElement | null>(null)
    const closeTimer = useRef<number | null>(null)

    const cancelClose = useCallback(() => {
        if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current)
            closeTimer.current = null
        }
    }, [])
    useEffect(() => cancelClose, [cancelClose])

    // The flyout is portalled to the body: the menu itself scrolls when tall, which would clip a child
    // positioned outside it. Placed beside the row, flipped to the left near the window edge.
    useLayoutEffect(() => {
        if (!open || !wrapperRef.current) {
            setPosition(null)
            return
        }
        const rect = wrapperRef.current.getBoundingClientRect()
        const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - 320))
        setPosition(rect.right + 236 > window.innerWidth
            ? { top, right: window.innerWidth - rect.left + 8 }
            : { top, left: rect.right + 8 })
    }, [open])

    return (
        <div
            ref={wrapperRef}
            className="relative"
            onMouseEnter={() => {
                cancelClose()
                onOpenChange(true)
            }}
            onMouseLeave={() => {
                cancelClose()
                closeTimer.current = window.setTimeout(() => onOpenChange(false), 200)
            }}
        >
            <ContextMenuItem
                icon={props.icon}
                label={props.label}
                hasPopup
                expanded={open}
                onSelect={() => onOpenChange(!open)}
                onFocus={() => onOpenChange(true)}
                trailing={<ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--social-fg-subtle)]" />}
            />
            {open && position ? createPortal(
                <div data-context-submenu className="fixed z-[60]" style={position}>
                    {props.children}
                </div>,
                document.body
            ) : null}
        </div>
    )
}

/** Wake-time choices; `indent` lines them up under the parent row when shown inline on phones. */
export function SnoozeOptions(props: { onSnooze: (until: number) => void; onCustom?: () => void; indent?: boolean }) {
    const { t, locale } = useTranslation()
    const now = Date.now()
    const spacer = props.indent ? <span aria-hidden="true" /> : undefined
    return (
        <>
            {getSnoozePresets(new Date(now)).map((preset) => (
                <ContextMenuItem
                    key={preset.key}
                    icon={spacer}
                    label={t(`dialog.snooze.${preset.key}`)}
                    trailing={(
                        <span className="shrink-0 text-[13px] text-[var(--social-fg-muted)]">
                            {formatSnoozeWake(preset.until, now, locale, t)}
                        </span>
                    )}
                    onSelect={() => props.onSnooze(preset.until)}
                />
            ))}
            {props.onCustom ? (
                <ContextMenuItem icon={spacer} label={t('dialog.snooze.custom')} onSelect={props.onCustom} />
            ) : null}
        </>
    )
}

export function SessionActionMenu(props: SessionActionMenuProps) {
    const { t } = useTranslation()
    const isMobileLayout = useIsMobileLayout()
    const { isOpen, onClose, onTags, onSnooze } = props
    const [flyout, setFlyout] = useState<'tags' | 'snooze' | 'task' | null>(null)
    const [snoozeExpanded, setSnoozeExpanded] = useState(false)
    const [taskExpanded, setTaskExpanded] = useState(false)

    useEffect(() => {
        if (!isOpen) {
            setFlyout(null)
            setSnoozeExpanded(false)
            setTaskExpanded(false)
        }
    }, [isOpen])

    const flyoutProps = (id: 'tags' | 'snooze' | 'task') => ({
        open: flyout === id,
        onOpenChange: (open: boolean) => setFlyout((current) => open ? id : current === id ? null : current)
    })

    const run = (action?: () => void) => () => {
        if (!action) return
        onClose()
        action()
    }

    // Phones open the tags sheet directly: a side flyout would not fit next to the menu.
    const tagsItem = onTags ? (isMobileLayout ? (
        <ContextMenuItem icon={<TagIcon />} label={t('session.action.tags')} onSelect={run(onTags)} />
    ) : (
        <FlyoutItem icon={<TagIcon />} label={t('session.action.tags')} {...flyoutProps('tags')}>
            <TagsSubmenu
                tags={props.tags ?? []}
                availableTags={props.availableTags ?? []}
                pending={props.tagsPending ?? false}
                onTagsChange={props.onTagsChange}
                onEdit={onTags}
                onClose={onClose}
            />
        </FlyoutItem>
    )) : null

    const snooze = (until: number) => run(() => onSnooze?.(until))()
    const snoozeCustom = props.onSnoozeCustom ? run(props.onSnoozeCustom) : undefined
    // Phones expand the wake times in place, under the row; desktop shows them in a flyout.
    const snoozeItem = props.onUnsnooze ? (
        <ContextMenuItem
            icon={<SunIcon />}
            label={t('session.action.unsnooze')}
            description={props.snoozeStatus}
            onSelect={run(props.onUnsnooze)}
        />
    ) : !onSnooze ? null : isMobileLayout ? (
        <>
            <ContextMenuItem
                icon={<MoonIcon />}
                label={t('session.action.snooze')}
                hasPopup
                expanded={snoozeExpanded}
                onSelect={() => setSnoozeExpanded((expanded) => !expanded)}
                trailing={(
                    <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', snoozeExpanded ? 'rotate-180' : '')} />
                )}
            />
            {snoozeExpanded ? <SnoozeOptions onSnooze={snooze} onCustom={snoozeCustom} indent /> : null}
        </>
    ) : (
        <FlyoutItem icon={<MoonIcon />} label={t('session.action.snooze')} {...flyoutProps('snooze')}>
            <div role="menu" aria-label={t('session.action.snooze')} className={cn('flex min-w-[240px] flex-col', CONTEXT_MENU_SURFACE)}>
                <SnoozeOptions onSnooze={snooze} />
                {snoozeCustom ? (
                    <>
                        <ContextMenuSeparator />
                        <ContextMenuItem label={t('dialog.snooze.custom')} onSelect={snoozeCustom} />
                    </>
                ) : null}
            </div>
        </FlyoutItem>
    )

    // Same pattern as snooze: inline on phones, a flyout on desktop. The menu stays open so several tasks can be ticked.
    const onTaskToggle = props.onTaskToggle
    const taskItem = !onTaskToggle ? null : isMobileLayout ? (
        <>
            <ContextMenuItem
                icon={<QueueListIcon />}
                label={t('session.action.task')}
                hasPopup
                expanded={taskExpanded}
                onSelect={() => setTaskExpanded((expanded) => !expanded)}
                trailing={(
                    <ChevronDownIcon className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', taskExpanded ? 'rotate-180' : '')} />
                )}
            />
            {taskExpanded ? <TaskOptions tasks={props.tasks ?? []} taskIds={props.taskIds ?? []} onToggle={onTaskToggle} indent /> : null}
        </>
    ) : (
        <FlyoutItem icon={<QueueListIcon />} label={t('session.action.task')} {...flyoutProps('task')}>
            <div role="menu" aria-label={t('session.action.task')} className={cn('flex min-w-[240px] max-w-[320px] flex-col', CONTEXT_MENU_SURFACE)}>
                <TaskOptions tasks={props.tasks ?? []} taskIds={props.taskIds ?? []} onToggle={onTaskToggle} />
            </div>
        </FlyoutItem>
    )

    return (
        <ContextMenu open={isOpen} anchorPoint={props.anchorPoint} onClose={onClose} label={t('session.more')} menuId={props.menuId}>
            {props.onTogglePin ? (
                <ContextMenuItem
                    icon={props.pinned ? <PinOffIcon /> : <PinIcon />}
                    label={props.pinned ? t('session.action.unpin') : t('session.action.pin')}
                    onSelect={run(props.onTogglePin)}
                />
            ) : null}
            {snoozeItem}
            <ContextMenuItem icon={<PencilIcon />} label={t('session.action.rename')} onSelect={run(props.onRename)} />
            {tagsItem}
            {taskItem}
            {props.onSpawnSameConfig ? (
                <ContextMenuItem icon={<NewSessionIcon />} label={t('session.action.newSameConfig')} onSelect={run(props.onSpawnSameConfig)} />
            ) : null}
            {props.onDuplicate ? (
                <ContextMenuItem icon={<DuplicateIcon />} label={t('session.action.duplicate')} onSelect={run(props.onDuplicate)} />
            ) : null}
            <ContextMenuSeparator />
            {props.sessionActive ? (
                <ContextMenuItem icon={<ArchiveBoxIcon />} label={t('session.action.archive')} destructive onSelect={run(props.onArchive)} />
            ) : (
                <ContextMenuItem icon={<TrashIcon />} label={t('session.action.delete')} destructive onSelect={run(props.onDelete)} />
            )}
        </ContextMenu>
    )
}
