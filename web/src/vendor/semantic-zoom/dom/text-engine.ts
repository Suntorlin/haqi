// The DOM counterpart of LeveledTextView + LeveledTextLayout + _MorphPainter
// in semantic_zoom ((c) Roshen De Zoysa, MIT). See docs/behavior.md
// R-38..R-45.
//
// At rest an item is real, selectable, accessible text ("flow" mode). While
// it zooms, the flow text is hidden from sight (but not from screen readers)
// and every token is an absolutely positioned element moved with transforms
// ("morph" mode). Token positions come from the browser's own line breaking:
// for each (level, width) the visible text is laid out once in an invisible
// "ghost" copy and every token's box is read back. Nothing is measured while
// a pinch is in progress, except the first time a level is needed.

import { type FrameBatch, type SemanticZoomController, type ZoomView, setDefaultBatchFactory } from '../core/controller'
import { type LeveledText, type LeveledToken, isBreak, isVisibleAt } from '../core/leveled-text'
import { between, clamp, lerp, tokenOpacity } from '../core/motion'

/** Where every token sits at one level, indexed like `text.tokens`. */
export interface LevelLayout {
  xs: Float64Array
  ys: Float64Array
  /** 1 when the token is shown at this level. */
  has: Uint8Array
  height: number
}

export interface TextEngineOptions {
  itemId?: unknown
  /** Called instead of following a link when a link is clicked. */
  onLinkTap?: (href: string) => void
  /** Limits the zoom this view shows (used by the lazy view while it loads). */
  capZoom?: (z: number) => number
  /**
   * Clip words to the current height while they move. Off by default, like
   * the original, where words of the next level can show faintly below.
   */
  clip?: boolean
}

const LINK_ATTR = 'data-sz-link'
const PARAGRAPH_STYLE = 'display:block;margin:0'
const PARAGRAPH_GAP_STYLE = 'display:block;margin:var(--sz-paragraph-gap,0.5em) 0 0'
const EPS = 1e-3

// ───────────────────────── building text ─────────────────────────

interface Built {
  root: HTMLDivElement
  /** For ghosts: the measurable span of each shown token. */
  spans: (HTMLSpanElement | null)[]
  probe: HTMLSpanElement | null
}

/**
 * Builds the text at `level` as paragraphs. `ghost` wraps every token in its
 * own span so it can be measured; otherwise plain text nodes are used. Both
 * produce the same layout.
 */
function build(text: LeveledText, level: number, ghost: boolean): Built {
  const doc = document
  const root = doc.createElement('div')
  const tokens = text.tokens
  const spans: (HTMLSpanElement | null)[] = ghost ? new Array(tokens.length).fill(null) : []
  let paragraph: HTMLElement | null = null
  let hasContent = false
  let pendingBreak = false
  let linkEl: HTMLAnchorElement | null = null
  let link: string | null = null

  const newParagraph = () => {
    paragraph = doc.createElement('div')
    paragraph.setAttribute('style', root.childElementCount ? PARAGRAPH_GAP_STYLE : PARAGRAPH_STYLE)
    paragraph.setAttribute('data-sz-p', '')
    root.appendChild(paragraph)
    linkEl = null
    link = null
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (!isVisibleAt(t, level)) continue
    if (isBreak(t)) {
      pendingBreak = hasContent
      continue
    }
    let space = false
    if (!paragraph || pendingBreak) {
      newParagraph()
      pendingBreak = false
    } else {
      space = !t.glued
    }
    const p = paragraph as unknown as HTMLElement
    // A space inside a multi-word link belongs to the link, so it is one
    // continuous link (R-44); otherwise it sits between them.
    if (t.link !== link || t.link === null) {
      if (space) p.appendChild(doc.createTextNode(' '))
      space = false
      linkEl = null
      link = t.link
      if (t.link !== null) {
        linkEl = doc.createElement('a')
        linkEl.href = t.link
        linkEl.setAttribute(LINK_ATTR, '')
        p.appendChild(linkEl)
      }
    }
    const parent: HTMLElement = linkEl ?? p
    if (space) parent.appendChild(doc.createTextNode(' '))
    let host: HTMLElement = parent
    if (t.style?.bold) host = host.appendChild(doc.createElement('strong'))
    if (t.style?.italic) host = host.appendChild(doc.createElement('em'))
    if (ghost) {
      const s = doc.createElement('span')
      s.textContent = t.text
      host.appendChild(s)
      spans[i] = s
    } else {
      host.appendChild(doc.createTextNode(t.text))
    }
    hasContent = true
  }

  let probe: HTMLSpanElement | null = null
  if (ghost) {
    // How far below an absolutely positioned token's top its glyphs start:
    // the half-leading of the line box. Morph tokens are placed at
    // (glyph box top - inset) so they line up with the flow text.
    const outer = doc.createElement('span')
    outer.setAttribute('style', 'position:absolute;left:0;top:0;white-space:pre')
    probe = doc.createElement('span')
    probe.textContent = 'Xg'
    outer.appendChild(probe)
    root.appendChild(outer)
    root.setAttribute(
      'style',
      'position:absolute;left:0;top:0;width:100%;visibility:hidden;pointer-events:none;contain:layout style',
    )
    root.setAttribute('aria-hidden', 'true')
  }
  return { root, spans, probe }
}

// ───────────────────────── measuring ─────────────────────────

interface Request {
  engine: LeveledTextEngine
  level: number
  built?: Built
}

/** Batches ghost layouts: all DOM writes, then all reads, then cleanup. */
export class MeasureBatch implements FrameBatch {
  private readonly reqs: Request[] = []
  private readonly seen = new Set<string>()
  private static ids = new WeakMap<LeveledTextEngine, number>()
  private static next = 0

  get size(): number {
    return this.reqs.length
  }

  request(engine: LeveledTextEngine, level: number): void {
    let id = MeasureBatch.ids.get(engine)
    if (id === undefined) MeasureBatch.ids.set(engine, (id = MeasureBatch.next++))
    const key = `${id}:${level}`
    if (this.seen.has(key)) return
    this.seen.add(key)
    this.reqs.push({ engine, level })
  }

  flush(): void {
    for (const r of this.reqs) {
      r.built = build(r.engine.text, r.level, true)
      r.engine.container.appendChild(r.built.root)
    }
    for (const r of this.reqs) r.engine._read(r.level, r.built!)
    for (const r of this.reqs) r.built!.root.remove()
    this.reqs.length = 0
    this.seen.clear()
  }
}

export const createMeasureBatch = (): MeasureBatch => new MeasureBatch()
setDefaultBatchFactory(createMeasureBatch)

// ───────────────────────── shared observers ─────────────────────────

const engines = new Set<LeveledTextEngine>()
let intersection: IntersectionObserver | null = null
let resize: ResizeObserver | null = null
const byElement = new WeakMap<Element, LeveledTextEngine>()

function observe(engine: LeveledTextEngine) {
  if (typeof IntersectionObserver !== 'undefined') {
    intersection ??= new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const en = byElement.get(e.target)
          if (en) en._setVisible(e.isIntersecting)
        }
      },
      // Morph a little beyond the viewport so items scrolled in by the
      // anchor correction are already morphing.
      { rootMargin: '50% 0px 50% 0px' },
    )
    intersection.observe(engine.container)
  }
  if (typeof ResizeObserver !== 'undefined') {
    resize ??= new ResizeObserver((entries) => {
      for (const e of entries) {
        const en = byElement.get(e.target)
        if (en) en._setWidth(e.contentRect.width)
      }
    })
    resize.observe(engine.container)
  }
}

if (typeof document !== 'undefined' && document.fonts) {
  // Web fonts change every measurement.
  document.fonts.addEventListener?.('loadingdone', () => {
    for (const e of engines) e.invalidate()
  })
}

// Pre-measures off-screen items while the browser is idle, so the first
// pinch doesn't have to (R-38).
const idleQueue = new Set<LeveledTextEngine>()
let idleScheduled = false
const ric: (cb: (d: { timeRemaining(): number }) => void) => void =
  typeof requestIdleCallback !== 'undefined'
    ? (cb) => requestIdleCallback(cb, { timeout: 1000 })
    : (cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 50)

function enqueueIdle(engine: LeveledTextEngine) {
  idleQueue.add(engine)
  if (idleScheduled) return
  idleScheduled = true
  ric(runIdle)
}

function runIdle(deadline: { timeRemaining(): number }) {
  idleScheduled = false
  while (idleQueue.size && deadline.timeRemaining() > 2) {
    const batch = new MeasureBatch()
    const done: LeveledTextEngine[] = []
    for (const e of idleQueue) {
      idleQueue.delete(e)
      if (!e.container.isConnected) continue
      e._requestAll(batch)
      done.push(e)
      if (done.length >= 6) break
    }
    if (batch.size) batch.flush()
    for (const e of done) e._idleWork()
  }
  if (idleQueue.size) {
    idleScheduled = true
    ric(runIdle)
  }
}

// ───────────────────────── the engine ─────────────────────────

type Plan = 'none' | 'flow' | 'morph' | 'height'

/**
 * Follows `controller` for one piece of leveled text inside `container`
 * (which it owns the children of).
 */
export class LeveledTextEngine implements ZoomView {
  readonly container: HTMLElement
  text: LeveledText
  private readonly controller: SemanticZoomController
  private opts: TextEngineOptions
  private readonly flowEl: HTMLDivElement
  private morphEl: HTMLDivElement | null = null
  private morphNodes: (HTMLElement | null)[] = []
  /** x, y, opacity last written per token (NaN = hidden). */
  private last = new Float64Array(0)
  private cache = new Map<number, LevelLayout>()
  private cacheWidth = -1
  private width = 0
  private visible = true
  private mode: 'flow' | 'morph' | 'height' = 'flow'
  private flowLevel = -1
  private plan: Plan = 'none'
  private planLevel = 0
  private planLo = 0
  private planHi = 0
  private planMove = 0
  private planZ = 0
  private lastHeight = -1
  private readonly unregister: () => void
  private readonly onClick = (e: MouseEvent) => {
    const tap = this.opts.onLinkTap
    if (!tap) return
    const a = (e.target as Element | null)?.closest?.(`a[${LINK_ATTR}]`)
    if (!a || !this.container.contains(a)) return
    e.preventDefault()
    tap(a.getAttribute('href') ?? '')
  }

  constructor(container: HTMLElement, controller: SemanticZoomController, text: LeveledText, opts: TextEngineOptions = {}) {
    this.container = container
    this.controller = controller
    this.text = text
    this.opts = opts
    container.style.position ||= 'relative'
    this.flowEl = document.createElement('div')
    this.flowEl.setAttribute('data-sz-flow', '')
    container.replaceChildren(this.flowEl)
    container.addEventListener('click', this.onClick)
    this._renderFlow(this._shownLevel(this._zoom()))
    byElement.set(container, this)
    engines.add(this)
    observe(this)
    enqueueIdle(this)
    this.unregister = controller.registerView(this)
  }

  /** Updates options that don't need a re-layout. */
  setOptions(opts: TextEngineOptions): void {
    this.opts = opts
    this.controller.scheduleFrame()
  }

  /** Replaces the text; layouts are recomputed. */
  setText(text: LeveledText): void {
    if (text === this.text || text.equals(this.text)) {
      this.text = text
      return
    }
    this.text = text
    this.cache.clear()
    this._dropMorph()
    this.flowLevel = -1
    if (this.mode === 'flow') this._renderFlow(this._shownLevel(this._zoom()))
    enqueueIdle(this)
    this.controller.scheduleFrame()
  }

  /** Drops cached layouts, e.g. after fonts or styles changed. */
  invalidate(): void {
    this.cache.clear()
    enqueueIdle(this)
    this.controller.scheduleFrame()
  }

  destroy(): void {
    this.unregister()
    engines.delete(this)
    idleQueue.delete(this)
    intersection?.unobserve(this.container)
    resize?.unobserve(this.container)
    this.container.removeEventListener('click', this.onClick)
    this.container.replaceChildren()
    this.container.style.height = ''
  }

  /** The text level shown at rest for the current zoom. */
  get level(): number {
    return this._shownLevel(this._zoom())
  }

  /** Whether the engine is currently drawing word by word. */
  get isMorphing(): boolean {
    return this.mode !== 'flow'
  }

  // ── internals used by the batch and observers ──

  _setVisible(v: boolean): void {
    if (v === this.visible) return
    this.visible = v
    if (v) {
      this.controller.scheduleFrame()
      // Build the word layer ahead of the next pinch.
      if (!this.morphEl) enqueueIdle(this)
    }
  }

  /** Work done while the browser is idle, after measuring. */
  _idleWork(): void {
    // Off-screen items left at a pinned height after a level change get
    // their real text now, a few at a time, instead of all in one frame.
    if (this.mode === 'height' && !this.controller.isGesturing) {
      const z = this._zoom()
      if (Math.abs(z - Math.round(z)) < EPS) this._enterFlow(this._shownLevel(z))
    }
    if (this.visible && !this.morphEl && this.text.tokens.length) {
      this._ensureMorph()
      this.morphEl!.style.display = 'none'
    }
  }

  _setWidth(w: number): void {
    if (Math.abs(w - this.width) < 0.01) return
    this.width = w
    this.cache.clear()
    this.cacheWidth = -1
    enqueueIdle(this)
    if (this.mode !== 'flow') this.controller.scheduleFrame()
  }

  _requestAll(batch: MeasureBatch): void {
    this._syncWidth()
    for (let l = 0; l <= this.controller.maxLevel; l++) {
      const tl = this._textLevel(l)
      if (!this.cache.has(tl)) batch.request(this, tl)
    }
  }

  _read(level: number, built: Built): void {
    const n = this.text.tokens.length
    const rootRect = built.root.getBoundingClientRect()
    let inset = 0
    if (built.probe) {
      const outer = built.probe.parentElement!.getBoundingClientRect()
      inset = built.probe.getBoundingClientRect().top - outer.top
    }
    const xs = new Float64Array(n)
    const ys = new Float64Array(n)
    const has = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const s = built.spans[i]
      if (!s) continue
      // A word wider than the line is anchored at its first fragment.
      const r = s.getClientRects()[0]
      if (!r) continue
      xs[i] = r.left - rootRect.left
      ys[i] = r.top - rootRect.top - inset
      has[i] = 1
    }
    // The ghost holds only the probe when nothing is shown at this level.
    const height = built.spans.some(Boolean) ? rootRect.height : 0
    this.cacheWidth = this.width
    this.cache.set(level, { xs, ys, has, height })
  }

  // ── ZoomView ──

  prepare(batch: FrameBatch): void {
    const z = this._zoom()
    const ctl = this.controller
    const rounded = Math.round(z)
    const atRest = (!ctl.isGesturing && Math.abs(z - rounded) < EPS) || ctl.reduceMotion
    if (atRest) {
      const level = this._shownLevel(z)
      if (this.mode === 'flow' && this.flowLevel === level) {
        this.plan = 'none'
        return
      }
      const pinned = this.cache.get(level)
      if (!this.visible && pinned && this.cacheWidth === this.width) {
        // Off-screen: keep the right height now, swap in the text when idle.
        this.plan = 'height'
        this.planLo = this.planHi = level
        this.planMove = 0
        enqueueIdle(this)
        return
      }
      this.plan = 'flow'
      this.planLevel = level
      return
    }
    this._syncWidth()
    const [lo, hi, move] = between(z, ctl.maxLevel)
    const tlo = this._textLevel(lo)
    const thi = this._textLevel(hi)
    const missing = !this.cache.has(tlo) || !this.cache.has(thi)
    if (missing) {
      if (!this.visible) {
        // Off-screen and never measured: leave it; the idle queue will
        // measure it and the anchor absorbs the change.
        enqueueIdle(this)
        this.plan = 'none'
        return
      }
      const b = batch as MeasureBatch
      if (!this.cache.has(tlo)) b.request(this, tlo)
      if (!this.cache.has(thi)) b.request(this, thi)
    }
    this.plan = this.visible ? 'morph' : 'height'
    this.planLo = tlo
    this.planHi = thi
    this.planMove = move
    this.planZ = clamp(z, 0, ctl.maxLevel)
  }

  apply(): void {
    const plan = this.plan
    this.plan = 'none'
    if (plan === 'none') return
    if (plan === 'flow') {
      this._enterFlow(this.planLevel)
      return
    }
    const from = this.cache.get(this.planLo)
    const to = this.cache.get(this.planHi)
    if (!from || !to) return
    const height = lerp(from.height, to.height, this.planMove)
    this._hideFlow()
    if (Math.abs(height - this.lastHeight) > 0.01) {
      this.container.style.height = `${height}px`
      this.lastHeight = height
    }
    if (plan === 'height') {
      if (this.morphEl) this.morphEl.style.display = 'none'
      this.mode = 'height'
      return
    }
    this.mode = 'morph'
    this._paint(from, to, this.planMove, this.planZ)
  }

  // ── private ──

  private _zoom(): number {
    const raw = this.controller.valueFor(this.opts.itemId)
    return this.opts.capZoom ? this.opts.capZoom(raw) : raw
  }

  private _textLevel(level: number): number {
    return Math.min(level, this.text.maxLevel)
  }

  private _shownLevel(z: number): number {
    return this._textLevel(clamp(Math.round(z), 0, this.controller.maxLevel))
  }

  private _syncWidth() {
    if (this.width === 0) this.width = this.container.clientWidth
    if (this.cacheWidth !== -1 && Math.abs(this.cacheWidth - this.width) > 0.01) {
      this.cache.clear()
      this.cacheWidth = -1
    }
  }

  private _renderFlow(level: number) {
    const built = build(this.text, level, false)
    this.flowEl.replaceChildren(...Array.from(built.root.childNodes))
    this.flowLevel = level
  }

  private _hideFlow() {
    if (this.mode !== 'flow') return
    // The words are absolutely positioned now, so a shrink-to-fit parent
    // (an inline bubble, a flex item) would collapse to nothing: keep the
    // width the text was measured at until it is real text again.
    this.container.style.width = `${this.width}px`
    if (this.opts.clip) this.container.style.overflow = 'clip'
    // Out of sight, still read by screen readers (R-75).
    this.flowEl.setAttribute(
      'style',
      'position:absolute;left:0;top:0;width:100%;opacity:0;pointer-events:none;user-select:none',
    )
  }

  private _enterFlow(level: number) {
    if (this.flowLevel !== level) this._renderFlow(level)
    if (this.mode !== 'flow') {
      this.flowEl.removeAttribute('style')
      if (this.morphEl) this.morphEl.style.display = 'none'
      this.container.style.height = ''
      this.container.style.width = ''
      this.container.style.overflow = ''
      this.lastHeight = -1
      this.mode = 'flow'
    }
  }

  private _dropMorph() {
    this.morphEl?.remove()
    this.morphEl = null
    this.morphNodes = []
    this.last = new Float64Array(0)
  }

  private _ensureMorph() {
    if (this.morphEl) {
      this.morphEl.style.display = ''
      return
    }
    const doc = document
    const layer = doc.createElement('div')
    layer.setAttribute('data-sz-morph', '')
    layer.setAttribute('aria-hidden', 'true')
    layer.setAttribute('style', 'position:absolute;left:0;top:0;width:100%;height:0;pointer-events:none;user-select:none')
    const tokens = this.text.tokens
    this.morphNodes = tokens.map((t) => (isBreak(t) ? null : morphNode(t)))
    for (const n of this.morphNodes) if (n) layer.appendChild(n)
    this.last = new Float64Array(tokens.length * 3).fill(Number.NaN)
    this.container.appendChild(layer)
    this.morphEl = layer
  }

  private _paint(from: LevelLayout, to: LevelLayout, move: number, z: number) {
    this._ensureMorph()
    const tokens = this.text.tokens
    const rewritten = this.text.rewrittenLevels
    const nodes = this.morphNodes
    const last = this.last
    for (let i = 0; i < tokens.length; i++) {
      const node = nodes[i]
      if (!node) continue
      const a = from.has[i] === 1
      const b = to.has[i] === 1
      const t = tokens[i]
      const o = a || b ? tokenOpacity(t.minLevel, t.maxLevel, z, rewritten) : 0
      const k = i * 3
      if (o <= 0.002) {
        if (!Number.isNaN(last[k + 2])) {
          node.style.display = 'none'
          last[k + 2] = Number.NaN
        }
        continue
      }
      // Shared words slide; words in only one level stay where they are and fade.
      const x = a && b ? lerp(from.xs[i], to.xs[i], move) : a ? from.xs[i] : to.xs[i]
      const y = a && b ? lerp(from.ys[i], to.ys[i], move) : a ? from.ys[i] : to.ys[i]
      if (Number.isNaN(last[k + 2])) node.style.display = ''
      if (Math.abs(x - last[k]) > 0.01 || Math.abs(y - last[k + 1]) > 0.01 || Number.isNaN(last[k])) {
        node.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`
        last[k] = x
        last[k + 1] = y
      }
      if (Math.abs(o - last[k + 2]) > 0.002 || Number.isNaN(last[k + 2])) {
        node.style.opacity = o >= 0.998 ? '' : o.toFixed(3)
        last[k + 2] = o
      }
    }
  }
}

function morphNode(t: LeveledToken): HTMLElement {
  const doc = document
  let outer: HTMLElement
  if (t.link !== null) {
    const a = doc.createElement('a')
    a.href = t.link
    a.tabIndex = -1
    a.setAttribute(LINK_ATTR, '')
    outer = a
  } else {
    outer = doc.createElement('span')
  }
  outer.setAttribute('style', 'position:absolute;left:0;top:0;white-space:pre;display:none')
  let host = outer
  if (t.style?.bold) host = host.appendChild(doc.createElement('strong'))
  if (t.style?.italic) host = host.appendChild(doc.createElement('em'))
  host.appendChild(doc.createTextNode(t.text))
  return outer
}
