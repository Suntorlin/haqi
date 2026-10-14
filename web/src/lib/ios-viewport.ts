// iOS ignores `interactive-widget=resizes-content`: opening the keyboard shrinks only the *visual*
// viewport and pans the page, so the composer ended up under the keyboard's suggestion bar with the header
// scrolled away. On iOS the app root follows the visual viewport instead (height and offset), and the bottom
// safe area is dropped while the keyboard covers the home indicator.
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

    let frame = 0
    const apply = () => {
        frame = 0
        const keyboardOpen = window.innerHeight - vv.height > KEYBOARD_MIN_PX
        root.style.setProperty('--app-height', `${Math.round(vv.height)}px`)
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
