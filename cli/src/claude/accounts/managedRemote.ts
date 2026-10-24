import { claudeRemote } from '../claudeRemote';
import type { EnhancedMode } from '../loop';
import { AccountHandoff } from './handoff';
import { accountEnvironment, type AccountProfile, type AccountsConfig, verifyAccount } from './profiles';
import { getDefaultClaudeCodePath } from '../sdk/utils';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { getProjectPath } from '../utils/path';
import { fetchClaudeUsageLimits } from '../utils/claudeUsage';

type RemoteOptions = Parameters<typeof claudeRemote>[0] & { onAccountState?: (state: import('@hapi/protocol/schemas').ClaudeAccountRuntime) => void };

/** A window that blocks every request (5h session or all-model weekly) is full and its reset is still ahead. */
async function usageBlocked(configDir: string): Promise<boolean> {
    const limits = await fetchClaudeUsageLimits(configDir);
    const now = Date.now();
    return (limits ?? []).some(limit =>
        (limit.kind === 'session' || limit.kind === 'weekly_all') && (limit.percent ?? 0) >= 100 && (limit.resetsAt ?? 0) * 1000 > now);
}

/** Opt-in remote-only adapter. Keeps the outer HAQI client/session/queue untouched. */
export class ManagedClaudeRemote {
    readonly handoff: AccountHandoff;
    private initialized = false;
    private poisoned = false;
    // The outer launcher creates a new `claudeRemote` after every abort. A
    // resumed transcript needs one synthetic continuation prompt only on the
    // first launch; replaying it here makes Abort immediately start the turn
    // again.
    private hasLaunched = false;

    constructor(config: AccountsConfig, private readonly verify = verifyAccount, private readonly usageExhausted = usageBlocked) {
        this.handoff = new AccountHandoff(config);
    }

    async run(opts: RemoteOptions, busy: () => boolean): Promise<void> {
        if (this.poisoned) throw new Error('接管进程异常，已禁止自动重试；需要人工检查执行状态');
        const base = { ...process.env, ...opts.claudeEnvVars };
        const envFor = (profile: AccountProfile) => accountEnvironment(base, profile);
        const verify = (profile: AccountProfile) => this.verify(getDefaultClaudeCodePath(), opts.path, envFor(profile), profile);
        const publish = (status: import('@hapi/protocol/schemas').ClaudeAccountRuntime['status']) => opts.onAccountState?.({
            id: this.handoff.current.id, email: this.handoff.current.email, automatic: this.handoff.automatic, status, updatedAt: Date.now()
        });
        const report = (message: string) => opts.onCompletionEvent?.(message);
        const copyTranscript = async (sessionId: string, from: AccountProfile, to: AccountProfile) => {
            const source = join(getProjectPath(opts.path, from.configDir), `${sessionId}.jsonl`);
            const targetDir = getProjectPath(opts.path, to.configDir);
            await mkdir(targetDir, { recursive: true, mode: 0o700 });
            await copyFile(source, join(targetDir, `${sessionId}.jsonl`));
        };
        if (!this.initialized) {
            // A restart loses the in-memory quota state, and the limit that killed the
            // previous process sends no live event here. Ask the usage API first, so the
            // session does not come back onto an account that is still over its limit.
            if (this.handoff.automatic) {
                try {
                    if (await this.usageExhausted(this.handoff.current.configDir)) {
                        this.handoff.markExhausted(this.handoff.current.id);
                        let target = this.handoff.candidate();
                        while (target && await this.usageExhausted(target.configDir)) {
                            this.handoff.markExhausted(target.id);
                            target = this.handoff.candidate();
                        }
                        if (target) {
                            const from = this.handoff.current;
                            if (opts.sessionId) await copyTranscript(opts.sessionId, from, target);
                            this.handoff.commit(target);
                            report(`账号 ${from.email} 仍超限，启动时切换为 ${target.email}`);
                        } else {
                            report(`账号 ${this.handoff.current.email} 仍超限，且同组没有可用账号`);
                        }
                    }
                } catch (error) {
                    // Stay on the configured account; verification below still runs.
                    report(`启动时的额度检查失败：${error instanceof Error ? error.message : String(error)}`);
                }
            }
            await verify(this.handoff.current);
            report(`账号已核验：${this.handoff.current.email}；自动切换${this.handoff.automatic ? '开启' : '关闭'}`);
            publish('verified');
            this.initialized = true;
        }
        let seed: { message: string; mode: EnhancedMode } | null = null;
        let sessionId = opts.sessionId;
        let lastMode: EnhancedMode | null = null;
        let quotaNoticeSent = false;
        while (!opts.signal?.aborted) {
            const resumeRequested = !this.hasLaunched && Boolean(sessionId || opts.claudeArgs?.some((arg, index) =>
                ['--resume', '--continue', '-c', '-r'].includes(arg) && (arg !== '--resume' || Boolean(opts.claudeArgs?.[index + 1]))
            ));
            // A manually switched account already has the copied native transcript.
            // Start the resumed Claude process idle; injecting a synthetic prompt
            // would create an unsolicited duplicate turn after an otherwise idle
            // account switch.
            const resumeWithoutMessage = resumeRequested && process.env.HAPI_CLAUDE_ACCOUNT_RESUME_IDLE === '1';
            let resumeSeedConsumed = false;
            let prepared: AccountProfile | null = null;
            const prepare = async (id: string) => {
                const profile = await this.handoff.prepare(id, busy, verify);
                // Only a fully prepared switch (transcript copied) may be committed later.
                if (sessionId) await copyTranscript(sessionId, this.handoff.current, profile);
                prepared = profile;
                publish('switching');
                report(`正在停止旧进程，准备由 ${profile.email} 接管当前 HAQI 会话`);
            };
            try {
                this.hasLaunched = true;
                await claudeRemote({
                    ...opts,
                    sessionId,
                    childEnv: envFor(this.handoff.current),
                    stopChildOnReturn: true,
                    startWithoutMessage: resumeWithoutMessage,
                    onSessionFound: id => { sessionId = id; opts.onSessionFound(id); },
                    onMessage: message => { this.handoff.observe(message); if (message.type === 'assistant') publish('active'); opts.onMessage(message); },
                    nextMessage: async signal => {
                        if (resumeRequested && !resumeWithoutMessage && !resumeSeedConsumed) {
                            resumeSeedConsumed = true;
                            lastMode = lastMode ?? { permissionMode: 'default' };
                            return { message: '继续当前会话。不要重复已经完成的工作。', mode: lastMode };
                        }
                        if (seed) {
                            const initial = seed; seed = null;
                            return initial;
                        }
                        const target = this.handoff.automaticTarget();
                        if (target && lastMode && !busy()) {
                            try { await prepare(target.id); return null; }
                            catch (error) { report(error instanceof Error ? error.message : '账号预检失败'); }
                        }
                        if (this.handoff.waitingForQuota && !quotaNoticeSent) {
                            quotaNoticeSent = true;
                            publish('blocked');
                            const why = this.handoff.automatic ? '同组没有可接管的账号（都已超限或本进程已用过）' : '自动切换已关闭';
                            report(`额度已拒绝；${why}。可用 /account use <账号标识> 手动切换，不会无限轮换或开启付费兜底。`);
                        }
                        while (!opts.signal?.aborted && !signal?.aborted) {
                            const next = await opts.nextMessage(signal);
                            if (!next) return null;
                            lastMode = next.mode;
                            if (/^\/account(?:\s|$)/.test(next.message.trim())) {
                                const parts = next.message.trim().split(/\s+/);
                                if (parts.length === 1 || (parts.length === 2 && parts[1] === 'list')) {
                                    report(this.handoff.config.profiles.map(p => `${p.id}: ${p.email}${p.id === this.handoff.current.id ? '（当前）' : ''}`).join('\n'));
                                } else if (parts.length === 3 && parts[1] === 'auto' && ['on', 'off'].includes(parts[2])) {
                                    this.handoff.automatic = parts[2] === 'on';
                                    publish(this.handoff.waitingForQuota ? 'blocked' : 'verified');
                                    report(`自动切换已${this.handoff.automatic ? '开启（后续明确限额事件触发）' : '关闭'}`);
                                } else if (parts.length === 3 && parts[1] === 'use') {
                                    try { await prepare(parts[2]); return null; }
                                    catch (error) { report(error instanceof Error ? error.message : '切换失败'); }
                                } else report('用法：/account list | /account use <账号标识> | /account auto on|off');
                                continue;
                            }
                            return next;
                        }
                        return null;
                    }
                });
            } catch (error) {
                this.poisoned = true;
                throw error;
            }
            if (!prepared || !lastMode || opts.signal?.aborted) return;
            // claudeRemote has awaited actual child close, not merely sent SIGTERM.
            const next = prepared as AccountProfile;
            this.handoff.commit(next);
            publish('handoff');
            opts.onSessionReset?.();
            // Keep the same Claude session ID. The runner copied the transcript
            // into the target account directory, so Claude resumes natively.
            sessionId = sessionId ?? null;
            seed = { message: '继续当前会话。不要重复已经完成的工作。', mode: lastMode };
            quotaNoticeSent = false;
            report(`账号切换为 ${next.email}，继续原会话；HAQI 会话保持不变`);
        }
    }
}
