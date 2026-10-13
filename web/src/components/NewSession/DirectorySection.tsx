import { useId, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { FormField, SuggestionChip } from '@/components/ui/FormControls'
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

    return (
        <FormField label={t('newSession.directory')} htmlFor={id}>
            <div className="relative">
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
                    className={`${DIALOG_INPUT_CLASS} disabled:opacity-50`}
                />
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
            </div>

            {props.recentPaths.length > 0 && (
                <div className="flex flex-col gap-1.5 pt-1">
                    <span className="px-1 text-[12px] text-[var(--social-fg-subtle)]">{t('newSession.recent')}</span>
                    <div className="flex flex-wrap gap-1.5">
                        {props.recentPaths.map((path) => (
                            <SuggestionChip
                                key={path}
                                label={shortenHomePath(path)}
                                title={path}
                                disabled={props.isDisabled}
                                onClick={() => props.onPathClick(path)}
                            />
                        ))}
                    </div>
                </div>
            )}
        </FormField>
    )
}
