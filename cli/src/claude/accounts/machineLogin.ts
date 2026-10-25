import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ClaudeMachineLogin } from '@hapi/protocol/schemas';

/*
 * The machine login is what a Claude session uses when no pool account is picked: the plain
 * `claude` login of the machine (CLAUDE_CONFIG_DIR of the runner, else ~/.claude).
 * `claude auth status` only reads the stored credentials, so a login whose refresh token is dead
 * still reads as logged in. A session that fails to authenticate on it records the failure here,
 * together with a stamp of the stored credentials; a new login changes the stamp and clears it.
 */

const FAILURE_FILE = 'claude-machine-login.json';
const FailureSchema = z.object({ failedAt: z.number(), stamp: z.string().nullable() });

function configDir(env: NodeJS.ProcessEnv): string | undefined {
    return env.CLAUDE_CONFIG_DIR || undefined;
}

/** Same naming as Claude Code: base name, plus a sha256(dir) suffix only for a custom config dir. */
function keychainService(dir: string | undefined): string {
    if (!dir) return 'Claude Code-credentials';
    return `Claude Code-credentials-${createHash('sha256').update(dir).digest('hex').slice(0, 8)}`;
}

/** When the stored credentials last changed. Reads item attributes only, never the secret. */
async function credentialStamp(env: NodeJS.ProcessEnv): Promise<string | null> {
    const dir = configDir(env);
    if (process.platform === 'darwin') {
        const service = keychainService(dir);
        const mdat = await new Promise<string | null>(resolve => {
            execFile('security', ['find-generic-password', '-s', service, '-a', env.USER ?? ''],
                { timeout: 5_000, maxBuffer: 64 * 1024 },
                (error, stdout) => resolve(error ? null : /"mdat"<timedate>=0x([0-9A-F]+)/.exec(stdout)?.[1] ?? null));
        });
        if (mdat) return `keychain:${mdat}`;
    }
    try {
        const info = await stat(join(dir ?? join(homedir(), '.claude'), '.credentials.json'));
        return `file:${info.mtimeMs}`;
    } catch {
        return null;
    }
}

async function loginEmail(env: NodeJS.ProcessEnv): Promise<string | undefined> {
    const dir = configDir(env);
    try {
        const raw = JSON.parse(await readFile(dir ? join(dir, '.claude.json') : join(homedir(), '.claude.json'), 'utf8')) as unknown;
        const email = z.object({ oauthAccount: z.object({ emailAddress: z.string() }) }).safeParse(raw);
        return email.success ? email.data.oauthAccount.emailAddress : undefined;
    } catch {
        return undefined;
    }
}

async function readFailure(home: string): Promise<z.infer<typeof FailureSchema> | null> {
    try {
        const parsed = FailureSchema.safeParse(JSON.parse(await readFile(join(home, FAILURE_FILE), 'utf8')));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

export async function readMachineLogin(home: string, env: NodeJS.ProcessEnv = process.env): Promise<ClaudeMachineLogin> {
    const [email, failure] = await Promise.all([loginEmail(env), readFailure(home)]);
    if (!failure) return { email };
    // Logged in again since the failure: the old failure says nothing about the new login.
    if (failure.stamp !== await credentialStamp(env)) return { email };
    return { email, failedAt: failure.failedAt };
}

export async function recordMachineLoginFailure(home: string, env: NodeJS.ProcessEnv = process.env, now: number = Date.now()): Promise<void> {
    const stamp = await credentialStamp(env);
    await writeFile(join(home, FAILURE_FILE), JSON.stringify({ failedAt: now, stamp }), { mode: 0o600 });
}

export async function clearMachineLoginFailure(home: string): Promise<void> {
    await rm(join(home, FAILURE_FILE), { force: true });
}

/** A session runs on the machine login when the runner did not give it a pool account. */
export function usesMachineLogin(env: NodeJS.ProcessEnv = process.env): boolean {
    return !env.HAPI_CLAUDE_ACCOUNT;
}
