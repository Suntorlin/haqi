import { memo, useMemo, useState } from 'react'
import type { ChatToolCall } from '@/chat/types'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Chip } from '@/components/ui/Chip'
import { TextField } from '@/components/ui/TextField'
import { HIT_AREA_CLASS } from '@/components/AssistantChat/hitArea'
import { cn } from '@/lib/utils'
import { getAskUserQuestionAnswerKey, isAskUserQuestionToolName, parseAskUserQuestionInput } from '@/components/ToolCard/askUserQuestion'
import {
    isRequestUserInputToolName,
    parseRequestUserInputInput,
    formatRequestUserInputAnswers
} from '@/components/ToolCard/requestUserInput'
import { isCodexFamilyFlavor } from '@/lib/agentFlavorUtils'
import { getInputStringAny } from '@/lib/toolInputUtils'

/* ── tiny CLI-style button ── */
function CliBtn(props: {
    label: string
    tone: 'allow' | 'deny' | 'neutral'
    loading?: boolean
    disabled: boolean
    onClick: () => void
}) {
    const color = props.tone === 'allow'
        ? 'text-[var(--app-badge-success-text)] border-[var(--app-badge-success-border)] hover:bg-[var(--app-badge-success-bg)] hover:text-[var(--app-badge-success-text)]'
        : props.tone === 'deny'
            ? 'text-[var(--social-danger)] border-[var(--app-badge-error-border)] hover:bg-[var(--app-badge-error-bg)] hover:text-[var(--social-danger)]'
            : 'text-[var(--social-fg)] border-[var(--social-border)] hover:bg-[var(--social-hover)]'

    return (
        <Button
            variant="outline"
            size="sm"
            className={cn('h-9 gap-1 px-3 text-footnote', HIT_AREA_CLASS, color)}
            disabled={props.disabled}
            onClick={props.onClick}
        >
            {props.loading && <Spinner size="sm" label={null} className="h-3 w-3 text-current" />}
            {props.label}
        </Button>
    )
}

/* ── Permission (approve / deny) ── */
export const CliPermission = memo(function CliPermission(props: {
    tool: ChatToolCall
    disabled: boolean
}) {
    const ctx = useOptionalHappyChatContext()
    const permission = props.tool.permission
    const [loading, setLoading] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    const codex = useMemo(
        () => isCodexFamilyFlavor(ctx?.metadata?.flavor) || props.tool.name.startsWith('Codex') || props.tool.name.startsWith('Gemini') || props.tool.name.startsWith('OpenCode'),
        [ctx?.metadata?.flavor, props.tool.name]
    )

    if (!permission || !ctx?.api || !ctx.sessionId) return null

    if (permission.status !== 'pending') {
        if ((permission.status === 'denied' || permission.status === 'canceled') && permission.reason) {
            return <div className="ml-5 text-xs text-[var(--social-danger)] italic">denied: {permission.reason}</div>
        }
        return null
    }

    const run = async (action: () => Promise<void>) => {
        setError(null)
        try {
            await action()
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Request failed')
        }
    }

    const toolName = props.tool.name
    const isEditTool = toolName === 'Edit' || toolName === 'MultiEdit' || toolName === 'Write' || toolName === 'NotebookEdit'
    const hideAllowForSession = isEditTool || toolName === 'exit_plan_mode' || toolName === 'ExitPlanMode'

    const approve = async () => {
        setLoading('allow')
        await run(() => ctx.api.approvePermission(ctx.sessionId, permission.id))
        setLoading(null)
    }

    const approveForSession = async () => {
        setLoading('session')
        const command = toolName === 'Bash' ? getInputStringAny(props.tool.input, ['command', 'cmd']) : null
        const toolId = toolName === 'Bash' && command ? `Bash(${command})` : toolName
        await run(() => ctx.api.approvePermission(ctx.sessionId, permission.id, { allowTools: [toolId] }))
        setLoading(null)
    }

    const approveAllEdits = async () => {
        setLoading('allEdits')
        await run(() => ctx.api.approvePermission(ctx.sessionId, permission.id, 'acceptEdits'))
        setLoading(null)
    }

    const deny = async () => {
        setLoading('deny')
        await run(() => ctx.api.denyPermission(ctx.sessionId, permission.id))
        setLoading(null)
    }

    const codexApprove = async (decision: 'approved' | 'approved_for_session') => {
        setLoading(decision)
        await run(() => ctx.api.approvePermission(ctx.sessionId, permission.id, { decision }))
        setLoading(null)
    }

    const codexAbort = async () => {
        setLoading('abort')
        await run(() => ctx.api.denyPermission(ctx.sessionId, permission.id, { decision: 'abort' }))
        setLoading(null)
    }

    const busy = loading !== null || props.disabled

    return (
        <div className="ml-5 mt-1 flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--app-badge-warning-text)]">permission required</span>
            {codex ? (
                <>
                    <CliBtn label="yes" tone="allow" loading={loading === 'approved'} disabled={busy} onClick={() => codexApprove('approved')} />
                    <CliBtn label="yes (session)" tone="neutral" loading={loading === 'approved_for_session'} disabled={busy} onClick={() => codexApprove('approved_for_session')} />
                    <CliBtn label="abort" tone="deny" loading={loading === 'abort'} disabled={busy} onClick={codexAbort} />
                </>
            ) : (
                <>
                    <CliBtn label="allow" tone="allow" loading={loading === 'allow'} disabled={busy} onClick={approve} />
                    {!hideAllowForSession && (
                        <CliBtn label="allow (session)" tone="neutral" loading={loading === 'session'} disabled={busy} onClick={approveForSession} />
                    )}
                    {isEditTool && (
                        <CliBtn label="allow all edits" tone="neutral" loading={loading === 'allEdits'} disabled={busy} onClick={approveAllEdits} />
                    )}
                    <CliBtn label="deny" tone="deny" loading={loading === 'deny'} disabled={busy} onClick={deny} />
                </>
            )}
            {error && <span className="text-xs text-[var(--social-danger)]">{error}</span>}
        </div>
    )
})

/* ── AskUserQuestion (CLI-style inline selection) ── */
export const CliAskUserQuestion = memo(function CliAskUserQuestion(props: {
    tool: ChatToolCall
    disabled: boolean
}) {
    const ctx = useOptionalHappyChatContext()
    const permission = props.tool.permission
    const parsed = useMemo(() => parseAskUserQuestionInput(props.tool.input), [props.tool.input])
    const questions = parsed.questions

    const [selectedByQ, setSelectedByQ] = useState<number[][]>(() => questions.map(() => []))
    const [otherSelectedByQ, setOtherSelectedByQ] = useState<boolean[]>(() => questions.map(() => false))
    const [otherTextByQ, setOtherTextByQ] = useState<string[]>(() => questions.map(() => ''))
    const [fallbackText, setFallbackText] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (!permission || permission.status !== 'pending' || !ctx?.api || !ctx.sessionId) return null
    if (!isAskUserQuestionToolName(props.tool.name)) return null

    const toggle = (qIdx: number, optIdx: number) => {
        const q = questions[qIdx]
        if (!q) return
        setSelectedByQ(prev => {
            const next = prev.slice()
            const cur = new Set(next[qIdx] ?? [])
            if (q.multiSelect) {
                if (cur.has(optIdx)) cur.delete(optIdx); else cur.add(optIdx)
                next[qIdx] = Array.from(cur).sort((a, b) => a - b)
            } else {
                next[qIdx] = [optIdx]
            }
            return next
        })
        if (!q.multiSelect) {
            setOtherSelectedByQ(prev => { const n = prev.slice(); n[qIdx] = false; return n })
        }
    }

    const toggleOther = (qIdx: number) => {
        const q = questions[qIdx]
        if (!q) return
        if (!q.multiSelect) {
            setSelectedByQ(prev => { const n = prev.slice(); n[qIdx] = []; return n })
            setOtherSelectedByQ(prev => { const n = prev.slice(); n[qIdx] = true; return n })
        } else {
            setOtherSelectedByQ(prev => { const n = prev.slice(); n[qIdx] = !n[qIdx]; return n })
        }
    }

    const submit = async () => {
        if (loading) return
        const answers: Record<string, string[]> = {}

        if (questions.length === 0) {
            const text = fallbackText.trim()
            if (!text) { setError('Please enter a response'); return }
            answers['0'] = [text]
        } else {
            for (let i = 0; i < questions.length; i++) {
                const q = questions[i]
                const parts: string[] = []
                for (const idx of (selectedByQ[i] ?? [])) {
                    const label = q.options[idx]?.label
                    if (label) parts.push(label)
                }
                if (otherSelectedByQ[i] && otherTextByQ[i]?.trim()) parts.push(otherTextByQ[i].trim())
                if (parts.length === 0) { setError('Please select an option'); return }
                answers[getAskUserQuestionAnswerKey(q, i)] = parts
            }
        }

        setError(null)
        setLoading(true)
        try {
            await ctx.api.approvePermission(ctx.sessionId, permission.id, { answers })
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Submit failed')
        }
        setLoading(false)
    }

    return (
        <div className="ml-5 mt-1 border-l border-[var(--social-divider)] pl-3 space-y-1">
            {questions.length === 0 ? (
                <div className="space-y-1">
                    <span className="text-xs text-[var(--app-badge-info-text)]">? Input requested</span>
                    <TextField
                        type="text"
                        value={fallbackText}
                        onChange={e => setFallbackText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submit() }}
                        disabled={props.disabled || loading}
                        placeholder="Type your answer…"
                        wrapperClassName="max-w-md"
                    />
                </div>
            ) : (
                questions.map((q, qIdx) => (
                    <div key={qIdx} className="space-y-0.5">
                        {q.header && <span className="text-xs font-semibold text-[var(--social-fg)]">{q.header}</span>}
                        {q.question && <div className="text-xs text-[var(--social-fg)]">{q.question}</div>}
                        <div className="flex flex-wrap gap-1 mt-0.5">
                            {q.options.map((opt, optIdx) => {
                                const selected = (selectedByQ[qIdx] ?? []).includes(optIdx)
                                return (
                                    <Chip
                                        key={optIdx}
                                        onClick={() => toggle(qIdx, optIdx)}
                                        disabled={props.disabled || loading}
                                        selected={selected}
                                        title={opt.description ?? undefined}
                                    >
                                        {q.multiSelect ? (selected ? '☑ ' : '☐ ') : (selected ? '● ' : '○ ')}
                                        {opt.label}
                                    </Chip>
                                )
                            })}
                            <Chip
                                onClick={() => toggleOther(qIdx)}
                                disabled={props.disabled || loading}
                                selected={otherSelectedByQ[qIdx] ?? false}
                            >
                                other
                            </Chip>
                        </div>
                        {otherSelectedByQ[qIdx] && (
                            <TextField
                                type="text"
                                value={otherTextByQ[qIdx] ?? ''}
                                onChange={e => setOtherTextByQ(prev => { const n = prev.slice(); n[qIdx] = e.target.value; return n })}
                                disabled={props.disabled || loading}
                                placeholder="Type your answer…"
                                wrapperClassName="max-w-md"
                            />
                        )}
                    </div>
                ))
            )}
            <div className="flex items-center gap-1.5 pt-0.5">
                <CliBtn label={loading ? 'submitting…' : 'submit'} tone="allow" loading={loading} disabled={props.disabled || loading} onClick={submit} />
                {error && <span className="text-xs text-[var(--social-danger)]">{error}</span>}
            </div>
        </div>
    )
})

/* ── RequestUserInput (CLI-style) ── */
export const CliRequestUserInput = memo(function CliRequestUserInput(props: {
    tool: ChatToolCall
    disabled: boolean
}) {
    const ctx = useOptionalHappyChatContext()
    const permission = props.tool.permission
    const parsed = useMemo(() => parseRequestUserInputInput(props.tool.input), [props.tool.input])
    const questions = parsed.questions

    const [stateByQ, setStateByQ] = useState<Record<string, { selected: string | null; userNote: string }>>(() => {
        const init: Record<string, { selected: string | null; userNote: string }> = {}
        for (const q of questions) init[q.id] = { selected: null, userNote: '' }
        return init
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    if (!permission || permission.status !== 'pending' || !ctx?.api || !ctx.sessionId) return null
    if (!isRequestUserInputToolName(props.tool.name)) return null

    const select = (qId: string, label: string) => {
        setStateByQ(prev => ({ ...prev, [qId]: { ...prev[qId], selected: label } }))
    }

    const updateNote = (qId: string, value: string) => {
        setStateByQ(prev => ({ ...prev, [qId]: { ...prev[qId], userNote: value } }))
    }

    const submit = async () => {
        if (loading) return
        for (const q of questions) {
            const s = stateByQ[q.id]
            if (q.options.length > 0 && !s?.selected && !s?.userNote.trim()) {
                setError('Please select an option or enter a note')
                return
            }
            if (q.options.length === 0 && !s?.userNote.trim()) {
                setError('Please enter a response')
                return
            }
        }
        setError(null)
        setLoading(true)
        try {
            const formatted = formatRequestUserInputAnswers(stateByQ)
            await ctx.api.approvePermission(ctx.sessionId, permission.id, formatted)
        } catch (e) {
            setError(e instanceof Error ? e.message : 'Submit failed')
        }
        setLoading(false)
    }

    return (
        <div className="ml-5 mt-1 border-l border-[var(--social-divider)] pl-3 space-y-1">
            {questions.map(q => {
                const state = stateByQ[q.id]
                return (
                    <div key={q.id} className="space-y-0.5">
                        {q.question && <div className="text-xs text-[var(--social-fg)]">{q.question}</div>}
                        {q.options.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-0.5">
                                {q.options.map((opt, i) => {
                                    const selected = state?.selected === opt.label
                                    return (
                                        <Chip
                                            key={i}
                                            onClick={() => select(q.id, opt.label)}
                                            disabled={props.disabled || loading}
                                            selected={selected}
                                            title={opt.description ?? undefined}
                                        >
                                            {selected ? '● ' : '○ '}{opt.label}
                                        </Chip>
                                    )
                                })}
                            </div>
                        )}
                        <TextField
                            type="text"
                            value={state?.userNote ?? ''}
                            onChange={e => updateNote(q.id, e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') submit() }}
                            disabled={props.disabled || loading}
                            placeholder={q.options.length > 0 ? 'Additional note (optional)…' : 'Type your answer…'}
                            wrapperClassName="max-w-md"
                        />
                    </div>
                )
            })}
            <div className="flex items-center gap-1.5 pt-0.5">
                <CliBtn label={loading ? 'submitting…' : 'submit'} tone="allow" loading={loading} disabled={props.disabled || loading} onClick={submit} />
                {error && <span className="text-xs text-[var(--social-danger)]">{error}</span>}
            </div>
        </div>
    )
})
