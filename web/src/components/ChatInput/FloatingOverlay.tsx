import { memo, ReactNode } from 'react'
import { CONTEXT_MENU_SURFACE } from '@/components/mobile/ContextMenu'

interface FloatingOverlayProps {
    children: ReactNode
    maxHeight?: number
}

/**
 * Floating list above or below a text field (autocomplete, slash commands, @ mentions).
 * Same surface as context menus; the surface itself scrolls.
 */
export const FloatingOverlay = memo(function FloatingOverlay(props: FloatingOverlayProps) {
    const { children, maxHeight = 240 } = props

    return (
        <div className={CONTEXT_MENU_SURFACE} style={{ maxHeight }}>
            {children}
        </div>
    )
})
