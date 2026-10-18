import {
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { SemanticZoomController } from '../core/controller'
import { type GestureOptions, attachZoomGestures } from '../dom/gestures'
import { ITEM_ATTR, ScrollAnchor } from '../dom/scroll-anchor'
import { SemanticZoomContext } from './hooks'

export interface UseSemanticZoomScrollerOptions extends GestureOptions {
  /** Chat layout: newest item at the bottom (R-68). */
  reverse?: boolean
  /** Chat in normal DOM order: items hold their bottom edge (see `ScrollAnchorOptions.bottomEdge`). */
  bottomEdge?: boolean
  /** Selector of anchorable items. Default `[data-sz-item]`. */
  itemSelector?: string
  /** Turn off pinch/wheel/keyboard input (anchoring stays). */
  gestures?: boolean
}

/**
 * Makes `ref` (a scroll container) zoomable: pinch, ctrl+wheel, Safari
 * gestures and keyboard input, plus scroll anchoring. The building block of
 * `SemanticZoomList` and `SemanticZoomGrid`, for your own scroll views.
 */
export function useSemanticZoomScroller(
  ref: RefObject<HTMLElement | null>,
  controller: SemanticZoomController,
  options: UseSemanticZoomScrollerOptions = {},
): ScrollAnchor | null {
  const [anchor, setAnchor] = useState<ScrollAnchor | null>(null)
  const latest = useRef(options)
  latest.current = options
  const { reverse = false, bottomEdge = false, itemSelector, gestures = true, keyboardShortcuts } = options

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const a = new ScrollAnchor(el, { reverse, bottomEdge, itemSelector })
    const off = controller.addAnchorClient(a)
    setAnchor(a)
    return () => {
      off()
      a.destroy()
      setAnchor(null)
    }
  }, [controller, ref, reverse, bottomEdge, itemSelector])

  useEffect(() => {
    const el = ref.current
    if (!el || !gestures) return
    return attachZoomGestures(el, controller, {
      ...latest.current,
      keyboardShortcuts,
      onPinchChange: (p) => latest.current.onPinchChange?.(p),
    })
  }, [controller, ref, gestures, keyboardShortcuts])

  return anchor
}

interface ScrollerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  controller: SemanticZoomController
  itemCount: number
  renderItem: (index: number) => ReactNode
  /** React key for item `index`. Default: the index. */
  getItemKey?: (index: number) => string | number
  /** Class of the wrapper around each item (the element that gets anchored). */
  itemClassName?: string
  itemStyle?: CSSProperties
  /** Rendered before the first item, inside the scroll container (e.g. a header). */
  header?: ReactNode
  footer?: ReactNode
  /** Class of the element that holds the items. */
  contentClassName?: string
  contentStyle?: CSSProperties
  gestureOptions?: GestureOptions
  keyboardShortcuts?: GestureOptions['keyboardShortcuts']
  scrollerRef?: RefObject<HTMLDivElement | null>
}

export interface SemanticZoomListProps extends ScrollerProps {
  /**
   * Chat layout: item 0 is the newest and is drawn at the bottom; the list
   * starts scrolled to the bottom and grows upwards (R-68).
   */
  reverse?: boolean
}

function useScrollerRef(external?: RefObject<HTMLDivElement | null>) {
  const own = useRef<HTMLDivElement>(null)
  return external ?? own
}

function Items({
  itemCount,
  renderItem,
  getItemKey,
  itemClassName,
  itemStyle,
  reverse,
}: Pick<ScrollerProps, 'itemCount' | 'renderItem' | 'getItemKey' | 'itemClassName' | 'itemStyle'> & {
  reverse?: boolean
}) {
  const out: ReactNode[] = []
  for (let k = 0; k < itemCount; k++) {
    // A chat keeps reading order oldest → newest in the DOM, so screen
    // readers and selection read it top to bottom.
    const i = reverse ? itemCount - 1 - k : k
    out.push(
      <div key={getItemKey ? getItemKey(i) : i} {...{ [ITEM_ATTR]: '' }} data-index={i} className={itemClassName} style={itemStyle}>
        {renderItem(i)}
      </div>,
    )
  }
  return <>{out}</>
}

/**
 * A ready-made zoomable scrolling list. Put `LeveledTextView`s inside the
 * items; they find the controller through context.
 */
export function SemanticZoomList({
  controller,
  itemCount,
  renderItem,
  getItemKey,
  itemClassName,
  itemStyle,
  header,
  footer,
  contentClassName,
  contentStyle,
  gestureOptions,
  keyboardShortcuts,
  scrollerRef,
  reverse = false,
  style,
  ...rest
}: SemanticZoomListProps) {
  const ref = useScrollerRef(scrollerRef)
  useSemanticZoomScroller(ref, controller, { ...gestureOptions, keyboardShortcuts, reverse })
  return (
    <SemanticZoomContext.Provider value={controller}>
      <div
        {...rest}
        ref={ref}
        data-sz-list=""
        data-sz-reverse={reverse ? '' : undefined}
        style={{
          overflowY: 'auto',
          overscrollBehavior: 'contain',
          // column-reverse keeps a chat pinned to its bottom edge and makes
          // scrollTop 0 mean "newest message".
          ...(reverse ? { display: 'flex', flexDirection: 'column-reverse' } : null),
          ...style,
        }}
      >
        <div className={contentClassName} style={reverse ? { flex: 'none', ...contentStyle } : contentStyle}>
          {header}
          <Items {...{ itemCount, renderItem, getItemKey, itemClassName, itemStyle, reverse }} />
          {footer}
        </div>
      </div>
    </SemanticZoomContext.Provider>
  )
}

export interface SemanticZoomGridProps extends ScrollerProps {
  /** Fixed number of columns. */
  columns?: number
  /** Maximum column width in px; the number of columns follows the width (R-69). */
  maxColumnWidth?: number
  /** Space between columns and rows in px. */
  gap?: number
  rowGap?: number
}

/** A zoomable grid: rows grow with their tallest card; cards are top-aligned (R-69). */
export function SemanticZoomGrid({
  controller,
  itemCount,
  renderItem,
  getItemKey,
  itemClassName,
  itemStyle,
  header,
  footer,
  contentClassName,
  contentStyle,
  gestureOptions,
  keyboardShortcuts,
  scrollerRef,
  columns,
  maxColumnWidth = 380,
  gap = 12,
  rowGap,
  style,
  ...rest
}: SemanticZoomGridProps) {
  const ref = useScrollerRef(scrollerRef)
  const content = useRef<HTMLDivElement>(null)
  useSemanticZoomScroller(ref, controller, { ...gestureOptions, keyboardShortcuts })
  const [auto, setAuto] = useState(1)

  useLayoutEffect(() => {
    if (columns) return
    const el = content.current
    if (!el) return
    const update = (w: number) => setAuto(Math.max(1, Math.ceil((w + gap) / (maxColumnWidth + gap))))
    update(el.clientWidth)
    const ro = new ResizeObserver(([e]) => update(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [columns, maxColumnWidth, gap])

  const count = columns ?? auto
  return (
    <SemanticZoomContext.Provider value={controller}>
      <div {...rest} ref={ref} data-sz-grid="" style={{ overflowY: 'auto', overscrollBehavior: 'contain', ...style }}>
        {header}
        <div
          ref={content}
          className={contentClassName}
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`,
            alignItems: 'start',
            columnGap: gap,
            rowGap: rowGap ?? gap,
            ...contentStyle,
          }}
        >
          <Items {...{ itemCount, renderItem, getItemKey, itemClassName, itemStyle }} />
        </div>
        {footer}
      </div>
    </SemanticZoomContext.Provider>
  )
}

/** Provides a controller to `LeveledTextView`s outside a list. */
export function SemanticZoomProvider({ controller, children }: { controller: SemanticZoomController; children: ReactNode }) {
  return <SemanticZoomContext.Provider value={controller}>{children}</SemanticZoomContext.Provider>
}
