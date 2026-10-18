import { type ReactNode, useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { SemanticZoomController, ZoomView } from '../core/controller'
import type { LeveledTextLoader } from '../core/loader'
import { easeInOut } from '../core/motion'
import { useSemanticZoom } from './hooks'
import { LeveledTextView, type LeveledTextViewProps } from './LeveledTextView'

export interface LazyLeveledTextViewProps extends Omit<LeveledTextViewProps, 'text' | 'capZoom'> {
  loader: LeveledTextLoader
  /** Start loading when shown instead of when the entry starts to zoom. */
  eager?: boolean
  /** Shown under the text while loading, e.g. a thin progress bar (R-72). */
  renderLoading?: () => ReactNode
  /** Shown under the text when loading failed. */
  renderError?: (error: unknown, retry: () => void) => ReactNode
  /** How long the new words take to morph in once loaded. Default 350 ms (R-73). */
  revealDuration?: number
}

const ZOOMING = 0.01

/**
 * Like `LeveledTextView`, for text from a `LeveledTextLoader`: the brief
 * text shows at once, the longer versions load the first time this entry
 * starts to zoom, then morph in (R-70..R-74).
 */
export function LazyLeveledTextView({
  loader,
  eager = false,
  renderLoading,
  renderError,
  revealDuration = 350,
  controller: explicit,
  itemId,
  ...rest
}: LazyLeveledTextViewProps) {
  const controller = useSemanticZoom(explicit)
  const state = useSyncExternalStore(
    loader.subscribe,
    () => `${loader.isLoaded}|${loader.isLoading}|${loader.error ? 1 : 0}`,
    () => 'false|false|0',
  )
  // 0 = only level 0 may show, 1 = no limit.
  const reveal = useRef(loader.isLoaded ? 1 : 0)

  // Starts loading when this entry starts to zoom; after a failure, only a
  // new zoom retries (R-71).
  useEffect(() => {
    let wasZooming = false
    const view: ZoomView = {
      prepare() {
        const zooming = controller.valueFor(itemId) > ZOOMING
        if (zooming && !loader.isLoaded && !loader.isLoading && (!loader.error || !wasZooming)) {
          void loader.ensureLoaded()
        }
        wasZooming = zooming
      },
      apply() {},
    }
    return controller.registerView(view)
  }, [controller, loader, itemId])

  useEffect(() => {
    if (eager) void loader.ensureLoaded()
  }, [eager, loader])

  // Loading rows appearing or going, and the reveal, change this entry's
  // height: keep the first visible entry still meanwhile (R-74).
  useEffect(() => {
    if (!loader.isLoading && !(loader.isLoaded && reveal.current < 1)) return
    const release = controller.holdAnchor()
    let raf = 0
    if (loader.isLoaded && reveal.current < 1) {
      if (controller.reduceMotion || revealDuration <= 0) {
        reveal.current = 1
        controller.scheduleFrame()
      } else {
        const start = performance.now()
        const from = reveal.current
        const tick = () => {
          const t = Math.min(1, (performance.now() - start) / revealDuration)
          reveal.current = from + (1 - from) * t
          controller.scheduleFrame()
          if (t < 1) raf = requestAnimationFrame(tick)
          else requestAnimationFrame(() => release())
        }
        raf = requestAnimationFrame(tick)
        return () => {
          cancelAnimationFrame(raf)
          reveal.current = 1
          release()
        }
      }
    }
    return () => {
      // Released after the new height has been laid out.
      requestAnimationFrame(() => release())
    }
  }, [state, controller, loader, revealDuration])

  const capZoom = useCallback(
    (z: number) => Math.min(z, easeInOut(reveal.current) * (controller as SemanticZoomController).maxLevel),
    [controller],
  )

  const extra = loader.isLoading
    ? renderLoading?.()
    : loader.error
      ? renderError?.(loader.error, () => void loader.ensureLoaded())
      : null

  return (
    <>
      <LeveledTextView {...rest} text={loader.text} itemId={itemId} controller={controller} capZoom={capZoom} />
      {extra}
    </>
  )
}
