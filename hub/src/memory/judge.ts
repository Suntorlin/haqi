import { yesProbability, type JevAnswer, type JevQuestion } from './jev'

export type MemoryLevel = 'fact' | 'experience' | 'principle'
export type MemoryStatus = 'active' | 'pending' | 'candidate' | 'archived'

export const LEVEL_RANK: Record<MemoryLevel, number> = { fact: 0, experience: 1, principle: 2 }

/** Thresholds of the rule: below keepMin a candidate is not kept; Jev must be sure (>= SURE) about level and scope or it says so in the reason. */
export const THRESHOLDS = { secret: 0.5, keepMin: 0.6, writtenKeepMin: 0.3, sure: 0.6, match: 0.8 } as const

/**
 * Where a candidate comes from, which decides how far it can go on its own:
 * - written: the user wrote it down (MEMORY.md); it is active.
 * - said: the user's own words in a message; it waits for the user's approval.
 * - agent: an agent's note or guess; it is watched, and waits for approval only once it keeps coming up.
 */
export type Origin = 'written' | 'said' | 'agent'

/**
 * Watching an agent's memory: it waits for approval once it comes up TRIAL.promote times within
 * TRIAL.windowDays, and is let go when nothing mentions it for TRIAL.windowDays.
 * An active experience mentioned TRIAL.principleAt times in all is offered to the user as a principle.
 */
export const TRIAL = { windowDays: 30, promote: 3, principleAt: 5 } as const

/** Memories waiting for approval are offered in one go: the user hears about them once REVIEW.batch are waiting. */
export const REVIEW = { batch: 10, quietHours: 24 } as const

const LEVEL_CRITERIA: Record<MemoryLevel, unknown> = {
    fact: {
        covers: 'A specific observation of what happened or what is true right now, usually tied to a time, place, file, session, count or number. It reports; it does not recommend.',
        example: 'The nightly build failed twice this week because the disk was full.'
    },
    experience: {
        covers: "A lesson, pattern or guess generalized from what happened: 'when X, doing Y works or fails', or 'the user seems to ...'. It may be wrong and should be checked against more cases.",
        example: 'Builds tend to fail on Mondays, probably because the cache is cold.'
    },
    principle: {
        covers: 'A settled rule or preference that should guide behaviour from now on, phrased as what to always or never do, or what the user wants. Not a guess and not a one-time event.',
        example: 'Always run the linter before committing.'
    }
}

/** The questions Jev answers for one candidate, in one request. */
export function buildQuestions(input: { hasProject: boolean; similar: Array<{ id: string; text: string }> }): Record<string, JevQuestion> {
    const questions: Record<string, JevQuestion> = {
        keep: {
            type: 'noul',
            instructions: '`candidate` is a note a coding agent wants to save into the long-term memory of one developer. Does it state a lasting fact, lesson, rule or preference that should change how future, unrelated sessions behave?',
            criteria: {
                true: 'Yes: it stays true after the current task, such as a standing preference, a rule, a lesson learned, or how a system works.',
                false: 'No: it only describes the task in progress or this moment, is small talk, or only restates what the code, files or git history already show.'
            }
        },
        level: {
            type: 'choice',
            instructions: { context: '`candidate` is a note in a developer\'s long-term memory for coding agents.', question: 'How mature is `candidate` as knowledge?' },
            criteria: LEVEL_CRITERIA as Record<string, unknown>
        },
        secret: {
            type: 'noul',
            instructions: 'Does `candidate` contain the actual value of a secret, such as a password, API key, access token or private key? Saying that a key exists, or where it is stored, does not count.'
        }
    }
    if (input.hasProject) {
        questions.scope = {
            type: 'choice',
            instructions: { context: '`project` is the repository the session was working in.', question: 'Where does `candidate` apply?' },
            criteria: {
                global: {
                    covers: 'The developer themself, in every project: the language, tone and length they want; how to report; what needs their approval; how work is verified, delivered and handed off; tools and accounts they use everywhere.',
                    test: 'Would this still be true if the developer opened a session in a completely different project tomorrow?'
                },
                project: {
                    covers: 'Only the repository in `project`: how it is built, run, tested and deployed; its architecture, commands, environments, conventions and pitfalls.',
                    test: 'Useful to future sessions in this repository, but not in other projects.'
                }
            }
        }
    }
    if (input.similar.length > 0) questions.match = matchQuestion(input.similar)
    return questions
}

/** "Is `candidate` the same memory as one of these?", alone when cleaning up and inside buildQuestions when capturing. */
export function matchQuestion(similar: Array<{ id: string; text: string }>): JevQuestion {
    const criteria: Record<string, unknown> = {}
    for (const item of similar) criteria[item.id] = item.text
    criteria.none = 'No entry is about the same rule, lesson or fact as `candidate`.'
    return {
        type: 'choice',
        instructions: 'Which entry is about the same rule, lesson or fact as `candidate`? Two notes about the same topic that say different things do not count.',
        criteria
    }
}

export type JevVerdict = {
    keep: number
    level: { choice: MemoryLevel; confidence: number }
    scope: { choice: 'global' | 'project'; confidence: number }
    match: { id: string | null; confidence: number }
    secret: number
}

function choiceOf(answer: JevAnswer | undefined): { choice: string; confidence: number } | null {
    return answer && answer.type === 'choice' ? { choice: answer.choice, confidence: answer.confidence } : null
}

export function parseVerdict(answers: Record<string, JevAnswer>, input: { hasProject: boolean }): JevVerdict {
    const level = choiceOf(answers.level)
    const scope = choiceOf(answers.scope)
    const match = choiceOf(answers.match)
    const levelChoice = level && level.choice in LEVEL_RANK ? level.choice as MemoryLevel : 'fact'
    return {
        keep: yesProbability(answers.keep),
        level: { choice: levelChoice, confidence: level?.confidence ?? 0 },
        scope: input.hasProject
            ? { choice: scope?.choice === 'project' ? 'project' : 'global', confidence: scope?.confidence ?? 0 }
            : { choice: 'global', confidence: 1 },
        match: match && match.choice !== 'none' ? { id: match.choice, confidence: match.confidence } : { id: null, confidence: match?.confidence ?? 1 },
        secret: yesProbability(answers.secret)
    }
}

export type Decision =
    | { kind: 'reject'; reason: string }
    | { kind: 'skip'; reason: string }
    | { kind: 'reinforce'; targetId: string }
    | {
        kind: 'add'
        status: 'active' | 'pending' | 'candidate'
        reason: string | null
        level: MemoryLevel
        scope: 'global' | 'project'
        /** New memory supports the matched one (lower level), or the matched one supports it (higher level). */
        link: { matchedId: string; direction: 'supports-matched' | 'matched-supports' } | null
    }

const fmt = (value: number) => value.toFixed(2)

/**
 * The rule: nothing an agent or a message brings becomes active without the user. What the user wrote is active;
 * what the user said waits for approval; what an agent noted is watched. A sure match at the same level only reinforces.
 */
export function decide(input: { verdict: JevVerdict; origin: Origin; matchedLevel?: MemoryLevel | null }): Decision {
    const { verdict, origin } = input
    if (verdict.secret >= THRESHOLDS.secret) return { kind: 'reject', reason: '含密钥' }
    if (verdict.keep < (origin === 'written' ? THRESHOLDS.writtenKeepMin : THRESHOLDS.keepMin)) return { kind: 'skip', reason: '不值得长期记' }

    const level = verdict.level.choice
    const matched = verdict.match.id && verdict.match.confidence >= THRESHOLDS.match && input.matchedLevel ? verdict.match.id : null
    if (matched && input.matchedLevel === level) return { kind: 'reinforce', targetId: matched }

    const link = linkTo(matched, level, input.matchedLevel)
    if (origin === 'written') return { kind: 'add', status: 'active', reason: null, level, scope: verdict.scope.choice, link }

    const doubts: string[] = []
    if (verdict.level.confidence < THRESHOLDS.sure) doubts.push(`级别 ${fmt(verdict.level.confidence)}`)
    if (verdict.scope.confidence < THRESHOLDS.sure) doubts.push(`范围 ${fmt(verdict.scope.confidence)}`)
    const doubt = doubts.length > 0 ? `；Jev 拿不准${doubts.join('、')}` : ''
    // An unsure scope keeps it to the project, the narrower reading.
    const scope = verdict.scope.confidence < THRESHOLDS.sure ? 'project' : verdict.scope.choice

    if (origin === 'said') return { kind: 'add', status: 'pending', reason: `你说过${doubt}`, level, scope, link }
    return { kind: 'add', status: 'candidate', reason: `agent 记的${doubt}`, level, scope, link }
}

function linkTo(matched: string | null, level: MemoryLevel, matchedLevel: MemoryLevel | null | undefined): Extract<Decision, { kind: 'add' }>['link'] {
    if (!matched || !matchedLevel) return null
    return { matchedId: matched, direction: LEVEL_RANK[level] < LEVEL_RANK[matchedLevel] ? 'supports-matched' : 'matched-supports' }
}
