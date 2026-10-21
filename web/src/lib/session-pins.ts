/**
 * Pinning, snoozing and task membership are stored as reserved system tags, so they ride on the existing tags API:
 * synced across devices and kept across resume / account switches like any tag.
 * Tag UIs show getUserTags() instead of the raw list.
 */
export const PINNED_TAG = 'pinned'
/** `snooze:<epoch ms>`: the session is out of the way until that moment; `snooze:forever` until woken by hand. */
export const SNOOZE_TAG_PREFIX = 'snooze:'
/** `task:<task id>`: how older builds stored task membership. Still a system tag, so it stays hidden. */
export const TASK_TAG_PREFIX = 'task:'
/** Wake time of a snooze with no end. */
export const SNOOZE_FOREVER = Number.POSITIVE_INFINITY
const SNOOZE_FOREVER_VALUE = 'forever'
/** A snoozed session comes back at this local hour the next day. */
export const SNOOZE_WAKE_HOUR = 6

type TaggedSession = {
    metadata?: { tags?: string[] } | null
    active?: boolean
    pendingRequestsCount?: number
}

function isSystemTag(tag: string): boolean {
    return tag === PINNED_TAG || tag.startsWith(SNOOZE_TAG_PREFIX) || tag.startsWith(TASK_TAG_PREFIX)
}

export function isSessionPinned(session: TaggedSession): boolean {
    return session.metadata?.tags?.includes(PINNED_TAG) === true
}

export function getUserTags(session: TaggedSession): string[] {
    return (session.metadata?.tags ?? []).filter((tag) => !isSystemTag(tag))
}

/** Full tag list to save after editing user tags: the system tags already on the session stay. */
export function withUserTags(session: TaggedSession, userTags: readonly string[]): string[] {
    const systemTags = (session.metadata?.tags ?? []).filter(isSystemTag)
    return [...userTags.filter((tag) => !isSystemTag(tag)), ...systemTags]
}

/** Full tag list to save with the pin flag set or cleared. */
export function withPinTag(session: TaggedSession, pinned: boolean): string[] {
    const tags = (session.metadata?.tags ?? []).filter((tag) => tag !== PINNED_TAG)
    return pinned ? [...tags, PINNED_TAG] : tags
}

export function getSnoozeUntil(session: TaggedSession): number | null {
    const tag = session.metadata?.tags?.find((item) => item.startsWith(SNOOZE_TAG_PREFIX))
    if (!tag) return null
    const value = tag.slice(SNOOZE_TAG_PREFIX.length)
    if (value === SNOOZE_FOREVER_VALUE) return SNOOZE_FOREVER
    const until = Number(value)
    return Number.isFinite(until) ? until : null
}

/**
 * Snoozed until the wake time passes. A request waiting for approval blocks the agent,
 * so it brings the session back early.
 */
export function isSessionSnoozed(session: TaggedSession, now: number = Date.now()): boolean {
    const until = getSnoozeUntil(session)
    if (until === null || until <= now) return false
    return !(session.active && (session.pendingRequestsCount ?? 0) > 0)
}

/** Full tag list to save with the snooze set (wake time in epoch ms, or SNOOZE_FOREVER) or cleared (null). */
export function withSnoozeTag(session: TaggedSession, until: number | null): string[] {
    const tags = (session.metadata?.tags ?? []).filter((tag) => !tag.startsWith(SNOOZE_TAG_PREFIX))
    if (until === null) return tags
    return [...tags, `${SNOOZE_TAG_PREFIX}${until === SNOOZE_FOREVER ? SNOOZE_FOREVER_VALUE : until}`]
}

/** Next wake time: the next SNOOZE_WAKE_HOUR, local time (tomorrow, or today when snoozed after midnight). */
export function getNextSnoozeWake(now: Date = new Date()): number {
    const wake = new Date(now)
    wake.setHours(SNOOZE_WAKE_HOUR, 0, 0, 0)
    if (wake.getTime() <= now.getTime()) {
        wake.setDate(wake.getDate() + 1)
    }
    return wake.getTime()
}

/** Full tag list with the task's own tag added, so a session joined to a task shows in that tag's view. */
export function withTaskOwnTag(session: TaggedSession, tag: string): string[] {
    const tags = session.metadata?.tags ?? []
    return tags.includes(tag) ? tags : [tag, ...tags]
}
