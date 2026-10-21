import { describe, expect, it } from 'bun:test'
import { isReadOnlyCommand, isReadOnlyRequest } from './readonly'

describe('read-only requests', () => {
    it('grants reading tools and commands that only list, print or search', () => {
        expect(isReadOnlyRequest('Read', { file_path: '/x' })).toBe(true)
        for (const command of [
            'ls -a /repo',
            'cd /repo && git log --oneline -5 && git status',
            'for d in /a /b; do echo "== $d"; ls -a $d; done; grep -rliE "todo" /a /b 2>/dev/null | head -50',
            'cat AGENTS.md CLAUDE.md 2>/dev/null',
            'find . -name "*.ts" | wc -l',
            'git -C /repo diff main...HEAD --stat',
            'sed -n 1,40p src/a.ts',
            'for d in /u/dev/tg-sandbox /u/dev/radar; do echo "== $d"; ls -a $d; done; echo; grep -rliE "todo|待办" --exclude-dir=node_modules --exclude-dir=.git /u/dev/tg-sandbox 2>/dev/null | head -50',
            "grep -n 'a > b' notes.md",
            "sed -n '10,20p' src/a.ts",
            'git branch -a',
            "git branch --list 'feat*'",
            'git tag -l',
            'git remote -v',
            'git worktree list',
            'git config --get user.name',
            'sort a.txt | uniq -c'
        ]) expect([command, isReadOnlyCommand(command)]).toEqual([command, true])
    })

    it('leaves anything that could change something to the user', () => {
        for (const command of [
            'git push origin main',
            'git commit -am x',
            'git worktree add ../x -b y',
            'rm -rf build',
            'echo hi > notes.md',
            'cat a >> b',
            'sed -i s/a/b/ f',
            'find . -name "*.log" -delete',
            'npm install',
            'curl -X POST https://example.com',
            'ls $(rm -rf /tmp/x)',
            'grep x f | tee out',
            'echo "$(rm -rf /tmp/x)"',
            // Reading programs that can still write or run something.
            'env rm -rf build',
            "awk 'BEGIN{system(\"rm -rf build\")}'",
            "sed -n 'w out.txt' a.txt",
            "sed '1e rm -rf build' a.txt",
            'find . -fprint out.txt',
            'fd -e ts -x rm',
            'rg --pre ./run.sh x',
            'sort -o a.txt b.txt',
            'uniq a.txt b.txt',
            'git config user.name x',
            'git tag v1',
            'git branch newbranch',
            'git remote add x y',
            'git -C /repo branch -D old'
        ]) expect([command, isReadOnlyCommand(command)]).toEqual([command, false])
        expect(isReadOnlyRequest('Write', { file_path: '/x' })).toBe(false)
        expect(isReadOnlyRequest('Edit', {})).toBe(false)
    })
})
