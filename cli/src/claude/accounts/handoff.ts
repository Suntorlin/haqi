import { claudeQuotaRefusal } from '@hapi/protocol';
import type { SDKMessage } from '../sdk';
import type { AccountProfile, AccountsConfig } from './profiles';

/**
 * Account switching keeps the native transcript: the runner copies the session
 * .jsonl into the target account's config dir and Claude resumes natively, so
 * no handoff prompt or history ledger is needed. Safety here is about timing
 * (idle session, one switch at a time) and scope (same trust group only).
 */
export class AccountHandoff {
    current: AccountProfile;
    automatic: boolean;
    private exhausted = new Set<string>();
    private visited = new Set<string>();
    private quotaRejected = false;
    private switching = false;

    constructor(readonly config: AccountsConfig) {
        this.current = config.profiles.find(p => p.id === config.initialAccount)!;
        this.automatic = config.autoSwitch;
        this.visited.add(this.current.id);
    }

    observe(message: SDKMessage): void {
        const event = message as unknown as { type: string; message?: unknown; rate_limit_info?: { status?: string; rateLimitType?: string; isUsingOverage?: boolean } };
        const info = event.rate_limit_info;
        const rejected = event.type === 'rate_limit_event' && info?.status === 'rejected' && !info.isUsingOverage &&
            ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'].includes(info.rateLimitType ?? '');
        // The refused turn's synthetic reply also comes when no rejected rate_limit_event does.
        if (rejected || (event.type === 'assistant' && claudeQuotaRefusal(event.message))) {
            this.quotaRejected = true;
            this.exhausted.add(this.current.id);
        }
    }

    /** The usage API (not a live rate_limit_event) says this account is over a blocking window. */
    markExhausted(id: string): void {
        this.exhausted.add(id);
    }

    /** The next enabled account in the same trust group that is not exhausted and not already used by this process. */
    candidate(): AccountProfile | undefined {
        return this.config.profiles.find(p => p.enabled !== false && p.trustGroup === this.current.trustGroup && !this.exhausted.has(p.id) && !this.visited.has(p.id));
    }

    automaticTarget(): AccountProfile | undefined {
        if (!this.automatic || !this.quotaRejected) return undefined;
        return this.candidate();
    }

    get waitingForQuota(): boolean { return this.quotaRejected; }

    async prepare(id: string, isBusy: () => boolean, verify: (profile: AccountProfile) => Promise<void>): Promise<AccountProfile> {
        if (this.switching) throw new Error('账号切换已经在进行中');
        const profile = this.config.profiles.find(p => p.id === id);
        if (!profile || profile.enabled === false) throw new Error('账号不存在或已停用');
        if (profile.id === this.current.id) throw new Error('已经使用这个账号');
        if (profile.trustGroup !== this.current.trustGroup) throw new Error('禁止跨授权组迁移会话上下文');
        if (isBusy()) throw new Error('会话仍在执行，暂不能切换账号');
        this.switching = true;
        try {
            await verify(profile);
            // A background turn can start while the read-only identity check is pending.
            if (isBusy()) throw new Error('身份检查期间会话重新变为忙碌，切换已取消');
            return profile;
        } finally { this.switching = false; }
    }

    /** Only call after the previous child has fully stopped. */
    commit(profile: AccountProfile): void {
        this.current = profile;
        this.visited.add(profile.id);
        this.quotaRejected = false;
    }
}
