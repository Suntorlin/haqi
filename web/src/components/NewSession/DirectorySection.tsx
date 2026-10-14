import { useId, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Suggestion } from '@/hooks/useActiveSuggestions'
import { Autocomplete } from '@/components/ChatInput/Autocomplete'
import { FloatingOverlay } from '@/components/ChatInput/FloatingOverlay'
import { FormField } from '@/components/ui/FormControls'
import { InputHistory } from '@/components/ui/InputHistory'
import { TextField } from '@/components/ui/TextField'
import { useTranslation } from '@/lib/use-translation'

/** "/Users/me/projects/app" → "~/projects/app", so chips show the part that differs. */
export function shortenHomePath(path: string): string {
    return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
}

export type DirectorySectionProps = {
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
    /** The picker above already names this field; skip the caption. */
    hideLabel?: boolean
    autoFocus?: boolean
}

export function DirectorySection(props: DirectorySectionProps) {
    const { t } = useTranslation()
    const id = useId()

    const field = (
            <InputHistory
                items={props.recentPaths}
                label={t('newSession.recent')}
                disabled={props.isDisabled}
                format={shortenHomePath}
                onPick={props.onPathClick}
            >
                {({ trailing, open }) => (
                    <>
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
                            autoFocus={props.autoFocus}
                            trailing={trailing}
                        />
                        {props.suggestions.length > 0 && !open && (
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
                    </>
                )}
            </InputHistory>
    )

    return props.hideLabel ? field : <FormField label={t('newSession.directory')} htmlFor={id}>{field}</FormField>
}
