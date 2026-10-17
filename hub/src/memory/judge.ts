import { yesProbability, type JevAnswer, type JevQuestion } from './jev'

export type MemoryLevel = 'fact' | 'experience' | 'principle'
export type MemoryStatus = 'active' | 'pending' | 'archived'

export const LEVEL_RANK: Record<MemoryLevel, number> = { fact: 0, experience: 1, principle: 2 }

/** Thresholds of the one rule: Jev must be sure (>= SURE) on every call, or the memory waits for the user. */
export const THRESHOLDS = { secret: 0.5, keepMin: 0.3, sure: 0.6, match: 0.8 } as const

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
    if (input.similar.length > 0) {
        const criteria: Record<string, unknown> = {}
        for (const item of input.similar) criteria[item.id] = item.text
        criteria.none = 'No entry is about the same rule, lesson or fact as `candidate`.'
        questions.match = {
            type: 'choice',
            instructions: 'Which entry is about the same rule, lesson or fact as `candidate`?',
            criteria
        }
    }
    return questions
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
        status: 'active' | 'pending'
        reason: string | null
        level: MemoryLevel
        scope: 'global' | 'project'
        /** New memory supports the matched one (lower level), or the matched one supports it (higher level). */
        link: { matchedId: string; direction: 'supports-matched' | 'matched-supports' } | null
    }

const fmt = (value: number) => value.toFixed(2)

/**
 * The one rule: Jev must be sure on "keep", "level" and "scope", otherwise the memory waits for the user.
 * Principles always wait unless the user said them. A sure match at the same level only reinforces.
 */
export function decide(input: { verdict: JevVerdict; said: boolean; matchedLevel?: MemoryLevel | null }): Decision {
    const { verdict } = input
    if (verdict.secret >= THRESHOLDS.secret) return { kind: 'reject', reason: '含密钥' }
    if (verdict.keep < THRESHOLDS.keepMin) return { kind: 'skip', reason: '不值得长期记' }

    const level = verdict.level.choice
    const matched = verdict.match.id && verdict.match.confidence >= THRESHOLDS.match && input.matchedLevel ? verdict.match.id : null
    if (matched && input.matchedLevel === level) return { kind: 'reinforce', targetId: matched }

    const doubts: string[] = []
    if (verdict.keep < THRESHOLDS.sure) doubts.push(`要不要记 ${fmt(verdict.keep)}`)
    if (verdict.level.confidence < THRESHOLDS.sure) doubts.push(`级别 ${fmt(verdict.level.confidence)}`)
    if (verdict.scope.confidence < THRESHOLDS.sure) doubts.push(`范围 ${fmt(verdict.scope.confidence)}`)

    let reason: string | null = null
    if (doubts.length > 0) reason = `Jev 拿不准：${doubts.join('、')}`
    if (level === 'principle' && !input.said) reason = reason ? `原则要你确认；${reason}` : '原则要你确认'

    const link = matched && input.matchedLevel
        ? { matchedId: matched, direction: LEVEL_RANK[level] < LEVEL_RANK[input.matchedLevel] ? 'supports-matched' as const : 'matched-supports' as const }
        : null
    return { kind: 'add', status: reason ? 'pending' : 'active', reason, level, scope: verdict.scope.choice, link }
}
