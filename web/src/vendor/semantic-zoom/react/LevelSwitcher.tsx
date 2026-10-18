import { type HTMLAttributes, type KeyboardEvent, useRef } from 'react'
import type { SemanticZoomController } from '../core/controller'
import { useZoomLevel } from './hooks'

export interface LevelSwitcherProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange'> {
  controller: SemanticZoomController
  /** Button labels. Default: the controller's `levelLabels` or "Detail i of n". */
  labels?: readonly string[]
  /** Accessible name of the group. */
  label?: string
  /** Class of each button. The selected one has `data-active` and `aria-checked="true"`. */
  buttonClassName?: string
}

/**
 * A segmented control for the global level, for people who can't or won't
 * pinch (R-77). It is a radio group: arrow keys move between levels.
 */
export function LevelSwitcher({ controller, labels, label = 'Detail level', buttonClassName, ...rest }: LevelSwitcherProps) {
  const level = useZoomLevel(controller)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const names = Array.from({ length: controller.levelCount }, (_, i) => labels?.[i] ?? controller.labelForLevel(i))

  const select = (i: number, focus = false) => {
    void controller.animateToLevel(i)
    if (focus) refs.current[i]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const max = controller.maxLevel
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(max, level + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, level - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = max
    if (next === null) return
    e.preventDefault()
    select(next, true)
  }

  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} {...rest}>
      {names.map((name, i) => (
        <button
          key={i}
          ref={(b) => {
            refs.current[i] = b
          }}
          type="button"
          role="radio"
          aria-checked={i === level}
          tabIndex={i === level ? 0 : -1}
          data-active={i === level ? '' : undefined}
          className={buttonClassName}
          onClick={() => select(i)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}
