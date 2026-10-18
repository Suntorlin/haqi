// Curves, the settle spring and the zoom math of semantic_zoom
// (c) Roshen De Zoysa, MIT. See docs/behavior.md R-28..R-42.

export type Curve = (t: number) => number

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
// `+ 0` turns -0 (e.g. Math.round(-0.4)) into 0.
export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v) + 0
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** CSS-style cubic Bézier easing, like Flutter's `Cubic`. */
export function cubic(x1: number, y1: number, x2: number, y2: number): Curve {
  const bez = (a: number, b: number, m: number) => 3 * a * (1 - m) * (1 - m) * m + 3 * b * (1 - m) * m * m + m * m * m
  return (t) => {
    if (t <= 0) return 0
    if (t >= 1) return 1
    // Binary search on x, as Flutter does (tolerance 0.001).
    let start = 0
    let end = 1
    for (;;) {
      const mid = (start + end) / 2
      const x = bez(x1, x2, mid)
      if (Math.abs(t - x) < 0.001) return bez(y1, y2, mid)
      if (x < t) start = mid
      else end = mid
    }
  }
}

export const linear: Curve = (t) => t
export const easeOut: Curve = cubic(0.0, 0.0, 0.58, 1.0)
export const easeInOut: Curve = cubic(0.42, 0.0, 0.58, 1.0)
export const easeInOutCubic: Curve = cubic(0.645, 0.045, 0.355, 1.0)

/** Flutter's `Interval(begin, end, curve)`. */
export function interval(begin: number, end: number, curve: Curve = linear): Curve {
  return (t) => {
    const u = clamp01((t - begin) / (end - begin))
    return u === 0 || u === 1 ? u : curve(u)
  }
}

// ───────────────────────────── spring ─────────────────────────────

export interface SpringDescription {
  mass: number
  stiffness: number
  damping: number
}

export function springWithDampingRatio(mass: number, stiffness: number, ratio: number): SpringDescription {
  return { mass, stiffness, damping: ratio * 2 * Math.sqrt(mass * stiffness) }
}

/** Slightly under-damped spring used when settling on a level (R-34). */
export const defaultSpring = springWithDampingRatio(1, 320, 0.9)

const TOLERANCE_DISTANCE = 1e-3
const TOLERANCE_VELOCITY = 1e-3

/** Closed-form damped spring from `start` to `end`, like Flutter's `SpringSimulation`. */
export class SpringSimulation {
  private readonly x: (t: number) => number
  private readonly v: (t: number) => number
  readonly end: number

  constructor(spring: SpringDescription, start: number, end: number, velocity: number) {
    this.end = end
    const { mass: m, stiffness: k, damping: c } = spring
    const x0 = start - end
    const disc = c * c - 4 * m * k
    if (Math.abs(disc) < 1e-9) {
      // Critically damped.
      const r = -c / (2 * m)
      const c1 = x0
      const c2 = velocity - r * x0
      this.x = (t) => (c1 + c2 * t) * Math.exp(r * t)
      this.v = (t) => (r * (c1 + c2 * t) + c2) * Math.exp(r * t)
    } else if (disc > 0) {
      // Over-damped.
      const r1 = (-c - Math.sqrt(disc)) / (2 * m)
      const r2 = (-c + Math.sqrt(disc)) / (2 * m)
      const c2 = (velocity - r1 * x0) / (r2 - r1)
      const c1 = x0 - c2
      this.x = (t) => c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t)
      this.v = (t) => c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t)
    } else {
      // Under-damped.
      const w = Math.sqrt(4 * m * k - c * c) / (2 * m)
      const r = -c / (2 * m)
      const c1 = x0
      const c2 = (velocity - r * x0) / w
      this.x = (t) => Math.exp(r * t) * (c1 * Math.cos(w * t) + c2 * Math.sin(w * t))
      this.v = (t) => {
        const p = Math.exp(r * t)
        const cos = Math.cos(w * t)
        const sin = Math.sin(w * t)
        return p * (c2 * w * cos - c1 * w * sin) + r * p * (c2 * sin + c1 * cos)
      }
    }
  }

  /** Position at `t` seconds. */
  positionAt(t: number): number {
    return this.end + this.x(t)
  }

  /** Velocity at `t` seconds. */
  velocityAt(t: number): number {
    return this.v(t)
  }

  isDone(t: number): boolean {
    return Math.abs(this.x(t)) < TOLERANCE_DISTANCE && Math.abs(this.v(t)) < TOLERANCE_VELOCITY
  }
}

// ───────────────────────────── zoom math ─────────────────────────────

/** Defaults of the original detector. */
export const zoomDefaults = {
  /** Levels per doubling of finger distance (R-30). */
  levelsPerDoubling: 1.6,
  /** Fraction applied past the first/last level (R-31). */
  overscrollResistance: 0.25,
  /** Seconds of velocity projected forward when snapping (R-33). */
  flingProjection: 0.12,
  /** ms without a ctrl+wheel event before it counts as released (R-58). */
  signalSettleDelay: 160,
} as const

/** Rubber band past 0 and `max` (R-31). */
export function rubberBand(z: number, max: number, resistance: number = zoomDefaults.overscrollResistance): number {
  if (z < 0) return z * resistance
  if (z > max) return max + (z - max) * resistance
  return z
}

/** Zoom value for a pinch `scale` relative to its start (R-30). */
export function zoomForScale(
  startZoom: number,
  scale: number,
  levelsPerDoubling: number = zoomDefaults.levelsPerDoubling,
): number {
  return startZoom + (Math.log(Math.max(scale, 1e-3)) / Math.LN2) * levelsPerDoubling
}

/** Light smoothing so one jittery sample doesn't decide the snap (R-32). */
export function smoothVelocity(previous: number, dz: number, dtSeconds: number): number {
  if (dtSeconds <= 0) return previous
  return 0.7 * previous + 0.3 * (dz / dtSeconds)
}

/** The level a release snaps to (R-33). */
export function snapLevel(
  value: number,
  velocity: number,
  maxLevel: number,
  projection: number = zoomDefaults.flingProjection,
): number {
  return clamp(Math.round(value + velocity * projection), 0, maxLevel)
}

/** The two levels around `z` and the eased progress between them (R-39). */
export function between(z: number, maxLevel: number, moveCurve: Curve = easeInOutCubic): [number, number, number] {
  const zz = clamp(z, 0, maxLevel)
  const lo = Math.min(Math.floor(zz), maxLevel)
  const hi = Math.min(lo + 1, maxLevel)
  return [lo, hi, moveCurve(zz - lo)]
}

const FADE_IN: Curve = interval(0.25, 1)
const LATE_FADE_IN: Curve = interval(0.45, 1)
const FADE_OUT: Curve = interval(0, 0.4, easeOut)

/**
 * Opacity of a token at zoom `z` (R-42). A token shown from level L fades in
 * over z in (L-1, L]; one dropped after level M fades out over z in [M, M+1).
 * Dropped words leave early and, on levels that replace words, new ones
 * arrive late, so the two never overlap.
 */
export function tokenOpacity(
  minLevel: number,
  maxLevel: number | null,
  z: number,
  rewrittenLevels: ReadonlySet<number>,
): number {
  const tIn = clamp01(z - minLevel + 1)
  const fadeIn = rewrittenLevels.has(minLevel) ? LATE_FADE_IN(tIn) : FADE_IN(tIn)
  if (maxLevel === null) return fadeIn
  const fadeOut = 1 - FADE_OUT(clamp01(z - maxLevel))
  return Math.min(fadeIn, fadeOut)
}
