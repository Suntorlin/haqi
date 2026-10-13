import type { ToolViewComponent, ToolViewProps } from '@/components/ToolCard/views/_all'
import { isObject, safeStringify } from '@hapi/protocol'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CodeBlock } from '@/components/CodeBlock'
import { DiffView } from '@/components/DiffView'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { PathActionLink } from '@/components/assistant-ui/path-action-link'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { parseUnifiedDiff } from '@/lib/gitDiff'
import { ChecklistList, extractTodoChecklist } from '@/components/ToolCard/checklist'
import { basename, resolveDisplayPath } from '@/utils/path'
import { useTranslation } from '@/lib/use-translation'
import { Chip } from '@/components/ui/Chip'

const MAX_IMAGE_PREVIEW_BYTES = 8 * 1024 * 1024
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    ico: 'image/x-icon'
}

function parseToolUseError(message: string): { isToolUseError: boolean; errorMessage: string | null } {
    const regex = /<tool_use_error>(.*?)<\/tool_use_error>/s
    const match = message.match(regex)

    if (match) {
        return {
            isToolUseError: true,
            errorMessage: typeof match[1] === 'string' ? match[1].trim() : ''
        }
    }

    return { isToolUseError: false, errorMessage: null }
}

function extractTextFromContentBlock(block: unknown): string | null {
    if (typeof block === 'string') return block
    if (!isObject(block)) return null
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (typeof block.text === 'string') return block.text
    return null
}

function extractTextFromResult(result: unknown, depth: number = 0): string | null {
    if (depth > 2) return null
    if (result === null || result === undefined) return null
    if (typeof result === 'string') {
        const toolUseError = parseToolUseError(result)
        return toolUseError.isToolUseError ? (toolUseError.errorMessage ?? '') : result
    }

    if (Array.isArray(result)) {
        const parts = result
            .map(extractTextFromContentBlock)
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
        return parts.length > 0 ? parts.join('\n') : null
    }

    if (!isObject(result)) return null

    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text
    if (typeof result.output === 'string') return result.output
    if (typeof result.error === 'string') return result.error
    if (typeof result.message === 'string') return result.message

    const contentArray = Array.isArray(result.content) ? result.content : null
    if (contentArray) {
        const parts = contentArray
            .map(extractTextFromContentBlock)
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
        return parts.length > 0 ? parts.join('\n') : null
    }

    const nestedOutput = isObject(result.output) ? result.output : null
    if (nestedOutput) {
        if (typeof nestedOutput.content === 'string') return nestedOutput.content
        if (typeof nestedOutput.text === 'string') return nestedOutput.text
    }

    const nestedError = isObject(result.error) ? result.error : null
    if (nestedError) {
        if (typeof nestedError.message === 'string') return nestedError.message
        if (typeof nestedError.error === 'string') return nestedError.error
    }

    const nestedResult = isObject(result.result) ? result.result : null
    if (nestedResult) {
        const nestedText = extractTextFromResult(nestedResult, depth + 1)
        if (nestedText) return nestedText
    }

    const nestedData = isObject(result.data) ? result.data : null
    if (nestedData) {
        const nestedText = extractTextFromResult(nestedData, depth + 1)
        if (nestedText) return nestedText
    }

    return null
}

interface CodexBashOutput {
    exitCode: number | null
    wallTime: string | null
    output: string
}

function parseCodexBashOutput(text: string): CodexBashOutput | null {
    const exitMatch = text.match(/^Exit code:\s*(\d+)/m)
    const wallMatch = text.match(/^Wall time:\s*(.+)$/m)
    const outputMatch = text.match(/^Output:\n([\s\S]*)$/m)

    if (!exitMatch && !wallMatch && !outputMatch) return null

    return {
        exitCode: exitMatch ? parseInt(exitMatch[1], 10) : null,
        wallTime: wallMatch ? wallMatch[1].trim() : null,
        output: outputMatch ? outputMatch[1] : text
    }
}

function looksLikeHtml(text: string): boolean {
    const trimmed = text.trimStart()
    return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<div') || trimmed.startsWith('<span')
}

function looksLikeJson(text: string): boolean {
    const trimmed = text.trim()
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
}

function renderText(text: string, opts: { mode: 'markdown' | 'code' | 'auto'; language?: string } = { mode: 'auto' }) {
    if (opts.mode === 'code') {
        return <CodeBlock code={text} language={opts.language ?? 'text'} />
    }

    if (opts.mode === 'markdown') {
        return <MarkdownRenderer content={text} />
    }

    if (looksLikeHtml(text) || looksLikeJson(text)) {
        return <CodeBlock code={text} language={looksLikeJson(text) ? 'json' : 'html'} />
    }

    return <MarkdownRenderer content={text} />
}

type ResultNoteKind = 'done' | 'empty' | 'waiting' | 'running'

function placeholderForState(state: ToolViewProps['block']['tool']['state']): ResultNoteKind {
    if (state === 'pending') return 'waiting'
    if (state === 'running') return 'running'
    return 'empty'
}

function ResultNoteText(props: { kind: ResultNoteKind }) {
    const { t } = useTranslation()
    return <>{t(`tool.result.${props.kind}`)}</>
}

/** Muted one-liner shown instead of a result body (done / no output / waiting / running). */
function ResultNote(props: { kind: ResultNoteKind }) {
    const { t } = useTranslation()
    return <div className="text-[13px] text-[var(--social-fg-muted)]">{t(`tool.result.${props.kind}`)}</div>
}

function RawJsonDevOnly(props: { value: unknown }) {
    if (!import.meta.env.DEV) return null
    if (props.value === null || props.value === undefined) return null

    return (
        <details className="mt-3">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--social-fg-muted)]">
                Raw JSON
            </summary>
            <div className="mt-2">
                <CodeBlock code={safeStringify(props.value)} language="json" />
            </div>
        </details>
    )
}

function extractStdoutStderr(result: unknown): { stdout: string | null; stderr: string | null } | null {
    if (!isObject(result)) return null

    const stdout = typeof result.stdout === 'string' ? result.stdout : null
    const stderr = typeof result.stderr === 'string' ? result.stderr : null
    if (stdout !== null || stderr !== null) {
        return { stdout, stderr }
    }

    const nested = isObject(result.output) ? result.output : null
    if (nested) {
        const nestedStdout = typeof nested.stdout === 'string' ? nested.stdout : null
        const nestedStderr = typeof nested.stderr === 'string' ? nested.stderr : null
        if (nestedStdout !== null || nestedStderr !== null) {
            return { stdout: nestedStdout, stderr: nestedStderr }
        }
    }

    return null
}

function extractReadFileContent(result: unknown): { filePath: string | null; content: string } | null {
    if (!isObject(result)) return null
    const file = isObject(result.file) ? result.file : null
    if (!file) return null

    const content = typeof file.content === 'string' ? file.content : null
    if (content === null) return null

    const filePath = typeof file.filePath === 'string'
        ? file.filePath
        : typeof file.file_path === 'string'
            ? file.file_path
            : null

    return { filePath, content }
}

function extractLineList(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
}

function isProbablyMarkdownList(text: string): boolean {
    const trimmed = text.trimStart()
    return trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('1. ')
}

function extensionFromPath(path: string): string | null {
    const normalized = path.replace(/\\/g, '/')
    const fileName = normalized.split('/').pop() ?? ''
    const dotIndex = fileName.lastIndexOf('.')
    if (dotIndex <= 0 || dotIndex === fileName.length - 1) {
        return null
    }
    return fileName.slice(dotIndex + 1).toLowerCase()
}

function imageMimeFromPath(path: string): string | null {
    const extension = extensionFromPath(path)
    if (!extension) return null
    return IMAGE_MIME_BY_EXTENSION[extension] ?? null
}

function base64ToBytes(base64: string): Uint8Array {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
    }
    return bytes
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    return buffer
}

function extractStringByKeysDeep(value: unknown, keys: string[], depth: number = 0): string | null {
    if (depth > 2 || !isObject(value)) return null

    for (const key of keys) {
        const candidate = value[key]
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
            return candidate.trim()
        }
    }

    const nestedKeys = ['result', 'output', 'data', 'file']
    for (const key of nestedKeys) {
        const nested = extractStringByKeysDeep(value[key], keys, depth + 1)
        if (nested) return nested
    }

    return null
}

function normalizeDirectImageUrl(value: string | null): string | null {
    if (!value) return null
    const trimmed = value.trim()
    if (
        trimmed.startsWith('data:image/')
        || trimmed.startsWith('http://')
        || trimmed.startsWith('https://')
        || trimmed.startsWith('blob:')
    ) {
        return trimmed
    }
    return null
}

function revokeIfBlobUrl(url: string | null): void {
    if (!url) return
    if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url)
    }
}

const AskUserQuestionResultView: ToolViewComponent = (props: ToolViewProps) => {
    const answers = props.block.tool.permission?.answers ?? null

    // If answers exist, AskUserQuestionView already shows them with highlighting
    // Return null to avoid duplicate display
    if (answers && Object.keys(answers).length > 0) {
        return null
    }

    // Fallback for tools without structured answers
    return <MarkdownResultView {...props} />
}

const BashResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <ResultNote kind={placeholderForState(props.block.tool.state)} />
    }

    if (typeof result === 'string') {
        const toolUseError = parseToolUseError(result)
        const display = toolUseError.isToolUseError ? (toolUseError.errorMessage ?? '') : result
        return (
            <>
                <CodeBlock code={display} language="text" />
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    const stdio = extractStdoutStderr(result)
    if (stdio) {
        return (
            <>
                <div className="flex flex-col gap-2">
                    {stdio.stdout ? <CodeBlock code={stdio.stdout} language="text" /> : null}
                    {stdio.stderr ? <CodeBlock code={stdio.stderr} language="text" /> : null}
                </div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'code', language: 'text' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <ResultNote kind="empty" />
            <RawJsonDevOnly value={result} />
        </>
    )
}

const MarkdownResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <ResultNote kind={placeholderForState(props.block.tool.state)} />
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <ResultNote kind="empty" />
            <RawJsonDevOnly value={result} />
        </>
    )
}

const LineListResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <ResultNote kind={placeholderForState(props.block.tool.state)} />
    }

    const text = extractTextFromResult(result)
    if (!text) {
        return (
            <>
                <ResultNote kind="empty" />
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    if (isProbablyMarkdownList(text)) {
        return (
            <>
                <MarkdownRenderer content={text} />
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    const lines = extractLineList(text)
    if (lines.length === 0) {
        return (
            <>
                <ResultNote kind="empty" />
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <div className="flex flex-col gap-1">
                {lines.map((line) => (
                    <div key={line} className="text-[13px] font-mono text-[var(--social-fg)] break-all">
                        {line}
                    </div>
                ))}
            </div>
            <RawJsonDevOnly value={result} />
        </>
    )
}

const ReadResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <ResultNote kind={placeholderForState(props.block.tool.state)} />
    }

    const file = extractReadFileContent(result)
    if (file) {
        const path = file.filePath ? resolveDisplayPath(file.filePath, props.metadata) : null
        return (
            <>
                {path ? (
                    <div className="mb-2 text-xs text-[var(--social-fg-muted)] font-mono break-all">
                        {basename(path)}
                    </div>
                ) : null}
                <CodeBlock code={file.content} language="text" />
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'code', language: 'text' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <ResultNote kind="empty" />
            <RawJsonDevOnly value={result} />
        </>
    )
}

const MutationResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { state, result } = props.block.tool

    if (result === undefined || result === null) {
        if (state === 'completed') {
            return <ResultNote kind="done" />
        }
        return <ResultNote kind={placeholderForState(state)} />
    }

    const text = extractTextFromResult(result)
    if (typeof text === 'string' && text.trim().length > 0) {
        const className = state === 'error' ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg)]'
        return (
            <>
                <div className={`text-[13px] ${className}`}>
                    {renderText(text, { mode: state === 'error' ? 'code' : 'auto' })}
                </div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <div className="text-[13px] text-[var(--social-fg-muted)]">
                <ResultNoteText kind={state === 'completed' ? 'done' : 'empty'} />
            </div>
            <RawJsonDevOnly value={result} />
        </>
    )
}

const CodexPatchResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result
    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    if (result === undefined || result === null) {
        return props.block.tool.state === 'completed'
            ? <ResultNote kind="done" />
            : <ResultNote kind={placeholderForState(props.block.tool.state)} />
    }

    return (
        <>
            <ResultNote kind="empty" />
            <RawJsonDevOnly value={result} />
        </>
    )
}

const CodexReasoningResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <ResultNote kind={placeholderForState(props.block.tool.state)} />
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <ResultNote kind="empty" />
            <RawJsonDevOnly value={result} />
        </>
    )
}

const CodexDiffResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return props.block.tool.state === 'completed'
            ? <ResultNote kind="done" />
            : <ResultNote kind={placeholderForState(props.block.tool.state)} />
    }

    const text = extractTextFromResult(result)
    if (text) {
        const parsed = parseUnifiedDiff(text)
        return (
            <>
                <DiffView
                    oldString={parsed.oldText}
                    newString={parsed.newText}
                    filePath={parsed.fileName}
                    variant="inline"
                />
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <ResultNote kind="done" />
            <RawJsonDevOnly value={result} />
        </>
    )
}

type CollabAgentStateEntry = {
    agentId: string
    status: string | null
    message: string | null
}

function extractCollabAgentEntries(block: ToolViewProps['block']): {
    senderId: string | null
    prompt: string | null
    entries: CollabAgentStateEntry[]
} | null {
    const input = isObject(block.tool.input) ? block.tool.input : null
    const result = isObject(block.tool.result) ? block.tool.result : null
    const payload = result ?? input
    if (!payload) return null

    const senderId = typeof payload.sender_thread_id === 'string'
        ? payload.sender_thread_id
        : typeof input?.sender_thread_id === 'string'
            ? input.sender_thread_id
            : null
    const prompt = typeof payload.prompt === 'string'
        ? payload.prompt
        : typeof input?.prompt === 'string'
            ? input.prompt
            : null

    const receiverIds = Array.isArray(payload.receiver_thread_ids)
        ? payload.receiver_thread_ids.filter((value): value is string => typeof value === 'string')
        : Array.isArray(input?.receiver_thread_ids)
            ? input.receiver_thread_ids.filter((value): value is string => typeof value === 'string')
            : []

    const statesRecord = isObject(payload.agents_states)
        ? payload.agents_states
        : isObject(input?.agents_states)
            ? input.agents_states
            : null

    if (!senderId && receiverIds.length === 0 && !statesRecord) {
        return null
    }

    const agentIds = new Set<string>(receiverIds)
    if (statesRecord) {
        Object.keys(statesRecord).forEach((id) => agentIds.add(id))
    }

    const entries: CollabAgentStateEntry[] = Array.from(agentIds).map((agentId) => {
        const rawState = statesRecord && isObject(statesRecord[agentId]) ? statesRecord[agentId] : null
        const status = rawState && typeof rawState.status === 'string' ? rawState.status : null
        const message = rawState && typeof rawState.message === 'string' ? rawState.message : null
        return { agentId, status, message }
    })

    return { senderId, prompt, entries }
}

function collabStatusTone(status: string | null): string {
    if (!status) return 'text-[var(--social-fg-muted)]'
    const normalized = status.toLowerCase()
    if (normalized.includes('running') || normalized.includes('progress')) {
        return 'text-[var(--social-fg)]'
    }
    if (normalized.includes('complete') || normalized.includes('done')) {
        return 'text-[var(--app-badge-success-text)]'
    }
    if (normalized.includes('error') || normalized.includes('fail')) {
        return 'text-[var(--social-danger)]'
    }
    return 'text-[var(--social-fg-muted)]'
}

const CollabAgentResultView: ToolViewComponent = (props: ToolViewProps) => {
    const collab = useMemo(() => extractCollabAgentEntries(props.block), [props.block])
    const [selectedAgentId, setSelectedAgentId] = useState<string | null>(collab?.entries[0]?.agentId ?? null)

    useEffect(() => {
        setSelectedAgentId(collab?.entries[0]?.agentId ?? null)
    }, [collab])

    if (!collab || collab.entries.length === 0) {
        return <GenericResultView {...props} />
    }

    const selected = collab.entries.find((entry) => entry.agentId === selectedAgentId) ?? collab.entries[0]

    return (
        <div className="flex flex-col gap-2">
            {collab.senderId ? (
                <div className="text-xs text-[var(--social-fg-muted)]">
                    sender: <span className="font-mono break-all">{collab.senderId}</span>
                </div>
            ) : null}

            <div className="flex flex-wrap gap-1">
                {collab.entries.map((entry) => (
                    <Chip
                        key={entry.agentId}
                        selected={selected?.agentId === entry.agentId}
                        onClick={() => setSelectedAgentId(entry.agentId)}
                    >
                        {entry.agentId.slice(0, 8)}
                    </Chip>
                ))}
            </div>

            {selected ? (
                <div className="rounded-xl border border-[var(--social-border)] bg-[var(--social-hover)] p-2 text-xs">
                    <div className={`font-semibold ${collabStatusTone(selected.status)}`}>
                        {selected.status ?? 'unknown'}
                    </div>
                    {selected.message ? (
                        <div className="mt-1 break-words text-[var(--social-fg)]">
                            {selected.message}
                        </div>
                    ) : null}
                </div>
            ) : null}

            {collab.prompt ? (
                <div className="rounded-xl border border-[var(--social-border)] p-2 text-xs text-[var(--social-fg-muted)]">
                    <div className="mb-1 font-semibold uppercase tracking-wide">prompt</div>
                    <div className="break-words text-[var(--social-fg)]">{collab.prompt}</div>
                </div>
            ) : null}
        </div>
    )
}

type TodoItem = {
    id?: string
    content?: string
    status?: 'pending' | 'in_progress' | 'completed'
    priority?: 'high' | 'medium' | 'low'
}

function extractTodos(input: unknown, result: unknown): TodoItem[] {
    const todosFromInput = isObject(input) && Array.isArray(input.todos)
        ? input.todos.filter(isObject)
        : []
    if (todosFromInput.length > 0) {
        return todosFromInput.map((t) => ({
            id: typeof t.id === 'string' ? t.id : undefined,
            content: typeof t.content === 'string' ? t.content : undefined,
            status: t.status === 'pending' || t.status === 'in_progress' || t.status === 'completed' ? t.status : undefined,
            priority: t.priority === 'high' || t.priority === 'medium' || t.priority === 'low' ? t.priority : undefined
        }))
    }

    const newTodos = isObject(result) && Array.isArray(result.newTodos)
        ? result.newTodos.filter(isObject)
        : []
    return newTodos.map((t) => ({
        id: typeof t.id === 'string' ? t.id : undefined,
        content: typeof t.content === 'string' ? t.content : undefined,
        status: t.status === 'pending' || t.status === 'in_progress' || t.status === 'completed' ? t.status : undefined,
        priority: t.priority === 'high' || t.priority === 'medium' || t.priority === 'low' ? t.priority : undefined
    }))
}

function todoTone(todo: TodoItem): string {
    if (todo.status === 'completed') return 'text-[var(--app-badge-success-text)] line-through'
    if (todo.status === 'in_progress') return 'text-[var(--social-fg)]'
    return 'text-[var(--social-fg-muted)]'
}

function todoIcon(todo: TodoItem): string {
    if (todo.status === 'completed') return '☑'
    return '☐'
}

const TodoWriteResultView: ToolViewComponent = (props: ToolViewProps) => {
    const todos = extractTodoChecklist(props.block.tool.input, props.block.tool.result)
    if (todos.length === 0) {
        return <ResultNote kind={placeholderForState(props.block.tool.state)} />
    }

    return <ChecklistList items={todos} />
}

const ImageViewResultView: ToolViewComponent = (props: ToolViewProps) => {
    const ctx = useOptionalHappyChatContext()
    const api = ctx?.api
    const sessionId = ctx?.sessionId
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const previousSourceKeyRef = useRef<string>('none')
    const loadedSourceKeyRef = useRef<string>('none')

    const inputPath = useMemo(
        () => extractStringByKeysDeep(props.block.tool.input, ['path', 'file_path', 'filePath', 'file']),
        [props.block.tool.input]
    )
    const resultPath = useMemo(
        () => extractStringByKeysDeep(props.block.tool.result, ['path', 'file_path', 'filePath', 'file']),
        [props.block.tool.result]
    )
    const imagePath = resultPath ?? inputPath

    const inputUrl = useMemo(
        () => extractStringByKeysDeep(props.block.tool.input, ['url', 'src', 'image_url', 'imageUrl', 'data_url', 'dataUrl']),
        [props.block.tool.input]
    )
    const resultUrl = useMemo(
        () => extractStringByKeysDeep(props.block.tool.result, ['url', 'src', 'image_url', 'imageUrl', 'data_url', 'dataUrl']),
        [props.block.tool.result]
    )
    const directUrl = useMemo(
        () => normalizeDirectImageUrl(resultUrl ?? inputUrl ?? imagePath),
        [resultUrl, inputUrl, imagePath]
    )
    const localPath = useMemo(
        () => (imagePath && normalizeDirectImageUrl(imagePath) === null ? imagePath : null),
        [imagePath]
    )
    const imageMimeType = useMemo(
        () => (localPath ? imageMimeFromPath(localPath) : null),
        [localPath]
    )
    const sourceKey = directUrl
        ? `url:${directUrl}`
        : localPath
            ? `path:${localPath}`
            : 'none'

    useEffect(() => {
        let cancelled = false
        const sourceChanged = previousSourceKeyRef.current !== sourceKey
        previousSourceKeyRef.current = sourceKey

        if (sourceChanged) {
            loadedSourceKeyRef.current = 'none'
            setPreviewUrl((current) => {
                revokeIfBlobUrl(current)
                return null
            })
            setErrorMessage(null)
            setLoading(false)
        }

        if (directUrl) {
            loadedSourceKeyRef.current = sourceKey
            setPreviewUrl((current) => {
                if (current === directUrl) return current
                revokeIfBlobUrl(current)
                return directUrl
            })
            setErrorMessage(null)
            setLoading(false)
            return () => {
                cancelled = true
            }
        }

        if (sourceKey === 'none') {
            if (props.block.tool.state !== 'pending') {
                setErrorMessage('Image path missing.')
            }
            return () => {
                cancelled = true
            }
        }

        if (props.block.tool.state === 'pending') {
            return () => {
                cancelled = true
            }
        }

        if (!api || !sessionId) {
            setErrorMessage('Image preview requires active session context.')
            return () => {
                cancelled = true
            }
        }

        if (!localPath) {
            setErrorMessage('Image path missing.')
            return () => {
                cancelled = true
            }
        }

        if (!imageMimeType) {
            setErrorMessage('Unsupported image format.')
            return () => {
                cancelled = true
            }
        }

        if (loadedSourceKeyRef.current === sourceKey) {
            setLoading(false)
            return () => {
                cancelled = true
            }
        }

        setErrorMessage(null)
        setLoading(true)

        void (async () => {
            try {
                const result = await api.readSessionFile(sessionId, localPath, { maxBytes: MAX_IMAGE_PREVIEW_BYTES })
                if (cancelled) return
                if (!result.success || !result.content) {
                    setErrorMessage(result.error ?? 'Failed to preview image.')
                    return
                }
                if (result.truncated || (typeof result.size === 'number' && result.size > MAX_IMAGE_PREVIEW_BYTES)) {
                    setErrorMessage('Image preview is limited to 8 MB.')
                    return
                }

                const bytes = base64ToBytes(result.content)
                const objectUrl = URL.createObjectURL(new Blob([toArrayBuffer(bytes)], { type: imageMimeType }))
                if (cancelled) {
                    URL.revokeObjectURL(objectUrl)
                    return
                }
                loadedSourceKeyRef.current = sourceKey
                setPreviewUrl(objectUrl)
            } catch (error) {
                if (cancelled) return
                setErrorMessage(error instanceof Error ? error.message : 'Failed to preview image.')
            } finally {
                if (!cancelled) {
                    setLoading(false)
                }
            }
        })()

        return () => {
            cancelled = true
        }
    }, [api, directUrl, imageMimeType, localPath, props.block.tool.state, sessionId, sourceKey])

    useEffect(() => {
        return () => {
            revokeIfBlobUrl(previewUrl)
        }
    }, [previewUrl])

    const displayPath = localPath ? resolveDisplayPath(localPath, props.metadata) : null
    const altText = displayPath ? basename(displayPath) : 'Image preview'

    return (
        <div className="flex flex-col gap-2">
            {localPath ? (
                <div className="w-fit max-w-full">
                    <PathActionLink path={localPath} />
                </div>
            ) : null}

            {previewUrl ? (
                <div className="overflow-hidden rounded-md border border-[var(--social-border)] bg-[var(--social-hover)] p-1">
                    <img
                        src={previewUrl}
                        alt={altText}
                        className="mx-auto max-h-[420px] max-w-full rounded-md object-contain"
                    />
                </div>
            ) : loading ? (
                <div className="text-[13px] text-[var(--social-fg-muted)]">Loading image…</div>
            ) : errorMessage ? (
                <div className="text-[13px] text-[var(--social-danger)]">{errorMessage}</div>
            ) : (
                <ResultNote kind={placeholderForState(props.block.tool.state)} />
            )}
        </div>
    )
}

const GenericResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <ResultNote kind={placeholderForState(props.block.tool.state)} />
    }

    // Detect codex bash output format and render accordingly
    if (typeof result === 'string') {
        const parsed = parseCodexBashOutput(result)
        if (parsed) {
            return (
                <>
                    <div className="text-xs text-[var(--social-fg-muted)] mb-2">
                        {parsed.exitCode !== null && `Exit code: ${parsed.exitCode}`}
                        {parsed.exitCode !== null && parsed.wallTime && ' · '}
                        {parsed.wallTime && `Wall time: ${parsed.wallTime}`}
                    </div>
                    {renderText(parsed.output.trim(), { mode: 'code' })}
                    <RawJsonDevOnly value={result} />
                </>
            )
        }
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                {typeof result === 'object' ? <RawJsonDevOnly value={result} /> : null}
            </>
        )
    }

    if (typeof result === 'string') {
        return renderText(result, { mode: 'auto' })
    }

    return <CodeBlock code={safeStringify(result)} language="json" />
}

export const toolResultViewRegistry: Record<string, ToolViewComponent> = {
    Task: MarkdownResultView,
    Bash: BashResultView,
    Glob: LineListResultView,
    Grep: LineListResultView,
    LS: LineListResultView,
    Read: ReadResultView,
    Edit: MutationResultView,
    MultiEdit: MutationResultView,
    Write: MutationResultView,
    WebFetch: MarkdownResultView,
    WebSearch: GenericResultView,
    NotebookRead: ReadResultView,
    NotebookEdit: MutationResultView,
    TodoWrite: TodoWriteResultView,
    ImageView: ImageViewResultView,
    CodexReasoning: CodexReasoningResultView,
    CodexPatch: CodexPatchResultView,
    CodexDiff: CodexDiffResultView,
    CodexTurnChanges: MutationResultView,
    collab_tool_call: CollabAgentResultView,
    spawn_agent: CollabAgentResultView,
    send_input: CollabAgentResultView,
    wait: CollabAgentResultView,
    close_agent: CollabAgentResultView,
    resume_agent: CollabAgentResultView,
    AskUserQuestion: AskUserQuestionResultView,
    ExitPlanMode: MarkdownResultView,
    ask_user_question: AskUserQuestionResultView,
    exit_plan_mode: MarkdownResultView
}

export function getToolResultViewComponent(toolName: string): ToolViewComponent {
    if (toolName.startsWith('mcp__')) {
        return GenericResultView
    }
    const mapped = toolResultViewRegistry[toolName]
    if (mapped) {
        return mapped
    }
    return GenericResultView
}
