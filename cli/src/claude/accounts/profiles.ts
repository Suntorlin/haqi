import { execFile } from 'node:child_process';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { z } from 'zod';

const ProfileSchema = z.object({
    id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
    email: z.email(),
    configDir: z.string().refine(isAbsolute),
    // Same trust group explicitly authorizes sharing this conversation's context.
    trustGroup: z.string().min(1).max(80),
    enabled: z.boolean().optional()
}).strict();
export const AccountsSchema = z.object({
    version: z.literal(1),
    initialAccount: z.string(),
    autoSwitch: z.boolean().default(false),
    profiles: z.array(ProfileSchema).min(1).max(10)
}).strict();
export type AccountProfile = z.infer<typeof ProfileSchema>;
export type AccountsConfig = z.infer<typeof AccountsSchema>;

/** No credentials are stored in this registry. Isolated profiles must be local. */
export async function loadAccounts(home: string): Promise<AccountsConfig> {
    const config = AccountsSchema.parse(JSON.parse(await readFile(join(home, 'claude-accounts.json'), 'utf8')));
    const root = await realpath(join(home, 'claude-accounts'));
    const ids = new Set<string>();
    const paths = new Set<string>();
    const emails = new Set<string>();
    for (const profile of config.profiles) {
        const path = await realpath(profile.configDir);
        const child = relative(root, path);
        if (!child || child.startsWith('..') || isAbsolute(child)) {
            throw new Error('账号目录必须位于独立 HAPI_HOME/claude-accounts 内，禁止使用全局登录目录或外部符号链接');
        }
        const email = profile.email.toLowerCase();
        if (ids.has(profile.id) || paths.has(path) || emails.has(email)) {
            throw new Error('账号标识、邮箱与配置目录必须唯一');
        }
        profile.configDir = path;
        ids.add(profile.id); paths.add(path); emails.add(email);
    }
    if (!ids.has(config.initialAccount)) throw new Error('初始账号不在配置中');
    return config;
}

/** Build a fresh child environment; never modify process.env or global credentials. */
export function accountEnvironment(base: NodeJS.ProcessEnv, profile: AccountProfile): NodeJS.ProcessEnv {
    const env = { ...base };
    for (const key of Object.keys(env)) {
        if (key.startsWith('ANTHROPIC_') || key.startsWith('CLAUDE_CODE_OAUTH') || key.startsWith('CLAUDE_CODE_USE_')) {
            delete env[key];
        }
    }
    env.CLAUDE_CONFIG_DIR = profile.configDir;
    env.DISABLE_AUTOUPDATER = '1';
    return env;
}

/** Read-only identity check. Never return raw CLI stdout/stderr (may contain secrets). */
export async function verifyAccount(executable: string, cwd: string, env: NodeJS.ProcessEnv, profile: AccountProfile): Promise<void> {
    const output = await new Promise<string>((resolve, reject) => {
        execFile(executable, ['auth', 'status', '--json'], { cwd, env, timeout: 15_000, maxBuffer: 64 * 1024 }, (error, stdout) => {
            if (error) reject(new Error('账号身份检查失败，请在隔离目录内登录后重试'));
            else resolve(stdout);
        });
    });
    const parsed = z.object({
        loggedIn: z.literal(true),
        email: z.string(),
        authMethod: z.literal('claude.ai')
    }).safeParse((() => { try { return JSON.parse(output); } catch { return null; } })());
    if (!parsed.success || parsed.data.email.toLowerCase() !== profile.email.toLowerCase()) {
        throw new Error('实际登录身份或鉴权方式与账号配置不符，已阻止启动');
    }
}
