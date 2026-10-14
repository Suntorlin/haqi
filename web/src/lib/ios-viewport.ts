// iOS ignores `interactive-widget=resizes-content`: opening the keyboard shrinks only the *visual*
// viewport and pans the page, so the composer ended up under the keyboard's suggestion bar with the header
// scrolled away, and a stale height could leave a blank band under the tab bar. On iOS the app root follows
// the visual viewport instead (height and offset), and the bottom safe area is dropped while the keyboard
// covers the home indicator.
const KEYBOARD_MIN_PX = 120

export function isIOSDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
}

export function installIOSViewportFit(): void {
    const vv = window.visualViewport
    if (!isIOSDevice() || !vv) {
        return
    }

    const root = document.documentElement
    root.classList.add('ios-vv')

    const isStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
        || window.matchMedia('(display-mode: standalone)').matches

    let frame = 0
    const apply = () => {
        frame = 0
        const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_MIN_PX
        let height = vv.height
        if (isStandalone && !keyboardOpen) {
            // A home-screen app owns the whole screen. innerHeight can come up short of it (blank band
            // under the tab bar), so fill the screen when no keyboard is covering part of it.
            const portrait = window.innerHeight >= window.innerWidth
            const screenHeight = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width)
            height = Math.max(height, screenHeight)
        }
        root.style.setProperty('--app-height', `${Math.round(height)}px`)
        root.style.setProperty('--app-top', `${Math.round(vv.offsetTop)}px`)
        root.dataset.keyboard = keyboardOpen ? 'open' : 'closed'
    }
    const schedule = () => {
        if (!frame) frame = window.requestAnimationFrame(apply)
    }

    vv.addEventListener('resize', schedule)
    vv.addEventListener('scroll', schedule)
    window.addEventListener('orientationchange', schedule)
    apply()
}
