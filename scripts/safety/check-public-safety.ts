// Public-safety check: this repo is public, so nothing private may land in it.
//
// Blocks secrets, private hosts, personal paths, internal network addresses,
// and files that should never be committed (screenshots, recordings, logs,
// agent state, test output). Runs gitleaks too when it is installed.
//
//   bun scripts/safety/check-public-safety.ts --staged         # pre-commit hook
//   bun scripts/safety/check-public-safety.ts --range A..B     # pre-push hook, CI
//   bun scripts/safety/check-public-safety.ts --tree           # every tracked file (CI)
//   bun scripts/safety/check-public-safety.ts --self-test      # the rules still fire
//
// A line that must stay can end with the comment `public-safety: allow`.
//
// Private names (own domains, notes vault, ...) are not listed here, because
// this file is public too. They come from PUBLIC_SAFETY_PRIVATE_TERMS (comma
// separated; a GitHub Actions secret in CI) and from the untracked file
// .public-safety.local (one term per line).

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { userInfo } from 'node:os'
import { join } from 'node:path'

type Finding = { where: string; rule: string; text: string }

// ───────────────────────────── rules ─────────────────────────────

/** Private names that must not appear: domains, vault names, ... (never committed). */
function loadPrivateTerms(): string[] {
    const terms = (process.env.PUBLIC_SAFETY_PRIVATE_TERMS ?? '').split(',')
    const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()
    const file = root && join(root, '.public-safety.local')
    if (file && existsSync(file)) terms.push(...readFileSync(file, 'utf8').split('\n'))
    return terms.map((t) => t.trim()).filter((t) => t && !t.startsWith('#'))
}

/** Home-directory names that are placeholders or upstream test fixtures. */
const ALLOWED_HOME_NAMES = new Set(['me', 'user', 'username', 'YOUR_USERNAME', 'runner', 'john', 'steve', 'kirilldubovitskiy'])

/** Email domains that are fine to publish. */
const ALLOWED_EMAIL = [
    /@example\.(com|org|net)$/i,
    /@hapi\.run$/i,
    /^noreply@/i,
    /^git@github\.com$/i,
    /@users\.noreply\.github\.com$/i,
]

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// `secret` rules are checked in every commit (history can't be taken back);
// `privacy` rules are checked on what the tree ends up containing.
type Kind = 'secret' | 'privacy'

type ContentRule = { rule: string; kind: Kind; re: RegExp; allow?: (m: string) => boolean }

function privateTermRule(terms: string[]): ContentRule[] {
    if (terms.length === 0) return []
    return [{ rule: 'private name', kind: 'privacy', re: new RegExp(`[a-z0-9.-]*(${terms.map(escape).join('|')})`, 'gi') }]
}

const GENERIC_RULES: ContentRule[] = [
    {
        rule: 'personal home path',
        kind: 'privacy',
        re: /\/(Users|home)\/([A-Za-z0-9_.-]+)/g,
        allow: (m) => ALLOWED_HOME_NAMES.has(m.split('/')[2]) && m.split('/')[2] !== userInfo().username,
    },
    { rule: 'agent account dir', kind: 'privacy', re: /\.hapi-haqi\d*\/claude-accounts|\baccount-[0-9a-f]{8}\b/g },
    { rule: 'notes path', kind: 'privacy', re: /Mobile Documents\/iCloud~md~obsidian/g },
    { rule: 'tunnel credential', kind: 'secret', re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.cfargotunnel\.com|"TunnelSecret"\s*:/g },
    {
        rule: 'private network address',
        kind: 'privacy',
        re: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b(?!\/\d)/g,
    },
    {
        rule: 'email address',
        kind: 'privacy',
        re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g,
        // logo@2x.png is a file name, not an address.
        allow: (m) => ALLOWED_EMAIL.some((r) => r.test(m)) || /\.(png|jpe?g|svg|webp|gif|js|ts|css|json|md)$/i.test(m),
    },
    { rule: 'private key', kind: 'secret', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { rule: 'API key', kind: 'secret', re: /\b(sk-ant-[A-Za-z0-9_-]{20,}|sk-(proj-)?[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{30,}|(AKIA|ASIA)[0-9A-Z]{16}|xox[abp]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{35})\b/g },
    { rule: 'bot token', kind: 'secret', re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g },
    { rule: 'JWT', kind: 'secret', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
    { rule: 'webhook URL', kind: 'secret', re: /hooks\.slack\.com\/services\/\S+|open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/\S+|discord(app)?\.com\/api\/webhooks\/\S+/g },
    { rule: 'mobile number', kind: 'privacy', re: /(?<![\d.\-+:/])1[3-9]\d{9}(?![\d.])/g },
]

let CONTENT_RULES: ContentRule[] = [...GENERIC_RULES]

/** Files that never belong in the repo, by path. */
const PATH_RULES: { rule: string; re: RegExp }[] = [
    { rule: 'agent / browser state', re: /(^|\/)\.(playwright-mcp|omx|ace-tool)\// },
    { rule: 'test output', re: /(^|\/)(test-results|playwright-report|artifacts|coverage)\// },
    { rule: 'old build copy', re: /(^|\/)dist\.(prev|new|bak)[^/]*\// },
    { rule: 'screenshot or recording at repo root', re: /^[^/]+\.(png|jpe?g|webp|gif|mp4|webm|mov)$/i },
    { rule: 'recording', re: /\.(mp4|webm|mov)$/i },
    { rule: 'log / transcript', re: /\.(log|har)$|^(?!.*__fixtures__).*\.jsonl$/i },
    { rule: 'database', re: /\.(sqlite3?|db)(-wal|-shm)?$/i },
    { rule: 'key or certificate', re: /\.(pem|key|p12|pfx)$|(^|\/)id_(rsa|ed25519)(\.pub)?$/i },
    { rule: 'env file', re: /(^|\/)\.env(\.(?!example$)[^/]+)?$/ },
]

/** Content scanning skips generated and third-party files. */
const SKIP_CONTENT = [/(^|\/)bun\.lock$/, /(^|\/)package-lock\.json$/, /^docker\/workspace-desktop\/usr-share\//, /\.(png|jpe?g|webp|gif|ico|woff2?|ttf|otf|mp4|webm|zip|gz|wasm|exe)$/i]

const ALLOW_MARKER = 'public-safety: allow'

// ───────────────────────────── scanning ─────────────────────────────

function scanLine(where: string, line: string, out: Finding[], kinds: Kind[] = ['secret', 'privacy']): void {
    if (line.includes(ALLOW_MARKER)) return
    for (const { rule, kind, re, allow } of CONTENT_RULES) {
        if (!kinds.includes(kind)) continue
        re.lastIndex = 0
        for (const m of line.matchAll(re)) {
            if (allow?.(m[0])) continue
            out.push({ where, rule, text: m[0] })
        }
    }
}

function scanPath(path: string, out: Finding[]): void {
    for (const { rule, re } of PATH_RULES) {
        if (re.test(path)) out.push({ where: path, rule, text: path })
    }
}

const git = (args: string[]) => {
    const r = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 30 })
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
    return r.stdout
}

/** Added lines and added/renamed paths of a unified diff. */
function scanDiff(diff: string, out: Finding[], kinds: Kind[] = ['secret', 'privacy'], paths = true): void {
    let file = ''
    let lineNo = 0
    for (const line of diff.split('\n')) {
        if (line.startsWith('+++ ')) {
            file = line.startsWith('+++ b/') ? line.slice(6) : ''
            if (file && paths) scanPath(file, out)
            continue
        }
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line)
        if (hunk) {
            lineNo = Number(hunk[1])
            continue
        }
        if (!file || SKIP_CONTENT.some((r) => r.test(file))) continue
        if (line.startsWith('+')) {
            scanLine(`${file}:${lineNo}`, line.slice(1), out, kinds)
            lineNo++
        } else if (!line.startsWith('-')) {
            lineNo++
        }
    }
}

function scanTree(out: Finding[]): void {
    const files = git(['ls-files', '-z']).split('\0').filter(Boolean)
    for (const f of files) scanPath(f, out)
    const text = files.filter((f) => !SKIP_CONTENT.some((r) => r.test(f)))
    // git grep is fast and handles binary detection; scan its matches line by line.
    for (let i = 0; i < text.length; i += 2000) {
        const r = spawnSync('git', ['grep', '-I', '-n', '--no-color', '-E', '.', '--', ...text.slice(i, i + 2000)], {
            encoding: 'utf8',
            maxBuffer: 1 << 30,
        })
        for (const row of r.stdout.split('\n')) {
            const m = /^([^:]+):(\d+):(.*)$/.exec(row)
            if (m) scanLine(`${m[1]}:${m[2]}`, m[3], out)
        }
    }
}

function runGitleaks(mode: 'staged' | 'range', range?: string): boolean {
    const probe = spawnSync('gitleaks', ['version'], { encoding: 'utf8' })
    if (probe.status !== 0) {
        const msg = '[public-safety] gitleaks is not installed; only the built-in rules ran (brew install gitleaks).'
        if (process.env.CI) {
            console.error(msg)
            return false
        }
        console.warn(msg)
        return true
    }
    const args =
        mode === 'staged'
            ? ['git', '--pre-commit', '--staged', '--redact', '--no-banner']
            : ['git', `--log-opts=${range}`, '--redact', '--no-banner']
    const r = spawnSync('gitleaks', args, { stdio: 'inherit' })
    return r.status === 0
}

// ───────────────────────────── self-test ─────────────────────────────

function selfTest(): void {
    // Synthetic samples only: this file is public.
    CONTENT_RULES = [...privateTermRule(['corp-private.test']), ...GENERIC_RULES]
    const bad = [
        'see https://chat.corp-private.test/share/r/x', // public-safety: allow
        'cd /Users/alice-private/Documents', // public-safety: allow
        '~/.hapi-haqi3/claude-accounts/account-0123abcd', // public-safety: allow
        'Mobile Documents/iCloud~md~obsidian/Documents/Vault', // public-safety: allow
        '00000000-1111-2222-3333-444444444444.cfargotunnel.com', // public-safety: allow
        'ssh 192.168.3.14', // public-safety: allow
        'mail me: someone@gmail.com', // public-safety: allow
        'sk-ant-api03-abcdefghijklmnopqrstuvwx', // public-safety: allow gitleaks:allow
        '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1', // public-safety: allow gitleaks:allow
        'call 13812345678', // public-safety: allow
    ]
    const good = [
        'https://haqi.example.com/share/r/x',
        '/Users/me/projects/app',
        'ufw allow from 192.168.1.0/24',
        'test@example.com noreply@anthropic.com',
        'version 1.13.4567890',
        'see https://chat.corp-private.test // public-safety: allow',
    ]
    let ok = true
    for (const s of bad) {
        const out: Finding[] = []
        scanLine('bad', s, out)
        if (out.length === 0) {
            console.error(`[self-test] missed: ${s}`)
            ok = false
        }
    }
    for (const s of good) {
        const out: Finding[] = []
        scanLine('good', s, out)
        if (out.length) {
            console.error(`[self-test] false alarm (${out[0].rule}): ${s}`)
            ok = false
        }
    }
    const paths: [string, boolean][] = [
        ['.playwright-mcp/page.yml', true],
        ['haqi-final.png', true],
        ['test-results/x/error-context.md', true],
        ['web/dist.prev-163901/index.html', true],
        ['.env.local', true],
        ['web/public/icon.png', false],
        ['cli/src/claude/utils/__fixtures__/a.jsonl', false],
        ['.env.example', false],
    ]
    for (const [p, blocked] of paths) {
        const out: Finding[] = []
        scanPath(p, out)
        if ((out.length > 0) !== blocked) {
            console.error(`[self-test] path ${p}: expected ${blocked ? 'blocked' : 'allowed'}`)
            ok = false
        }
    }
    if (!ok) process.exit(1)
    console.log('[public-safety] self-test OK')
}

// ───────────────────────────── main ─────────────────────────────

function main(): void {
    const args = process.argv.slice(2)
    if (args.includes('--self-test')) return selfTest()

    const terms = loadPrivateTerms()
    CONTENT_RULES = [...privateTermRule(terms), ...GENERIC_RULES]
    if (terms.length === 0) {
        console.warn(
            '[public-safety] No private names configured (PUBLIC_SAFETY_PRIVATE_TERMS or .public-safety.local); ' +
                'only the generic rules ran.',
        )
    }

    const findings: Finding[] = []
    let gitleaksOk = true
    if (args.includes('--staged')) {
        scanDiff(git(['diff', '--cached', '--no-color', '-U0', '--diff-filter=ACMR']), findings)
        gitleaksOk = runGitleaks('staged')
    } else if (args.includes('--range')) {
        const range = args[args.indexOf('--range') + 1]
        if (!range) throw new Error('--range needs A..B')
        // Every commit: secrets and forbidden files. The end result: privacy.
        scanDiff(git(['log', '--no-color', '-p', '-U0', '--diff-filter=ACMR', '--format=', range]), findings, ['secret'])
        scanDiff(git(['diff', '--no-color', '-U0', '--diff-filter=ACMR', range]), findings, ['privacy'], false)
        gitleaksOk = runGitleaks('range', range)
    } else if (args.includes('--tree')) {
        scanTree(findings)
    } else {
        console.error('usage: check-public-safety.ts --staged | --range A..B | --tree | --self-test')
        process.exit(2)
    }

    const seen = new Set<string>()
    const unique = findings.filter((f) => {
        const k = `${f.where}|${f.rule}|${f.text}`
        return seen.has(k) ? false : (seen.add(k), true)
    })
    if (unique.length === 0 && gitleaksOk) {
        console.log('[public-safety] OK - nothing private found.')
        return
    }
    if (unique.length) {
        console.error('[public-safety] This repo is public. Remove these before committing or pushing:')
        for (const f of unique.slice(0, 50)) console.error(`  ${f.where}  [${f.rule}]  ${f.text.slice(0, 80)}`)
        if (unique.length > 50) console.error(`  … and ${unique.length - 50} more`)
        console.error(
            `\nUse placeholders (haqi.example.com, /Users/me, test@example.com). ` +
                `If a line really must stay, end it with the comment "${ALLOW_MARKER}".`,
        )
    }
    if (!gitleaksOk) console.error('[public-safety] gitleaks reported a secret (see above).')
    process.exit(1)
}

try {
    main()
} catch (error) {
    console.error('[public-safety] Failed:', error)
    process.exit(1)
}
