import type { CodexSessionConfig } from '../types';
import type { EnhancedMode } from '../loop';
import type { CodexCliOverrides } from './codexCliOverrides';
import { getCodexSystemPrompt } from './systemPrompt';
import { isPureContextModeEnabled } from '@/agent/utils/haqiAgentInstructions';

function resolveApprovalPolicy(mode: EnhancedMode): CodexSessionConfig['approval-policy'] {
    switch (mode.permissionMode) {
        case 'default': return 'untrusted';
        case 'read-only': return 'never';
        case 'safe-yolo': return 'on-request';
        case 'yolo': return 'never';
        case 'auto-approve': return 'never';
        default: {
            throw new Error(`Unknown permission mode: ${mode.permissionMode}`);
        }
    }
}

function normalizeApprovalPolicy(
    value: CodexCliOverrides['approvalPolicy'] | CodexSessionConfig['approval-policy'] | undefined
): CodexSessionConfig['approval-policy'] | undefined {
    // 'on-failure' is no longer accepted; keep asking on request rather than
    // silently turning approvals off.
    return value === 'on-failure' ? 'on-request' : value;
}

function resolveSandbox(mode: EnhancedMode): CodexSessionConfig['sandbox'] {
    switch (mode.permissionMode) {
        case 'default': return 'workspace-write';
        case 'read-only': return 'read-only';
        case 'safe-yolo': return 'workspace-write';
        case 'yolo': return 'danger-full-access';
        case 'auto-approve': return 'danger-full-access';
        default: {
            throw new Error(`Unknown permission mode: ${mode.permissionMode}`);
        }
    }
}

export function buildCodexStartConfig(args: {
    message: string;
    mode: EnhancedMode;
    first: boolean;
    mcpServers: Record<string, { command: string; args: string[] }>;
    cliOverrides?: CodexCliOverrides;
    baseInstructions?: string;
    developerInstructions?: string;
    cwd?: string;
}): CodexSessionConfig {
    const approvalPolicy = resolveApprovalPolicy(args.mode);
    const sandbox = resolveSandbox(args.mode);
    const allowCliOverrides = args.mode.permissionMode === 'default';
    const cliOverrides = allowCliOverrides ? args.cliOverrides : undefined;
    const resolvedApprovalPolicy = normalizeApprovalPolicy(cliOverrides?.approvalPolicy) ?? approvalPolicy;
    const resolvedSandbox = cliOverrides?.sandbox ?? sandbox;

    const prompt = args.message;
    const defaultBaseInstructions = isPureContextModeEnabled() ? '' : getCodexSystemPrompt();
    const baseInstructions = args.baseInstructions ?? defaultBaseInstructions;
    const combinedInstructions = args.developerInstructions
        ? `${baseInstructions}\n\n${args.developerInstructions}`
        : baseInstructions;
    const config: Record<string, unknown> = {
        mcp_servers: args.mcpServers
    };
    if (args.mode.serviceTier) {
        config.service_tier = args.mode.serviceTier;
    }
    if (args.mode.effort && args.mode.effort !== 'auto') {
        config.model_reasoning_effort = args.mode.effort;
    }
    if (combinedInstructions.trim()) {
        config.developer_instructions = combinedInstructions;
    }
    const startConfig: CodexSessionConfig = {
        prompt,
        sandbox: resolvedSandbox,
        'approval-policy': resolvedApprovalPolicy,
        config
    };

    const cwd = typeof args.cwd === 'string' ? args.cwd.trim() : '';
    if (cwd) {
        startConfig.cwd = cwd;
    }

    if (args.mode.model) {
        startConfig.model = args.mode.model;
    }
    if (args.mode.collaborationMode === 'plan') {
        startConfig['include-plan-tool'] = true;
    }

    return startConfig;
}
