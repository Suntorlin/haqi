/**
 * The employee compaction pilot (design §8.2): watch the context share each turn, and at the employee's threshold
 * first flush the working state into the run log, then send `/compact <keep requirements>`. It also answers
 * SessionStart(compact) with the state package and reports every compaction to the hub, which counts it and saves
 * the summary into the run log — including Claude's own auto-compactions (the §8.3 fallback).
 */

import { logger } from "@/ui/logger";
import { readCompactKeep, type EmployeeEnv } from "@/agent/utils/employeeEnv";

export { employeeFromEnv, readCompactKeep, type EmployeeEnv } from "@/agent/utils/employeeEnv";

export const FLUSH_MESSAGE = "上下文快满了。用 employee_log 工具把当前目标、已做决策、待办和遗留问题记进运行日志，不要做别的事。";

export type CompactPilotHooks = {
    /** Queue a message into the session, behind whatever is already queued. */
    pushMessage: (text: string) => void;
    /** The employee's current state package, from the hub. */
    fetchStatePackage: () => Promise<string | null>;
    /** Tell the hub about a compaction, so it counts it and saves the summary into the run log. */
    reportCompaction: (input: { phase: "pre" | "post"; trigger: string; summary?: string }) => Promise<void>;
};

export class CompactPilot {
    private usedTokens = 0;
    private contextWindow = 200_000;
    /** The flush message is queued; the next turn end sends /compact. */
    private pendingCompact = false;
    /** A compaction is underway (ours or Claude's own); no new trigger until PostCompact. */
    private compacting = false;
    private statePackage: string | null = null;

    constructor(
        private readonly employee: EmployeeEnv,
        private readonly hooks: CompactPilotHooks
    ) {}

    start(): void {
        void this.refreshStatePackage();
    }

    private async refreshStatePackage(): Promise<void> {
        try {
            this.statePackage = await this.hooks.fetchStatePackage();
        } catch (error) {
            logger.debug("[compactPilot] state package fetch failed", error);
        }
    }

    /** SessionStart(compact) answers with the state package, so the squeezed session knows where it stood. */
    sessionStartContext(source: string | undefined): string | null {
        return source === "compact" ? this.statePackage : null;
    }

    /** Usage of the latest main-chain assistant message; sidechains (subagents) must not be fed here. */
    noteAssistantUsage(usage: unknown): void {
        if (!usage || typeof usage !== "object") return;
        const u = usage as Record<string, unknown>;
        const part = (key: string) => (typeof u[key] === "number" ? (u[key] as number) : 0);
        const used = part("input_tokens") + part("cache_read_input_tokens") + part("cache_creation_input_tokens");
        if (used > 0) this.usedTokens = used;
    }

    noteContextWindow(window: unknown): void {
        if (typeof window === "number" && window > 0) this.contextWindow = window;
    }

    /** A turn's result landed: the session is idle, the one safe moment to flush and compact. */
    noteTurnEnd(): void {
        if (this.compacting) return;
        if (this.pendingCompact) {
            // The flush ran (queue order guarantees it went first); now the compaction itself.
            this.pendingCompact = false;
            this.compacting = true;
            this.hooks.pushMessage(`/compact 压缩后的摘要必须完整保留：${readCompactKeep(this.employee.dir)}`);
            return;
        }
        if (this.usedTokens / this.contextWindow >= this.employee.compactThreshold) {
            logger.debug(`[compactPilot] threshold hit: ${this.usedTokens}/${this.contextWindow}`);
            this.pendingCompact = true;
            this.hooks.pushMessage(FLUSH_MESSAGE);
        }
    }

    notePreCompact(trigger: "manual" | "auto"): void {
        // Claude compacting on its own mid-turn is the fallback path: no flush ran, the hub still hears about it.
        if (trigger === "auto") this.compacting = true;
        void this.refreshStatePackage();
        void this.hooks.reportCompaction({ phase: "pre", trigger }).catch((error) => {
            logger.debug("[compactPilot] pre report failed", error);
        });
    }

    notePostCompact(trigger: "manual" | "auto", summary: string): void {
        this.compacting = false;
        this.pendingCompact = false;
        // The next assistant message brings the real post-compaction usage; until then, no retrigger.
        this.usedTokens = 0;
        void this.hooks.reportCompaction({ phase: "post", trigger, summary }).catch((error) => {
            logger.debug("[compactPilot] post report failed", error);
        });
    }
}
