import type { TaskDraft } from '@hapi/protocol/types'
import { z } from 'zod'

/** What the planner submits through task_draft_submit. Limits keep the guide sheet short enough to read on a phone. */
export const DRAFT_LIMITS = { goal: 120, nonGoals: 3, criteriaMin: 3, criteriaMax: 6, questions: 3, optionsMin: 2, optionsMax: 4 } as const

const optionSchema = z.object({
    id: z.string().trim().min(1).max(40),
    label: z.string().trim().min(1).max(80)
})

const questionSchema = z.object({
    id: z.string().trim().min(1).max(40),
    text: z.string().trim().min(1).max(200),
    options: z.array(optionSchema).min(DRAFT_LIMITS.optionsMin).max(DRAFT_LIMITS.optionsMax),
    default: z.string().trim().min(1).max(40),
    precedentRef: z.string().trim().min(1).max(80).nullish()
}).refine((question) => question.options.some((option) => option.id === question.default), {
    message: 'default must be the id of one of the options'
}).refine((question) => new Set(question.options.map((option) => option.id)).size === question.options.length, {
    message: 'option ids must be unique'
})

export const draftInputSchema = z.object({
    goal: z.string().trim().min(1).max(DRAFT_LIMITS.goal),
    nonGoals: z.array(z.string().trim().min(1).max(200)).max(DRAFT_LIMITS.nonGoals).default([]),
    criteria: z.array(z.object({
        text: z.string().trim().min(1).max(300),
        source: z.enum(['principle', 'repo', 'inferred']),
        sourceRef: z.string().trim().min(1).max(200).nullish(),
        verify: z.string().trim().min(1).max(300)
    })).min(DRAFT_LIMITS.criteriaMin).max(DRAFT_LIMITS.criteriaMax),
    questions: z.array(questionSchema).max(DRAFT_LIMITS.questions).default([])
}).refine((draft) => new Set(draft.questions.map((question) => question.id)).size === draft.questions.length, {
    message: 'question ids must be unique'
})

export type DraftInput = z.infer<typeof draftInputSchema>

export type { TaskDraft }

export function toTaskDraft(input: DraftInput, version: number): TaskDraft {
    return {
        version,
        goal: input.goal,
        nonGoals: input.nonGoals,
        criteria: input.criteria.map((criterion, index) => ({
            id: `c${index + 1}`,
            text: criterion.text,
            source: criterion.source,
            sourceRef: criterion.sourceRef ?? null,
            verify: criterion.verify
        })),
        questions: input.questions.map((question) => ({
            id: question.id,
            text: question.text,
            options: question.options,
            default: question.default,
            precedentRef: question.precedentRef ?? null
        }))
    }
}

/** What the user may add or rewrite on top of a draft; looser than the planner's limits. */
export const USER_LIMITS = { goal: 300, nonGoals: 6, added: 4 } as const

/**
 * The user's answer to a draft: which criteria stay (edited or not), the criteria the user added, and one option per
 * question.
 */
export const confirmInputSchema = z.object({
    goal: z.string().trim().min(1).max(USER_LIMITS.goal).optional(),
    nonGoals: z.array(z.string().trim().min(1).max(200)).max(USER_LIMITS.nonGoals).optional(),
    criteria: z.array(z.object({
        id: z.string().trim().min(1).max(40),
        kept: z.boolean(),
        text: z.string().trim().min(1).max(300).optional()
    })).max(DRAFT_LIMITS.criteriaMax),
    added: z.array(z.object({
        text: z.string().trim().min(1).max(300),
        verify: z.string().trim().max(300).optional()
    })).max(USER_LIMITS.added).default([]),
    answers: z.record(z.string(), z.string()).default({})
})

export type ConfirmInput = z.infer<typeof confirmInputSchema>
