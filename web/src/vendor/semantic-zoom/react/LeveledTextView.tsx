import { type HTMLAttributes, useEffect, useLayoutEffect, useRef } from 'react'
import type { SemanticZoomController } from '../core/controller'
import type { LeveledText } from '../core/leveled-text'
import { LeveledTextEngine } from '../dom/text-engine'
import { useSemanticZoom } from './hooks'

export interface LeveledTextViewProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The text to show. Create it once with your data, not in render. */
  text: LeveledText
  /** Identifies this item for per-item zoom (`setItemLevel`). Without it the view follows the global level. */
  itemId?: unknown
  /** Defaults to the nearest list, grid or provider. */
  controller?: SemanticZoomController
  /** Called with a link's href instead of following it. */
  onLinkTap?: (href: string) => void
  /** Clip words to the current height while they move (e.g. inside chat bubbles). Default false, like the original. */
  clip?: boolean
  /** @internal Used by LazyLeveledTextView. */
  capZoom?: (z: number) => number
}

/**
 * Shows `text` at the controller's zoom, morphing between levels: shared
 * words slide, the rest fade in or out in place. The font size never
 * changes.
 *
 * At rest it is plain, selectable text that screen readers read in full.
 * Don't give this element padding or borders; put them on a wrapper. Give
 * it a definite width (a block, or `w-full` in a flex row), like the
 * original fills its bounded width: in a shrink-to-fit parent the width is
 * held while words move, then follows the new text.
 */
export function LeveledTextView({
  text,
  itemId,
  controller: explicit,
  onLinkTap,
  capZoom,
  clip,
  ...rest
}: LeveledTextViewProps) {
  const controller = useSemanticZoom(explicit)
  const ref = useRef<HTMLDivElement>(null)
  const engine = useRef<LeveledTextEngine | null>(null)
  const latest = useRef({ text, itemId, onLinkTap, capZoom, clip })
  latest.current = { text, itemId, onLinkTap, capZoom, clip }

  useLayoutEffect(() => {
    const { text, itemId, onLinkTap, capZoom, clip } = latest.current
    const e = new LeveledTextEngine(ref.current!, controller, text, { itemId, onLinkTap, capZoom, clip })
    engine.current = e
    return () => {
      e.destroy()
      engine.current = null
    }
  }, [controller])

  useLayoutEffect(() => {
    engine.current?.setText(text)
  }, [text])

  useEffect(() => {
    engine.current?.setOptions({ itemId, onLinkTap, capZoom, clip })
  }, [itemId, onLinkTap, capZoom, clip])

  return <div {...rest} ref={ref} data-sz-text="" />
}
