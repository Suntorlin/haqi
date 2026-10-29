import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { CompactPilot, FLUSH_MESSAGE, employeeFromEnv, readCompactKeep, type EmployeeEnv } from './compactPilot';

/**
 * Design guards for the compaction layer (§8.2): at the threshold the pilot first flushes the run log,
 * then sends /compact with the keep requirements; after PostCompact it rearms and reports to the hub.
 */

const employee: EmployeeEnv = { id: 'e1', name: '小鱼', dir: '', compactThreshold: 0.75 };

function makePilot(overrides: Partial<EmployeeEnv> = {}) {
    const pushed: string[] = [];
    const reports: Array<{ phase: string; trigger: string; summary?: string }> = [];
    const pilot = new CompactPilot({ ...employee, ...overrides }, {
        pushMessage: (text) => pushed.push(text),
        fetchStatePackage: async () => '[HAQI 状态包] 测试',
        reportCompaction: async (input) => { reports.push(input); }
    });
    return { pilot, pushed, reports };
}

const tempDirs: string[] = [];
afterEach(() => {
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('employeeFromEnv', () => {
    it('reads the identity and threshold, with 0.75 as the fallback', () => {
        expect(employeeFromEnv({})).toBeNull();
        const env = { HAPI_EMPLOYEE_ID: 'e9', HAPI_EMPLOYEE_NAME: '小虾', HAPI_EMPLOYEE_DIR: '/tmp/e9', HAPI_EMPLOYEE_COMPACT_THRESHOLD: '0.2' };
        expect(employeeFromEnv(env)).toEqual({ id: 'e9', name: '小虾', dir: '/tmp/e9', compactThreshold: 0.2 });
        expect(employeeFromEnv({ HAPI_EMPLOYEE_ID: 'e9' })?.compactThreshold).toBe(0.75);
        expect(employeeFromEnv({ HAPI_EMPLOYEE_ID: 'e9', HAPI_EMPLOYEE_COMPACT_THRESHOLD: '7' })?.compactThreshold).toBe(0.75);
    });
});

describe('readCompactKeep', () => {
    it('flattens the 压缩时保留 section of AGENTS.md, defaults without one', () => {
        const dir = mkdtempSync(join(tmpdir(), 'pilot-'));
        tempDirs.push(dir);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'AGENTS.md'), '# 规则\n\n## 压缩时保留\n- 当前目标\n- 密语 KIWI-5\n\n## 别的\n无\n');
        expect(readCompactKeep(dir)).toBe('当前目标；密语 KIWI-5');
        expect(readCompactKeep('/does/not/exist')).toContain('当前目标');
    });
});

describe('CompactPilot', () => {
    it('flushes first, compacts on the next turn end, and rearms after PostCompact', () => {
        const { pilot, pushed, reports } = makePilot();
        pilot.noteContextWindow(100_000);

        // Below the threshold: nothing happens.
        pilot.noteAssistantUsage({ input_tokens: 10, cache_read_input_tokens: 50_000, cache_creation_input_tokens: 10_000 });
        pilot.noteTurnEnd();
        expect(pushed).toEqual([]);

        // Over the threshold: the flush message goes out once.
        pilot.noteAssistantUsage({ input_tokens: 10, cache_read_input_tokens: 70_000, cache_creation_input_tokens: 10_000 });
        pilot.noteTurnEnd();
        expect(pushed).toEqual([FLUSH_MESSAGE]);

        // The flush turn ends: now the /compact command with the keep requirements.
        pilot.noteTurnEnd();
        expect(pushed).toHaveLength(2);
        expect(pushed[1]).toMatch(/^\/compact /);
        expect(pushed[1]).toContain('当前目标');

        // While compacting, no re-trigger.
        pilot.noteTurnEnd();
        expect(pushed).toHaveLength(2);

        // PostCompact resets the usage and reports to the hub.
        pilot.notePostCompact('manual', '摘要原文');
        expect(reports).toContainEqual({ phase: 'post', trigger: 'manual', summary: '摘要原文' });
        pilot.noteTurnEnd();
        expect(pushed).toHaveLength(2);

        // Usage climbs again: the cycle rearms.
        pilot.noteAssistantUsage({ input_tokens: 80_000 });
        pilot.noteTurnEnd();
        expect(pushed).toHaveLength(3);
        expect(pushed[2]).toBe(FLUSH_MESSAGE);
    });

    it("answers SessionStart(compact) with the state package, and reports Claude's own auto compaction", async () => {
        const { pilot, pushed, reports } = makePilot();
        pilot.start();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(pilot.sessionStartContext('compact')).toBe('[HAQI 状态包] 测试');
        expect(pilot.sessionStartContext('startup')).toBeNull();

        // The fallback (§8.3): Claude compacted mid-turn on its own; the pilot reports it and pushes nothing.
        pilot.notePreCompact('auto');
        pilot.notePostCompact('auto', '自动压缩摘要');
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(reports).toContainEqual({ phase: 'pre', trigger: 'auto' });
        expect(reports).toContainEqual({ phase: 'post', trigger: 'auto', summary: '自动压缩摘要' });
        expect(pushed).toEqual([]);
    });
});
