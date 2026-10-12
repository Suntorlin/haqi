import { useSyncExternalStore } from 'react'

// Matches the `lg` breakpoint where the desktop sidebar layout kicks in.
const MOBILE_LAYOUT_QUERY = '(max-width: 1023px)'

function subscribe(onChange: () => void): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return () => {}
    }
    const mediaQuery = window.matchMedia(MOBILE_LAYOUT_QUERY)
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
}

function getSnapshot(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return false
    }
    return window.matchMedia(MOBILE_LAYOUT_QUERY).matches
}

/** True when the viewport uses the single-pane mobile layout (social-style UI). */
export function useIsMobileLayout(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
