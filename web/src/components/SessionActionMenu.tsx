import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties
} from 'react'
import { useTranslation } from '@/lib/use-translation'

type SessionActionMenuProps = {
    isOpen: boolean
    onClose: () => void
    sessionActive: boolean
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

function EditIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            <path d="m15 5 4 4" />
        </svg>
    )
}

function ArchiveIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect width="20" height="5" x="2" y="3" rx="1" />
            <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
            <path d="M10 12h4" />
        </svg>
    )
}

function NewSessionIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M12 18v-6" />
            <path d="M9 15h6" />
        </svg>
    )
}

function DuplicateIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
    )
}

function TagIcon(props: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
            <path d="M20.59 13.41 11 3.83V3H4v7h.83l9.58 9.59a2 2 0 0 0 2.83 0l3.35-3.35a2 2 0 0 0 0-2.83Z" />
            <circle cx="7.5" cy="6.5" r=".5" fill="currentColor" />
        </svg>
    )
}

function ChevronRightIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function TrashIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" x2="10" y1="11" y2="17" />
            <line x1="14" x2="14" y1="11" y2="17" />
        </svg>
    )
}

type MenuPosition = {
    top: number
    left: number
    transformOrigin: string
}

export function SessionActionMenu(props: SessionActionMenuProps) {
    const { t } = useTranslation()
    const {
        isOpen,
        onClose,
        sessionActive,
        onRename,
        onTags,
        tags = [],
        availableTags = [],
        onTagsChange,
        tagsPending = false,
        onSpawnSameConfig,
        onDuplicate,
        onArchive,
        onDelete,
        anchorPoint,
        menuId
    } = props
    const menuRef = useRef<HTMLDivElement | null>(null)
    const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
    const [tagsSubmenuOpen, setTagsSubmenuOpen] = useState(false)
    const [submenuSide, setSubmenuSide] = useState<'left' | 'right'>('right')
    const [submenuTags, setSubmenuTags] = useState(tags)
    const submenuCloseTimer = useRef<number | null>(null)

    const cancelSubmenuClose = useCallback(() => {
        if (submenuCloseTimer.current !== null) {
            window.clearTimeout(submenuCloseTimer.current)
            submenuCloseTimer.current = null
        }
    }, [])

    const openTagsSubmenu = useCallback(() => {
        cancelSubmenuClose()
        setTagsSubmenuOpen((open) => {
            if (!open) setSubmenuTags(tags)
            return true
        })
    }, [cancelSubmenuClose, tags])

    const scheduleTagsSubmenuClose = useCallback(() => {
        cancelSubmenuClose()
        submenuCloseTimer.current = window.setTimeout(() => {
            submenuCloseTimer.current = null
            setTagsSubmenuOpen(false)
        }, 200)
    }, [cancelSubmenuClose])

    useEffect(() => cancelSubmenuClose, [cancelSubmenuClose])
    const internalId = useId()
    const resolvedMenuId = menuId ?? `session-action-menu-${internalId}`
    const headingId = `${resolvedMenuId}-heading`

    const quickSelectTags = Array.from(new Set([...availableTags, ...tags]))
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b))

    const handleRename = () => {
        onClose()
        onRename()
    }

    const handleTags = () => {
        if (!onTags) return
        onClose()
        onTags()
    }

    const handleTagsSubmenuToggle = () => {
        cancelSubmenuClose()
        setSubmenuTags(tags)
        setTagsSubmenuOpen((open) => !open)
    }

    const handleTagToggle = (tag: string) => {
        if (!onTagsChange || tagsPending) return
        const nextTags = submenuTags.includes(tag)
            ? submenuTags.filter((selectedTag) => selectedTag !== tag)
            : [...submenuTags, tag]
        setSubmenuTags(nextTags)
        void onTagsChange(nextTags).catch(() => {
            setSubmenuTags(tags)
        })
    }

    const handleArchive = () => {
        onClose()
        onArchive()
    }

    const handleSpawnSameConfig = () => {
        if (!onSpawnSameConfig) return
        onClose()
        onSpawnSameConfig()
    }

    const handleDuplicate = () => {
        if (!onDuplicate) return
        onClose()
        onDuplicate()
    }

    const handleDelete = () => {
        onClose()
        onDelete()
    }

    const updatePosition = useCallback(() => {
        const menuEl = menuRef.current
        if (!menuEl) return

        const menuRect = menuEl.getBoundingClientRect()
        const viewportWidth = window.innerWidth
        const viewportHeight = window.innerHeight
        const padding = 8
        const gap = 8

        const spaceBelow = viewportHeight - anchorPoint.y
        const spaceAbove = anchorPoint.y
        const openAbove = spaceBelow < menuRect.height + gap && spaceAbove > spaceBelow

        let top = openAbove ? anchorPoint.y - menuRect.height - gap : anchorPoint.y + gap
        let left = anchorPoint.x - menuRect.width / 2
        const transformOrigin = openAbove ? 'bottom center' : 'top center'

        top = Math.min(Math.max(top, padding), viewportHeight - menuRect.height - padding)
        left = Math.min(Math.max(left, padding), viewportWidth - menuRect.width - padding)

        setMenuPosition({ top, left, transformOrigin })
    }, [anchorPoint])

    useLayoutEffect(() => {
        if (!isOpen) return
        updatePosition()
    }, [isOpen, updatePosition])

    useEffect(() => {
        if (!isOpen) {
            setMenuPosition(null)
            setTagsSubmenuOpen(false)
            cancelSubmenuClose()
            return
        }

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node
            if (menuRef.current?.contains(target)) return
            onClose()
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose()
            }
        }

        const handleReflow = () => {
            updatePosition()
        }

        document.addEventListener('pointerdown', handlePointerDown)
        document.addEventListener('keydown', handleKeyDown)
        window.addEventListener('resize', handleReflow)
        window.addEventListener('scroll', handleReflow, true)

        return () => {
            document.removeEventListener('pointerdown', handlePointerDown)
            document.removeEventListener('keydown', handleKeyDown)
            window.removeEventListener('resize', handleReflow)
            window.removeEventListener('scroll', handleReflow, true)
        }
    }, [isOpen, onClose, updatePosition, cancelSubmenuClose])

    useLayoutEffect(() => {
        if (!tagsSubmenuOpen || !menuRef.current) return
        const menuRect = menuRef.current.getBoundingClientRect()
        setSubmenuSide(menuRect.right + 236 > window.innerWidth ? 'left' : 'right')
    }, [tagsSubmenuOpen])

    useEffect(() => {
        if (!isOpen) return

        const frame = window.requestAnimationFrame(() => {
            const firstItem = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
            firstItem?.focus()
        })

        return () => window.cancelAnimationFrame(frame)
    }, [isOpen])

    if (!isOpen) return null

    const menuStyle: CSSProperties | undefined = menuPosition
        ? {
            top: menuPosition.top,
            left: menuPosition.left,
            transformOrigin: menuPosition.transformOrigin
        }
        : undefined

    const baseItemClassName =
        'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-base transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]'

    return (
        <div
            ref={menuRef}
            className="fixed z-50 min-w-[200px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg animate-menu-pop"
            style={menuStyle}
        >
            <div
                id={headingId}
                className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]"
            >
                {t('session.more')}
            </div>
            <div
                id={resolvedMenuId}
                role="menu"
                aria-labelledby={headingId}
                className="flex flex-col gap-1"
            >
                <button
                    type="button"
                    role="menuitem"
                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                    onClick={handleRename}
                >
                    <EditIcon className="text-[var(--app-hint)]" />
                    {t('session.action.rename')}
                </button>

                {onTags ? (
                    <div
                        className="relative"
                        onMouseEnter={openTagsSubmenu}
                        onMouseLeave={scheduleTagsSubmenuClose}
                    >
                        <button
                            type="button"
                            role="menuitem"
                            aria-haspopup="menu"
                            aria-expanded={tagsSubmenuOpen}
                            className={`${baseItemClassName} justify-between hover:bg-[var(--app-subtle-bg)]`}
                            onClick={handleTagsSubmenuToggle}
                            onFocus={openTagsSubmenu}
                        >
                            <span className="flex min-w-0 items-center gap-3">
                                <TagIcon className="text-[var(--app-hint)]" />
                                {t('session.action.tags')}
                            </span>
                            <ChevronRightIcon className="h-4 w-4 shrink-0 text-[var(--app-hint)]" />
                        </button>

                        {tagsSubmenuOpen ? (
                            // pl/pr hover bridge covers the gap so the pointer never leaves the wrapper mid-crossing
                            <div className={`absolute top-0 z-10 ${submenuSide === 'right' ? 'left-full pl-2' : 'right-full pr-2'}`}>
                            <div
                                role="menu"
                                aria-label={t('session.action.tags')}
                                className="min-w-[220px] rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-1 shadow-lg"
                            >
                                <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--app-hint)]">
                                    {t('session.action.tags')}
                                </div>
                                {quickSelectTags.length ? quickSelectTags.map((tag) => {
                                    const isSelected = submenuTags.includes(tag)
                                    return (
                                        <button
                                            key={tag}
                                            type="button"
                                            role="menuitemcheckbox"
                                            aria-checked={isSelected}
                                            disabled={!onTagsChange || tagsPending}
                                            className={`${baseItemClassName} justify-between hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50`}
                                            onClick={() => handleTagToggle(tag)}
                                        >
                                            <span>#{tag}</span>
                                            <span className={`text-sm ${isSelected ? 'text-[var(--app-link)]' : 'text-transparent'}`} aria-hidden="true">
                                                ✓
                                            </span>
                                        </button>
                                    )
                                }) : (
                                    <div className="px-3 py-2 text-sm text-[var(--app-hint)]">
                                        {t('session.action.noTags')}
                                    </div>
                                )}
                                <div className="my-1 border-t border-[var(--app-divider)]" />
                                <button
                                    type="button"
                                    role="menuitem"
                                    className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                                    onClick={handleTags}
                                >
                                    <EditIcon className="text-[var(--app-hint)]" />
                                    {t('session.action.editTags')}
                                </button>
                            </div>
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {onSpawnSameConfig ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleSpawnSameConfig}
                    >
                        <NewSessionIcon className="text-[var(--app-hint)]" />
                        {t('session.action.newSameConfig')}
                    </button>
                ) : null}

                {onDuplicate ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} hover:bg-[var(--app-subtle-bg)]`}
                        onClick={handleDuplicate}
                    >
                        <DuplicateIcon className="text-[var(--app-hint)]" />
                        {t('session.action.duplicate')}
                    </button>
                ) : null}

                {sessionActive ? (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} text-red-500 hover:bg-red-500/10`}
                        onClick={handleArchive}
                    >
                        <ArchiveIcon className="text-red-500" />
                        {t('session.action.archive')}
                    </button>
                ) : (
                    <button
                        type="button"
                        role="menuitem"
                        className={`${baseItemClassName} text-red-500 hover:bg-red-500/10`}
                        onClick={handleDelete}
                    >
                        <TrashIcon className="text-red-500" />
                        {t('session.action.delete')}
                    </button>
                )}
            </div>
        </div>
    )
}
