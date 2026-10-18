import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react'
import { SemanticZoomController, type SemanticZoomControllerOptions } from '../core/controller'
import { createMeasureBatch } from '../dom/text-engine'

export const SemanticZoomContext = createContext<SemanticZoomController | null>(null)

/** The controller of the nearest list, grid or provider. Throws with a fix-it hint when there is none. */
export function useSemanticZoom(explicit?: SemanticZoomController | null): SemanticZoomController {
  const fromContext = useContext(SemanticZoomContext)
  const controller = explicit ?? fromContext
  if (!controller) {
    throw new Error(
      'semantic-zoom-react: no SemanticZoomController found. Put the view inside ' +
        '<SemanticZoomList>, <SemanticZoomGrid> or <SemanticZoomProvider>, or pass controller={...}. ' +
        'Create one with useSemanticZoomController().',
    )
  }
  return controller
}

export interface UseSemanticZoomControllerOptions extends Omit<SemanticZoomControllerOptions, 'createBatch'> {
  /** Called when the committed global level changes. */
  onLevelChange?: (level: number) => void
}

/**
 * Creates a controller for this component's lifetime and disposes it on
 * unmount (like Flutter's `DefaultSemanticZoomController`). Follows the
 * `prefers-reduced-motion` setting unless `reduceMotion` is given.
 */
export function useSemanticZoomController(options: UseSemanticZoomControllerOptions = {}): SemanticZoomController {
  const [controller] = useState(() => new SemanticZoomController({ ...options, createBatch: createMeasureBatch }))

  useEffect(() => {
    controller.revive()
    return () => controller.dispose()
  }, [controller])

  useEffect(() => {
    if (options.reduceMotion !== undefined || typeof matchMedia === 'undefined') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      controller.reduceMotion = mq.matches
      controller.scheduleFrame()
    }
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [controller, options.reduceMotion])

  const onLevelChange = options.onLevelChange
  useEffect(() => {
    if (!onLevelChange) return
    let last = controller.level
    return controller.subscribe(() => {
      if (controller.level !== last) {
        last = controller.level
        onLevelChange(last)
      }
    })
  }, [controller, onLevelChange])

  return controller
}

/** The committed global level; re-renders only when it changes. */
export function useZoomLevel(controller: SemanticZoomController): number {
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.level,
    () => controller.level,
  )
}

/** The committed level of one item. */
export function useItemLevel(controller: SemanticZoomController, itemId: unknown): number {
  return useSyncExternalStore(
    controller.subscribe,
    () => controller.itemLevel(itemId),
    () => controller.itemLevel(itemId),
  )
}

/** Whether a pinch is in progress. */
export function useIsPinching(controller: SemanticZoomController): boolean {
  return useSyncExternalStore(
    controller.subscribeGesture,
    () => controller.isGesturing,
    () => false,
  )
}
