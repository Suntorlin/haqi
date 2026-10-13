/**
 * Pinning is stored as a reserved system tag, so it rides on the existing tags API:
 * synced across devices and kept across resume / account switches like any tag.
 * Tag UIs show getUserTags() instead of the raw list.
 */
export const PINNED_TAG = 'pinned'

type TaggedSession = { metadata?: { tags?: string[] } | null }

export function isSessionPinned(session: TaggedSession): boolean {
    return session.metadata?.tags?.includes(PINNED_TAG) === true
}

export function getUserTags(session: TaggedSession): string[] {
    return (session.metadata?.tags ?? []).filter((tag) => tag !== PINNED_TAG)
}

/** Full tag list to save: the user's own tags plus the pin flag. */
export function withPinTag(userTags: readonly string[], pinned: boolean): string[] {
    const tags = userTags.filter((tag) => tag !== PINNED_TAG)
    return pinned ? [...tags, PINNED_TAG] : tags
}
