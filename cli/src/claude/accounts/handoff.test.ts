import { describe, expect, it } from 'vitest';
import { HandoffLedger } from './handoff';
import type { SDKMessage } from '../sdk';

describe('Claude account context handoff', () => {
    it('preserves safe history and excludes private thinking', () => {
        const ledger = new HandoffLedger();
        ledger.user('继续修复');
        ledger.observe({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret' }, { type: 'text', text: '已完成' }] } } as unknown as SDKMessage);
        ledger.observe({ type: 'result', subtype: 'success', result: 'ok' } as unknown as SDKMessage);
        const prompt = ledger.build('/repo');
        expect(prompt).toContain('继续修复');
        expect(prompt).toContain('已完成');
        expect(prompt).not.toContain('secret');
    });

    it('fails closed while a tool or background agent is unresolved', () => {
        const ledger = new HandoffLedger();
        ledger.user('执行');
        ledger.observe({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }] } } as unknown as SDKMessage);
        expect(() => ledger.build('/repo')).toThrow('工具或当前回合尚未完成');
        const background = new HandoffLedger();
        background.user('启动');
        background.observe({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Task', input: { run_in_background: true } }] } } as unknown as SDKMessage);
        expect(background.unsafeReason()).toContain('后台任务');
    });
});
