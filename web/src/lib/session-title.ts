import type { Session, SessionSummary } from '@/types/api'

type SessionLike = Pick<SessionSummary, 'id' | 'metadata'> | Pick<Session, 'id' | 'metadata'>

export function getSessionTitle(
    session: SessionLike | null | undefined,
    options?: {
        fallbackSessionId?: string | null
        fallbackIdLength?: number
    }
): string {
    const fallbackIdLength = options?.fallbackIdLength ?? 8
    const name = session?.metadata?.name?.trim()
    if (name) {
        return name
    }

    const summaryText = session?.metadata?.summary?.text?.trim()
    if (summaryText) {
        return summaryText
    }

    const path = session?.metadata?.path?.trim()
    if (path) {
        const parts = path.split(/[\\/]+/).filter(Boolean)
        if (parts.length > 0) {
            return parts[parts.length - 1]
        }
    }

    const fallbackId = options?.fallbackSessionId ?? session?.id
    if (fallbackId) {
        return fallbackId.slice(0, fallbackIdLength)
    }

    return 'unknown'
}

// "规划 · Implement this design", "返工 4 · Prompt 写好了": a short tag before " · " can go first.
const LEADING_TAG_RE = /^[^·]{1,8}\s+·\s+/

/**
 * Forms of the session title from long to short, for <FitText kind="label">: the title, the title
 * without its leading tag, the short title the agent gave with change_title. When none fits, the
 * last one is cut; not the project folder, which would name every session of a project the same.
 */
export function getSessionLabelCandidates(session: SessionLike | null | undefined): string[] {
    const title = getSessionTitle(session)
    const renamed = Boolean(session?.metadata?.name?.trim())
    return [
        title,
        title.replace(LEADING_TAG_RE, ''),
        renamed ? undefined : session?.metadata?.summary?.short?.trim()
    ].filter((form, index, all): form is string => Boolean(form) && all.indexOf(form) === index)
}
