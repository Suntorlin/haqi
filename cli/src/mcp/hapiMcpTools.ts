import { z } from 'zod'

export type HapiMcpToolDefinition = {
    name: string
    title: string
    description: string
    inputSchema: z.ZodTypeAny
}

export const changeTitleInputSchema: z.ZodTypeAny = z.object({
    title: z.string().describe('The new title for the chat session')
})

export const reportCreateInputSchema: z.ZodTypeAny = z.object({
    session_id: z.string().min(1).max(255).optional(),
    task_id: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(200).optional(),
    status: z.string().min(1).max(40).optional(),
    markdown: z.string().max(400_000).optional(),
    metadata: z.unknown().optional(),
    share_expires_in_hours: z.number().positive().max(24 * 365).optional()
})

export const memoryProposeInputSchema: z.ZodTypeAny = z.object({
    text: z.string().min(4).max(400).describe('One short sentence to remember'),
    said_by_user: z.boolean().optional().describe('True when the user said it in so many words')
})

export const memorySearchInputSchema: z.ZodTypeAny = z.object({
    query: z.string().min(1).max(500).describe('What to look up, in any language'),
    limit: z.number().int().min(1).max(20).optional().describe('Most results to return (default 8)'),
    tag: z.string().min(1).max(40).optional().describe('Only memories with this tag, such as the tag of the current task')
})

export const MEMORY_SEARCH_DESCRIPTION = "Search the user's long-term memory by meaning (Chinese and English both match). Use it to look up the user's rules, preferences and lessons about this project before you decide how to do something. Each result shows its level (fact, experience, principle), scope and status (active; pending = waiting for the user; candidate = on trial, not yet confirmed)."

export const MEMORY_PROPOSE_DESCRIPTION = "Offer one sentence for the user's long-term memory: a standing preference or rule the user stated, or a durable lesson or fact about this project. HAQI decides whether it is a fact, experience or principle, global or for this project, and may hold it for the user's review. Not for task progress, temporary details, secrets, or anything the code or git history already shows."

export const reportUpdateInputSchema: z.ZodTypeAny = z.object({
    report_id: z.string().min(1).max(255),
    task_id: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(200).optional(),
    status: z.string().min(1).max(40).optional(),
    markdown: z.string().max(400_000).optional(),
    metadata: z.unknown().optional()
})

export const reportGetInputSchema: z.ZodTypeAny = z.object({
    report_id: z.string().min(1).max(255)
})

export const reportListInputSchema: z.ZodTypeAny = z.object({
    limit: z.number().int().min(1).max(200).optional(),
    session_id: z.string().min(1).max(255).optional()
})

export const reportAddAssetInputSchema: z.ZodTypeAny = z.object({
    report_id: z.string().min(1).max(255),
    filename: z.string().min(1).max(255).optional(),
    mime_type: z.string().min(1).max(255).optional(),
    content_base64: z.string().min(1).optional(),
    content_data_url: z.string().min(1).optional(),
    source_path: z.string().min(1).optional(),
    caption: z.string().max(500).optional()
}).superRefine((data, ctx) => {
    const contentFields = [
        typeof data.content_base64 === 'string' && data.content_base64.trim().length > 0,
        typeof data.content_data_url === 'string' && data.content_data_url.trim().length > 0,
        typeof data.source_path === 'string' && data.source_path.trim().length > 0
    ].filter(Boolean).length

    if (contentFields === 0) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Provide one of content_base64, content_data_url, or source_path'
        })
        return
    }

    if (contentFields > 1) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Use only one of content_base64, content_data_url, or source_path'
        })
    }
})

export const reportCreateShareInputSchema: z.ZodTypeAny = z.object({
    report_id: z.string().min(1).max(255),
    expires_in_hours: z.number().positive().max(24 * 365).optional(),
    created_by: z.string().min(1).max(255).optional()
})

export const reviewLoopWorkerSubmitInputSchema: z.ZodTypeAny = z.object({
    loop_id: z.string().min(1).describe('The review loop ID'),
    round_id: z.string().min(1).describe('The current round ID'),
    raw_response: z.string().describe('Your complete response/output'),
    summary: z.string().optional().describe('Brief summary of what you did'),
    diff: z.string().describe('Git diff of changes made'),
    files_changed: z.array(z.string()).describe('List of files changed'),
    commands: z.array(z.object({
        command: z.string(),
        exit_code: z.number(),
        stdout: z.string(),
        stderr: z.string()
    })).describe('Commands executed and their results'),
    exit_status: z.enum(['success', 'error']).describe('Overall execution status')
})

export const taskDraftSubmitInputSchema: z.ZodTypeAny = z.object({
    task_id: z.string().min(1).max(40).describe('The task id from the guide message'),
    goal: z.string().min(1).max(120).describe('One sentence: what the task achieves'),
    non_goals: z.array(z.string().min(1).max(200)).max(3).optional().describe('What the task does not do (at most 3)'),
    criteria: z.array(z.object({
        text: z.string().min(1).max(300).describe('One acceptance criterion that can be checked'),
        source: z.enum(['principle', 'repo', 'inferred']).describe('principle = from a user principle; repo = from a repository convention file; inferred = your own guess'),
        source_ref: z.string().min(1).max(200).optional().describe('The principle id or the file name'),
        verify: z.string().min(1).max(300).describe('How to check it: a command, a page or data')
    })).min(3).max(6).describe('3 to 6 acceptance criteria'),
    questions: z.array(z.object({
        id: z.string().min(1).max(40),
        text: z.string().min(1).max(200).describe('Only what the context and the repository cannot settle'),
        options: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().min(1).max(80) })).min(2).max(4),
        default: z.string().min(1).max(40).describe('The id of the default option'),
        precedent_ref: z.string().min(1).max(80).optional().describe('The experience id the default comes from')
    })).max(3).optional().describe('At most 3 choice questions for the user')
})

export const TASK_DRAFT_SUBMIT_DESCRIPTION = 'Submit the goal and acceptance criteria you drafted for a HAQI task, during its guide step. The user ticks the criteria and answers the questions in the HAQI web app. Call it again with a new draft when the user asks for changes. Do not start the work.'

export const reviewLoopReviewerSubmitInputSchema: z.ZodTypeAny = z.object({
    loop_id: z.string().min(1).describe('The review loop ID'),
    round_id: z.string().min(1).describe('The current round ID'),
    action: z.enum(['continue', 'pass', 'abort', 'notify_user']).describe('Verdict action'),
    feedback: z.string().describe('Feedback or next instruction for worker'),
    user_message: z.string().optional().describe('Message for user (required for notify_user)'),
    progress: z.number().min(0).max(100).describe('Estimated progress percentage'),
    criteria_status: z.array(z.object({
        criteria: z.string(),
        status: z.enum(['met', 'not_met', 'unclear']),
        note: z.string().optional()
    })).describe('Status of each acceptance criterion')
})

export const HAPI_MCP_TOOL_DEFINITIONS: HapiMcpToolDefinition[] = [
    {
        name: 'change_title',
        title: 'Change Chat Title',
        description: 'Change the title of the current chat session',
        inputSchema: changeTitleInputSchema
    },
    {
        name: 'report_create',
        title: 'Create Report',
        description: 'Create a markdown report and a public share link. Public links use /share/r/<token> (for example <report-public-base-url>/share/r/FrG7h-uOFtuKw0Ay1S8NNWhuBB9uNgDq).',
        inputSchema: reportCreateInputSchema
    },
    {
        name: 'memory_propose',
        title: 'Propose Memory',
        description: MEMORY_PROPOSE_DESCRIPTION,
        inputSchema: memoryProposeInputSchema
    },
    {
        name: 'memory_search',
        title: 'Search Memory',
        description: MEMORY_SEARCH_DESCRIPTION,
        inputSchema: memorySearchInputSchema
    },
    {
        name: 'report_update',
        title: 'Update Report',
        description: 'Update report title/status/markdown/metadata',
        inputSchema: reportUpdateInputSchema
    },
    {
        name: 'report_get',
        title: 'Get Report',
        description: 'Get full report details by report_id',
        inputSchema: reportGetInputSchema
    },
    {
        name: 'report_list',
        title: 'List Reports',
        description: 'List reports in current namespace',
        inputSchema: reportListInputSchema
    },
    {
        name: 'report_add_asset',
        title: 'Add Report Asset',
        description: 'Attach image/file asset to a report using base64/data-url/source-path',
        inputSchema: reportAddAssetInputSchema
    },
    {
        name: 'report_create_share',
        title: 'Create Report Share',
        description: 'Create a public share link for a report. Public links use /share/r/<token> (for example <report-public-base-url>/share/r/FrG7h-uOFtuKw0Ay1S8NNWhuBB9uNgDq).',
        inputSchema: reportCreateShareInputSchema
    },
    {
        name: 'task_draft_submit',
        title: 'Submit Task Draft',
        description: TASK_DRAFT_SUBMIT_DESCRIPTION,
        inputSchema: taskDraftSubmitInputSchema
    },
    {
        name: 'review_loop_worker_submit',
        title: 'Submit Review Loop Worker Output',
        description: 'Submit your execution results for the current ReviewLoop round. Call this when you have completed the instruction.',
        inputSchema: reviewLoopWorkerSubmitInputSchema
    },
    {
        name: 'review_loop_reviewer_submit',
        title: 'Submit Review Loop Verdict',
        description: 'Submit your review verdict for the current ReviewLoop round. Use action "continue" with feedback as next instruction, "pass" if all criteria met, "abort" if task is impossible, or "notify_user" if human input needed.',
        inputSchema: reviewLoopReviewerSubmitInputSchema
    }
]
