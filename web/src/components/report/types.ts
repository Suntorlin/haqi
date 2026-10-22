// Report kit: the lead's live report, decision cards and checklists.
// Presentational only — business code supplies all data and copy that is data
// (questions, option labels, statuses); fixed UI labels go through i18n keys.

/** Where a tracked goal stands. Drives ring colour and row emphasis. */
export type ReportTone = 'wait' | 'live' | 'stuck' | 'done'

/** One acceptance check inside a goal or a finished report. */
export type CheckState = 'done' | 'live' | 'wait' | 'todo'

export type DecisionOption = {
    label: string
    /** What the user gains by picking this; empty hides the line. */
    good: string
    /** What it costs; empty hides the line. */
    cost: string
    recommended?: boolean
}

/** Which goal a decision belongs to, shown above the question. */
export type DecisionSource = {
    /** Orb seed, usually the goal id. */
    seed: string
    name: string
    /** e.g. "等了 12 分钟". */
    meta?: string
}

export type Decision = {
    id: string
    question: string
    context?: string
    /** Short facts the lead gathered, rendered as a bullet list. */
    basis?: string[]
    options: DecisionOption[]
    source?: DecisionSource
    /** The user's ask-back, waiting for the asker's answer. */
    asked?: string
}

/** One goal row in the compact progress list. */
export type ProgressItem = {
    id: string
    /** Orb seed; defaults to `id`. */
    seed?: string
    name: string
    /** One short status line. */
    status: string
    tone: ReportTone
    done: number
    total: number
    /** Trailing label when done (e.g. "10:42"); live rows show done/total. */
    when?: string
    unread?: boolean
}

export type CheckItem = {
    title: string
    /** A second line under the title (how the check is verified). */
    subtitle?: string
    state: CheckState
    /** Trailing text (a time, a count). Ignored when `waiting`. */
    trailing?: string
    /** Show the "your call" badge instead of the trailing text. */
    waiting?: boolean
    onClick?: () => void
}

export type ReportStat = {
    value: string
    label: string
}

export type LatestMessage = {
    from: 'lead' | 'me'
    text: string
    when: string
}

export type Shot = {
    src: string
    caption: string
}
