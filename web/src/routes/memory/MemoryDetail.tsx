import { useState } from 'react'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { Button } from '@/components/ui/button'
import { FormField, SegmentedControl } from '@/components/ui/FormControls'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { cn } from '@/lib/utils'
import type { MemoryItem, MemoryLink } from '@/types/api'
import { evidenceOf, formatWhen, LEVEL_LABEL, scopeLabel, sourceLabel, supportsOf, type Level } from './model'

/** Maturity as a filling circle: fact ○, experience ◐, principle ●. Used by the graph and its legend. */
export function LevelIcon(props: { level: Level; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={cn('h-5 w-5', props.className)} aria-label={LEVEL_LABEL[props.level]} role="img">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
            {props.level === 'experience' ? <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /> : null}
            {props.level === 'principle' ? <circle cx="12" cy="12" r="8" fill="currentColor" /> : null}
        </svg>
    )
}

/** "0.66" in plain text when Jev was sure, in the warning colour when it was not. */
function Score(props: { value: number }) {
    return (
        <span className={cn('tabular-nums', props.value < 0.6 && 'font-semibold text-[var(--social-warning)]')}>
            {props.value.toFixed(2)}
        </span>
    )
}

const LEVEL_OPTIONS: Array<{ value: Level; label: string }> = [
    { value: 'fact', label: '事实' },
    { value: 'experience', label: '经验' },
    { value: 'principle', label: '原则' }
]

export type MemoryEdit = { text?: string; level?: Level; scope?: string }

/** One memory: edit the sentence, its level and scope; see what Jev said and what it is linked to. */
export function MemoryDetail(props: {
    memory: MemoryItem
    all: MemoryItem[]
    links: MemoryLink[]
    projects: string[]
    busy: boolean
    onOpen: (id: string) => void
    onSave: (patch: MemoryEdit) => void
    onConfirm: (patch: MemoryEdit) => void
    onDismiss: () => void
    onDelete: () => void
}) {
    const { memory } = props
    const byId = new Map(props.all.map((m) => [m.id, m]))
    const project = memory.scope || memory.jev?.project || props.projects[0] || 'haqi'
    const [text, setText] = useState(memory.text)
    const [level, setLevel] = useState<Level>(memory.level)
    const [scope, setScope] = useState(memory.scope)
    const supports = supportsOf(memory.id, props.links).map((id) => byId.get(id)).filter((m): m is MemoryItem => Boolean(m))
    const evidence = evidenceOf(memory.id, props.links).map((id) => byId.get(id)).filter((m): m is MemoryItem => Boolean(m))
    const replaced = memory.replaces ? byId.get(memory.replaces) : undefined
    const pending = memory.status === 'pending'
    const jev = memory.jev
    const changed = memory.overridden?.level ? '级别' : memory.overridden?.scope !== undefined ? '范围' : null
    const patch: MemoryEdit = {
        ...(text.trim() !== memory.text ? { text: text.trim() } : {}),
        ...(level !== memory.level ? { level } : {}),
        ...(scope !== memory.scope ? { scope } : {})
    }

    return (
        <div className="space-y-5 px-4 pb-6">
            {pending && memory.reason ? (
                <p className="text-[15px] leading-relaxed text-[var(--social-fg)]">
                    {memory.reason}
                    {replaced ? <span className="mt-1 block text-[13px] text-[var(--social-fg-muted)]">确认后会替换：{replaced.text}</span> : null}
                </p>
            ) : null}

            <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={3}
                aria-label="记忆内容"
                className={cn(DIALOG_INPUT_CLASS, 'resize-none leading-relaxed')}
            />

            <FormField label="级别">
                <SegmentedControl label="级别" value={level} options={LEVEL_OPTIONS} onChange={setLevel} />
            </FormField>
            <FormField label="范围">
                <SegmentedControl
                    label="范围"
                    value={scope}
                    options={[{ value: '', label: '全局' }, { value: project, label: project }]}
                    onChange={setScope}
                />
            </FormField>

            {jev ? (
                <p className="px-1 text-[13px] text-[var(--social-fg-muted)]">
                    Jev：要记 <Score value={jev.keep} /> · {LEVEL_LABEL[jev.level.choice]} <Score value={jev.level.confidence} /> · {jev.scope.choice === 'project' && jev.project ? jev.project : '全局'} <Score value={jev.scope.confidence} />
                    {changed ? ` · 你改过${changed}` : ''}
                </p>
            ) : null}

            {supports.length + evidence.length > 0 ? (
                <ListGroup title="关联">
                    {supports.map((item) => (
                        <ListRow key={item.id} wrap title={item.text} subtitle={`它撑起的${LEVEL_LABEL[item.level]}`} onClick={() => props.onOpen(item.id)} />
                    ))}
                    {evidence.map((item) => (
                        <ListRow key={item.id} wrap title={item.text} subtitle={`依据 · ${LEVEL_LABEL[item.level]}`} onClick={() => props.onOpen(item.id)} />
                    ))}
                </ListGroup>
            ) : null}

            <p className="px-1 text-[13px] text-[var(--social-fg-muted)]">
                {sourceLabel(memory)} · {formatWhen(memory.createdAt)} · {scopeLabel(memory.scope)}
                {memory.support > 1 ? ` · 被提到 ${memory.support} 次` : ''}
                {memory.version > 1 ? ` · 第 ${memory.version} 版` : ''}
            </p>

            {pending ? (
                <div className="flex gap-2">
                    <Button className="flex-1" disabled={props.busy} onClick={() => props.onConfirm(patch)}>确认</Button>
                    <Button variant="secondary" className="flex-1" disabled={props.busy} onClick={props.onDismiss}>不记</Button>
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <Button className="flex-1" disabled={props.busy || Object.keys(patch).length === 0} onClick={() => props.onSave(patch)}>保存</Button>
                    <Button variant="ghost" className="text-[var(--social-danger)] hover:text-[var(--social-danger)]" disabled={props.busy} onClick={props.onDelete}>删除</Button>
                </div>
            )}
        </div>
    )
}
