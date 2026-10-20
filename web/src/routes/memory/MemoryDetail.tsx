import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { Button } from '@/components/ui/button'
import { FormField, SegmentedControl } from '@/components/ui/FormControls'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import type { MemoryItem, MemoryLink } from '@/types/api'
import { evidenceOf, formatWhen, levelLabel, scopeLabel, sourceLabel, supportsOf, trialLabel, type Level } from './model'

/** Maturity as a filling circle: fact ○, experience ◐, principle ●. Used by the graph and its legend. */
export function LevelIcon(props: { level: Level; className?: string }) {
    const { t } = useTranslation()
    return (
        <svg viewBox="0 0 24 24" className={cn('h-5 w-5', props.className)} aria-label={levelLabel(props.level, t)} role="img">
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

const LEVELS: Level[] = ['fact', 'experience', 'principle']

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
    /** Mentions so far, for a memory on trial. */
    trial?: { recent: number; lastAt: number }
    /** Merge this memory into another one. */
    onMerge: (intoId: string) => void
}) {
    const { memory } = props
    const { api } = useAppContext()
    const { t } = useTranslation()
    const related = useQuery({
        queryKey: [...queryKeys.memories, 'related', memory.id, memory.updatedAt],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return (await api.relatedMemories(memory.id)).hits
        },
        enabled: Boolean(api)
    })
    const byId = new Map(props.all.map((m) => [m.id, m]))
    const project = memory.scope || memory.jev?.project || props.projects[0] || 'haqi'
    const [text, setText] = useState(memory.text)
    const [level, setLevel] = useState<Level>(memory.level)
    const [scope, setScope] = useState(memory.scope)
    const supports = supportsOf(memory.id, props.links).map((id) => byId.get(id)).filter((m): m is MemoryItem => Boolean(m))
    const evidence = evidenceOf(memory.id, props.links).map((id) => byId.get(id)).filter((m): m is MemoryItem => Boolean(m))
    const replaced = memory.replaces ? byId.get(memory.replaces) : undefined
    const pending = memory.status === 'pending'
    const onTrial = memory.status === 'candidate'
    const jev = memory.jev
    const changed = memory.overridden?.level ? t('memoryPage.detail.youChangedLevel') : memory.overridden?.scope !== undefined ? t('memoryPage.detail.youChangedScope') : null
    const patch: MemoryEdit = {
        ...(text.trim() !== memory.text ? { text: text.trim() } : {}),
        ...(level !== memory.level ? { level } : {}),
        ...(scope !== memory.scope ? { scope } : {})
    }

    return (
        <div className="space-y-5 px-4 pb-6">
            {pending && memory.reason ? (
                <p className="text-body leading-relaxed text-[var(--social-fg)]">
                    {memory.reason}
                    {replaced ? <span className="mt-1 block text-footnote text-[var(--social-fg-muted)]">{t('memoryPage.detail.replaces', { text: replaced.text })}</span> : null}
                </p>
            ) : null}
            {onTrial ? (
                <p className="text-body leading-relaxed text-[var(--social-fg)]">
                    {t('memoryPage.detail.onTrial', { trial: trialLabel(props.trial, t) })}
                    {memory.reason ? <span className="mt-1 block text-footnote text-[var(--social-fg-muted)]">{memory.reason}</span> : null}
                </p>
            ) : null}

            <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={3}
                aria-label={t('memoryPage.detail.textLabel')}
                className={cn(DIALOG_INPUT_CLASS, 'resize-none leading-relaxed')}
            />

            <FormField label={t('memoryPage.detail.level')}>
                <SegmentedControl label={t('memoryPage.detail.level')} value={level} options={LEVELS.map((value) => ({ value, label: levelLabel(value, t) }))} onChange={setLevel} />
            </FormField>
            <FormField label={t('memoryPage.detail.scope')}>
                <SegmentedControl
                    label={t('memoryPage.detail.scope')}
                    value={scope}
                    options={[{ value: '', label: t('memoryPage.scope.global') }, { value: project, label: project }]}
                    onChange={setScope}
                />
            </FormField>

            {jev ? (
                <p className="px-1 text-footnote text-[var(--social-fg-muted)]">
                    {t('memoryPage.detail.jevKeep')} <Score value={jev.keep} /> · {levelLabel(jev.level.choice, t)} <Score value={jev.level.confidence} /> · {jev.scope.choice === 'project' && jev.project ? jev.project : t('memoryPage.scope.global')} <Score value={jev.scope.confidence} />
                    {changed ? ` · ${changed}` : ''}
                </p>
            ) : null}

            {supports.length + evidence.length > 0 ? (
                <ListGroup title={t('memoryPage.detail.links')}>
                    {supports.map((item) => (
                        <ListRow key={item.id} wrap title={item.text} subtitle={t('memoryPage.detail.supports', { level: levelLabel(item.level, t) })} onClick={() => props.onOpen(item.id)} />
                    ))}
                    {evidence.map((item) => (
                        <ListRow key={item.id} wrap title={item.text} subtitle={t('memoryPage.detail.evidence', { level: levelLabel(item.level, t) })} onClick={() => props.onOpen(item.id)} />
                    ))}
                </ListGroup>
            ) : null}

            {related.data && related.data.length > 0 ? (
                <ListGroup title={t('memoryPage.detail.similar')}>
                    {related.data.map((item) => (
                        <ListRow
                            key={item.id}
                            wrap
                            title={item.text}
                            subtitle={`${levelLabel(item.level, t)} · ${scopeLabel(item.scope, t)} · ${t('memoryPage.detail.similarity', { score: item.score.toFixed(2) })}`}
                            trailing={(
                                <Button variant="secondary" className="px-4" disabled={props.busy} onClick={() => props.onMerge(item.id)}>
                                    {t('memoryPage.detail.merge')}
                                </Button>
                            )}
                        />
                    ))}
                </ListGroup>
            ) : null}

            <p className="px-1 text-footnote text-[var(--social-fg-muted)]">
                {sourceLabel(memory, t)} · {formatWhen(memory.createdAt, t)} · {scopeLabel(memory.scope, t)}
                {memory.support > 1 ? ` · ${t('memoryPage.mentioned', { count: memory.support })}` : ''}
                {memory.version > 1 ? ` · ${t('memoryPage.detail.version', { version: memory.version })}` : ''}
            </p>

            {pending || onTrial ? (
                <div className="flex gap-2">
                    <Button className="flex-1" disabled={props.busy} onClick={() => props.onConfirm(patch)}>{onTrial ? t('memoryPage.detail.applyNow') : t('memoryPage.detail.approve')}</Button>
                    <Button variant="secondary" className="flex-1" disabled={props.busy} onClick={props.onDismiss}>{t('memoryPage.detail.dismiss')}</Button>
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <Button className="flex-1" disabled={props.busy || Object.keys(patch).length === 0} onClick={() => props.onSave(patch)}>{t('memoryPage.detail.save')}</Button>
                    <Button variant="ghost" className="text-[var(--social-danger)] hover:text-[var(--social-danger)]" disabled={props.busy} onClick={props.onDelete}>{t('memoryPage.delete')}</Button>
                </div>
            )}
        </div>
    )
}
