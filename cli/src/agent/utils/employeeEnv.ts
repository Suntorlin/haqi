/**
 * The digital-employee identity of this process, from the HAPI_EMPLOYEE_* env the runner sets at spawn,
 * and the "压缩时保留" requirements read from the employee's AGENTS.md. Shared by the Claude compaction
 * pilot and the Codex thread config.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export type EmployeeEnv = {
    id: string;
    name: string;
    dir: string;
    compactThreshold: number;
};

export function employeeFromEnv(env: NodeJS.ProcessEnv = process.env): EmployeeEnv | null {
    const id = env.HAPI_EMPLOYEE_ID?.trim();
    if (!id) return null;
    const threshold = Number(env.HAPI_EMPLOYEE_COMPACT_THRESHOLD);
    return {
        id,
        name: env.HAPI_EMPLOYEE_NAME?.trim() || "employee",
        dir: env.HAPI_EMPLOYEE_DIR?.trim() || "",
        compactThreshold: Number.isFinite(threshold) && threshold > 0 && threshold < 1 ? threshold : 0.75
    };
}

const DEFAULT_KEEP = "当前目标、未完成事项、涉及的文件路径、已做的决策";

/**
 * The "压缩时保留" section of the employee's AGENTS.md, flattened to one line.
 * Claude does not obey an injected AGENTS.md during compaction (verified §15.4), so the requirements
 * ride the `/compact <要求>` command (Claude) or the compact_prompt config (Codex).
 */
export function readCompactKeep(dir: string): string {
    if (!dir) return DEFAULT_KEEP;
    try {
        const content = readFileSync(join(dir, "AGENTS.md"), "utf8");
        const match = /(?:^|\n)#{1,6}[^\n]*压缩时保留[^\n]*\n([\s\S]*?)(?=\n#{1,6}\s|$)/.exec(content);
        const body = match?.[1]?.trim();
        if (body) {
            const items = body
                .split("\n")
                .map((line) => line.replace(/^[-*]\s*/, "").trim())
                .filter(Boolean);
            if (items.length > 0) return items.join("；");
        }
    } catch {
        // No AGENTS.md on disk: the defaults still protect the essentials.
    }
    return DEFAULT_KEEP;
}
