/** Keeps a compact visual (24-36px) but extends the touch target to >= 44px (Apple HIG). Needs a positioned button. */
export const HIT_AREA_CLASS = "relative after:absolute after:-inset-1 after:content-['']"

/* 28px buttons: use IconButton / Button size="xs" (they carry their own 44px hit area). */

/** Same for inline text actions (12-13px labels): grows the touch target vertically. */
export const TEXT_HIT_AREA_CLASS = "relative after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"
