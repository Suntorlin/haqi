import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getProjectPath } from './path';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('node:os', () => ({
    homedir: vi.fn(() => '/home/user')
}));

// Store original env
const originalEnv = process.env;

describe('getProjectPath', () => {
    beforeEach(() => {
        // Reset process.env to a clean state
        process.env = { ...originalEnv };
        delete process.env.CLAUDE_CONFIG_DIR;
    });

    afterEach(() => {
        // Restore original env
        process.env = originalEnv;
    });
    it('should replace slashes with hyphens in the project path', () => {
        const workingDir = '/Users/steve/projects/my-app';
        const result = getProjectPath(workingDir);
        expect(result).toBe(join('/home/user', '.claude', 'projects', '-Users-steve-projects-my-app'));
    });

    it('should replace dots with hyphens in the project path', () => {
        const workingDir = '/Users/steve/projects/app.test.js';
        const result = getProjectPath(workingDir);
        expect(result).toBe(join('/home/user', '.claude', 'projects', '-Users-steve-projects-app-test-js'));
    });

    it('should handle paths with both slashes and dots', () => {
        const workingDir = '/var/www/my.site.com/public';
        const result = getProjectPath(workingDir);
        expect(result).toBe(join('/home/user', '.claude', 'projects', '-var-www-my-site-com-public'));
    });

    it('should replace underscores with hyphens in the project path', () => {
        const workingDir = '/data/github/hapi__worktrees/ime';
        const result = getProjectPath(workingDir);
        expect(result).toBe(join('/home/user', '.claude', 'projects', '-data-github-hapi--worktrees-ime'));
    });

    it('should handle relative paths by resolving them first', () => {
        const workingDir = './my-project';
        const result = getProjectPath(workingDir);
        expect(result).toContain(join('/home/user', '.claude', 'projects'));
        expect(result).toContain('my-project');
    });

    it('should handle empty directory path', () => {
        const workingDir = '';
        const result = getProjectPath(workingDir);
        expect(result).toContain(join('/home/user', '.claude', 'projects'));
    });

    describe('symlinked working directories', () => {
        // node:os is mocked above, so the temp root comes from the environment.
        const tempRoot = process.env.TMPDIR || '/tmp';
        let base: string;

        beforeEach(() => {
            base = mkdtempSync(join(tempRoot, 'hapi-path-'));
        });

        afterEach(() => {
            rmSync(base, { recursive: true, force: true });
        });

        it('maps a symlinked directory to the same project as its real path', () => {
            const real = join(base, 'real');
            const link = join(base, 'link');
            mkdirSync(real);
            symlinkSync(real, link);
            expect(getProjectPath(link)).toBe(getProjectPath(real));
            expect(getProjectPath(link)).toBe(getProjectPath(realpathSync(real)));
        });

        it('falls back to the plain resolved path when the directory does not exist', () => {
            const missing = join(base, 'not-there');
            const projectId = missing.replace(/[^a-zA-Z0-9]/g, '-');
            expect(getProjectPath(missing)).toBe(join('/home/user', '.claude', 'projects', projectId));
        });
    });

    describe('CLAUDE_CONFIG_DIR support', () => {
        it('should use default .claude directory when CLAUDE_CONFIG_DIR is not set', () => {
            const workingDir = '/Users/steve/projects/my-app';
            const result = getProjectPath(workingDir);
            expect(result).toBe(join('/home/user', '.claude', 'projects', '-Users-steve-projects-my-app'));
        });

        it('should use CLAUDE_CONFIG_DIR when set', () => {
            process.env.CLAUDE_CONFIG_DIR = '/custom/claude/config';
            const workingDir = '/Users/steve/projects/my-app';
            const result = getProjectPath(workingDir);
            expect(result).toBe(join('/custom/claude/config', 'projects', '-Users-steve-projects-my-app'));
        });

        it('should handle relative CLAUDE_CONFIG_DIR path', () => {
            process.env.CLAUDE_CONFIG_DIR = './config/claude';
            const workingDir = '/Users/steve/projects/my-app';
            const result = getProjectPath(workingDir);
            expect(result).toBe(join('./config/claude', 'projects', '-Users-steve-projects-my-app'));
        });

        it('should fallback to default when CLAUDE_CONFIG_DIR is empty string', () => {
            process.env.CLAUDE_CONFIG_DIR = '';
            const workingDir = '/Users/steve/projects/my-app';
            const result = getProjectPath(workingDir);
            expect(result).toBe(join('/home/user', '.claude', 'projects', '-Users-steve-projects-my-app'));
        });

        it('should handle CLAUDE_CONFIG_DIR with trailing slash', () => {
            process.env.CLAUDE_CONFIG_DIR = '/custom/claude/config/';
            const workingDir = '/Users/steve/projects/my-app';
            const result = getProjectPath(workingDir);
            expect(result).toBe(join('/custom/claude/config/', 'projects', '-Users-steve-projects-my-app'));
        });
    });
});