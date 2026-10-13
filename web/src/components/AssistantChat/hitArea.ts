/** Keeps a compact visual (24-36px) but extends the touch target to >= 44px (Apple HIG). Needs a positioned button. */
export const HIT_AREA_CLASS = "relative after:absolute after:-inset-1 after:content-['']"

/** 28px visual (h-7) -> 44px. */
export const HIT_AREA_28_CLASS = "relative after:absolute after:-inset-2 after:content-['']"

/** 24px visual (h-6) -> 44px. */
export const HIT_AREA_24_CLASS = "relative after:absolute after:-inset-2.5 after:content-['']"

/** Same for inline text actions (12-13px labels): grows the touch target vertically. */
export const TEXT_HIT_AREA_CLASS = "relative after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-['']"
