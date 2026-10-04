import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ClaudeUsageLimit } from '@hapi/protocol/schemas';
import { logger } from '@/ui/logger';

const CredentialsSchema = z.object({
    claudeAiOauth: z.object({ accessToken: z.string().min(1) })
});

const UsageLimitsBodySchema = z.object({
    limits: z.array(z.object({
        kind: z.string().min(1).max(40),
        percent: z.number().nullable().optional(),
        resets_at: z.string().nullable().optional(),
        severity: z.string().max(20).nullable().optional(),
        scope: z.object({
            model: z.object({ display_name: z.string().max(60).nullable().optional() }).nullable().optional()
        }).nullable().optional()
    })).max(16)
});

/** Keychain service follows cc's per-CLAUDE_CONFIG_DIR naming: base name + sha256(dir) prefix. */
function keychainService(configDir: string | undefined): string {
    if (!configDir) return 'Claude Code-credentials';
    return `Claude Code-credentials-${createHash('sha256').update(configDir).digest('hex').slice(0, 8)}`;
}

async function readKeychainCredentials(configDir: string | undefined): Promise<string | null> {
    return new Promise(resolve => {
        execFile(
            'security',
            ['find-generic-password', '-s', keychainService(configDir), '-a', process.env.USER ?? '', '-w'],
            { timeout: 5_000, maxBuffer: 64 * 1024 },
            (error, stdout) => resolve(error ? null : stdout)
        );
    });
}

async function readFileCredentials(configDir: string | undefined): Promise<string | null> {
    try {
        return await readFile(join(configDir ?? join(homedir(), '.claude'), '.credentials.json'), 'utf8');
    } catch {
        return null;
    }
}

async function readAccessToken(configDir: string | undefined): Promise<string | null> {
    const raw = process.platform === 'darwin'
        ? (await readKeychainCredentials(configDir)) ?? (await readFileCredentials(configDir))
        : await readFileCredentials(configDir);
    if (!raw) return null;
    try {
        return CredentialsSchema.parse(JSON.parse(raw)).claudeAiOauth.accessToken;
    } catch {
        return null;
    }
}

/** Map the oauth usage response body to snapshot rows. Exported for tests. */
export function parseUsageLimits(body: unknown, now: number = Date.now()): ClaudeUsageLimit[] | null {
    const parsed = UsageLimitsBodySchema.safeParse(body);
    if (!parsed.success) return null;
    return parsed.data.limits.map(limit => {
        const resetsAtMs = limit.resets_at ? Date.parse(limit.resets_at) : Number.NaN;
        const entry: ClaudeUsageLimit = { kind: limit.kind, observedAt: now };
        if (typeof limit.percent === 'number' && limit.percent >= 0) entry.percent = Math.min(100, limit.percent);
        if (Number.isFinite(resetsAtMs)) entry.resetsAt = Math.floor(resetsAtMs / 1000);
        if (limit.severity) entry.severity = limit.severity;
        const label = limit.scope?.model?.display_name;
        if (label) entry.label = label;
        return entry;
    });
}

/**
 * Fetch per-window usage (including model-scoped weekly buckets like Fable)
 * from the oauth usage API. rate_limit_event only carries the single
 * representative claim, so this is the only source for the full picture.
 * Returns null on any failure; callers keep the previous snapshot.
 */
export async function fetchClaudeUsageLimits(configDir: string | undefined, now: number = Date.now()): Promise<ClaudeUsageLimit[] | null> {
    try {
        const token = await readAccessToken(configDir);
        if (!token) return null;
        const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
            headers: {
                Authorization: `Bearer ${token}`,
                'anthropic-beta': 'oauth-2025-04-20'
            },
            signal: AbortSignal.timeout(10_000)
        });
        if (!response.ok) return null;
        return parseUsageLimits(await response.json(), now);
    } catch (error) {
        logger.debug('[claudeUsage] fetch failed', error);
        return null;
    }
}
