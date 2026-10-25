import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearMachineLoginFailure, readMachineLogin, recordMachineLoginFailure } from './machineLogin';

describe('machine login', () => {
    let home: string;
    let configDir: string;
    let env: NodeJS.ProcessEnv;

    beforeEach(async () => {
        home = await mkdtemp(join(tmpdir(), 'hapi-home-'));
        // A custom config dir: no keychain item exists for it, so the credentials file is the stamp.
        configDir = await mkdtemp(join(tmpdir(), 'claude-config-'));
        env = { CLAUDE_CONFIG_DIR: configDir, USER: 'nobody' };
        await writeFile(join(configDir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'test@example.com' } }));
        await writeFile(join(configDir, '.credentials.json'), '{}');
    });

    afterEach(async () => {
        await rm(home, { recursive: true, force: true });
        await rm(configDir, { recursive: true, force: true });
    });

    it('reports a failure until the login changes or a session succeeds', async () => {
        expect(await readMachineLogin(home, env)).toEqual({ email: 'test@example.com' });

        await recordMachineLoginFailure(home, env, 1000);
        expect(await readMachineLogin(home, env)).toEqual({ email: 'test@example.com', failedAt: 1000 });

        // Logging in again rewrites the credentials.
        await utimes(join(configDir, '.credentials.json'), new Date(), new Date(Date.now() + 60_000));
        expect(await readMachineLogin(home, env)).toEqual({ email: 'test@example.com' });

        await recordMachineLoginFailure(home, env, 2000);
        await clearMachineLoginFailure(home);
        expect(await readMachineLogin(home, env)).toEqual({ email: 'test@example.com' });
    });
});
