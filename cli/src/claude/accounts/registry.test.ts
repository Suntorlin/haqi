import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readPool, savePool } from './registry';

let home: string;
beforeEach(async () => { home = await mkdtemp(join(tmpdir(), 'haqi-pool-test-')); });
afterEach(async () => { await rm(home, { recursive: true, force: true }); });
const pool = { initialAccount: 'first', autoSwitch: false, profiles: [
    { id: 'first', email: 'first@example.com', trustGroup: 'personal', enabled: true },
    { id: 'second', email: 'second@example.com', trustGroup: 'personal', enabled: true }
] };
describe('machine-local Claude account registry', () => {
    it('returns empty metadata and no paths or secrets', async () => {
        const view = await readPool(home);
        expect(view.pool.profiles).toEqual([]);
        const result = await savePool(home, { pool, revision: view.revision });
        expect(JSON.stringify(result)).not.toContain(home);
        expect(result.pool.profiles.map(p => p.id)).toEqual(['first', 'second']);
        expect((await stat(join(home, 'claude-accounts.json'))).mode & 0o777).toBe(0o600);
    });
    it('preserves order and rejects stale writers', async () => {
        const view = await readPool(home);
        const result = await savePool(home, { pool, revision: view.revision });
        const reversed = { ...pool, profiles: [...pool.profiles].reverse() };
        await expect(savePool(home, { pool: reversed, revision: view.revision })).rejects.toThrow('已被修改');
        await savePool(home, { pool: reversed, revision: result.revision });
        expect((await readPool(home)).pool.profiles[0].id).toBe('second');
    });
    it('serializes concurrent edits so only one succeeds', async () => {
        const view = await readPool(home);
        const results = await Promise.allSettled([savePool(home, { pool, revision: view.revision }), savePool(home, { pool, revision: view.revision })]);
        expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    });
    it('does not delete credential directories when removing a profile', async () => {
        const view = await savePool(home, { pool, revision: (await readPool(home)).revision });
        await savePool(home, { pool: { ...pool, profiles: [pool.profiles[1]], initialAccount: 'second' }, revision: view.revision });
        expect((await stat(join(home, 'claude-accounts', 'first'))).isDirectory()).toBe(true);
    });
    it('blocks symlink escapes and duplicate identity', async () => {
        const view = await savePool(home, { pool, revision: (await readPool(home)).revision });
        await symlink(tmpdir(), join(home, 'claude-accounts', 'outside'));
        await expect(savePool(home, { pool: { ...pool, profiles: [...pool.profiles, { ...pool.profiles[0], id: 'outside', email: 'other@example.com' }] }, revision: view.revision })).rejects.toThrow('目录外');
        await expect(savePool(home, { pool: { ...pool, profiles: [...pool.profiles, pool.profiles[0]] }, revision: view.revision })).rejects.toThrow();
        expect(JSON.parse(await readFile(join(home, 'claude-accounts.json'), 'utf8')).profiles).toHaveLength(2);
    });
});
