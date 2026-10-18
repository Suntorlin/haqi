// Port of lib/src/semantic_zoom_controller.dart (semantic_zoom,
// (c) Roshen De Zoysa, MIT). See docs/behavior.md R-28..R-37, R-46..R-52,
// R-60..R-64.
//
// Unlike Flutter, the browser has no layout pass we can hook into, so the
// controller also runs the per-frame pipeline: advance the springs, let every
// registered view measure (batched) and write its new geometry, then let
// every anchor client read its anchor once and correct scrollTop, all inside
// one requestAnimationFrame so the anchored item never visibly moves.

import { SpringSimulation, clamp, defaultSpring, type SpringDescription } from './motion'

/** Something that keeps its content still while the zoom changes, e.g. a scroll container. */
export interface AnchorClient {
  /** Pins the item under the client point. Returns whether one was found. */
  captureAnchorAt(clientX: number, clientY: number): boolean
  /** Pins the first item visible at the leading edge. */
  captureLeadingAnchor(): boolean
  /** Restores the pinned item's position by adjusting the scroll offset. */
  correct(): void
  /** Stops pinning. */
  releaseAnchor(): void
}

/** A batched layout reader/writer; see `MeasureBatch` in the DOM layer. */
export interface FrameBatch {
  /** Runs every queued measurement: all DOM writes, then all reads. */
  flush(): void
}

/** A view that follows the zoom, e.g. one `LeveledTextView`. */
export interface ZoomView {
  /** Reads only. Queue measurements on `batch` if needed. */
  prepare(batch: FrameBatch): void
  /** Writes only: positions, opacities, heights. */
  apply(): void
}

export interface SemanticZoomControllerOptions {
  /** Number of discrete levels (>= 2). Default 3. */
  levelCount?: number
  initialLevel?: number
  /** Screen-reader / button names for each level. */
  levelLabels?: readonly string[]
  spring?: SpringDescription
  /** Jump between levels instead of animating. Default: `prefers-reduced-motion`. */
  reduceMotion?: boolean
  /** Vibrate briefly when a gesture or shortcut changes the level (where supported). Default true. */
  haptics?: boolean
  /** Creates the per-frame measurement batch. Set by the DOM layer. */
  createBatch?: () => FrameBatch & { readonly size: number }
}

interface ItemZoom {
  offset: number
  target: number
  sim: SpringSimulation | null
  simStart: number
}

type Listener = () => void

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
const raf: (cb: (t: number) => void) => number =
  typeof requestAnimationFrame !== 'undefined' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(() => cb(now()), 16) as unknown as number
const caf: (id: number) => void =
  typeof cancelAnimationFrame !== 'undefined' ? (id) => cancelAnimationFrame(id) : (id) => clearTimeout(id)

const noopBatch = { flush() {}, size: 0 }

let defaultBatchFactory: () => FrameBatch & { readonly size: number } = () => noopBatch

/** Set by the DOM layer so plain `new SemanticZoomController()` can measure text. */
export function setDefaultBatchFactory(factory: () => FrameBatch & { readonly size: number }): void {
  defaultBatchFactory = factory
}

/**
 * Drives a semantic zoom: a continuous `value` (e.g. 0.0 → 2.0), the discrete
 * `level` it last settled on, and optional per-item levels.
 *
 * `value` changes every frame during a pinch; do not put it in React state.
 * `subscribe` listeners fire only when a committed level changes.
 */
export class SemanticZoomController {
  readonly levelCount: number
  readonly levelLabels: readonly string[] | undefined
  readonly spring: SpringDescription
  reduceMotion: boolean
  haptics: boolean

  private _value: number
  private _level: number
  private _sim: SpringSimulation | null = null
  private _simStart = 0
  private _settleWaiters: Array<() => void> = []
  private readonly _items = new Map<unknown, ItemZoom>()
  private readonly _views = new Set<ZoomView>()
  private readonly _clients = new Set<AnchorClient>()
  private readonly _listeners = new Set<Listener>()
  private readonly _gestureListeners = new Set<Listener>()
  private readonly _frameListeners = new Set<Listener>()
  private _anchorGeneration = 0
  private _pinchAnchored = false
  private _itemAnchorGeneration: number | null = null
  private _releaseGeneration: number | null = null
  private _holds = 0
  private _holdGeneration: number | null = null
  private _gesturing = false
  private _rafId = 0
  private _disposed = false
  private _version = 0
  private readonly _createBatch: () => FrameBatch & { readonly size: number }

  /** Durations of the last frames' work in ms (for diagnostics and benchmarks). */
  readonly frameStats: { work: number[]; enabled: boolean } = { work: [], enabled: false }

  constructor(options: SemanticZoomControllerOptions = {}) {
    const levelCount = options.levelCount ?? 3
    if (!Number.isInteger(levelCount) || levelCount < 2) throw new RangeError('levelCount must be an integer >= 2')
    if (options.levelLabels && options.levelLabels.length !== levelCount) {
      throw new RangeError(`levelLabels must have ${levelCount} entries`)
    }
    this.levelCount = levelCount
    this.levelLabels = options.levelLabels
    this.spring = options.spring ?? defaultSpring
    this.reduceMotion =
      options.reduceMotion ??
      (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
    this.haptics = options.haptics ?? true
    this._level = clamp(Math.round(options.initialLevel ?? 0), 0, levelCount - 1)
    this._value = this._level
    this._createBatch = options.createBatch ?? (() => defaultBatchFactory())
  }

  // ── state ──

  /** Highest level index. */
  get maxLevel(): number {
    return this.levelCount - 1
  }

  /** Current continuous zoom. Can briefly exceed 0..maxLevel while rubber-banding. */
  get value(): number {
    return this._value
  }

  /** Sets the continuous zoom directly (used while a gesture is active). */
  set value(v: number) {
    if (v === this._value) return
    this._value = v
    this.scheduleFrame()
  }

  /** The level the zoom last settled on (or is settling towards). */
  get level(): number {
    return this._level
  }

  /** Whether a global settle animation is running. */
  get isAnimating(): boolean {
    return this._sim !== null
  }

  /** Whether a pinch (touch, trackpad or ctrl+wheel) is in progress. */
  get isGesturing(): boolean {
    return this._gesturing
  }

  /** Increments on every committed level change. Handy as a React snapshot. */
  get version(): number {
    return this._version
  }

  /** Name of `level` for buttons and screen readers. */
  labelForLevel(level: number): string {
    return this.levelLabels?.[level] ?? `Detail ${level + 1} of ${this.levelCount}`
  }

  /** Listens for committed level changes (global or per item). Returns an unsubscribe function. */
  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener)
    return () => this._listeners.delete(listener)
  }

  /** Listens for pinch start and end. */
  subscribeGesture = (listener: Listener): (() => void) => {
    this._gestureListeners.add(listener)
    return () => this._gestureListeners.delete(listener)
  }

  /**
   * Called after every frame, once views have been drawn and anchors
   * corrected. For diagnostics, tests and UI that must follow the zoom.
   */
  addFrameListener(listener: Listener): () => void {
    this._frameListeners.add(listener)
    return () => this._frameListeners.delete(listener)
  }

  private _notify() {
    this._version++
    for (const l of [...this._listeners]) l()
  }

  // ── views and frames ──

  /** Registers a view drawn every frame. Returns an unregister function. */
  registerView(view: ZoomView): () => void {
    this._views.add(view)
    this.scheduleFrame()
    return () => {
      this._views.delete(view)
    }
  }

  /** Registers a client that keeps content anchored. Returns an unregister function. */
  addAnchorClient(client: AnchorClient): () => void {
    this._clients.add(client)
    return () => {
      this._clients.delete(client)
    }
  }

  /** Requests a frame. Views call this when their content or size changes. */
  scheduleFrame(): void {
    if (this._rafId || this._disposed) return
    this._rafId = raf(() => this._frame())
  }

  /** Runs one frame synchronously (tests and benchmarks). */
  flushFrame(): void {
    if (this._rafId) caf(this._rafId)
    this._rafId = 0
    this._frame()
  }

  private _frame() {
    this._rafId = 0
    if (this._disposed) return
    const t0 = now()
    let active = false

    if (this._sim) {
      const dt = (t0 - this._simStart) / 1000
      if (this._sim.isDone(dt)) {
        this._value = this._sim.end
        this._sim = null
      } else {
        this._value = this._sim.positionAt(dt)
        active = true
      }
    }

    let itemsWereActive = false
    for (const item of this._items.values()) {
      if (!item.sim) continue
      itemsWereActive = true
      const dt = (t0 - item.simStart) / 1000
      if (item.sim.isDone(dt)) {
        item.offset = item.target
        item.sim = null
      } else {
        item.offset = item.sim.positionAt(dt)
        active = true
      }
    }

    // Measure everything first (one forced layout), then write.
    const batch = this._createBatch()
    for (const v of this._views) v.prepare(batch)
    if (batch.size) batch.flush()
    for (const v of this._views) v.apply()
    // One read per client, then a scrollTop write: the anchored item is back
    // in place before the browser paints.
    for (const c of this._clients) c.correct()

    if (!this._sim) {
      const waiters = this._settleWaiters
      this._settleWaiters = []
      for (const w of waiters) w()
    }
    if (itemsWereActive && ![...this._items.values()].some((i) => i.sim)) this._maybeReleaseItemAnchor()

    const release = this._releaseGeneration
    if (release !== null && release === this._anchorGeneration && !active) {
      this._releaseGeneration = null
      for (const c of this._clients) c.releaseAnchor()
    }

    if (this.frameStats.enabled) {
      this.frameStats.work.push(now() - t0)
      if (this.frameStats.work.length > 5000) this.frameStats.work.shift()
    }
    for (const l of this._frameListeners) l()
    if (active) this.scheduleFrame()
  }

  // ── anchoring ──

  /** Pins the item under the client point in every attached list. */
  anchorAt(clientX: number, clientY: number): void {
    this._anchorGeneration++
    this._releaseGeneration = null
    for (const c of this._clients) c.captureAnchorAt(clientX, clientY)
  }

  /** Pins the first visible item (newest visible one in a chat list). */
  anchorLeading(): void {
    this._anchorGeneration++
    this._releaseGeneration = null
    for (const c of this._clients) c.captureLeadingAnchor()
  }

  /** Stops anchoring after the next frame has been laid out (R-50). */
  releaseAnchor(): void {
    this._releaseGeneration = this._anchorGeneration
    this.scheduleFrame()
  }

  /** Stops anchoring right now, e.g. when the user starts scrolling during a settle (R-61). */
  releaseAnchorNow(): void {
    this._anchorGeneration++
    this._releaseGeneration = null
    for (const c of this._clients) c.releaseAnchor()
  }

  private get _anchorBusy() {
    return this._sim !== null || this._pinchAnchored
  }

  /**
   * Keeps the first visible item still until the returned callback is
   * called, e.g. while an item above it grows because its content loaded
   * (R-52). Holds can overlap.
   */
  holdAnchor(): () => void {
    if (this._holds === 0 && !this._anchorBusy) {
      this.anchorLeading()
      this._holdGeneration = this._anchorGeneration
    }
    this._holds++
    let released = false
    return () => {
      if (released) return
      released = true
      if (--this._holds > 0) return
      if (this._holdGeneration === this._anchorGeneration) this.releaseAnchor()
      this._holdGeneration = null
    }
  }

  // ── global level ──

  /** Stops any settle animation. */
  stop(): void {
    this._sim = null
  }

  /**
   * Settles every item on `target` with a spring, carrying `velocity`
   * (levels/second). Per-item levels are cleared (R-33, R-35, R-64).
   */
  animateToLevel(
    target: number,
    opts: { velocity?: number; anchor?: boolean; animate?: boolean } = {},
  ): Promise<void> {
    target = clamp(Math.round(target), 0, this.maxLevel)
    if ((opts.anchor ?? true) && !this._anchorBusy) this.anchorLeading()
    this._pinchAnchored = false
    const animated = opts.animate ?? !this.reduceMotion
    this._clearItems(animated)
    this._commit(target)

    if (!animated || this._value === target) {
      this._sim = null
      this._value = target
      this.releaseAnchor()
      return Promise.resolve()
    }
    this._sim = new SpringSimulation(this.spring, this._value, target, opts.velocity ?? 0)
    this._simStart = now()
    this.scheduleFrame()
    return new Promise((resolve) => {
      this._settleWaiters.push(() => {
        this.releaseAnchor()
        resolve()
      })
    })
  }

  /** Programmatic API: animate to `level` (alias of `animateToLevel`). */
  setLevel(level: number, opts?: { animate?: boolean }): Promise<void> {
    return this.animateToLevel(level, opts)
  }

  /** Jumps to `target` without animation or anchoring. */
  jumpToLevel(target: number): void {
    void this.animateToLevel(target, { animate: false, anchor: false })
  }

  /** Moves one level up or down (keyboard, buttons). Returns whether the level changed. */
  step(delta: number): boolean {
    const before = this._level
    void this.animateToLevel(before + delta)
    const changed = this._level !== before
    if (changed) this._haptic()
    return changed
  }

  private _commit(target: number) {
    if (target === this._level) return
    this._level = target
    this._notify()
  }

  private _haptic() {
    if (!this.haptics) return
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { vibrate?: (p: number) => boolean }) : null
    try {
      nav?.vibrate?.(8)
    } catch {
      // Not allowed without user activation; ignore.
    }
  }

  // ── gestures ──

  /**
   * Starts a gesture at the client point (or the leading item when omitted):
   * stops settling, anchors there and returns every item to the global level
   * (R-46, R-51, R-60).
   */
  beginGesture(clientX?: number, clientY?: number): void {
    this._sim = null
    if (clientX !== undefined && clientY !== undefined) this.anchorAt(clientX, clientY)
    else this.anchorLeading()
    this._pinchAnchored = true
    this._gesturing = true
    this._clearItems(!this.reduceMotion)
    for (const l of [...this._gestureListeners]) l()
    this.scheduleFrame()
  }

  /** Ends a gesture, settling on the level `projected` rounds to (R-33). */
  endGesture(projected: number, velocity = 0): Promise<void> {
    this._gesturing = false
    for (const l of [...this._gestureListeners]) l()
    const before = this._level
    const p = this.animateToLevel(Math.round(projected), { velocity })
    if (this._level !== before) this._haptic()
    return p
  }

  // ── per-item levels ──
  //
  // Each item's zoom is the global zoom plus an animated offset, so a global
  // pinch or level change can smoothly pull every item back (R-62).

  private _item(id: unknown): ItemZoom {
    let item = this._items.get(id)
    if (!item) {
      item = { offset: 0, target: 0, sim: null, simStart: 0 }
      this._items.set(id, item)
    }
    return item
  }

  /** Continuous zoom for item `id` (the global value when `id` is null/undefined). */
  valueFor(id: unknown): number {
    if (id === undefined || id === null) return this._value
    return this._value + (this._items.get(id)?.offset ?? 0)
  }

  /** The committed level of item `id` (R-63). */
  itemLevel(id: unknown): number {
    return clamp(Math.round(this._level + (this._items.get(id)?.target ?? 0)), 0, this.maxLevel)
  }

  /** Whether any item has a level different from the global level. */
  get hasItemLevels(): boolean {
    for (const i of this._items.values()) if (i.target !== 0) return true
    return false
  }

  /** Items whose level differs from the global level. */
  get itemLevels(): Map<unknown, number> {
    const out = new Map<unknown, number>()
    for (const [id, item] of this._items) if (item.target !== 0) out.set(id, this.itemLevel(id))
    return out
  }

  /** Moves only item `id` to `target`, e.g. on tap. The next pinch or level change clears it. */
  setItemLevel(id: unknown, target: number, opts: { animate?: boolean } = {}): void {
    target = clamp(Math.round(target), 0, this.maxLevel)
    const before = this.itemLevel(id)
    const itemsActive = [...this._items.values()].some((i) => i.sim)
    if (!this._anchorBusy && !itemsActive) {
      this.anchorLeading()
      this._itemAnchorGeneration = this._anchorGeneration
    }
    this._animateItem(this._item(id), target - this._level, opts.animate)
    if (this.itemLevel(id) !== before) this._notify()
  }

  /** Returns every item to the global level. */
  clearItemLevels(opts: { animate?: boolean } = {}): void {
    const changed = this.hasItemLevels
    this._clearItems(opts.animate ?? !this.reduceMotion)
    if (changed) this._notify()
  }

  private _clearItems(animate: boolean) {
    for (const item of this._items.values()) {
      if (item.target !== 0 || item.offset !== 0) this._animateItem(item, 0, animate)
    }
  }

  private _animateItem(item: ItemZoom, target: number, animate: boolean | undefined) {
    item.target = target
    if (!(animate ?? !this.reduceMotion)) {
      item.sim = null
      item.offset = target
      this.scheduleFrame()
      this._maybeReleaseItemAnchor()
      return
    }
    const t = now()
    const velocity = item.sim ? item.sim.velocityAt((t - item.simStart) / 1000) : 0
    item.sim = new SpringSimulation(this.spring, item.offset, target, velocity)
    item.simStart = t
    this.scheduleFrame()
  }

  private _maybeReleaseItemAnchor() {
    // Only release an anchor the item animation took; a pinch or global
    // settle that started since owns the current one.
    if (this._itemAnchorGeneration !== null && this._itemAnchorGeneration === this._anchorGeneration) {
      this.releaseAnchor()
    }
    this._itemAnchorGeneration = null
  }

  /**
   * Stops frames and animations. A disposed controller can be revived with
   * `revive()` (React StrictMode unmounts and remounts effects once).
   */
  dispose(): void {
    this._disposed = true
    if (this._rafId) caf(this._rafId)
    this._rafId = 0
    this._sim = null
  }

  /** Undoes `dispose()`. */
  revive(): void {
    if (!this._disposed) return
    this._disposed = false
    this.scheduleFrame()
  }
}
