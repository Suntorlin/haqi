/**
 * Which approval requests the observer may grant on its own: reads only (Read, Glob, Grep, and shell commands that
 * only list, print or search). Anything that could change a file, the repository or the outside world stays the
 * user's call.
 */

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch'])

/** Programs that only read. */
const READ_PROGRAMS = new Set([
    'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'egrep', 'fgrep', 'find', 'fd', 'tree', 'pwd', 'echo', 'printf', 'file', 'stat',
    'du', 'df', 'which', 'type', 'basename', 'dirname', 'realpath', 'sort', 'uniq', 'cut', 'tr', 'nl', 'less', 'more', 'jq', 'diff',
    'true', 'test', '[', 'date', 'env', 'printenv', 'awk', 'sed'
])

/** git subcommands that only read. */
const READ_GIT = new Set(['log', 'show', 'diff', 'status', 'branch', 'rev-parse', 'ls-files', 'blame', 'grep', 'remote', 'describe', 'shortlog', 'worktree', 'config', 'tag'])

/** Shell keywords of loops and conditions; their bodies are checked as commands. */
const KEYWORDS = new Set(['for', 'in', 'do', 'done', 'if', 'then', 'else', 'elif', 'fi', 'while', 'until'])

export function isReadOnlyRequest(tool: string, args: unknown): boolean {
    if (READ_TOOLS.has(tool)) return true
    if (tool !== 'Bash') return false
    const command = (args as { command?: unknown } | null)?.command
    return typeof command === 'string' && isReadOnlyCommand(command)
}

export function isReadOnlyCommand(command: string): boolean {
    // Writing to a file, substitution that could run anything, or background jobs: not a plain read.
    if (/(^|[^>&0-9])>(?!&)|>>|\$\(|`|<\(|&\s*$|\btee\b/.test(command.replace(/2>\/dev\/null|2>&1|>\/dev\/null/g, ''))) return false
    const segments = command.split(/&&|\|\||;|\||\n/).map((part) => part.trim()).filter(Boolean)
    if (segments.length === 0) return false
    return segments.every((segment) => {
        const words = segment.split(/\s+/)
        let index = 0
        while (index < words.length && (KEYWORDS.has(words[index]!) || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]!))) {
            // "for d in a b c" lists values, not commands.
            if (words[index] === 'for') return true
            index += 1
        }
        const program = words[index]
        if (!program) return true
        if (program === 'cd') return true
        if (program === 'git') {
            const sub = words.slice(index + 1).find((word) => !word.startsWith('-') && !word.startsWith('/') && word !== 'C')
            if (!sub || !READ_GIT.has(sub)) return false
            // git worktree add / branch -D / config --set and the like change things.
            return !/\b(add|remove|prune|move|-d|-D|--delete|--set|--unset|--add|-m|-M)\b/.test(words.slice(index + 2).join(' '))
        }
        if (program === 'sed') return !/\s-i\b|\s--in-place\b/.test(segment)
        if (program === 'find') return !/\s-(delete|exec|execdir|ok)\b/.test(segment)
        return READ_PROGRAMS.has(program)
    })
}
