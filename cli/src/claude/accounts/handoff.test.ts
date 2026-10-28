import { describe, expect, it, vi } from 'vitest';
import { AccountHandoff } from './handoff';
import type { AccountsConfig } from './profiles';
import type { SDKMessage } from '../sdk';

const config: AccountsConfig = {
    version: 1,
    initialAccount: 'a',
    autoSwitch: true,
    profiles: [
        { id: 'a', email: 'a@example.com', configDir: '/tmp/haqi-a', trustGroup: 'personal' },
        { id: 'b', email: 'b@example.com', configDir: '/tmp/haqi-b', trustGroup: 'personal' },
        { id: 'c', email: 'c@example.com', configDir: '/tmp/haqi-c', trustGroup: 'work' }
    ]
};

const rejected = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } } as unknown as SDKMessage;

describe('Claude 账号自动切换', () => {
    it('明确的限额拒绝事件后，给出同组未超限账号', () => {
        const handoff = new AccountHandoff(config);
        expect(handoff.automaticTarget()).toBeUndefined();
        handoff.observe(rejected);
        expect(handoff.waitingForQuota).toBe(true);
        expect(handoff.automaticTarget()?.id).toBe('b');
    });

    it('长会话、子 Agent 和后台任务不再阻止切换', () => {
        const handoff = new AccountHandoff(config);
        handoff.observe({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Task', input: { run_in_background: true } }] } } as unknown as SDKMessage);
        handoff.observe(rejected);
        expect(handoff.automaticTarget()?.id).toBe('b');
    });

    it('没有限额事件时，额度拒绝的合成回复也触发切换', () => {
        const handoff = new AccountHandoff(config);
        const reply = (text: string, model = '<synthetic>') => ({ type: 'assistant', message: { model, role: 'assistant', content: [{ type: 'text', text }] } } as unknown as SDKMessage);
        handoff.observe(reply('Approaching usage limit · resets at 4pm'));
        handoff.observe(reply("You've hit your weekly limit · resets Oct 31 at 4pm", 'claude-opus-5-5'));
        expect(handoff.waitingForQuota).toBe(false);
        handoff.observe(reply("You've hit your weekly limit · resets Oct 31 at 4pm (Asia/Tokyo)"));
        expect(handoff.waitingForQuota).toBe(true);
        expect(handoff.automaticTarget()?.id).toBe('b');
    });

    it('付费兜底中的限额事件不触发切换', () => {
        const handoff = new AccountHandoff(config);
        handoff.observe({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour', isUsingOverage: true } } as unknown as SDKMessage);
        expect(handoff.automaticTarget()).toBeUndefined();
    });

    it('自动切换关闭或候选耗尽时不给目标', () => {
        const off = new AccountHandoff({ ...config, autoSwitch: false });
        off.observe(rejected);
        expect(off.automaticTarget()).toBeUndefined();

        const handoff = new AccountHandoff(config);
        handoff.observe(rejected);
        handoff.markExhausted('b');
        expect(handoff.automaticTarget()).toBeUndefined();
    });

    it('不跨授权组，不在忙碌时切换，核验后复查忙碌', async () => {
        const handoff = new AccountHandoff(config);
        await expect(handoff.prepare('c', () => false, vi.fn(async () => {}))).rejects.toThrow('禁止跨授权组');
        await expect(handoff.prepare('b', () => true, vi.fn(async () => {}))).rejects.toThrow('仍在执行');

        let busy = false;
        const verify = vi.fn(async () => { busy = true; });
        await expect(handoff.prepare('b', () => busy, verify)).rejects.toThrow('切换已取消');

        busy = false;
        const profile = await handoff.prepare('b', () => busy, vi.fn(async () => {}));
        expect(profile.id).toBe('b');
    });

    it('commit 后清除等待状态，且同一账号不再二次使用', () => {
        const handoff = new AccountHandoff(config);
        handoff.observe(rejected);
        const target = handoff.automaticTarget()!;
        handoff.commit(target);
        expect(handoff.current.id).toBe('b');
        expect(handoff.waitingForQuota).toBe(false);
        handoff.observe(rejected);
        // a 已超限、b 已用过：没有候选。
        expect(handoff.automaticTarget()).toBeUndefined();
    });
});
