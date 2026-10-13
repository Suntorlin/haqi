import { useId, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { FormField } from '@/components/ui/FormControls'
import { InputHistory } from '@/components/ui/InputHistory'
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
    const hasRecent = props.recentPaths.length > 0

    return (
        <FormField label={t('newSession.directory')} htmlFor={id}>
            <InputHistory
                items={props.recentPaths}
                label={t('newSession.recent')}
                disabled={props.isDisabled}
                format={shortenHomePath}
                suppressed={props.suggestions.length > 0}
                onPick={props.onPathClick}
            >
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
            </InputHistory>
        </FormField>
    )
}
