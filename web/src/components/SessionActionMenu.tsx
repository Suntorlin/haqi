import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import { CONTEXT_MENU_SURFACE, ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/mobile/ContextMenu'
import {
    ArchiveBoxIcon,
    ChevronRightIcon,
    DuplicateIcon,
    MoonIcon,
    NewSessionIcon,
    PencilIcon,
    PinIcon,
    PinOffIcon,
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
    /** Set to offer "snooze…" right after the pin action. */
    onSnooze?: () => void
    /** Set while snoozed: offers "wake up", with the wake time as its second line. */
    onUnsnooze?: () => void
    snoozeWakeLabel?: string
    onRename: () => void
    onTags?: () => void
    tags?: string[]
    availableTags?: string[]
    onTagsChange?: (tags: string[]) => Promise<void>
    tagsPending?: boolean
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

export function SessionActionMenu(props: SessionActionMenuProps) {
    const { t } = useTranslation()
    const isMobileLayout = useIsMobileLayout()
    const { isOpen, onClose, onTags } = props
    const [tagsOpen, setTagsOpen] = useState(false)
    const [submenuPos, setSubmenuPos] = useState<{ top: number; left?: number; right?: number } | null>(null)
    const tagsWrapperRef = useRef<HTMLDivElement | null>(null)
    const closeTimer = useRef<number | null>(null)

    const cancelClose = useCallback(() => {
        if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current)
            closeTimer.current = null
        }
    }, [])

    useEffect(() => {
        if (!isOpen) {
            setTagsOpen(false)
            cancelClose()
        }
    }, [isOpen, cancelClose])
    useEffect(() => cancelClose, [cancelClose])

    // The flyout is portalled to the body: the menu itself scrolls when tall, which would clip a child
    // positioned outside it. Placed beside the "tags" row, flipped to the left near the window edge.
    useLayoutEffect(() => {
        if (!tagsOpen || !tagsWrapperRef.current) {
            setSubmenuPos(null)
            return
        }
        const rect = tagsWrapperRef.current.getBoundingClientRect()
        const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - 320))
        setSubmenuPos(rect.right + 236 > window.innerWidth
            ? { top, right: window.innerWidth - rect.left + 8 }
            : { top, left: rect.right + 8 })
    }, [tagsOpen])

    const run = (action?: () => void) => () => {
        if (!action) return
        onClose()
        action()
    }

    // Phones open the tags sheet directly: a side flyout would not fit next to the menu.
    const tagsItem = onTags ? (isMobileLayout ? (
        <ContextMenuItem icon={<TagIcon />} label={t('session.action.tags')} onSelect={run(onTags)} />
    ) : (
        <div
            ref={tagsWrapperRef}
            className="relative"
            onMouseEnter={() => {
                cancelClose()
                setTagsOpen(true)
            }}
            onMouseLeave={() => {
                cancelClose()
                closeTimer.current = window.setTimeout(() => setTagsOpen(false), 200)
            }}
        >
            <ContextMenuItem
                icon={<TagIcon />}
                label={t('session.action.tags')}
                hasPopup
                expanded={tagsOpen}
                onSelect={() => setTagsOpen((open) => !open)}
                onFocus={() => setTagsOpen(true)}
                trailing={<ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--social-fg-subtle)]" />}
            />
            {tagsOpen && submenuPos ? createPortal(
                <div data-context-submenu className="fixed z-[60]" style={submenuPos}>
                    <TagsSubmenu
                        tags={props.tags ?? []}
                        availableTags={props.availableTags ?? []}
                        pending={props.tagsPending ?? false}
                        onTagsChange={props.onTagsChange}
                        onEdit={onTags}
                        onClose={onClose}
                    />
                </div>,
                document.body
            ) : null}
        </div>
    )) : null

    return (
        <ContextMenu open={isOpen} anchorPoint={props.anchorPoint} onClose={onClose} label={t('session.more')} menuId={props.menuId}>
            {props.onTogglePin ? (
                <ContextMenuItem
                    icon={props.pinned ? <PinOffIcon /> : <PinIcon />}
                    label={props.pinned ? t('session.action.unpin') : t('session.action.pin')}
                    onSelect={run(props.onTogglePin)}
                />
            ) : null}
            {props.onUnsnooze ? (
                <ContextMenuItem
                    icon={<SunIcon />}
                    label={t('session.action.unsnooze')}
                    description={props.snoozeWakeLabel ? t('session.snooze.wakesAt', { time: props.snoozeWakeLabel }) : undefined}
                    onSelect={run(props.onUnsnooze)}
                />
            ) : props.onSnooze ? (
                <ContextMenuItem icon={<MoonIcon />} label={t('session.action.snooze')} onSelect={run(props.onSnooze)} />
            ) : null}
            <ContextMenuItem icon={<PencilIcon />} label={t('session.action.rename')} onSelect={run(props.onRename)} />
            {tagsItem}
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
