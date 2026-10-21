import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BottomSheet } from '@/components/mobile/BottomSheet'
import { CheckIcon, MoreHorizontalIcon } from '@/components/mobile/icons'
import { MobileSearchField } from '@/components/mobile/MobileSearchField'
import { MobilePageHeader, MobileTabBar } from '@/components/mobile/MobileTabBar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { ChoiceChips, FieldHint, SegmentedControl } from '@/components/ui/FormControls'
import { IconButton } from '@/components/ui/IconButton'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { Switch } from '@/components/ui/Switch'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import type { MemoriesResponse, MemoryItem } from '@/types/api'
import { MemoryDetail, type MemoryEdit } from './MemoryDetail'
import { MergeSheet } from './MergeSheet'
import { actionLabel, evidenceOf, formatWhen, levelLabel, recentRows, scopeLabel, scopesInOrder, sourceLabel, trialLabel, type Level, type Translate } from './model'
import { EmptyState } from '@/components/ui/EmptyState'

const MemoryGraph = lazy(() => import('./MemoryGraph'))

type Tab = 'recent' | Level | 'graph'

const MODE_HINT_KEY: Record<'off' | 'record', string> = {
    off: 'memoryPage.settings.modeHint.off',
    record: 'memoryPage.settings.modeHint.record'
}

/** The search box waits for a pause in typing before it asks the hub. */
function useDebounced(value: string, ms: number): string {
    const [settled, setSettled] = useState(value)
    useEffect(() => {
        const timer = setTimeout(() => setSettled(value), ms)
        return () => clearTimeout(timer)
    }, [value, ms])
    return settled
}

/** Long sentences stay at three lines in lists; the edit sheet shows all of it. */
function Clamp(props: { text: string }) {
    return <span className="line-clamp-3">{props.text}</span>
}

/** The round mark of a row in select mode. */
function SelectMark(props: { on: boolean }) {
    return (
        <span className={cn('flex h-5 w-5 items-center justify-center rounded-full border', props.on ? 'border-[var(--social-primary)] bg-[var(--social-primary)] text-[var(--social-primary-fg)]' : 'border-[var(--social-fg-subtle)]')}>
            {props.on ? <CheckIcon className="h-3.5 w-3.5" /> : null}
        </span>
    )
}

function skippedSummary(reasons: Record<string, number>, t: Translate): string {
    return Object.entries(reasons).map(([reason, count]) => t('memoryPage.recent.skippedReason', { reason, count })).join(t('memoryPage.listSeparator'))
}

/** Memories captured from sessions, judged by Jev: recent captures, the three levels, and a graph. */
export function MemoryPage() {
    const isMobile = useIsMobileLayout()
    const { api } = useAppContext()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const [tab, setTab] = useState<Tab>('recent')
    const [openId, setOpenId] = useState<string | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [trialOpen, setTrialOpen] = useState(false)
    /** Ids picked in select mode; null when not selecting. */
    const [selected, setSelected] = useState<Set<string> | null>(null)
    const [mergeIds, setMergeIds] = useState<string[] | null>(null)
    const [archiveOpen, setArchiveOpen] = useState(false)
    /** The merge the notice can undo. */
    const [undoId, setUndoId] = useState<string | null>(null)
    const scroller = useRef<HTMLDivElement>(null)
    const needle = useDebounced(search.trim(), 300)

    const query = useQuery({
        queryKey: queryKeys.memories,
        queryFn: async (): Promise<MemoriesResponse> => {
            if (!api) throw new Error('API unavailable')
            return await api.getMemories()
        },
        enabled: Boolean(api)
    })
    const hits = useQuery({
        queryKey: [...queryKeys.memories, 'search', needle],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return (await api.searchMemories(needle)).hits
        },
        enabled: Boolean(api) && needle.length > 0
    })
    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.memories })
    const action = useMutation({
        mutationFn: async (run: () => Promise<unknown>) => await run(),
        onSettled: () => { void refresh() }
    })

    const data = query.data
    const memories = data?.memories ?? []
    const links = data?.links ?? []
    const open = openId ? memories.find((m) => m.id === openId) : undefined
    const pending = memories.filter((m) => m.status === 'pending')
    const onTrial = memories.filter((m) => m.status === 'candidate')
    const count = (level: Level) => memories.filter((m) => m.level === level && m.status === 'active').length
    const mode = data?.settings.mode ?? 'record'

    const run = (job: () => Promise<unknown>, after?: () => void) => {
        if (!api) return
        action.mutate(job, { onSuccess: () => after?.() })
    }
    const say = (text: string, undo: string | null = null) => {
        setNotice(text)
        setUndoId(undo)
    }
    /** A memory row opens the edit sheet, or in select mode picks the memory. */
    const pick = (m: MemoryItem) => selected
        ? { icon: <SelectMark on={selected.has(m.id)} />, chevron: false, onClick: () => setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(m.id)) next.delete(m.id)
            else next.add(m.id)
            return next
        }) }
        : { onClick: () => setOpenId(m.id) }

    const empty = (
        <EmptyState variant="page" title={t('memoryPage.empty.title')} subtitle={t('memoryPage.empty.description')}>
            <div className="flex flex-wrap justify-center gap-2">
                <Button variant="secondary" disabled={action.isPending} onClick={() => run(async () => {
                    const result = await api!.importMemoryMd()
                    say(t('memoryPage.notice.imported', { found: result.found, proposed: result.proposed }))
                })}>{t('memoryPage.importMemoryMd')}</Button>
                <Button variant="secondary" disabled={action.isPending} onClick={() => run(async () => {
                    const result = await api!.harvestClaudeMemories()
                    say(t('memoryPage.notice.harvested', { checked: result.checked, proposed: result.proposed }))
                })}>{t('memoryPage.empty.harvest')}</Button>
            </div>
        </EmptyState>
    )

    const recent = () => {
        const rows = recentRows(data?.recent ?? [], memories)
        const skipped = data?.stats.skippedToday ?? 0
        if (memories.length === 0 && rows.length === 0) return empty
        return (
            <div className="space-y-6">
                {pending.length > 0 ? (
                    <ListGroup title={t('memoryPage.recent.pendingTitle', { count: pending.length })}>
                        {pending.map((m) => (
                            <ListRow key={m.id} wrap title={<Clamp text={m.text} />} subtitle={[levelLabel(m.level, t), scopeLabel(m.scope, t), m.source === 'user_message' ? sourceLabel(m, t) : m.reason ?? t('memoryPage.status.pending')].join(' · ')} {...pick(m)} />
                        ))}
                        <ListRow
                            title={t('memoryPage.recent.approveAll')}
                            subtitle={t('memoryPage.recent.approveAllHint')}
                            wrap
                            disabled={action.isPending}
                            onClick={() => run(async () => {
                                const result = await api!.confirmAllMemoryItems(pending.map((m) => m.id))
                                say(t('memoryPage.notice.approved', { count: result.confirmed }))
                            })}
                        />
                    </ListGroup>
                ) : null}
                {onTrial.length > 0 ? (
                    <ListGroup title={t('memoryPage.recent.trialTitle', { count: onTrial.length })}>
                        {trialOpen ? onTrial.map((m) => (
                            <ListRow key={m.id} wrap title={<Clamp text={m.text} />} subtitle={`${levelLabel(m.level, t)} · ${trialLabel(data?.trial[m.id], t)}`} {...pick(m)} />
                        )) : null}
                        <ListRow
                            title={trialOpen ? t('memoryPage.recent.collapse') : t('memoryPage.recent.expand')}
                            subtitle={trialOpen ? undefined : t('memoryPage.recent.trialHint')}
                            wrap
                            onClick={() => setTrialOpen((value) => !value)}
                        />
                    </ListGroup>
                ) : null}
                {rows.length > 0 ? (
                    <div className="space-y-2">
                        <ListGroup title={t('memoryPage.tab.recent')}>
                            {rows.map(({ event, memory }) => (
                                <ListRow
                                    key={event.id}
                                    wrap
                                    title={<Clamp text={memory?.text ?? event.text} />}
                                    subtitle={[actionLabel(event.action, t), memory ? levelLabel(memory.level, t) : null, memory ? scopeLabel(memory.scope, t) : null, formatWhen(event.createdAt, t)].filter(Boolean).join(' · ')}
                                    onClick={memory ? () => setOpenId(memory.id) : undefined}
                                />
                            ))}
                        </ListGroup>
                        {skipped > 0 ? (
                            <p className="px-4 text-footnote text-[var(--social-fg-muted)]">{t('memoryPage.recent.skipped', { count: skipped, reasons: skippedSummary(data?.stats.skippedReasons ?? {}, t) })}</p>
                        ) : null}
                    </div>
                ) : null}
            </div>
        )
    }

    const levelList = (level: Level) => {
        const list = memories.filter((m) => m.level === level)
        if (list.length === 0) return <EmptyState title={t(`memoryPage.levelEmpty.${level}`)} />
        return (
            <div className="space-y-6">
                {scopesInOrder(list).map((scope) => (
                    <ListGroup key={scope || 'global'} title={scopeLabel(scope, t)}>
                        {list.filter((m) => m.scope === scope).map((m) => {
                            const backing = evidenceOf(m.id, links).length
                            return (
                                <ListRow
                                    key={m.id}
                                    wrap
                                    title={<Clamp text={m.text} />}
                                    subtitle={[backing ? t('memoryPage.list.backing', { count: backing }) : null, m.support > 1 ? t('memoryPage.mentioned', { count: m.support }) : null, sourceLabel(m, t)].filter(Boolean).join(' · ')}
                                    trailing={m.status === 'pending' ? <Badge variant="warning">{t('memoryPage.status.pending')}</Badge> : m.status === 'candidate' ? <Badge>{t('memoryPage.status.candidate')}</Badge> : undefined}
                                    {...pick(m)}
                                />
                            )
                        })}
                    </ListGroup>
                ))}
            </div>
        )
    }

    const tabs: Array<{ value: Tab; label: string }> = [
        { value: 'recent', label: t('memoryPage.tab.recent') },
        { value: 'principle', label: `${levelLabel('principle', t)} ${count('principle')}` },
        { value: 'experience', label: `${levelLabel('experience', t)} ${count('experience')}` },
        { value: 'fact', label: `${levelLabel('fact', t)} ${count('fact')}` },
        { value: 'graph', label: t('memoryPage.tab.graph') }
    ]

    const subtitle = data
        ? t('memoryPage.subtitle', { count: data.stats.addedToday, mode: mode === 'off' ? t('memoryPage.mode.offState') : t('memoryPage.mode.record') })
        : t('loading')
    const settingsButton = (
        <IconButton label={t('memoryPage.settings.title')} onClick={() => setSettingsOpen(true)}>
            <MoreHorizontalIcon className="h-6 w-6" />
        </IconButton>
    )
    const desktopTitle = isMobile ? null : (
        <div className="flex items-center gap-2 pb-2 pt-6">
            <div className="min-w-0 flex-1">
                <h1 className="text-title font-semibold leading-none tracking-[-0.035em] text-[var(--social-fg)]">{t('memoryPage.title')}</h1>
                <p className="mt-2 text-caption leading-none text-[var(--social-fg-muted)]">{subtitle}</p>
            </div>
            {settingsButton}
        </div>
    )
    const chips = (sticky: boolean) => (
        <ChoiceChips
            label={t('memoryPage.viewLabel')}
            value={tab}
            options={tabs}
            onChange={setTab}
            className={sticky
                ? 'sticky top-0 z-10 -mx-4 flex-nowrap overflow-x-auto bg-[var(--social-surface)] px-4 py-2 [scrollbar-width:none]'
                : '-mx-4 flex-nowrap overflow-x-auto px-4 py-2 [scrollbar-width:none]'}
        />
    )

    const searchResults = () => {
        if (hits.isLoading || needle !== search.trim()) return <p className="pt-6 text-center text-footnote text-[var(--social-fg-muted)]">{t('memoryPage.search.searching')}</p>
        if (hits.error) return <p className="pt-6 text-center text-footnote text-[var(--social-danger)]">{t('memoryPage.search.failed', { error: hits.error instanceof Error ? hits.error.message : t('memoryPage.unknownError') })}</p>
        const list = hits.data ?? []
        if (list.length === 0) return <EmptyState title={t('memoryPage.search.none')} />
        return (
            <ListGroup title={t('memoryPage.search.resultsTitle', { count: list.length })}>
                {list.map((m) => (
                    <ListRow
                        key={m.id}
                        wrap
                        title={<Clamp text={m.text} />}
                        subtitle={[levelLabel(m.level, t), scopeLabel(m.scope, t), m.status === 'pending' ? t('memoryPage.status.pending') : m.status === 'candidate' ? t('memoryPage.status.candidate') : null, t('memoryPage.search.relevance', { score: m.score.toFixed(2) })].filter(Boolean).join(' · ')}
                        {...pick(m)}
                    />
                ))}
            </ListGroup>
        )
    }

    const body = search.trim()
        ? searchResults()
        : query.isLoading
        ? <p className="pt-10 text-center text-footnote text-[var(--social-fg-muted)]">{t('loading')}</p>
        : query.error
            ? <p className="pt-10 text-center text-footnote text-[var(--social-danger)]">{t('memoryPage.loadFailed', { error: query.error instanceof Error ? query.error.message : t('memoryPage.unknownError') })}</p>
            : tab === 'recent' ? recent() : tab === 'graph' ? null : levelList(tab)

    const saveThen = (memory: MemoryItem, patch: MemoryEdit, then?: () => Promise<unknown>) => run(async () => {
        if (Object.keys(patch).length > 0) await api!.editMemoryItem(memory.id, patch)
        if (then) await then()
    }, () => setOpenId(null))

    const projects = data?.settings.projects ?? []

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
            {isMobile ? <MobilePageHeader title={t('memoryPage.title')} subtitle={subtitle} actions={settingsButton} /> : null}
            {tab === 'graph' ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="mx-auto w-full max-w-content px-4">
                        {desktopTitle}
                        {chips(false)}
                    </div>
                    <div className="min-h-0 flex-1 px-4 pb-4 pt-1">
                        {memories.length === 0 ? empty : (
                            <Suspense fallback={<div className="flex h-full items-center justify-center text-footnote text-[var(--social-fg-muted)]">{t('memoryPage.graph.loading')}</div>}>
                                <MemoryGraph memories={memories} links={links} onOpen={setOpenId} mobile={isMobile} />
                            </Suspense>
                        )}
                    </div>
                </div>
            ) : (
                <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
                    <div className="mx-auto max-w-content px-4 pb-8">
                        {desktopTitle}
                        <div className="pt-2">
                            <MobileSearchField value={search} onChange={setSearch} placeholder={t('memoryPage.search.placeholder')} />
                        </div>
                        {search.trim() ? null : chips(true)}
                        {memories.length > 0 ? (
                            <div className="flex items-center justify-between gap-2 px-1 pt-2">
                                <span className="text-footnote text-[var(--social-fg-muted)]">{selected ? t('memoryPage.select.hint', { count: selected.size }) : ''}</span>
                                <Button variant="ghost" size="xs" onClick={() => setSelected(selected ? null : new Set())}>{selected ? t('memoryPage.select.done') : t('memoryPage.select.start')}</Button>
                            </div>
                        ) : null}
                        {notice ? (
                            <p className="px-1 pt-2 text-footnote text-[var(--social-fg-muted)]">
                                {notice}
                                {undoId ? (
                                    <Button variant="ghost" size="xs" className="ml-1 text-[var(--social-fg)]" disabled={action.isPending} onClick={() => run(async () => {
                                        await api!.undoMemoryMerge(undoId)
                                        say(t('memoryPage.notice.unmerged'))
                                    })}>{t('memoryPage.notice.undo')}</Button>
                                ) : null}
                            </p>
                        ) : null}
                        <div className="pt-3">{body}</div>
                        {selected && selected.size > 0 ? (
                            <div className="sticky bottom-0 z-10 -mx-4 mt-4 flex gap-2 border-t border-[var(--social-border)] bg-[var(--social-surface)] px-4 py-3">
                                <Button variant="secondary" className="flex-1" disabled={action.isPending} onClick={() => setArchiveOpen(true)}>{t('memoryPage.select.archive', { count: selected.size })}</Button>
                                <Button className="flex-1" disabled={action.isPending || selected.size < 2} onClick={() => {
                                    action.reset()
                                    setMergeIds([...selected])
                                }}>{t('memoryPage.select.merge', { count: selected.size })}</Button>
                            </div>
                        ) : null}
                    </div>
                </div>
            )}
            {isMobile ? <MobileTabBar active="memory" /> : null}

            <BottomSheet open={Boolean(open)} onOpenChange={(value) => { if (!value) setOpenId(null) }} title={open?.status === 'pending' ? t('memoryPage.status.pending') : t('memoryPage.detail.title')}>
                {open ? (
                    <MemoryDetail
                        key={`${open.id}:${open.updatedAt}`}
                        memory={open}
                        all={memories}
                        links={links}
                        projects={projects}
                        busy={action.isPending}
                        onOpen={setOpenId}
                        onSave={(patch) => saveThen(open, patch)}
                        onConfirm={(patch) => saveThen(open, patch, () => api!.confirmMemoryItem(open.id))}
                        onDismiss={() => run(() => api!.dismissMemoryItem(open.id), () => setOpenId(null))}
                        trial={data?.trial[open.id]}
                        onMerge={(other) => {
                            action.reset()
                            setOpenId(null)
                            setMergeIds([open.id, other])
                        }}
                        merged={data?.merges[open.id]}
                        onUndoMerge={(eventId) => run(async () => {
                            await api!.undoMemoryMerge(eventId)
                            say(t('memoryPage.notice.unmerged'))
                        }, () => setOpenId(null))}
                        onDelete={() => setDeleteId(open.id)}
                    />
                ) : null}
            </BottomSheet>

            <BottomSheet open={Boolean(mergeIds)} onOpenChange={(value) => { if (!value) setMergeIds(null) }} title={t('memoryPage.merge.title')}>
                {mergeIds ? (
                    <MergeSheet
                        ids={mergeIds}
                        all={memories}
                        busy={action.isPending}
                        error={!action.isPending && action.error instanceof Error ? action.error.message : null}
                        onCancel={() => setMergeIds(null)}
                        onMerge={(text) => run(async () => {
                            const result = await api!.mergeMemories(mergeIds, text)
                            say(t('memoryPage.notice.merged', { count: mergeIds.length }), result.eventId)
                        }, () => {
                            setMergeIds(null)
                            setSelected(null)
                            // The notice with its undo sits at the top of the list.
                            scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })
                        })}
                    />
                ) : null}
            </BottomSheet>

            <ConfirmDialog
                isOpen={archiveOpen}
                onClose={() => setArchiveOpen(false)}
                title={t('memoryPage.archiveDialog.title', { count: selected?.size ?? 0 })}
                description={t('memoryPage.archiveDialog.description')}
                confirmLabel={t('memoryPage.archiveDialog.confirm')}
                confirmingLabel={t('memoryPage.archiveDialog.archiving')}
                isPending={action.isPending}
                onConfirm={async () => {
                    if (!selected || !api) return
                    const result = await api.archiveMemories([...selected])
                    setArchiveOpen(false)
                    setSelected(null)
                    say(t('memoryPage.notice.archived', { count: result.archived }))
                    await refresh()
                }}
            />

            <ConfirmDialog
                isOpen={Boolean(deleteId)}
                onClose={() => setDeleteId(null)}
                title={t('memoryPage.deleteDialog.title')}
                description={t('memoryPage.deleteDialog.description')}
                confirmLabel={t('memoryPage.delete')}
                confirmingLabel={t('memoryPage.deleteDialog.deleting')}
                destructive
                isPending={action.isPending}
                onConfirm={async () => {
                    if (!deleteId || !api) return
                    await api.deleteMemoryItem(deleteId)
                    setDeleteId(null)
                    setOpenId(null)
                    await refresh()
                }}
            />

            <BottomSheet open={settingsOpen} onOpenChange={setSettingsOpen} title={t('memoryPage.settings.title')}>
                <div className="space-y-5 px-4 pb-6">
                    <div className="space-y-2">
                        <SegmentedControl
                            label={t('memoryPage.settings.mode')}
                            value={mode}
                            options={[{ value: 'off', label: t('memoryPage.mode.off') }, { value: 'record', label: t('memoryPage.mode.record') }]}
                            onChange={(next) => run(() => api!.updateMemoryCapture({ mode: next }))}
                        />
                        <FieldHint>{t(MODE_HINT_KEY[mode])} {t('memoryPage.settings.injectionLater')}</FieldHint>
                    </div>
                    <ListGroup title={t('memoryPage.settings.projects')}>
                        {(data?.settings.knownProjects ?? []).map((project) => (
                            <ListRow
                                key={project.name}
                                wrap
                                title={project.name}
                                subtitle={[project.path ? project.path.replace(/^\/Users\/[^/]+/, '~') : null, project.sessions ? t('memoryPage.settings.sessionCount', { count: project.sessions }) : null].filter(Boolean).join(' · ') || undefined}
                                trailing={(
                                    <Switch
                                        checked={projects.includes(project.name)}
                                        ariaLabel={t('memoryPage.settings.collectProject', { name: project.name })}
                                        onCheckedChange={(on) => run(() => api!.updateMemoryCapture({ projects: on ? [...projects, project.name] : projects.filter((p) => p !== project.name) }))}
                                    />
                                )}
                            />
                        ))}
                    </ListGroup>
                    <FieldHint>{t('memoryPage.settings.projectsHint')}</FieldHint>
                    <ListGroup>
                        <ListRow title="Jev" trailing={data?.settings.jevReady ? t('memoryPage.settings.jevConnected') : t('memoryPage.settings.jevNoKey')} />
                        <ListRow title={t('memoryPage.settings.jevAccuracy')} trailing={t('memoryPage.settings.jevAccuracyValue', { judged: data?.stats.judged ?? 0, corrected: data?.stats.corrected ?? 0 })} />
                        <ListRow title={t('memoryPage.importMemoryMd')} subtitle={t('memoryPage.settings.importHint')} wrap disabled={action.isPending} onClick={() => run(async () => {
                            const result = await api!.importMemoryMd()
                            say(t('memoryPage.notice.imported', { found: result.found, proposed: result.proposed }))
                        })} />
                        <ListRow title={t('memoryPage.settings.maintain')} subtitle={t('memoryPage.settings.maintainHint')} wrap disabled={action.isPending} onClick={() => run(async () => {
                            const r = await api!.maintainMemories()
                            say(t('memoryPage.notice.maintained', { merged: r.merged, promoted: r.promoted, expired: r.expired, moved: r.moved, offered: r.offered }))
                        })} />
                        <ListRow title={t('memoryPage.settings.readMessages')} subtitle={t('memoryPage.settings.readMessagesHint')} wrap disabled={action.isPending} onClick={() => run(async () => {
                            const r = await api!.readUserMessagesForMemory()
                            say(t('memoryPage.notice.readMessages', { read: r.read, passed: r.passed, proposed: r.proposed, cost: r.costUsd.toFixed(3) }))
                        })} />
                        <ListRow title={t('memoryPage.settings.harvest')} subtitle={t('memoryPage.settings.harvestHint')} wrap disabled={action.isPending} onClick={() => run(async () => {
                            const result = await api!.harvestClaudeMemories()
                            say(t('memoryPage.notice.harvested', { checked: result.checked, proposed: result.proposed }))
                        })} />
                    </ListGroup>
                    {action.isPending ? <FieldHint>{t('memoryPage.settings.working')}</FieldHint> : notice ? <FieldHint>{notice}</FieldHint> : null}
                </div>
            </BottomSheet>
        </div>
    )
}
