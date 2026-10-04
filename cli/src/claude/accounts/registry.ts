import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { z } from 'zod';
import { ClaudeAccountPoolSchema, type ClaudeAccountPoolView } from '@hapi/protocol/schemas';
import { accountEnvironment, loadAccounts, verifyAccount } from './profiles';
import { getDefaultClaudeCodePath } from '../sdk/utils';

const revisionOf = (raw: string) => createHash('sha256').update(raw).digest('hex');
const empty = { initialAccount: '', autoSwitch: false, profiles: [] };
export const SavePoolSchema = z.object({ pool: ClaudeAccountPoolSchema, revision: z.string() }).strict();

export async function readPool(home: string): Promise<ClaudeAccountPoolView> {
    let raw: string;
    try { raw = await readFile(join(home, 'claude-accounts.json'), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { pool: empty, revision: revisionOf('') }; throw error; }
    const config = JSON.parse(raw) as { initialAccount: string; autoSwitch: boolean; profiles: Array<Record<string, unknown>> };
    return {
        revision: revisionOf(raw),
        pool: ClaudeAccountPoolSchema.parse({ initialAccount: config.initialAccount, autoSwitch: config.autoSwitch,
            profiles: config.profiles.map(p => ({ id: p.id, email: p.email, trustGroup: p.trustGroup, enabled: p.enabled ?? true })) })
    };
}

// All browser writes go through one runner. Serialize its read/compare/rename transaction.
let writes = Promise.resolve();
export function savePool(home: string, input: unknown): Promise<ClaudeAccountPoolView> {
    const operation = writes.then(async () => {
        const { pool, revision } = SavePoolSchema.parse(input);
        const current = await readPool(home);
        if (revision !== current.revision) throw new Error('账号配置已被修改，请刷新后重试');
        const root = join(home, 'claude-accounts');
        await mkdir(root, { recursive: true, mode: 0o700 });
        const rootReal = await realpath(root);
        const profiles = [];
        for (const profile of pool.profiles) {
            const configDir = join(root, profile.id);
            await mkdir(configDir, { recursive: true, mode: 0o700 });
            const path = await realpath(configDir);
            const child = relative(rootReal, path);
            if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error('不允许使用目录外的账号链接');
            const authHome = join(configDir, 'home');
            await mkdir(authHome, { recursive: true, mode: 0o700 });
            profiles.push({ ...profile, configDir, authHome });
        }
        const file = join(home, 'claude-accounts.json');
        const temp = `${file}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify({ version: 1, ...pool, profiles }, null, 2), { mode: 0o600 });
        await rename(temp, file);
        // Removing metadata never deletes/revokes credentials or interrupts active sessions.
        return readPool(home);
    });
    writes = operation.then(() => {}, () => {});
    return operation;
}

export async function checkPoolAccount(home: string, input: unknown): Promise<{ email: string; checkedAt: number }> {
    const { id } = z.object({ id: z.string() }).strict().parse(input);
    const config = await loadAccounts(home);
    const profile = config.profiles.find(p => p.id === id);
    if (!profile) throw new Error('账号不存在');
    await verifyAccount(getDefaultClaudeCodePath(), home, accountEnvironment(process.env, profile), profile);
    return { email: profile.email, checkedAt: Date.now() };
}
