/**
 * Which approval requests the observer may grant on its own: reads only (Read, Glob, Grep, and shell commands that
 * only list, print or search). Anything that could change a file, the repository or the outside world stays the
 * user's call.
 */

const READ_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'WebFetch', 'WebSearch'])

/**
 * Programs that only read. Not here on purpose: env and xargs (run any command), awk (system()), tee.
 * Some read-only programs have options that write or run things; those are checked in UNSAFE_OPTIONS.
 */
const READ_PROGRAMS = new Set([
    'ls', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'egrep', 'fgrep', 'find', 'fd', 'tree', 'pwd', 'echo', 'printf', 'file', 'stat',
    'du', 'df', 'which', 'type', 'basename', 'dirname', 'realpath', 'sort', 'uniq', 'cut', 'tr', 'nl', 'jq', 'diff',
    'true', 'test', '[', 'date', 'printenv', 'sed'
])

/** Options that make a reading program write a file or run a command. */
const UNSAFE_OPTIONS: Record<string, RegExp> = {
    find: /\s-(delete|exec|execdir|ok|okdir|fprint|fprint0|fprintf|fls)\b/,
    fd: /\s(-x|-X|--exec|--exec-batch)\b/,
    rg: /\s--pre\b/,
    sort: /\s(-o|--output)\b/,
    tree: /\s-o\b/,
    file: /\s-C\b/,
    date: /\s(-s|--set)\b/
}

/** sed only to print lines: "sed -n '10,20p' file". Its scripts can write (w) or run (e) anything. */
const SED_PRINT = /^sed\s+-n\s+(['"]?)(\d+|\$)(,(\d+|\$))?p\1(\s+[^\s'"]+)*$/

/** git subcommands that only read, whatever their arguments. */
const READ_GIT = new Set(['log', 'show', 'diff', 'status', 'rev-parse', 'ls-files', 'blame', 'grep', 'describe', 'shortlog'])
/** git subcommands that read only with these options (with none, branch/tag/remote list; config needs one). */
const LISTING_GIT: Record<string, Set<string>> = {
    branch: new Set(['-a', '-r', '-v', '-vv', '-l', '--list', '--all', '--remotes', '--show-current', '--contains', '--merged', '--no-merged']),
    tag: new Set(['-l', '--list', '-n', '--contains']),
    remote: new Set(['-v', '--verbose']),
    worktree: new Set(['list', '--porcelain']),
    config: new Set(['--get', '--get-all', '--get-regexp', '--list', '-l', '--show-origin'])
}

function isReadOnlyGit(words: string[]): boolean {
    const at = words.findIndex((word) => !word.startsWith('-'))
    if (at < 0) return false
    const sub = words[at]!
    const rest = words.slice(at + 1)
    if (READ_GIT.has(sub)) return true
    const allowed = LISTING_GIT[sub]
    if (!allowed) return false
    if (sub === 'config') return allowed.has(rest[0] ?? '')
    if (rest.length === 0 || rest.every((word) => allowed.has(word))) return true
    // "git branch --list 'feat*'": a pattern after a listing option.
    return (sub === 'branch' || sub === 'tag') && rest.some((word) => word === '--list' || word === '-l' || word === '--contains')
}

/** Shell keywords of loops and conditions; their bodies are checked as commands. */
const KEYWORDS = new Set(['for', 'in', 'do', 'done', 'if', 'then', 'else', 'elif', 'fi', 'while', 'until'])

export function isReadOnlyRequest(tool: string, args: unknown): boolean {
    if (READ_TOOLS.has(tool)) return true
    if (tool !== 'Bash') return false
    const command = (args as { command?: unknown } | null)?.command
    return typeof command === 'string' && isReadOnlyCommand(command)
}

export function isReadOnlyCommand(raw: string): boolean {
    // Quoted text is data (a grep pattern may hold "|" or ">"): blank it out first. "$(" inside double quotes still runs.
    if (/"[^"]*(\$\(|`)[^"]*"/.test(raw)) return false
    const command = raw.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, '""')
    // Writing to a file, substitution that could run anything, or background jobs: not a plain read.
    if (/(^|[^>&0-9])>(?!&)|>>|\$\(|`|<\(|&\s*$|\btee\b/.test(command.replace(/2>\/dev\/null|2>&1|>\/dev\/null/g, ''))) return false
    // sed scripts sit in quotes, which are blanked below: check each sed call on the raw text.
    const seds = raw.split(/&&|\|\||;|\||\n/).map((part) => part.trim()).filter((part) => /^sed\b/.test(part))
    if (seds.some((part) => !SED_PRINT.test(part))) return false
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
        if (program === 'git') return isReadOnlyGit(words.slice(index + 1).filter((word) => word !== '-C' && !word.startsWith('/')))
        if (program === 'uniq' && words.slice(index + 1).filter((word) => !word.startsWith('-')).length > 1) return false
        if (UNSAFE_OPTIONS[program]?.test(` ${words.slice(index + 1).join(' ')}`)) return false
        return READ_PROGRAMS.has(program)
    })
}
