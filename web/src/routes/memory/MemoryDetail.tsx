import { useState } from 'react'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FormField, SegmentedControl } from '@/components/ui/FormControls'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { cn } from '@/lib/utils'
import { findMemory, GLOBAL_SCOPE, LEVEL_LABEL, MEMORIES, type Level, type Memory } from './mock'

/** Maturity as a filling circle: fact ○, experience ◐, principle ●. */
export function LevelIcon(props: { level: Level; className?: string }) {
    return (
        <svg viewBox="0 0 24 24" className={cn('h-5 w-5', props.className)} aria-label={LEVEL_LABEL[props.level]} role="img">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
            {props.level === 'experience' ? <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" /> : null}
            {props.level === 'principle' ? <circle cx="12" cy="12" r="8" fill="currentColor" /> : null}
        </svg>
    )
}

function Confidence(props: { value: number }) {
    return props.value < 0.6
        ? <Badge variant="warning">{props.value.toFixed(2)}</Badge>
        : <span className="tabular-nums">{props.value.toFixed(2)}</span>
}

const LEVEL_OPTIONS: Array<{ value: Level; label: string }> = [
    { value: 'fact', label: '事实' },
    { value: 'experience', label: '经验' },
    { value: 'principle', label: '原则' }
]

/** One memory: edit the sentence, its level and scope; see what Jev said and what backs it. */
export function MemoryDetail(props: { memory: Memory; onOpen: (id: string) => void; onDone: () => void }) {
    const { memory } = props
    const project = memory.scope === GLOBAL_SCOPE ? 'haqi' : memory.scope
    const [text, setText] = useState(memory.text)
    const [level, setLevel] = useState<Level>(memory.level)
    const [scope, setScope] = useState(memory.scope)
    const evidence = (memory.evidence ?? []).map(findMemory).filter((m): m is Memory => Boolean(m))
    const supports = MEMORIES.filter((m) => m.evidence?.includes(memory.id))
    const replaced = memory.replaces ? findMemory(memory.replaces) : undefined
    const pending = memory.status === 'pending'
    const jev = memory.jev

    return (
        <div className="space-y-5 px-4 pb-6">
            {pending ? (
                <div className="space-y-2">
                    <Badge variant="warning" dot>等你确认</Badge>
                    <p className="text-[15px] leading-relaxed text-[var(--social-fg)]">{memory.reason}</p>
                    {replaced ? (
                        <p className="text-[13px] leading-relaxed text-[var(--social-fg-muted)]">确认后会替换：{replaced.text}</p>
                    ) : null}
                </div>
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
                    options={[{ value: GLOBAL_SCOPE, label: '全局' }, { value: project, label: project }]}
                    onChange={setScope}
                />
            </FormField>

            {jev ? (
                <ListGroup title="Jev 的判断">
                    <ListRow title="要不要记" trailing={<span>要 · <Confidence value={jev.keep} /></span>} />
                    <ListRow
                        title="哪一级"
                        subtitle={memory.overridden?.level ? `你改成了${LEVEL_LABEL[memory.overridden.level]}` : undefined}
                        trailing={<span>{LEVEL_LABEL[jev.level.choice]} · <Confidence value={jev.level.confidence} /></span>}
                    />
                    <ListRow
                        title="范围"
                        subtitle={memory.overridden?.scope ? `你改成了${memory.overridden.scope}` : undefined}
                        trailing={<span>{jev.scope.choice} · <Confidence value={jev.scope.confidence} /></span>}
                    />
                </ListGroup>
            ) : null}

            {evidence.length > 0 ? (
                <ListGroup title="依据">
                    {evidence.map((item) => (
                        <ListRow key={item.id} wrap icon={<LevelIcon level={item.level} />} title={item.text} subtitle={`${LEVEL_LABEL[item.level]} · ${item.at}`} onClick={() => props.onOpen(item.id)} />
                    ))}
                </ListGroup>
            ) : null}

            {supports.length > 0 ? (
                <ListGroup title="它撑起了">
                    {supports.map((item) => (
                        <ListRow key={item.id} wrap icon={<LevelIcon level={item.level} />} title={item.text} subtitle={LEVEL_LABEL[item.level]} onClick={() => props.onOpen(item.id)} />
                    ))}
                </ListGroup>
            ) : null}

            <p className="text-[13px] text-[var(--social-fg-muted)]">
                {memory.source} · {memory.at}{memory.versions && memory.versions > 1 ? ` · 第 ${memory.versions} 版` : ''}
            </p>

            <div className="flex gap-2">
                <Button className="flex-1" onClick={props.onDone}>{pending ? '确认' : '保存'}</Button>
                <Button variant="secondary" className={pending ? 'flex-1' : 'flex-1 text-[var(--social-danger)]'} onClick={props.onDone}>
                    {pending ? '不记' : '删除'}
                </Button>
            </div>
        </div>
    )
}
