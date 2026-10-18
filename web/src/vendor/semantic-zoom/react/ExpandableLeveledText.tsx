import { type HTMLAttributes, type ReactNode, forwardRef, useImperativeHandle } from 'react'
import type { LeveledText } from '../core/leveled-text'
import { useSemanticZoomController, useZoomLevel } from './hooks'
import { LeveledTextView } from './LeveledTextView'

export interface ExpandableLeveledTextHandle {
  readonly level: number
  readonly maxLevel: number
  setLevel(level: number): void
  next(): void
  expand(): void
  collapse(): void
}

export interface ExpandableLeveledTextProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  text: LeveledText
  initialLevel?: number
  /** Default: the levels the text uses (at least 2). */
  levelCount?: number
  /** Tapping the text steps to the next level. Default true. */
  expandOnTap?: boolean
  /** Stepping past the last level returns to the first. Default true. */
  wrap?: boolean
  onLevelChange?: (level: number) => void
  /** E.g. a "Show more / Show less" button. */
  footer?: (state: { level: number; maxLevel: number; toggle: () => void }) => ReactNode
  onLinkTap?: (href: string) => void
  textClassName?: string
  showMoreLabel?: string
  showLessLabel?: string
}

/**
 * One piece of leveled text that expands in place on tap, with no list or
 * controller to set up: an animated "read more" (R-66).
 */
export const ExpandableLeveledText = forwardRef<ExpandableLeveledTextHandle, ExpandableLeveledTextProps>(
  function ExpandableLeveledText(
    {
      text,
      initialLevel = 0,
      levelCount,
      expandOnTap = true,
      wrap = true,
      onLevelChange,
      footer,
      onLinkTap,
      textClassName,
      showMoreLabel = 'Show more',
      showLessLabel = 'Show less',
      ...rest
    },
    ref,
  ) {
    // Changing the level count needs a remount (e.g. a new `key`).
    const count = Math.max(2, levelCount ?? text.maxLevel + 1)
    const zoom = useSemanticZoomController({ levelCount: count, initialLevel, onLevelChange })
    const level = useZoomLevel(zoom)
    const max = zoom.maxLevel

    const setLevel = (l: number) => void zoom.animateToLevel(l, { anchor: false })
    const next = () => {
      if (level < max) setLevel(level + 1)
      else if (wrap) setLevel(0)
    }
    useImperativeHandle(ref, () => ({
      level,
      maxLevel: max,
      setLevel,
      next,
      expand: () => setLevel(max),
      collapse: () => setLevel(0),
    }))

    const canStep = level < max || wrap
    const tappable = expandOnTap && canStep
    return (
      <div {...rest}>
        <div
          role={tappable ? 'button' : undefined}
          tabIndex={tappable ? 0 : undefined}
          aria-expanded={tappable ? level === max : undefined}
          title={tappable ? (level === max ? showLessLabel : showMoreLabel) : undefined}
          onClick={(e) => {
            if (!tappable || (e.target as Element).closest('a')) return
            if (window.getSelection()?.toString()) return
            next()
          }}
          onKeyDown={(e) => {
            if (tappable && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              next()
            }
          }}
          style={tappable ? { cursor: 'pointer' } : undefined}
        >
          <LeveledTextView text={text} controller={zoom} onLinkTap={onLinkTap} className={textClassName} />
        </div>
        {footer?.({ level, maxLevel: max, toggle: next })}
      </div>
    )
  },
)
