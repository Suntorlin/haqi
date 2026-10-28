import { z } from 'zod'

export type HapiMcpToolDefinition = {
    name: string
    title: string
    description: string
    inputSchema: z.ZodTypeAny
}

const HTML_PATH_DESCRIPTION = 'Absolute path of a full HTML page (up to 10 MB) on this machine. The share link then shows this page in place of the markdown, and keeps the same link when you update it.'

export const changeTitleInputSchema: z.ZodTypeAny = z.object({
    title: z.string().describe('The new title for the chat session'),
    short_title: z.string().optional().describe('The same title in a few words (at most 6 Chinese characters or 3 English words), for narrow places such as avatar captions')
})

export const HANDOFF_DESCRIPTION = "Mark the report as a handoff. After the session ends, HAQI copies the report markdown word for word into the user's notes folder (Obsidian) and adds one line to the notes index. Do not write the notes folder yourself. Keep the markdown complete: a report with only an HTML page is not copied. Fields merge with the handoff fields already on the report."

export const reportHandoffSchema: z.ZodTypeAny = z.object({
    folder: z.string().min(1).max(500).optional().describe('Folder in the notes folder, relative to its root, that already exists. Get choices from handoff_folders.'),
    summary: z.string().min(1).max(600).optional().describe('The one-line index entry: the result and key numbers, risks, and what the user must decide.'),
    short_title: z.string().min(1).max(60).optional().describe('Short link text for the index line. The report title is used when not set.')
}).describe(HANDOFF_DESCRIPTION)

export const handoffFoldersInputSchema: z.ZodTypeAny = z.object({})

export const HANDOFF_FOLDERS_DESCRIPTION = "List the folders of the user's notes folder that a handoff report of this session can go to: the folders this project used before, then the folders the notes index links to. Use one of them as handoff.folder in report_create or report_update."

export const reportCreateInputSchema: z.ZodTypeAny = z.object({
    session_id: z.string().min(1).max(255).optional(),
    task_id: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(200).optional(),
    status: z.string().min(1).max(40).optional(),
    markdown: z.string().max(400_000).optional(),
    html_path: z.string().min(1).max(1000).optional().describe(HTML_PATH_DESCRIPTION),
    metadata: z.unknown().optional(),
    handoff: reportHandoffSchema.optional(),
    share_expires_in_hours: z.number().positive().max(24 * 365).optional().describe('Hours until the public link expires. At most 72 (3 days), which is also the default.')
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
    html_path: z.string().max(1000).optional().describe(`${HTML_PATH_DESCRIPTION} An empty string removes the page.`),
    metadata: z.unknown().optional(),
    handoff: reportHandoffSchema.optional()
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
    expires_in_hours: z.number().positive().max(24 * 365).optional().describe('Hours until the public link expires. At most 72 (3 days), which is also the default.'),
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
    tag: z.string().min(1).max(40).optional().describe('The tag you picked for the task (lowercase); leave out when the guide message says the user set it'),
    repo_path: z.string().min(1).max(500).optional().describe('Absolute path of the repository you picked, when the guide message asks you to pick one'),
    machine_id: z.string().min(1).max(100).optional().describe('The id of the machine you picked, when the guide message asks you to pick one; repo_path is then the path on that machine'),
    machine_reason: z.string().min(1).max(80).optional().describe('One line on why you picked that machine'),
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
        options: z.array(z.object({
            id: z.string().min(1).max(40),
            label: z.string().min(1).max(80),
            good: z.string().min(1).max(100).optional().describe('What picking this option gains'),
            cost: z.string().min(1).max(100).optional().describe('What it costs')
        })).min(2).max(4),
        default: z.string().min(1).max(40).describe('The id of the default option'),
        precedent_ref: z.string().min(1).max(80).optional().describe('The experience id the default comes from')
    })).max(3).optional().describe('At most 3 choice questions for the user')
})

export const taskPlanSubmitInputSchema: z.ZodTypeAny = z.object({
    task_id: z.string().min(1).max(40).describe('The task id from the message'),
    subtasks: z.array(z.object({
        id: z.string().min(1).max(40).describe('Short English id: letters, digits, - and _'),
        title: z.string().min(1).max(60).describe('At most 20 Chinese characters'),
        brief: z.string().min(1).max(4000).describe('What to change, where, and how to verify; the executor sees only this'),
        criteria: z.array(z.string().min(1).max(40)).describe('Acceptance criterion ids this subtask is responsible for'),
        depends_on: z.array(z.string().min(1).max(40)).optional().describe('Ids of subtasks that must finish first')
    })).min(1).max(5).describe('1 to 5 subtasks that together cover every acceptance criterion')
})

export const subtaskDoneInputSchema: z.ZodTypeAny = z.object({
    task_id: z.string().min(1).max(40),
    subtask_id: z.string().min(1).max(60),
    summary: z.string().min(1).max(4000).describe('What you changed and how you verified it'),
    evidence: z.array(z.string().min(1).max(1000)).max(20).optional().describe('One piece of evidence each: a command and its result, a file and line, a screenshot path')
})

export const taskDecisionAskInputSchema: z.ZodTypeAny = z.object({
    task_id: z.string().min(1).max(40),
    question: z.string().min(1).max(300).describe('The one thing the user has to decide'),
    context: z.string().max(1000).optional().describe('Why it needs the user, in one or two sentences'),
    options: z.array(z.object({
        label: z.string().min(1).max(80),
        good: z.string().max(120).optional().describe('What picking it gains'),
        cost: z.string().max(120).optional().describe('What it costs')
    })).min(2).max(4),
    recommended: z.string().max(80).optional().describe('The label you recommend')
})

export const taskIntegratedInputSchema: z.ZodTypeAny = z.object({
    task_id: z.string().min(1).max(40),
    branch: z.string().min(1).max(200),
    worktree_path: z.string().min(1).max(500).describe('Absolute path of the merge worktree'),
    summary: z.string().max(4000).optional().describe('Merge result and test results')
})

export const taskReviewSubmitInputSchema: z.ZodTypeAny = z.object({
    task_id: z.string().min(1).max(40),
    results: z.array(z.object({
        criterion_id: z.string().min(1).max(40),
        status: z.enum(['met', 'not_met', 'unclear']),
        evidence: z.string().min(1).max(2000).describe('What you checked and saw')
    })).min(1).describe('One result per acceptance criterion'),
    suggestions: z.array(z.string().min(1).max(500)).max(10).optional().describe('Your own ideas outside the acceptance list; they never fail the review')
})

export const TASK_RUN_TOOL_DESCRIPTIONS = {
    task_plan_submit: 'Submit how a confirmed HAQI task splits into subtasks. Each subtask goes to an executor session in its own git worktree. Do not change code yourself.',
    subtask_done: 'Tell HAQI your subtask is done, with a summary and evidence. Commit to your branch first. Do not push.',
    task_decision_ask: 'Ask the user to decide something the work needs (a disagreement, out of scope, an unclear criterion, anything that pushes, deploys, spends or sends). Give 2 to 4 options with gains and costs. Go on with the parts that do not depend on it; the answer comes back to this session.',
    task_integrated: 'Tell HAQI the subtask branches are merged into one branch, with the test results.',
    task_review_submit: 'Submit your review of a HAQI task: one result per acceptance criterion (met / not_met / unclear) with evidence.'
} as const

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

export const scheduledRunDoneInputSchema: z.ZodTypeAny = z.object({
    status: z.enum(['success', 'failed', 'skipped']).describe('success: done; failed: it could not be done; skipped: nothing to do this time'),
    summary: z.string().min(1).max(2000).describe('One sentence: the result, in the language of the task'),
    links: z.array(z.string().min(1).max(2000)).max(20).optional().describe('Links to what the run produced')
})

const scheduleFields = {
    name: z.string().min(1).max(120).optional().describe('Short name of the task'),
    prompt: z.string().max(20_000).optional().describe('What to do on each run'),
    prompt_file: z.string().min(1).max(1000).optional().describe('Absolute path of a file with the instructions; it is read fresh on each run'),
    cron: z.string().min(9).max(120).optional().describe('Five-field cron in the time zone, e.g. "0 9 * * 1-5" (weekdays 09:00). Sunday is 0'),
    run_at: z.string().min(1).max(40).optional().describe('One run at this ISO 8601 time instead of a cron, e.g. "2026-10-26T15:00:00+09:00"'),
    timezone: z.string().min(1).max(80).optional().describe('IANA time zone of the cron, e.g. "Asia/Tokyo". Default: this machine\'s time zone'),
    directory: z.string().min(1).max(1000).optional().describe('Folder the run starts in. Default: this session\'s folder'),
    model: z.string().min(1).max(100).optional(),
    permission_mode: z.enum(['default', 'acceptEdits', 'bypassPermissions', 'plan']).optional().describe('bypassPermissions runs without permission prompts'),
    max_minutes: z.number().int().min(1).max(1440).optional().describe('A run still open after this fails and stops (default 90)'),
    enabled: z.boolean().optional()
}

export const scheduleCreateInputSchema: z.ZodTypeAny = z.object({
    ...scheduleFields,
    name: z.string().min(1).max(120).describe('Short name of the task')
})

export const scheduleUpdateInputSchema: z.ZodTypeAny = z.object({
    id: z.string().min(1).max(80).describe('The scheduled task id, from schedule_list'),
    ...scheduleFields,
    manual: z.boolean().optional().describe('true: remove the clock; the task runs only with Run now')
})

export const scheduleListInputSchema: z.ZodTypeAny = z.object({})

export const SCHEDULE_TOOL_DESCRIPTIONS = {
    scheduled_run_done: 'Report the result of this scheduled run to HAQI. Call it once, at the end of every scheduled run. A run without it counts as failed and raises an alert.',
    schedule_create: 'Create a HAQI scheduled task: at each time of its cron (or once at run_at) HAQI starts a new session on this machine and sends the prompt. Give a cron, a run_at, or neither (run only on demand).',
    schedule_list: "List the user's HAQI scheduled tasks with their next run and last result.",
    schedule_update: 'Change a HAQI scheduled task: its prompt, schedule, folder or settings. enabled=false pauses it; enabled=true resumes it.'
} as const

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
        description: 'Update report title/status/markdown/metadata, or its full HTML page (html_path). The share link stays the same.',
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
        name: 'handoff_folders',
        title: 'Handoff Folders',
        description: HANDOFF_FOLDERS_DESCRIPTION,
        inputSchema: handoffFoldersInputSchema
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
    { name: 'task_plan_submit', title: 'Submit Task Plan', description: TASK_RUN_TOOL_DESCRIPTIONS.task_plan_submit, inputSchema: taskPlanSubmitInputSchema },
    { name: 'subtask_done', title: 'Subtask Done', description: TASK_RUN_TOOL_DESCRIPTIONS.subtask_done, inputSchema: subtaskDoneInputSchema },
    { name: 'task_decision_ask', title: 'Ask the User to Decide', description: TASK_RUN_TOOL_DESCRIPTIONS.task_decision_ask, inputSchema: taskDecisionAskInputSchema },
    { name: 'task_integrated', title: 'Branches Merged', description: TASK_RUN_TOOL_DESCRIPTIONS.task_integrated, inputSchema: taskIntegratedInputSchema },
    { name: 'task_review_submit', title: 'Submit Task Review', description: TASK_RUN_TOOL_DESCRIPTIONS.task_review_submit, inputSchema: taskReviewSubmitInputSchema },
    { name: 'scheduled_run_done', title: 'Scheduled Run Done', description: SCHEDULE_TOOL_DESCRIPTIONS.scheduled_run_done, inputSchema: scheduledRunDoneInputSchema },
    { name: 'schedule_create', title: 'Create Scheduled Task', description: SCHEDULE_TOOL_DESCRIPTIONS.schedule_create, inputSchema: scheduleCreateInputSchema },
    { name: 'schedule_list', title: 'List Scheduled Tasks', description: SCHEDULE_TOOL_DESCRIPTIONS.schedule_list, inputSchema: scheduleListInputSchema },
    { name: 'schedule_update', title: 'Update Scheduled Task', description: SCHEDULE_TOOL_DESCRIPTIONS.schedule_update, inputSchema: scheduleUpdateInputSchema },
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
