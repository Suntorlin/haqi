import { memo, useEffect, useRef } from 'react'
import { ContextMenuItem } from '@/components/mobile/ContextMenu'
import type { Suggestion } from '@/hooks/useActiveSuggestions'

interface AutocompleteProps {
    suggestions: readonly Suggestion[]
    selectedIndex: number
    onSelect: (index: number) => void
}

/**
 * Autocomplete suggestions list: menu rows, the keyboard-selected row is highlighted.
 */
export const Autocomplete = memo(function Autocomplete(props: AutocompleteProps) {
    const { suggestions, selectedIndex, onSelect } = props
    const listRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (selectedIndex < 0 || selectedIndex >= suggestions.length) return
        const listEl = listRef.current
        if (!listEl) return
        listEl.children[selectedIndex]?.scrollIntoView({ block: 'nearest' })
    }, [selectedIndex, suggestions])

    if (suggestions.length === 0) {
        return null
    }

    return (
        <div
            ref={listRef}
            role="menu"
            className="flex flex-col"
            // Keep focus in the text field: a click on a row must not blur it.
            onMouseDown={(e) => e.preventDefault()}
        >
            {suggestions.map((suggestion, index) => (
                <ContextMenuItem
                    key={suggestion.key}
                    label={suggestion.label}
                    description={suggestion.description}
                    wrapDescription
                    active={index === selectedIndex}
                    onSelect={() => onSelect(index)}
                />
            ))}
        </div>
    )
})
