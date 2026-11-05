import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { trimIdent } from '@/utils/trimIdent'
import { logger } from '@/ui/logger'

const WORKSPACE_INSTRUCTIONS_FILE = 'HAQI-Agent.md'
const GLOBAL_MEMORY_FILE = 'MEMORY.md'
const GLOBAL_SETTINGS_FILE = 'settings.json'
const DEFAULT_MEMORY_INJECTION_ENABLED = false
const DEFAULT_PURE_CONTEXT_MODE = false
const DEFAULT_CODEX_REPORT_PROMPT_ENABLED = false
const MAX_FILE_BYTES = 64 * 1024
const DEFAULT_MEMORY_TEMPLATE = trimIdent(`
    # MEMORY.md

    Global user style memory shared by all sessions.
    Keep only durable, reusable preferences.
    Do not store session logs, temporary tasks, or verbose execution history.

    ## Communication Style
    - Preferred language, tone, response length, and formatting.

    ## Engineering Workflow
    - Tooling, coding, and review preferences that repeat across projects.

    ## Stable Constraints
    - Long-lived constraints, non-negotiables, and durable assumptions.

    ## Do Not Store
    - Session-specific steps, temporary TODOs, one-off debug notes, raw logs.
`)

function findInstructionFile(startDir: string): string | null {
    let current = startDir

    while (true) {
        const candidate = join(current, WORKSPACE_INSTRUCTIONS_FILE)
        if (existsSync(candidate)) {
            return candidate
        }
        const parent = dirname(current)
        if (parent === current) {
            return null
        }
        current = parent
    }
}

function resolveHapiHomeDir(): string {
    const raw = process.env.HAPI_HOME?.trim()
    if (raw && raw.length > 0) {
        return raw.replace(/^~(?=\/|$)/, homedir())
    }
    return join(homedir(), '.hapi')
}

function resolveGlobalMemoryPath(): string {
    return join(resolveHapiHomeDir(), GLOBAL_MEMORY_FILE)
}

function resolveGlobalSettingsPath(): string {
    return join(resolveHapiHomeDir(), GLOBAL_SETTINGS_FILE)
}

type GlobalPromptSettings = {
    memoryInjectionEnabled: boolean
    pureContextMode: boolean
    codexReportPromptEnabled: boolean
}

function readGlobalPromptSettings(): GlobalPromptSettings {
    try {
        const filepath = resolveGlobalSettingsPath()
        if (!existsSync(filepath)) {
            return {
                memoryInjectionEnabled: DEFAULT_MEMORY_INJECTION_ENABLED,
                pureContextMode: DEFAULT_PURE_CONTEXT_MODE,
                codexReportPromptEnabled: DEFAULT_CODEX_REPORT_PROMPT_ENABLED
            }
        }
        const raw = readFileSync(filepath, 'utf-8').trim()
        if (!raw) {
            return {
                memoryInjectionEnabled: DEFAULT_MEMORY_INJECTION_ENABLED,
                pureContextMode: DEFAULT_PURE_CONTEXT_MODE,
                codexReportPromptEnabled: DEFAULT_CODEX_REPORT_PROMPT_ENABLED
            }
        }
        const parsed = JSON.parse(raw) as {
            memoryInjectionEnabled?: unknown
            pureContextMode?: unknown
            codexReportPromptEnabled?: unknown
        }
        const memoryInjectionEnabled = typeof parsed.memoryInjectionEnabled === 'boolean'
            ? parsed.memoryInjectionEnabled
            : DEFAULT_MEMORY_INJECTION_ENABLED
        const pureContextMode = typeof parsed.pureContextMode === 'boolean'
            ? parsed.pureContextMode
            : DEFAULT_PURE_CONTEXT_MODE
        const codexReportPromptEnabled = typeof parsed.codexReportPromptEnabled === 'boolean'
            ? parsed.codexReportPromptEnabled
            : DEFAULT_CODEX_REPORT_PROMPT_ENABLED
        return {
            memoryInjectionEnabled,
            pureContextMode,
            codexReportPromptEnabled
        }
    } catch (error) {
        logger.debug('[haqi-agent-instructions] failed to load global settings', error)
        return {
            memoryInjectionEnabled: DEFAULT_MEMORY_INJECTION_ENABLED,
            pureContextMode: DEFAULT_PURE_CONTEXT_MODE,
            codexReportPromptEnabled: DEFAULT_CODEX_REPORT_PROMPT_ENABLED
        }
    }
}

export function isPureContextModeEnabled(): boolean {
    return readGlobalPromptSettings().pureContextMode
}

export function isCodexReportPromptEnabledInSettings(): boolean {
    return readGlobalPromptSettings().codexReportPromptEnabled
}

function ensureGlobalMemoryFile(filepath: string): void {
    if (existsSync(filepath)) {
        return
    }

    mkdirSync(dirname(filepath), { recursive: true })
    writeFileSync(filepath, `${DEFAULT_MEMORY_TEMPLATE}\n`, { encoding: 'utf-8', flag: 'wx' })
}

function trimToMaxBytes(content: string, maxBytes: number, filename: string): string {
    const bytes = Buffer.byteLength(content, 'utf8')
    if (bytes <= maxBytes) {
        return content
    }

    const truncated = Buffer.from(content, 'utf8')
        .subarray(0, maxBytes)
        .toString('utf8')

    return `${truncated}\n\n[truncated: ${filename} exceeded ${maxBytes} bytes]`
}

export function loadHaqiAgentInstructions(startDir: string): string | null {
    try {
        const filepath = findInstructionFile(startDir)
        if (!filepath) {
            return null
        }
        const raw = readFileSync(filepath, 'utf-8').trim()
        if (!raw) {
            return null
        }
        return trimToMaxBytes(raw, MAX_FILE_BYTES, WORKSPACE_INSTRUCTIONS_FILE)
    } catch (error) {
        logger.debug('[haqi-agent-instructions] failed to load instructions', error)
        return null
    }
}

export function loadGlobalMemory(): { path: string; content: string } | null {
    try {
        const filepath = resolveGlobalMemoryPath()
        ensureGlobalMemoryFile(filepath)
        const raw = readFileSync(filepath, 'utf-8').trim()
        if (!raw) {
            return null
        }
        return {
            path: filepath,
            content: trimToMaxBytes(raw, MAX_FILE_BYTES, GLOBAL_MEMORY_FILE)
        }
    } catch (error) {
        logger.debug('[haqi-agent-instructions] failed to load global memory', error)
        return null
    }
}

const EMPLOYEE_FILE_MAX_CHARS = 20_000
const EMPLOYEE_TOTAL_MAX_CHARS = 60_000
const EMPLOYEE_IDENTITY_FILES: Array<{ file: string; tag: string }> = [
    { file: 'SOUL.md', tag: 'employee-soul' },
    { file: 'AGENTS.md', tag: 'employee-agents' },
    { file: 'MEMORY.md', tag: 'employee-memory' }
]

/**
 * The identity of the digital employee this session acts as, from the HAPI_EMPLOYEE_* env the runner sets at spawn.
 * SOUL, AGENTS and MEMORY go into the system prompt in that order, so they survive compaction; each file is capped
 * at 20k characters, the three together at 60k.
 */
export function loadEmployeeIdentityBlock(): string | null {
    const dir = process.env.HAPI_EMPLOYEE_DIR?.trim()
    if (!dir) {
        return null
    }
    const name = process.env.HAPI_EMPLOYEE_NAME?.trim() || 'employee'
    const id = process.env.HAPI_EMPLOYEE_ID?.trim() || ''
    const blocks: string[] = []
    let total = 0
    for (const { file, tag } of EMPLOYEE_IDENTITY_FILES) {
        try {
            const filepath = join(dir, file)
            if (!existsSync(filepath)) continue
            let content = readFileSync(filepath, 'utf-8').trim()
            if (!content) continue
            const budget = Math.min(EMPLOYEE_FILE_MAX_CHARS, EMPLOYEE_TOTAL_MAX_CHARS - total)
            if (budget <= 0) {
                logger.debug(`[haqi-agent-instructions] employee identity over ${EMPLOYEE_TOTAL_MAX_CHARS} chars, dropped ${file}`)
                break
            }
            if (content.length > budget) {
                logger.debug(`[haqi-agent-instructions] employee identity file ${file} truncated to ${budget} chars`)
                content = `${content.slice(0, budget)}\n\n[truncated: ${file} exceeded the identity budget]`
            }
            total += content.length
            blocks.push(`<${tag} path="${filepath}">\n${content}\n</${tag}>`)
        } catch (error) {
            logger.debug(`[haqi-agent-instructions] failed to load employee file ${file}`, error)
        }
    }
    const preface = trimIdent(`
        You are the digital employee "${name}"${id ? ` (id ${id})` : ''}. Your home folder is ${dir}.
        Act by SOUL.md (persona and boundaries) and AGENTS.md (duties and standards); MEMORY.md is your long-term memory.
        Record what you do with the mcp__haqi__employee_log tool (goal / done / decision / todo / issue_open / issue_close / note).
        Call mcp__haqi__employee_whoami when you need your own identity or current state.
        mcp__haqi__employee_sessions lists your other sessions; mcp__haqi__employee_send messages one of them.
        HAQI writes MEMORY.md from the memory database: do not edit it yourself; propose a lasting lesson with mcp__haqi__memory_propose. Change SOUL.md or AGENTS.md only when the user asks.
    `)
    return [preface, employeeRoleLine(process.env.HAPI_EMPLOYEE_ROLE?.trim()), ...blocks].filter(Boolean).join('\n\n')
}

/** What this session is among the employee's sessions; the runner sets HAPI_EMPLOYEE_ROLE at spawn. */
function employeeRoleLine(role: string | undefined): string | null {
    switch (role) {
        case 'main':
            return trimIdent(`
                You are the main session: you take the user's requests and keep the overview.
                For an independent job that can run in parallel, start a clone with mcp__haqi__employee_spawn (at most 5 at once); the clone reports back to you.
                For a large code change, use mcp__haqi__task_escalate.
            `)
        case 'clone':
            return trimIdent(`
                You are a clone: a side session that does the one job in your first message, not the main session.
                When the job is done, log it as done and report the result with mcp__haqi__employee_send to the session that sent you (the user, when none did, reads the log).
                You cannot start clones. If the job is too large, use mcp__haqi__task_escalate.
            `)
        case 'worker':
            return 'You work on a HAQI task for this employee. The task instructions in your first message come first; your identity sets the tone and the standards.'
        default:
            return null
    }
}

export function buildPromptWithHaqiAgentInstructions(basePrompt: string, startDir: string): string {
    const promptSettings = readGlobalPromptSettings()
    const employeeIdentity = loadEmployeeIdentityBlock()
    if (promptSettings.pureContextMode) {
        // Pure context mode strips the workspace extras, but an employee session still needs to know who it is.
        return employeeIdentity ? `${basePrompt}\n\n${employeeIdentity}` : basePrompt
    }

    const instructions = loadHaqiAgentInstructions(startDir)
    const globalMemory = promptSettings.memoryInjectionEnabled ? loadGlobalMemory() : null
    if (!instructions && !globalMemory && !employeeIdentity) {
        return basePrompt
    }

    const blocks: string[] = [basePrompt]

    if (employeeIdentity) {
        blocks.push(employeeIdentity)
    }

    if (instructions) {
        const instructionsPreface = trimIdent(`
        Follow workspace operating rules in HAQI-Agent.md for group collaboration and memory usage.
        Treat them as runtime policy for this repository.
    `)
        blocks.push(`${instructionsPreface}\n\n<haqi-agent-instructions>\n${instructions}\n</haqi-agent-instructions>`)
    }

    if (globalMemory) {
        const memoryPreface = trimIdent(`
        Load long-term user memory from ${globalMemory.path}.
        Treat MEMORY.md as global personal style and durable constraints shared across sessions.
        Only write stable, reusable preferences that still matter in future sessions.
        Never write session-specific details (task timelines, temporary TODOs, verbose debugging history).
        Keep entries short, high-signal, and remove outdated details instead of appending logs.
    `)
        blocks.push(`${memoryPreface}\n\n<haqi-memory path="${globalMemory.path}">\n${globalMemory.content}\n</haqi-memory>`)
    }

    return blocks.join('\n\n')
}
