import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildThreadStartParams, buildTurnStartParams } from './appServerConfig';
import { getCodexSystemPrompt } from './systemPrompt';

describe('appServerConfig', () => {
    let tempRoot: string;
    let previousHapiHome: string | undefined;
    const mcpServers = { hapi: { command: 'node', args: ['mcp'] } };

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'app-server-config-'));
        previousHapiHome = process.env.HAPI_HOME;
        process.env.HAPI_HOME = tempRoot;
    });

    afterEach(() => {
        if (previousHapiHome === undefined) {
            delete process.env.HAPI_HOME;
        } else {
            process.env.HAPI_HOME = previousHapiHome;
        }
        rmSync(tempRoot, { recursive: true, force: true });
    });

    it('applies CLI overrides when permission mode is default', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'default' },
            mcpServers,
            cliOverrides: { sandbox: 'danger-full-access', approvalPolicy: 'never' },
            cwd: '/tmp/workspace'
        });

        expect(params.sandbox).toBe('danger-full-access');
        expect(params.approvalPolicy).toBe('never');
        expect(params.baseInstructions).toBe(getCodexSystemPrompt());
        expect(params.developerInstructions).toBe(getCodexSystemPrompt());
        expect(params.cwd).toBe('/tmp/workspace');
        expect(params.config).toEqual({
            'mcp_servers.hapi': {
                command: 'node',
                args: ['mcp']
            },
            developer_instructions: getCodexSystemPrompt()
        });
    });

    it('ignores CLI overrides when permission mode is not default', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'yolo' },
            mcpServers,
            cliOverrides: { sandbox: 'read-only', approvalPolicy: 'never' }
        });

        expect(params.sandbox).toBe('danger-full-access');
        expect(params.approvalPolicy).toBe('never');
    });

    it('uses never approval in auto-approve mode for thread start', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'auto-approve' },
            mcpServers,
            cliOverrides: { sandbox: 'read-only', approvalPolicy: 'on-request' }
        });

        expect(params.sandbox).toBe('danger-full-access');
        expect(params.approvalPolicy).toBe('never');
    });

    it('omits base instructions when empty', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'default' },
            mcpServers,
            baseInstructions: ''
        });

        expect(params.baseInstructions).toBeUndefined();
        expect(params.developerInstructions).toBeUndefined();
    });

    it('concatenates custom developer instructions after base instructions', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'default' },
            mcpServers,
            developerInstructions: 'Only respond in Chinese.'
        });

        expect(params.baseInstructions).toBe(getCodexSystemPrompt());
        expect(params.developerInstructions).toBe(`${getCodexSystemPrompt()}

Only respond in Chinese.`);
        expect(params.config).toEqual({
            'mcp_servers.hapi': {
                command: 'node',
                args: ['mcp']
            },
            developer_instructions: `${getCodexSystemPrompt()}

Only respond in Chinese.`
        });
    });

    it('builds turn params with mode defaults', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            cwd: '/tmp/repo',
            mode: { permissionMode: 'read-only', model: 'o3', effort: 'high', serviceTier: 'fast' }
        });

        expect(params.threadId).toBe('thread-1');
        expect(params.input).toEqual([{ type: 'text', text: 'hello' }]);
        expect(params.cwd).toBe('/tmp/repo');
        expect(params.approvalPolicy).toBe('never');
        expect(params.sandboxPolicy).toEqual({ type: 'readOnly' });
        expect(params.model).toBe('o3');
        expect(params.effort).toBe('high');
        expect(params.serviceTier).toBe('fast');
    });

    it('passes service tier for thread start', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'default', serviceTier: 'flex' },
            mcpServers
        });

        expect(params.serviceTier).toBe('flex');
    });

    it('puts collaboration mode in turn params with model settings', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default', model: 'o3', collaborationMode: 'plan' }
        });

        expect(params.collaborationMode).toEqual({
            mode: 'plan',
            settings: {
                model: 'o3',
                reasoning_effort: null,
                developer_instructions: null
            }
        });
        expect(params.model).toBeUndefined();
    });

    it('folds reasoning effort into collaboration settings', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default', model: 'gpt-5.6-sol', effort: 'xhigh', collaborationMode: 'code' }
        });

        expect(params.collaborationMode).toEqual({
            mode: 'default',
            settings: {
                model: 'gpt-5.6-sol',
                reasoning_effort: 'xhigh',
                developer_instructions: null
            }
        });
        expect(params.model).toBeUndefined();
        expect(params.effort).toBeUndefined();
    });

    it('throws when collaboration mode is set but model is absent', () => {
        expect(() => buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default', collaborationMode: 'plan' }
        })).toThrowError('Collaboration mode requires model');
    });

    it('omits non-plan collaboration mode without model', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default' },
            overrides: { collaborationMode: 'code' }
        });

        expect(params.collaborationMode).toBeUndefined();
        expect(params.model).toBeUndefined();
    });

    it('applies CLI overrides for turns when permission mode is default', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default' },
            cliOverrides: { sandbox: 'danger-full-access', approvalPolicy: 'never' }
        });

        expect(params.approvalPolicy).toBe('never');
        expect(params.sandboxPolicy).toEqual({ type: 'dangerFullAccess' });
    });

    it('uses on-request approval for safe-yolo turns', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'safe-yolo' },
            cliOverrides: { sandbox: 'read-only', approvalPolicy: 'never' }
        });

        expect(params.approvalPolicy).toBe('on-request');
        expect(params.sandboxPolicy).toEqual({ type: 'workspaceWrite' });
    });

    it('maps legacy on-failure CLI overrides to on-request for app-server', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default' },
            cliOverrides: { approvalPolicy: 'on-failure' }
        });

        expect(params.approvalPolicy).toBe('on-request');
    });

    it('uses never approval in auto-approve mode for turns', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'auto-approve' },
            cliOverrides: { sandbox: 'read-only', approvalPolicy: 'on-request' }
        });

        expect(params.approvalPolicy).toBe('never');
        expect(params.sandboxPolicy).toEqual({ type: 'dangerFullAccess' });
    });

    it('uses never approval in auto-approve plan mode for thread start', () => {
        const params = buildThreadStartParams({
            mode: { permissionMode: 'auto-approve', collaborationMode: 'plan', model: 'o3' },
            mcpServers
        });

        expect(params.approvalPolicy).toBe('never');
        expect(params.sandbox).toBe('danger-full-access');
    });

    it('uses never approval in auto-approve plan mode for turns', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'review the plan',
            mode: { permissionMode: 'auto-approve', collaborationMode: 'plan', model: 'o3' }
        });

        expect(params.approvalPolicy).toBe('never');
        expect(params.sandboxPolicy).toEqual({ type: 'dangerFullAccess' });
        expect(params.collaborationMode).toEqual({
            mode: 'plan',
            settings: {
                model: 'o3',
                reasoning_effort: null,
                developer_instructions: null
            }
        });
    });

    it('prefers turn overrides', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default' },
            overrides: { approvalPolicy: 'on-request', model: 'gpt-5', effort: 'low', serviceTier: 'flex' }
        });

        expect(params.approvalPolicy).toBe('on-request');
        expect(params.model).toBe('gpt-5');
        expect(params.effort).toBe('low');
        expect(params.serviceTier).toBe('flex');
    });

    describe('collaboration mode resolution in auto-execute flow', () => {
        it('omits code collaboration mode without model via overrides', () => {
            const params = buildTurnStartParams({
                threadId: 'thread-1',
                message: 'execute approved plan',
                mode: { permissionMode: 'default' },
                overrides: { collaborationMode: 'code' }
            });

            expect(params.collaborationMode).toBeUndefined();
            expect(params.model).toBeUndefined();
        });

        it('throws when plan collaboration mode is set via overrides without model', () => {
            expect(() => buildTurnStartParams({
                threadId: 'thread-1',
                message: 'execute approved plan',
                mode: { permissionMode: 'default' },
                overrides: { collaborationMode: 'plan' }
            })).toThrowError('Collaboration mode requires model');
        });
    });

    it('omits collaborationMode when neither mode nor overrides set it', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default' }
        });

        expect(params.collaborationMode).toBeUndefined();
    });

    it('turn overrides collaborationMode takes precedence over mode collaborationMode', () => {
        const params = buildTurnStartParams({
            threadId: 'thread-1',
            message: 'hello',
            mode: { permissionMode: 'default', collaborationMode: 'plan', model: 'o3' },
            overrides: { collaborationMode: 'code' }
        });

        expect(params.collaborationMode).toEqual({
            mode: 'default',
            settings: {
                model: 'o3',
                reasoning_effort: null,
                developer_instructions: null
            }
        });
        expect(params.model).toBeUndefined();
    });
});
