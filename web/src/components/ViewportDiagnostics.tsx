import { useEffect, useState } from 'react'

type Snapshot = Record<string, string>

function unitHeight(unit: string): string {
    const probe = document.createElement('div')
    probe.style.cssText = `position:fixed;visibility:hidden;left:0;top:0;width:1px;height:100${unit};`
    document.body.appendChild(probe)
    const height = probe.getBoundingClientRect().height
    probe.remove()
    return `${Math.round(height)}`
}

function readSnapshot(): Snapshot {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:fixed;visibility:hidden;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);'
    document.body.appendChild(probe)
    const style = getComputedStyle(probe)
    const safeTop = style.paddingTop
    const safeBottom = style.paddingBottom
    probe.remove()

    const vv = window.visualViewport
    const root = document.getElementById('root')?.getBoundingClientRect()
    const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
        || window.matchMedia('(display-mode: standalone)').matches
    return {
        'window.inner': `${window.innerWidth} x ${window.innerHeight}`,
        'visualViewport': vv ? `${Math.round(vv.width)} x ${Math.round(vv.height)}, top ${Math.round(vv.offsetTop)}` : 'n/a',
        'screen': `${screen.width} x ${screen.height}`,
        'vh / lvh / svh / dvh': `${unitHeight('vh')} / ${unitHeight('lvh')} / ${unitHeight('svh')} / ${unitHeight('dvh')}`,
        'outer / client height': `${window.outerHeight} / ${document.documentElement.clientHeight}`,
        'safe-area top / bottom': `${safeTop} / ${safeBottom}`,
        '#root': root ? `top ${Math.round(root.top)}, height ${Math.round(root.height)}` : 'n/a',
        'standalone': String(standalone),
        'keyboard': document.documentElement.dataset.keyboard ?? 'n/a',
        'dpr': String(window.devicePixelRatio)
    }
}

/** Raw viewport numbers for debugging layout problems on a device (Settings > About). */
export function ViewportDiagnostics() {
    const [snapshot, setSnapshot] = useState<Snapshot>(() => readSnapshot())

    useEffect(() => {
        const update = () => setSnapshot(readSnapshot())
        const timer = window.setInterval(update, 1000)
        window.addEventListener('resize', update)
        return () => {
            window.clearInterval(timer)
            window.removeEventListener('resize', update)
        }
    }, [])

    return (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-4 py-3 text-[12px] tabular-nums text-[var(--social-fg-muted)]">
            {Object.entries(snapshot).map(([key, value]) => (
                <div key={key} className="contents">
                    <dt>{key}</dt>
                    <dd className="text-right text-[var(--social-fg)]">{value}</dd>
                </div>
            ))}
        </dl>
    )
}
