import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Claude stores sessions under the real path; a symlinked cwd must map to the same folder or resume breaks. */
function realWorkingDirectory(workingDirectory: string): string {
    try {
        return realpathSync(resolve(workingDirectory));
    } catch {
        return resolve(workingDirectory);
    }
}

export function getProjectPath(workingDirectory: string, configDir?: string) {
    const projectId = realWorkingDirectory(workingDirectory).replace(/[^a-zA-Z0-9]/g, '-');
    const claudeConfigDir = configDir || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
    return join(claudeConfigDir, 'projects', projectId);
}