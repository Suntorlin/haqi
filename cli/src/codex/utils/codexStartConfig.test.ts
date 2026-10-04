import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCodexStartConfig } from './codexStartConfig';
import { getCodexSystemPrompt } from './systemPrompt';

describe('buildCodexStartConfig', () => {
    let tempRoot: string;
    let previousHapiHome: string | undefined;
    const mcpServers = { hapi: { command: 'node', args: ['mcp'] } };

    beforeEach(() => {
        tempRoot = mkdtempSync(join(tmpdir(), 'codex-start-config-'));
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
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'default' },
            first: true,
            mcpServers,
            cliOverrides: { sandbox: 'danger-full-access', approvalPolicy: 'never' },
            cwd: '/tmp/project'
        });

        expect(config.sandbox).toBe('danger-full-access');
        expect(config['approval-policy']).toBe('never');
        expect(config.cwd).toBe('/tmp/project');
        expect(config.config).toEqual({
            mcp_servers: mcpServers,
            developer_instructions: getCodexSystemPrompt()
        });
    });

    it('ignores CLI overrides when permission mode is not default', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'yolo' },
            first: false,
            mcpServers,
            cliOverrides: { sandbox: 'read-only', approvalPolicy: 'never' }
        });

        expect(config.sandbox).toBe('danger-full-access');
        expect(config['approval-policy']).toBe('never');
    });

    it('uses yolo-style approval for auto-approve mode', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'auto-approve' },
            first: false,
            mcpServers,
            cliOverrides: { sandbox: 'read-only', approvalPolicy: 'on-request' }
        });

        expect(config.sandbox).toBe('danger-full-access');
        expect(config['approval-policy']).toBe('never');
    });

    it('uses yolo-style approval for auto-approve plan mode', () => {
        const config = buildCodexStartConfig({
            message: 'plan first',
            mode: { permissionMode: 'auto-approve', collaborationMode: 'plan' },
            first: false,
            mcpServers
        });

        expect(config.sandbox).toBe('danger-full-access');
        expect(config['approval-policy']).toBe('never');
        expect(config['include-plan-tool']).toBe(true);
    });

    it('passes model, service tier, and effort when provided', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'default', model: 'o3', serviceTier: 'fast', effort: 'high' },
            first: false,
            mcpServers
        });

        expect(config.model).toBe('o3');
        expect(config.config).toEqual({
            mcp_servers: mcpServers,
            service_tier: 'fast',
            model_reasoning_effort: 'high',
            developer_instructions: getCodexSystemPrompt()
        });
    });

    it('omits auto effort from config', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'default', effort: 'auto' },
            first: false,
            mcpServers
        });

        expect(config.config).not.toHaveProperty('model_reasoning_effort');
    });

    it('keeps asking on request for safe-yolo and legacy on-failure overrides', () => {
        const safeYolo = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'safe-yolo' },
            first: false,
            mcpServers
        });
        const legacy = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'default' },
            first: false,
            mcpServers,
            cliOverrides: { approvalPolicy: 'on-failure' }
        });

        expect(safeYolo['approval-policy']).toBe('on-request');
        expect(legacy['approval-policy']).toBe('on-request');
    });

    it('enables plan tool when collaboration mode is plan', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'default', collaborationMode: 'plan' },
            first: false,
            mcpServers
        });

        expect(config['include-plan-tool']).toBe(true);
    });

    it('omits developer instructions when base instructions are empty', () => {
        const config = buildCodexStartConfig({
            message: 'hello',
            mode: { permissionMode: 'default' },
            first: false,
            mcpServers,
            baseInstructions: ''
        });

        expect(config.config).toEqual({
            mcp_servers: mcpServers
        });
    });
});
