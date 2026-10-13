import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { FormField } from '@/components/ui/FormControls'
import { CONTEXT_MENU_SURFACE, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { cn } from '@/lib/utils'
import { ChevronDownIcon } from '@/components/mobile/icons'
import { useTranslation } from '@/lib/use-translation'

/** "/Users/me/projects/app" → "~/projects/app", so chips show the part that differs. */
function shortenHomePath(path: string): string {
    return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
}

export function DirectorySection(props: {
    directory: string
    suggestions: readonly Suggestion[]
    selectedIndex: number
    isDisabled: boolean
    recentPaths: string[]
    onDirectoryChange: (value: string) => void
    onDirectoryFocus: () => void
    onDirectoryBlur: () => void
    onDirectoryKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => void
    onSuggestionSelect: (index: number) => void
    onPathClick: (path: string) => void
}) {
    const { t } = useTranslation()
    const id = useId()
    const wrapperRef = useRef<HTMLDivElement>(null)
    const [recentOpen, setRecentOpen] = useState(false)
    const hasRecent = props.recentPaths.length > 0

    useEffect(() => {
        if (!recentOpen) return
        const close = (event: PointerEvent) => {
            if (!wrapperRef.current?.contains(event.target as Node)) setRecentOpen(false)
        }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
    }, [recentOpen])

    return (
        <FormField label={t('newSession.directory')} htmlFor={id}>
            <div ref={wrapperRef} className="relative">
                <input
                    id={id}
                    type="text"
                    placeholder={t('newSession.placeholder')}
                    value={props.directory}
                    onChange={(event) => props.onDirectoryChange(event.target.value)}
                    onKeyDown={props.onDirectoryKeyDown}
                    onFocus={props.onDirectoryFocus}
                    onBlur={props.onDirectoryBlur}
                    disabled={props.isDisabled}
                    className={`${DIALOG_INPUT_CLASS} disabled:opacity-50${hasRecent ? ' pr-11' : ''}`}
                />
                {hasRecent ? (
                    <button
                        type="button"
                        aria-label={t('newSession.recent')}
                        aria-expanded={recentOpen}
                        title={t('newSession.recent')}
                        disabled={props.isDisabled}
                        onClick={() => setRecentOpen((open) => !open)}
                        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[var(--social-fg-subtle)] transition-colors hover:bg-[var(--social-hover)] disabled:opacity-50"
                    >
                        <ChevronDownIcon className={`h-4 w-4 transition-transform ${recentOpen ? 'rotate-180' : ''}`} />
                    </button>
                ) : null}
                {props.suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-10 mt-1">
                        <FloatingOverlay maxHeight={200}>
                            <Autocomplete
                                suggestions={props.suggestions}
                                selectedIndex={props.selectedIndex}
                                onSelect={props.onSuggestionSelect}
                            />
                        </FloatingOverlay>
                    </div>
                )}
                {recentOpen && props.suggestions.length === 0 ? (
                    <div className={cn('absolute left-0 right-0 top-full z-10 mt-1 max-h-[220px] overflow-y-auto', CONTEXT_MENU_SURFACE)}>
                        {props.recentPaths.map((path) => (
                            <ContextMenuItem
                                key={path}
                                label={shortenHomePath(path)}
                                onSelect={() => {
                                    props.onPathClick(path)
                                    setRecentOpen(false)
                                }}
                            />
                        ))}
                    </div>
                ) : null}
            </div>
        </FormField>
    )
}
