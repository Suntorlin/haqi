import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { claudeRemote } from '../claudeRemote';
import { ManagedClaudeRemote } from './managedRemote';
import type { AccountsConfig } from './profiles';

vi.mock('../claudeRemote', () => ({ claudeRemote: vi.fn() }));
vi.mock('../sdk/utils', () => ({ getDefaultClaudeCodePath: () => '/fake/claude' }));

const config: AccountsConfig = {
    version: 1,
    initialAccount: 'test',
    autoSwitch: false,
    profiles: [{ id: 'test', email: 'test@example.com', configDir: '/tmp/haqi-test-account', trustGroup: 'test' }]
};

function options(sessionId: string | null): Parameters<typeof claudeRemote>[0] {
    return {
        sessionId,
        path: '/tmp/haqi-test-project',
        allowedTools: [],
        hookSettingsPath: '',
        canCallTool: async (_name, input) => ({ behavior: 'allow', updatedInput: (input ?? {}) as Record<string, unknown> }),
        nextMessage: vi.fn(async () => null),
        onReady: vi.fn(),
        isAborted: () => false,
        onSessionFound: vi.fn(),
        onMessage: vi.fn()
    };
}

beforeEach(() => vi.clearAllMocks());

const previousResumeIdle = process.env.HAPI_CLAUDE_ACCOUNT_RESUME_IDLE;
afterEach(() => {
    if (previousResumeIdle === undefined) delete process.env.HAPI_CLAUDE_ACCOUNT_RESUME_IDLE;
    else process.env.HAPI_CLAUDE_ACCOUNT_RESUME_IDLE = previousResumeIdle;
});

describe('受管理 Claude 会话中止后的恢复', () => {
    it('首次恢复历史时继续一次，中止后必须等待用户，不能自动续跑', async () => {
        const controller = new AbortController();
        const managed = new ManagedClaudeRemote(config, vi.fn(async () => {}));
        const initial = options('existing-session');
        vi.mocked(claudeRemote).mockImplementationOnce(async (opts) => {
            expect(await opts.nextMessage()).toMatchObject({ message: '继续当前会话。不要重复已经完成的工作。' });
            controller.abort();
        });
        await managed.run({ ...initial, signal: controller.signal }, () => false);

        const restarted = options('existing-session');
        vi.mocked(claudeRemote).mockImplementationOnce(async (opts) => {
            expect(await opts.nextMessage()).toBeNull();
        });
        await managed.run(restarted, () => false);
        expect(restarted.nextMessage).toHaveBeenCalledOnce();
    });

    it('新建会话获得历史 ID 后，中止重启也不能注入继续指令', async () => {
        const managed = new ManagedClaudeRemote(config, vi.fn(async () => {}));
        const first = options(null);
        first.nextMessage = vi.fn(async () => ({ message: '用户任务', mode: { permissionMode: 'acceptEdits' as const } }));
        vi.mocked(claudeRemote).mockImplementationOnce(async (opts) => {
            expect(await opts.nextMessage()).toMatchObject({ message: '用户任务' });
            opts.onSessionFound('new-session');
        });
        await managed.run(first, () => false);

        const restarted = options('new-session');
        vi.mocked(claudeRemote).mockImplementationOnce(async (opts) => {
            expect(await opts.nextMessage()).toBeNull();
        });
        await managed.run(restarted, () => false);
        expect(restarted.nextMessage).toHaveBeenCalledOnce();
    });

    it('中止后保留用户真实消息及权限模式，不用合成提示词覆盖', async () => {
        const managed = new ManagedClaudeRemote(config, vi.fn(async () => {}));
        vi.mocked(claudeRemote).mockImplementation(async (opts) => { await opts.nextMessage(); });
        await managed.run(options('existing-session'), () => false);

        const restarted = options('existing-session');
        const message = { message: '改做另一件事', mode: { permissionMode: 'acceptEdits' as const } };
        restarted.nextMessage = vi.fn(async () => message);
        vi.mocked(claudeRemote).mockImplementationOnce(async (opts) => {
            expect(await opts.nextMessage()).toEqual(message);
        });
        await managed.run(restarted, () => false);
    });

    it('显式切换账号时从历史会话空闲启动，不注入继续提示词', async () => {
        process.env.HAPI_CLAUDE_ACCOUNT_RESUME_IDLE = '1';
        const managed = new ManagedClaudeRemote(config, vi.fn(async () => {}));
        const initial = options('existing-session');
        const message = { message: '切换账号后的新任务', mode: { permissionMode: 'default' as const } };
        initial.nextMessage = vi.fn(async () => message);
        const controller = new AbortController();
        vi.mocked(claudeRemote).mockImplementationOnce(async (opts) => {
            expect(opts.startWithoutMessage).toBe(true);
            expect(await opts.nextMessage()).toEqual(message);
            controller.abort();
        });

        await managed.run({ ...initial, signal: controller.signal }, () => false);
        expect(initial.nextMessage).toHaveBeenCalledOnce();
    });
});
