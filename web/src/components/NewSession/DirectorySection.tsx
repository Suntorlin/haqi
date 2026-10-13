import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { FormField } from '@/components/ui/FormControls'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'
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
                <TextField
                    id={id}
                    type="text"
                    placeholder={t('newSession.placeholder')}
                    value={props.directory}
                    onChange={(event) => props.onDirectoryChange(event.target.value)}
                    onKeyDown={props.onDirectoryKeyDown}
                    onFocus={props.onDirectoryFocus}
                    onBlur={props.onDirectoryBlur}
                    disabled={props.isDisabled}
                    trailing={hasRecent ? (
                        <IconButton
                            size="sm"
                            label={t('newSession.recent')}
                            aria-expanded={recentOpen}
                            disabled={props.isDisabled}
                            onClick={() => setRecentOpen((open) => !open)}
                            className="text-[var(--social-fg-subtle)]"
                        >
                            <ChevronDownIcon className={`h-4 w-4 transition-transform ${recentOpen ? 'rotate-180' : ''}`} />
                        </IconButton>
                    ) : undefined}
                />
                {recentOpen && hasRecent ? (
                    <ul className="absolute left-0 right-0 top-full z-10 mt-1 max-h-[260px] overflow-y-auto rounded-2xl border border-[var(--social-border)] bg-[var(--app-bg)] p-1.5 shadow-lg">
                        {props.recentPaths.map((path) => (
                            <li key={path}>
                                <button
                                    type="button"
                                    title={path}
                                    onClick={() => {
                                        setRecentOpen(false)
                                        props.onPathClick(path)
                                    }}
                                    className="block min-h-11 w-full truncate rounded-xl px-3 text-left text-[15px] text-[var(--social-fg)] transition-colors hover:bg-[var(--social-hover)]"
                                >
                                    {shortenHomePath(path)}
                                </button>
                            </li>
                        ))}
                    </ul>
                ) : null}
                {props.suggestions.length > 0 && !recentOpen && (
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
            </div>

        </FormField>
    )
}
