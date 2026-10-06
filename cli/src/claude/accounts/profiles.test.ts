import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { accountEnvironment, verifyAccount } from './profiles';

const profile = { id: 'work', email: 'work@example.com', configDir: '/tmp/hapi-accounts/work', trustGroup: 'personal' };

describe('managed Claude account environment', () => {
    it('does not leak global Claude credentials into an isolated child', () => {
        const env = accountEnvironment({ ANTHROPIC_API_KEY: 'secret', CLAUDE_CODE_OAUTH_TOKEN: 'old', PATH: '/bin' }, profile);
        expect(env.ANTHROPIC_API_KEY).toBeUndefined();
        expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
        expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/hapi-accounts/work');
    });
});

describe('managed Claude account identity check', () => {
    let dir: string;
    beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'haqi-verify-test-')); });
    afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
    // Stand-in for `claude auth status --json`: fixed stdout and exit code.
    const fakeClaude = async (stdout: string, exitCode: number) => {
        const file = join(dir, 'claude');
        await writeFile(file, `#!/bin/sh\nprintf '%s' '${stdout}'\nexit ${exitCode}\n`);
        await chmod(file, 0o755);
        return file;
    };

    it('tells a logged-out profile how to log in even though auth status exits 1', async () => {
        const claude = await fakeClaude('{"loggedIn":false,"authMethod":"none"}', 1);
        await expect(verifyAccount(claude, dir, {}, profile)).rejects.toThrow('尚未在隔离目录登录');
        await expect(verifyAccount(claude, dir, {}, profile)).rejects.toThrow('CLAUDE_CONFIG_DIR="/tmp/hapi-accounts/work" claude auth login');
    });
    it('accepts the configured identity and blocks any other', async () => {
        await expect(verifyAccount(await fakeClaude('{"loggedIn":true,"email":"Work@Example.com","authMethod":"claude.ai"}', 0), dir, {}, profile)).resolves.toBeUndefined();
        await expect(verifyAccount(await fakeClaude('{"loggedIn":true,"email":"other@example.com","authMethod":"claude.ai"}', 0), dir, {}, profile)).rejects.toThrow('已阻止启动');
    });
    it('keeps the generic failure when the check itself cannot run', async () => {
        await expect(verifyAccount(await fakeClaude('', 1), dir, {}, profile)).rejects.toThrow('账号身份检查失败');
        await expect(verifyAccount(join(dir, 'missing'), dir, {}, profile)).rejects.toThrow('账号身份检查失败');
    });
});
