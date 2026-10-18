// Turns pinch input into zoom changes, the browser counterpart of
// SemanticZoomDetector in semantic_zoom ((c) Roshen De Zoysa, MIT).
// See docs/behavior.md R-30..R-33, R-54..R-61.
//
// Inputs:
// - Touch pinch: Pointer Events track the two fingers. `touch-action:
//   pan-x pan-y` keeps one-finger scrolling but stops the browser's own
//   pinch-zoom; a non-passive touchmove listener also cancels native
//   scrolling while two fingers are down.
// - Trackpad pinch in Chrome/Edge/Firefox: `wheel` with `ctrlKey`
//   (non-passive, preventDefault).
// - Safari: `gesturestart` / `gesturechange` / `gestureend`.
// - Keyboard: Ctrl/⌘ + `=` `+` `-` `0`.

import type { SemanticZoomController } from '../core/controller'
import { rubberBand, smoothVelocity, snapLevel, zoomDefaults, zoomForScale } from '../core/motion'

export interface GestureOptions {
  /** Levels per doubling of finger distance. Default 1.6 (R-30). */
  levelsPerDoubling?: number
  /** Fraction applied past the first/last level. Default 0.25 (R-31). */
  overscrollResistance?: number
  /** Seconds of velocity projected when snapping. Default 0.12 (R-33). */
  flingProjection?: number
  /**
   * Ctrl/⌘ + `+` `-` `0`. `'focus'` (default) acts while focus is inside the
   * element; `'global'` acts anywhere on the page except in text fields;
   * `false` turns them off.
   */
  keyboardShortcuts?: 'focus' | 'global' | false
  /** Called when a pinch starts or ends. */
  onPinchChange?: (pinching: boolean) => void
}

type Source = 'touch' | 'wheel' | 'safari'

interface GestureEventLike extends UIEvent {
  scale: number
  clientX: number
  clientY: number
}

const isEditable = (el: EventTarget | null) => {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
}

/** Attaches pinch, wheel, Safari gesture and keyboard handling to `el`. Returns a detach function. */
export function attachZoomGestures(
  el: HTMLElement,
  controller: SemanticZoomController,
  options: GestureOptions = {},
): () => void {
  const perDoubling = options.levelsPerDoubling ?? zoomDefaults.levelsPerDoubling
  const resistance = options.overscrollResistance ?? zoomDefaults.overscrollResistance
  const projection = options.flingProjection ?? zoomDefaults.flingProjection
  const keyboard = options.keyboardShortcuts ?? 'focus'

  const pointers = new Map<number, { x: number; y: number }>()
  let source: Source | null = null
  let startDistance = 1
  let startZoom = 0
  let velocity = 0
  let lastZoom = 0
  let lastTime = 0
  let wheelScale = 1
  let wheelTimer: ReturnType<typeof setTimeout> | null = null
  let suppressClickUntil = 0

  const prevTouchAction = el.style.touchAction
  el.style.touchAction = 'pan-x pan-y'

  const begin = (x: number, y: number, time: number, src: Source) => {
    if (wheelTimer) clearTimeout(wheelTimer)
    wheelTimer = null
    source = src
    controller.beginGesture(x, y)
    startZoom = controller.value
    lastZoom = controller.value
    lastTime = time
    velocity = 0
    el.setAttribute('data-sz-pinching', '')
    options.onPinchChange?.(true)
  }

  const update = (scale: number, time: number) => {
    const z = rubberBand(zoomForScale(startZoom, scale, perDoubling), controller.maxLevel, resistance)
    velocity = smoothVelocity(velocity, z - lastZoom, (time - lastTime) / 1000)
    lastZoom = z
    lastTime = time
    controller.value = z
  }

  const end = () => {
    if (!source) return
    source = null
    el.removeAttribute('data-sz-pinching')
    // A pinch never ends in a tap on the item under the fingers (R-56).
    suppressClickUntil = performance.now() + 400
    void controller.endGesture(snapLevel(controller.value, velocity, controller.maxLevel, projection), velocity)
    options.onPinchChange?.(false)
  }

  const distance = () => {
    const [a, b] = [...pointers.values()]
    return Math.hypot(a.x - b.x, a.y - b.y)
  }

  // ── touch (Pointer Events) ──

  const onPointerDown = (e: PointerEvent) => {
    if (keyboard === 'focus' && !el.contains(document.activeElement)) el.focus({ preventScroll: true })
    if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
    // A new touch during a settle means the user is taking over (R-61).
    if (pointers.size === 0 && controller.isAnimating) controller.releaseAnchorNow()
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.size === 2 && !source) {
      startDistance = Math.max(distance(), 1)
      const [a, b] = [...pointers.values()]
      begin((a.x + b.x) / 2, (a.y + b.y) / 2, e.timeStamp, 'touch')
    }
  }

  const onPointerMove = (e: PointerEvent) => {
    const p = pointers.get(e.pointerId)
    if (!p) return
    p.x = e.clientX
    p.y = e.clientY
    if (source !== 'touch' || pointers.size < 2) return
    update(distance() / startDistance, e.timeStamp)
  }

  const onPointerUp = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return
    if (pointers.size < 2 && source === 'touch') end()
  }

  // Cancels native scrolling and zooming while two fingers are down.
  const onTouch = (e: TouchEvent) => {
    if (e.touches.length >= 2 && e.cancelable) e.preventDefault()
  }

  // ── Safari ──

  const onGestureStart = (e: Event) => {
    e.preventDefault()
    const g = e as GestureEventLike
    // On iOS the fingers already drive the pinch through Pointer Events.
    if (pointers.size > 0 || source) return
    begin(g.clientX, g.clientY, e.timeStamp, 'safari')
  }
  const onGestureChange = (e: Event) => {
    e.preventDefault()
    if (source === 'safari') update((e as GestureEventLike).scale, e.timeStamp)
  }
  const onGestureEnd = (e: Event) => {
    e.preventDefault()
    if (source === 'safari') end()
  }

  // ── ctrl + wheel / trackpad pinch ──

  const onWheel = (e: WheelEvent) => {
    if (!e.ctrlKey) return
    e.preventDefault()
    if (source && source !== 'wheel') return
    let dy = e.deltaY
    if (e.deltaMode === 1) dy *= 16
    else if (e.deltaMode === 2) dy *= 400
    // Chrome reports a trackpad pinch as deltaY = -100 · ln(scale). A mouse
    // wheel notch is ±100 or more; cap it at about one level per notch.
    dy = Math.max(-50, Math.min(50, dy))
    if (!source) {
      begin(e.clientX, e.clientY, e.timeStamp, 'wheel')
      wheelScale = 1
    }
    wheelScale *= Math.exp(-dy / 100)
    update(wheelScale, e.timeStamp)
    if (wheelTimer) clearTimeout(wheelTimer)
    wheelTimer = setTimeout(() => {
      wheelTimer = null
      if (source === 'wheel') end()
    }, zoomDefaults.signalSettleDelay)
  }

  // ── keyboard ──

  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (keyboard === 'global' && isEditable(e.target)) return
    let delta: number | null = null
    if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd' || e.code === 'Equal') delta = 1
    else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract' || e.code === 'Minus') delta = -1
    else if (e.key === '0' || e.code === 'Numpad0' || e.code === 'Digit0') delta = -controller.level
    if (delta === null) return
    // Stop the browser's own page zoom.
    e.preventDefault()
    if (delta !== 0) controller.step(delta)
  }

  const onClickCapture = (e: MouseEvent) => {
    if (performance.now() < suppressClickUntil) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  if (keyboard === 'focus' && el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.tabIndex = 0

  const active: AddEventListenerOptions = { passive: false }
  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('pointermove', onPointerMove)
  el.addEventListener('pointerup', onPointerUp)
  el.addEventListener('pointercancel', onPointerUp)
  el.addEventListener('touchstart', onTouch, active)
  el.addEventListener('touchmove', onTouch, active)
  el.addEventListener('wheel', onWheel, active)
  el.addEventListener('gesturestart', onGestureStart, active)
  el.addEventListener('gesturechange', onGestureChange, active)
  el.addEventListener('gestureend', onGestureEnd, active)
  el.addEventListener('click', onClickCapture, true)
  const keyTarget: HTMLElement | Window | null = keyboard === 'global' ? window : keyboard === 'focus' ? el : null
  keyTarget?.addEventListener('keydown', onKey as EventListener)

  return () => {
    if (wheelTimer) clearTimeout(wheelTimer)
    if (source) end()
    el.style.touchAction = prevTouchAction
    el.removeEventListener('pointerdown', onPointerDown)
    el.removeEventListener('pointermove', onPointerMove)
    el.removeEventListener('pointerup', onPointerUp)
    el.removeEventListener('pointercancel', onPointerUp)
    el.removeEventListener('touchstart', onTouch)
    el.removeEventListener('touchmove', onTouch)
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('gesturestart', onGestureStart)
    el.removeEventListener('gesturechange', onGestureChange)
    el.removeEventListener('gestureend', onGestureEnd)
    el.removeEventListener('click', onClickCapture, true)
    keyTarget?.removeEventListener('keydown', onKey as EventListener)
  }
}
