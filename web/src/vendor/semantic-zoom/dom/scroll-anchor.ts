// Scroll anchoring for a scroll container, the browser counterpart of
// RenderSliverSemanticZoomList in semantic_zoom ((c) Roshen De Zoysa, MIT).
// See docs/behavior.md R-46..R-53, R-67, R-68.
//
// Flutter corrects the scroll offset during layout. In the browser the
// controller's frame writes every item's new height first, then calls
// `correct()`, which reads the anchored item's position once (one forced
// layout) and shifts scrollTop by the drift before the frame is painted.

import type { AnchorClient } from '../core/controller'

export const ITEM_ATTR = 'data-sz-item'

export interface ScrollAnchorOptions {
  /**
   * Chat layout: the newest item is at the bottom and the leading edge is
   * the bottom edge (R-68).
   */
  reverse?: boolean
  /**
   * Chat in normal DOM order (newest last, no column-reverse): items hold
   * their bottom edge and the newest visible item is the leading one, as in
   * `reverse`, while extra room still goes after the content (HAQI addition).
   */
  bottomEdge?: boolean
  /** Selector of the items that can be anchored. Default `[data-sz-item]`. */
  itemSelector?: string
}

/** Corrections smaller than this are ignored (R-47). */
const EPSILON = 0.5
/** How long borrowed room past the end takes to spring back. */
const BOUNCE_MS = 250

export class ScrollAnchor implements AnchorClient {
  readonly scroller: HTMLElement
  reverse: boolean
  bottomEdge: boolean
  private readonly selector: string
  private anchor: Element | null = null
  /** Leading edge of the anchor in client coordinates when it was pinned. */
  private edge = 0
  /** Last correction in px, for tests and diagnostics. */
  lastCorrection = 0
  /**
   * Room added after the content when a correction needs to scroll further
   * than the content allows (e.g. a short list growing above its anchor).
   * It only shrinks afterwards, as the user scrolls it out of view.
   */
  private spacer: HTMLDivElement | null = null
  private spacerHeight = 0
  private bounceRaf = 0
  private readonly onScroll = () => {
    if (this.spacerHeight > 0 && !this.anchor && !this.bounceRaf) this.trimSpacer()
  }

  constructor(scroller: HTMLElement, opts: ScrollAnchorOptions = {}) {
    this.scroller = scroller
    this.reverse = opts.reverse ?? false
    this.bottomEdge = opts.bottomEdge ?? false
    this.selector = opts.itemSelector ?? `[${ITEM_ATTR}]`
    scroller.addEventListener('scroll', this.onScroll, { passive: true })
  }

  /** Removes listeners and the spacer. */
  destroy(): void {
    if (this.bounceRaf) cancelAnimationFrame(this.bounceRaf)
    this.scroller.removeEventListener('scroll', this.onScroll)
    this.spacer?.remove()
    this.spacer = null
  }

  private setSpacer(h: number) {
    h = Math.max(0, h)
    if (this.spacer && Math.abs(h - this.spacerHeight) < 0.01) return
    if (!this.spacer) {
      this.spacer = document.createElement('div')
      this.spacer.setAttribute('aria-hidden', 'true')
      this.spacer.setAttribute('data-sz-spacer', '')
      this.spacer.style.flex = 'none'
      // Visually after the content: last child normally, first child in a
      // column-reverse chat (where the first child is drawn at the bottom).
      if (this.reverse) this.scroller.prepend(this.spacer)
      else this.scroller.append(this.spacer)
    }
    this.spacerHeight = h
    this.spacer.style.height = `${h}px`
  }

  /** Shrinks the spacer to the part of it that is on screen. */
  private trimSpacer() {
    if (!this.spacer) return
    const visible = this.scroller.getBoundingClientRect().bottom - this.spacer.getBoundingClientRect().top
    this.setSpacer(Math.min(this.spacerHeight, Math.max(0, visible)))
  }

  /** The pinned item, if any. */
  get anchorElement(): Element | null {
    return this.anchor
  }

  private edgeOf(el: Element): number {
    const r = el.getBoundingClientRect()
    return this.reverse || this.bottomEdge ? r.bottom : r.top
  }

  private items(): Element[] {
    return Array.from(this.scroller.querySelectorAll(this.selector))
  }

  private stopBounce() {
    if (this.bounceRaf) cancelAnimationFrame(this.bounceRaf)
    this.bounceRaf = 0
  }

  /**
   * Like Flutter's bouncing scroll physics: the room borrowed past the end of
   * the content springs back once nothing is anchored any more.
   */
  private bounceBack() {
    this.trimSpacer()
    const from = this.spacerHeight
    if (from <= 0) return
    const start = performance.now()
    const step = () => {
      const t = Math.min(1, (performance.now() - start) / BOUNCE_MS)
      const eased = 1 - (1 - t) ** 3
      this.setSpacer(from * (1 - eased))
      this.bounceRaf = t < 1 ? requestAnimationFrame(step) : 0
    }
    this.bounceRaf = requestAnimationFrame(step)
  }

  captureAnchorAt(x: number, y: number): boolean {
    this.stopBounce()
    this.anchor = null
    const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null
    const item = hit?.closest(this.selector)
    if (item && this.scroller.contains(item)) {
      this.pin(item)
      return true
    }
    // Between items (e.g. in a gap): take the one whose box spans y.
    for (const el of this.items()) {
      const r = el.getBoundingClientRect()
      if (y >= r.top && y <= r.bottom) {
        this.pin(el)
        return true
      }
    }
    return this.captureLeadingAnchor()
  }

  captureLeadingAnchor(): boolean {
    this.stopBounce()
    this.anchor = null
    const view = this.scroller.getBoundingClientRect()
    const items = this.items()
    if (this.reverse || this.bottomEdge) {
      // Newest visible: the last one in reading order that starts above the bottom.
      for (let i = items.length - 1; i >= 0; i--) {
        const r = items[i].getBoundingClientRect()
        if (r.top < view.bottom && r.height > 0) {
          this.pin(items[i])
          return true
        }
      }
      return false
    }
    for (const el of items) {
      const r = el.getBoundingClientRect()
      if (r.bottom > view.top && r.height > 0) {
        this.pin(el)
        return true
      }
    }
    return false
  }

  /** Pins `el` where it is now, e.g. to hold it still while the app swaps its content (HAQI addition). */
  pinElement(el: Element): void {
    this.stopBounce()
    this.pin(el)
  }

  private pin(el: Element) {
    this.anchor = el
    this.edge = this.edgeOf(el)
  }

  correct(): void {
    const el = this.anchor
    this.lastCorrection = 0
    if (!el) return
    if (!el.isConnected) {
      this.anchor = null
      return
    }
    const sc = this.scroller
    let total = 0
    // Usually one pass; a second one after making room at the end.
    for (let pass = 0; pass < 2; pass++) {
      const delta = this.edgeOf(el) - this.edge
      if (Math.abs(delta) < EPSILON) break
      // scrollTop grows towards the end of the content in both normal and
      // column-reverse scrollers, so the same correction works for chats.
      const before = sc.scrollTop
      sc.scrollTop = before + delta
      const moved = sc.scrollTop - before
      total += moved
      const missing = delta - moved
      if (delta <= 0 || missing < EPSILON) break
      // Clamped at the end of the content: make room after it.
      if (this.reverse) {
        // In a column-reverse chat scrollTop 0 is the bottom and stays the
        // bottom, so growing the room there lifts the content by as much.
        this.setSpacer(this.spacerHeight + missing)
      } else {
        this.setSpacer(this.spacerHeight)
        const r = sc.getBoundingClientRect()
        const spacerTop = this.spacer!.getBoundingClientRect().top - r.top - sc.clientTop + sc.scrollTop
        const padBottom = parseFloat(getComputedStyle(sc).paddingBottom) || 0
        this.setSpacer(before + delta + sc.clientHeight - spacerTop - padBottom)
      }
    }
    this.lastCorrection = total
  }

  releaseAnchor(): void {
    this.anchor = null
    if (this.spacerHeight > 0) this.bounceBack()
  }
}
