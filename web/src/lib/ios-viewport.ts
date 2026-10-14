// iOS home-screen apps (viewport-fit=cover) report innerHeight / dvh / visualViewport.height as the screen
// minus the top safe area (894 of 956 on an iPhone 16 Pro Max) and paint nothing below it, leaving a dead
// band under the bottom bars (WebKit bug 254868). 100vh is the real screen height there, so index.css
// sizes html/body with it in standalone mode instead of dvh.
//
// The keyboard is the other half: iOS ignores `interactive-widget=resizes-content`, so it only shrinks the
// visual viewport and pans the page, leaving the composer under the suggestion bar with the header
// scrolled away. While the keyboard is up the root follows the visual viewport (height and offset), and the
// bottom safe area is dropped because the keyboard covers the home indicator.
const KEYBOARD_MIN_PX = 200

export function isIOSDevice(): boolean {
    if (typeof navigator === 'undefined') return false
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
}

function fullScreenHeight(): number {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;visibility:hidden;left:0;top:0;width:1px;height:100vh;'
    document.body.appendChild(probe)
    const height = probe.getBoundingClientRect().height
    probe.remove()
    return height
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
        // 100vh does not shrink with the keyboard, so the difference is the keyboard (plus the usual
        // ~top-inset shortfall, well under the threshold).
        const keyboardOpen = fullScreenHeight() - vv.height > KEYBOARD_MIN_PX
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
