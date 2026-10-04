import { claudeRemote } from '../claudeRemote';
import type { EnhancedMode } from '../loop';
import { AccountHandoff } from './handoff';
import { accountEnvironment, type AccountProfile, type AccountsConfig, verifyAccount } from './profiles';
import { getDefaultClaudeCodePath } from '../sdk/utils';

type RemoteOptions = Parameters<typeof claudeRemote>[0] & { onAccountState?: (state: import('@hapi/protocol/schemas').ClaudeAccountRuntime) => void };
type Prepared = { profile: AccountProfile; prompt: string };

/** Opt-in remote-only adapter. Keeps the outer HAQI client/session/queue untouched. */
export class ManagedClaudeRemote {
    readonly handoff: AccountHandoff;
    private initialized = false;
    private poisoned = false;

    constructor(config: AccountsConfig, private readonly verify = verifyAccount) {
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
        if (!this.initialized) {
            if (opts.sessionId || opts.claudeArgs?.some(arg => ['--resume', '--continue', '-c', '-r'].includes(arg))) {
                throw new Error('实验版只支持新建的受管理会话，不能直接接管未记录历史的旧会话');
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
            let prepared: Prepared | null = null;
            const prepare = async (id: string) => {
                prepared = await this.handoff.prepare(id, opts.path, busy, verify);
                publish('switching');
                report(`正在停止旧进程，准备由 ${prepared.profile.email} 接管当前 HAQI 会话`);
            };
            try {
                await claudeRemote({
                    ...opts,
                    sessionId,
                    childEnv: envFor(this.handoff.current),
                    stopChildOnReturn: true,
                    onSessionFound: id => { sessionId = id; opts.onSessionFound(id); },
                    onMessage: message => { this.handoff.observe(message); if (message.type === 'assistant') publish('active'); opts.onMessage(message); },
                    nextMessage: async signal => {
                        if (seed) {
                            const initial = seed; seed = null;
                            this.handoff.ledger.startTurn();
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
                            report('额度已拒绝；没有已验证的安全自动接管路径。可使用 /account use <账号标识>，不会无限轮换或开启付费兜底。');
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
                            this.handoff.ledger.user(next.message);
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
            const next = prepared as Prepared;
            this.handoff.commit(next.profile);
            publish('handoff');
            opts.onSessionReset?.();
            sessionId = null;
            seed = { message: next.prompt, mode: lastMode };
            quotaNoticeSent = false;
            report(`账号切换为 ${next.profile.email}，正在通过 context_handoff 接管；HAQI 会话保持不变`);
        }
    }
}
