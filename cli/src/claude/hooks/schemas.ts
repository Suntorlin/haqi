import { z } from 'zod';

const BaseHookFields = z.object({
    session_id: z.string(),
    transcript_path: z.string().optional(),
    cwd: z.string().optional(),
    permission_mode: z.string().optional(),
    agent_id: z.string().optional(),
    agent_type: z.string().optional(),
    // Legacy HAQI/OMX hook metadata. Claude Code ignores these, but older
    // tests and custom hooks can still send them.
    agent_name: z.string().optional(),
    task_id: z.string().optional(),
    task_status: z.string().optional(),
    task_title: z.string().optional(),
    task_subject: z.string().optional(),
    task_description: z.string().optional(),
    team_name: z.string().optional(),
    teammate_name: z.string().optional(),
    agent_transcript_path: z.string().optional()
});

const AssistantMessageErrorSchema = z.enum([
    'authentication_failed',
    'billing_error',
    'rate_limit',
    'invalid_request',
    'server_error',
    'unknown',
    'max_output_tokens'
]);

const ConfigChangeSourceSchema = z.enum([
    'user_settings',
    'project_settings',
    'local_settings',
    'policy_settings',
    'skills'
]);

const InstructionsMemoryTypeSchema = z.enum(['User', 'Project', 'Local', 'Managed']);
const InstructionsLoadReasonSchema = z.enum(['session_start', 'nested_traversal', 'path_glob_match', 'include', 'compact']);
const SessionEndReasonSchema = z.enum(['clear', 'resume', 'logout', 'prompt_input_exit', 'other', 'bypass_permissions_disabled']);

// Known notification subtypes from Claude Code. The schema accepts any string for
// forward compatibility (cc may add new types); handlers should switch on
// `KnownClaudeNotificationType` to keep typo-safety while still receiving unknown
// types as plain strings.
export const KnownClaudeNotificationTypeSchema = z.enum([
    'idle_prompt',
    'permission_prompt',
    'worker_permission_prompt',
    'auth_success',
    'elicitation_dialog',
    'elicitation_complete',
    'elicitation_response',
    'computer_use_enter',
    'computer_use_exit'
]);
export type KnownClaudeNotificationType = z.infer<typeof KnownClaudeNotificationTypeSchema>;

const SessionStartSourceSchema = z.enum(['startup', 'resume', 'clear', 'compact']);

export const CLAUDE_HOOK_EVENTS = [
    'PreToolUse',
    'PostToolUse',
    'PostToolUseFailure',
    'Notification',
    'UserPromptSubmit',
    'SessionStart',
    'SessionEnd',
    'Stop',
    'StopFailure',
    'SubagentStart',
    'SubagentStop',
    'PreCompact',
    'PostCompact',
    'PermissionRequest',
    'PermissionDenied',
    'Setup',
    'TeammateIdle',
    'TaskCreated',
    'TaskCompleted',
    'Elicitation',
    'ElicitationResult',
    'ConfigChange',
    'WorktreeCreate',
    'WorktreeRemove',
    'InstructionsLoaded',
    'CwdChanged',
    'FileChanged'
] as const;

export type ClaudeHookEventName = typeof CLAUDE_HOOK_EVENTS[number];

export const ClaudeHookEventSchema = z.discriminatedUnion('hook_event_name', [
    BaseHookFields.extend({
        hook_event_name: z.literal('PreToolUse'),
        tool_name: z.string(),
        tool_input: z.unknown(),
        tool_use_id: z.string()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('PostToolUse'),
        tool_name: z.string(),
        tool_input: z.unknown(),
        tool_response: z.unknown(),
        tool_use_id: z.string()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('PostToolUseFailure'),
        tool_name: z.string(),
        tool_input: z.unknown(),
        tool_use_id: z.string(),
        error: z.string(),
        is_interrupt: z.boolean().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('Notification'),
        message: z.string(),
        title: z.string().optional(),
        notification_type: KnownClaudeNotificationTypeSchema.or(z.string())
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('UserPromptSubmit'),
        prompt: z.string()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('SessionStart'),
        source: SessionStartSourceSchema.optional(),
        agent_type: z.string().optional(),
        model: z.string().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('SessionEnd'),
        reason: SessionEndReasonSchema
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('Stop'),
        stop_hook_active: z.boolean().optional(),
        last_assistant_message: z.string().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('StopFailure'),
        error: AssistantMessageErrorSchema.or(z.string()),
        error_details: z.string().optional(),
        last_assistant_message: z.string().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('SubagentStart'),
        agent_id: z.string(),
        agent_type: z.string().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('SubagentStop'),
        stop_hook_active: z.boolean().optional(),
        agent_id: z.string(),
        agent_transcript_path: z.string().optional(),
        agent_type: z.string().optional(),
        last_assistant_message: z.string().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('PreCompact'),
        trigger: z.enum(['manual', 'auto']),
        custom_instructions: z.string().nullable()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('PostCompact'),
        trigger: z.enum(['manual', 'auto']),
        compact_summary: z.string()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('PermissionRequest'),
        tool_name: z.string(),
        tool_input: z.unknown(),
        permission_suggestions: z.array(z.unknown()).optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('PermissionDenied'),
        tool_name: z.string(),
        tool_input: z.unknown(),
        tool_use_id: z.string(),
        reason: z.string()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('Setup'),
        trigger: z.enum(['init', 'maintenance'])
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('TeammateIdle'),
        teammate_name: z.string(),
        team_name: z.string()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('TaskCreated'),
        task_id: z.string(),
        task_subject: z.string().optional(),
        task_description: z.string().optional(),
        teammate_name: z.string().optional(),
        team_name: z.string().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('TaskCompleted'),
        task_id: z.string(),
        task_subject: z.string().optional(),
        task_description: z.string().optional(),
        teammate_name: z.string().optional(),
        team_name: z.string().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('Elicitation'),
        mcp_server_name: z.string(),
        message: z.string(),
        mode: z.enum(['form', 'url']).optional(),
        url: z.string().optional(),
        elicitation_id: z.string().optional(),
        requested_schema: z.record(z.string(), z.unknown()).optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('ElicitationResult'),
        mcp_server_name: z.string(),
        elicitation_id: z.string().optional(),
        mode: z.enum(['form', 'url']).optional(),
        action: z.enum(['accept', 'decline', 'cancel']),
        content: z.record(z.string(), z.unknown()).optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('ConfigChange'),
        source: ConfigChangeSourceSchema,
        file_path: z.string().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('WorktreeCreate'),
        name: z.string()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('WorktreeRemove'),
        worktree_path: z.string()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('InstructionsLoaded'),
        file_path: z.string(),
        memory_type: InstructionsMemoryTypeSchema,
        load_reason: InstructionsLoadReasonSchema,
        globs: z.array(z.string()).optional(),
        trigger_file_path: z.string().optional(),
        parent_file_path: z.string().optional()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('CwdChanged'),
        old_cwd: z.string(),
        new_cwd: z.string()
    }),
    BaseHookFields.extend({
        hook_event_name: z.literal('FileChanged'),
        file_path: z.string(),
        event: z.enum(['change', 'add', 'unlink'])
    })
]);

export type ClaudeHookEvent = z.infer<typeof ClaudeHookEventSchema>;

export type HookResponse = {
    exit_code?: number;
    stdout?: string;
    stderr?: string;
};

export const HookResponseSchema = z.object({
    exit_code: z.number().int().optional(),
    stdout: z.string().optional(),
    stderr: z.string().optional()
});

export type SessionStartSource = z.infer<typeof SessionStartSourceSchema>;

/** Claude Code adds `additionalContext` to the conversation when the hook prints this JSON on stdout. */
export function hookAdditionalContext(hookEventName: 'SessionStart' | 'UserPromptSubmit', additionalContext: string): HookResponse {
    return {
        exit_code: 0,
        stdout: JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })
    };
}
