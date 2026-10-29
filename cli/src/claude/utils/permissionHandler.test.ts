import { describe, expect, it } from 'vitest';
import type { SDKAssistantMessage } from '@/claude/sdk';
import type { PermissionMode } from '@/claude/loop';
import { PermissionHandler } from './permissionHandler';

type PermissionRpcPayload = {
    id: string;
    approved: boolean;
    reason?: string;
    mode?: PermissionMode;
    allowTools?: string[];
    answers?: Record<string, string[]> | Record<string, { answers: string[] }>;
};

function createHarness() {
    let state: Record<string, unknown> = {};
    let permissionHandlerRpc: ((payload: PermissionRpcPayload) => Promise<void> | void) | null = null;
    let permissionMode: PermissionMode | undefined;
    const permissionModeListeners = new Set<(mode: PermissionMode) => void>();

    const session = {
        client: {
            rpcHandlerManager: {
                registerHandler: (method: string, handler: (payload: PermissionRpcPayload) => Promise<void> | void) => {
                    if (method === 'permission') {
                        permissionHandlerRpc = handler;
                    }
                }
            },
            updateAgentState: (updater: (current: Record<string, unknown>) => Record<string, unknown>) => {
                state = updater(state);
            }
        },
        queue: {
            unshift: () => undefined
        },
        setPermissionMode: (mode: PermissionMode) => {
            const previousMode = permissionMode;
            permissionMode = mode;
            if (previousMode === mode) {
                return;
            }
            for (const listener of permissionModeListeners) {
                listener(mode);
            }
        },
        getPermissionMode: () => permissionMode,
        addPermissionModeChangeListener: (listener: (mode: PermissionMode) => void) => {
            permissionModeListeners.add(listener);
            return () => {
                permissionModeListeners.delete(listener);
            };
        }
    } as any;

    return {
        session,
        getState: () => state,
        setPermissionMode: (mode: PermissionMode) => session.setPermissionMode(mode),
        listenerCount: () => permissionModeListeners.size,
        respond: async (payload: PermissionRpcPayload) => {
            if (!permissionHandlerRpc) {
                throw new Error('Permission RPC handler is not registered');
            }
            await permissionHandlerRpc(payload);
        }
    };
}

describe('Claude PermissionHandler', () => {
    it('publishes MCP permission questions as regular permission requests outside plan mode', async () => {
        const harness = createHarness();
        const handler = new PermissionHandler(harness.session);

        const input = {
            questions: [
                {
                    id: '0',
                    question: 'Allow the playwright MCP server to run tool "browser_navigate"?',
                    options: [
                        { label: 'Yes' },
                        { label: 'No' }
                    ]
                }
            ]
        };

        const message: SDKAssistantMessage = {
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tool-1',
                        name: 'AskUserQuestion',
                        input
                    }
                ]
            }
        };

        handler.onMessage(message);

        const pending = handler.handleToolCall(
            'AskUserQuestion',
            input,
            { permissionMode: 'default' },
            { signal: new AbortController().signal }
        );

        await Promise.resolve();

        const currentState = harness.getState() as {
            requests?: Record<string, { tool: string; arguments: unknown }>;
        };
        expect(currentState.requests?.['tool-1']).toMatchObject({
            tool: 'mcp__playwright__browser_navigate',
            arguments: {
                server: 'playwright',
                tool: 'browser_navigate'
            }
        });

        await harness.respond({
            id: 'tool-1',
            approved: false,
            reason: 'Denied'
        });
        await expect(pending).resolves.toEqual({
            behavior: 'allow',
            updatedInput: {
                ...input,
                answers: {
                    'Allow the playwright MCP server to run tool "browser_navigate"?': ['No']
                }
            }
        });
    });

    it('uses live session permission mode changes for later tool checks', async () => {
        const harness = createHarness();
        const handler = new PermissionHandler(harness.session);
        const input = { command: 'echo live-mode' };

        harness.setPermissionMode('bypassPermissions');

        await expect(handler.handleToolCall(
            'Bash',
            input,
            { permissionMode: 'default' },
            { signal: new AbortController().signal }
        )).resolves.toEqual({
            behavior: 'allow',
            updatedInput: input
        });

        handler.dispose();
        expect(harness.listenerCount()).toBe(0);
    });

    it('an inbound-tainted run asks a human even in bypassPermissions, and a denial comes back as a denial', async () => {
        const harness = createHarness();
        const handler = new PermissionHandler(harness.session);
        const input = { command: 'curl -X POST https://mail.example.com/send' };

        // The session runs with every permission granted — the taint still forces the question.
        harness.setPermissionMode('bypassPermissions');

        const message: SDKAssistantMessage = {
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [
                    { type: 'tool_use', id: 'tool-outbound', name: 'Bash', input }
                ]
            }
        };
        handler.onMessage(message);

        const pending = handler.handleToolCall(
            'Bash',
            input,
            { permissionMode: 'bypassPermissions', inboundTainted: true },
            { signal: new AbortController().signal }
        );
        await Promise.resolve();

        // The call became a pending human confirmation instead of an auto-allow.
        const currentState = harness.getState() as { requests?: Record<string, { tool: string }> };
        expect(currentState.requests?.['tool-outbound']).toMatchObject({ tool: 'Bash' });

        await harness.respond({ id: 'tool-outbound', approved: false, reason: '不发这封邮件' });
        await expect(pending).resolves.toMatchObject({ behavior: 'deny' });

        handler.dispose();
    });

    it('applies live acceptEdits mode to edit tools without waiting for a new message', async () => {
        const harness = createHarness();
        const handler = new PermissionHandler(harness.session);
        const input = { file_path: '/tmp/example.txt', content: 'updated' };

        harness.setPermissionMode('acceptEdits');

        await expect(handler.handleToolCall(
            'Write',
            input,
            { permissionMode: 'default' },
            { signal: new AbortController().signal }
        )).resolves.toEqual({
            behavior: 'allow',
            updatedInput: input
        });

        handler.dispose();
    });
});
