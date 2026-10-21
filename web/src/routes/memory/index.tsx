import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BottomSheet } from '@/components/mobile/BottomSheet'
import { MoreHorizontalIcon } from '@/components/mobile/icons'
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
import type { MemoriesResponse, MemoryItem } from '@/types/api'
import { MemoryDetail, type MemoryEdit } from './MemoryDetail'
import { ACTION_LABEL, evidenceOf, formatWhen, LEVEL_LABEL, recentRows, scopeLabel, scopesInOrder, sourceLabel, trialLabel, type Level } from './model'

const MemoryGraph = lazy(() => import('./MemoryGraph'))

type Tab = 'recent' | Level | 'graph'

const MODE_HINT: Record<'off' | 'record', string> = {
    off: '不采集新记忆。',
    record: '从你自己的消息里提取，你说过的攒到 10 条通知你一次审批；agent 记的先观察，30 天内被提到 3 次才交给你，30 天没再出现就不记。只有你写的 MEMORY.md 和你通过的才生效；还不注入会话。'
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

function skippedSummary(reasons: Record<string, number>): string {
    return Object.entries(reasons).map(([reason, count]) => `${reason} ${count} 条`).join('、')
}

/** Memories captured from sessions, judged by Jev: recent captures, the three levels, and a graph. */
export function MemoryPage() {
    const isMobile = useIsMobileLayout()
    const { api } = useAppContext()
    const queryClient = useQueryClient()
    const [tab, setTab] = useState<Tab>('recent')
    const [openId, setOpenId] = useState<string | null>(null)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const [deleteId, setDeleteId] = useState<string | null>(null)
    const [notice, setNotice] = useState<string | null>(null)
    const [search, setSearch] = useState('')
    const [trialOpen, setTrialOpen] = useState(false)
    const [tagFilter, setTagFilter] = useState('')
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

    const empty = (
        <div className="space-y-4 rounded-2xl border border-dashed border-[var(--social-border)] px-5 py-8 text-center">
            <p className="text-[15px] text-[var(--social-fg)]">还没有记忆</p>
            <p className="text-[13px] leading-relaxed text-[var(--social-fg-muted)]">会话提交、导入 MEMORY.md 或收集 Claude 自带记忆后，会出现在这里。</p>
            <div className="flex justify-center gap-2">
                <Button variant="secondary" disabled={action.isPending} onClick={() => run(async () => {
                    const result = await api!.importMemoryMd()
                    setNotice(`MEMORY.md 里有 ${result.found} 条，交给 Jev 判断了 ${result.proposed} 条。`)
                })}>导入 MEMORY.md</Button>
                <Button variant="secondary" disabled={action.isPending} onClick={() => run(async () => {
                    const result = await api!.harvestClaudeMemories()
                    setNotice(`找到 ${result.checked} 个 Claude 记忆文件，新交给 Jev ${result.proposed} 条。`)
                })}>收集 Claude 记忆</Button>
            </div>
        </div>
    )

    const recent = () => {
        const rows = recentRows(data?.recent ?? [], memories)
        const skipped = data?.stats.skippedToday ?? 0
        if (memories.length === 0 && rows.length === 0) return empty
        return (
            <div className="space-y-6">
                {pending.length > 0 ? (
                    <ListGroup title={`等你审批 · ${pending.length}`}>
                        {pending.map((m) => (
                            <ListRow key={m.id} wrap title={<Clamp text={m.text} />} subtitle={[LEVEL_LABEL[m.level], scopeLabel(m.scope), m.source === 'user_message' ? sourceLabel(m) : m.reason ?? '等你审批'].join(' · ')} onClick={() => setOpenId(m.id)} />
                        ))}
                        <ListRow
                            title="全部通过"
                            subtitle="不想要的先点开选不记，剩下的一次通过"
                            wrap
                            disabled={action.isPending}
                            onClick={() => run(async () => {
                                const result = await api!.confirmAllMemoryItems(pending.map((m) => m.id))
                                setNotice(`通过了 ${result.confirmed} 条。`)
                            })}
                        />
                    </ListGroup>
                ) : null}
                {onTrial.length > 0 ? (
                    <ListGroup title={`观察中 · ${onTrial.length}`}>
                        {trialOpen ? onTrial.map((m) => (
                            <ListRow key={m.id} wrap title={<Clamp text={m.text} />} subtitle={`${LEVEL_LABEL[m.level]} · ${trialLabel(data?.trial[m.id])}`} onClick={() => setOpenId(m.id)} />
                        )) : null}
                        <ListRow
                            title={trialOpen ? '收起' : '展开'}
                            subtitle={trialOpen ? undefined : '不用你处理：agent 记的，30 天内被提到 3 次或你说过才交给你，30 天没再出现自动不记'}
                            wrap
                            onClick={() => setTrialOpen((value) => !value)}
                        />
                    </ListGroup>
                ) : null}
                {rows.length > 0 ? (
                    <div className="space-y-2">
                        <ListGroup title="最近">
                            {rows.map(({ event, memory }) => (
                                <ListRow
                                    key={event.id}
                                    wrap
                                    title={<Clamp text={memory?.text ?? event.text} />}
                                    subtitle={[ACTION_LABEL[event.action], memory ? LEVEL_LABEL[memory.level] : null, memory ? scopeLabel(memory.scope) : null, formatWhen(event.createdAt)].filter(Boolean).join(' · ')}
                                    onClick={memory ? () => setOpenId(memory.id) : undefined}
                                />
                            ))}
                        </ListGroup>
                        {skipped > 0 ? (
                            <p className="px-4 text-[13px] text-[var(--social-fg-muted)]">今天另有 {skipped} 条没记：{skippedSummary(data?.stats.skippedReasons ?? {})}。</p>
                        ) : null}
                    </div>
                ) : null}
            </div>
        )
    }

    const levelList = (level: Level) => {
        const ofLevel = memories.filter((m) => m.level === level)
        const levelTags = Array.from(new Set(ofLevel.flatMap((m) => m.tags))).sort((a, b) => a.localeCompare(b))
        const activeTag = levelTags.includes(tagFilter) ? tagFilter : ''
        const list = activeTag ? ofLevel.filter((m) => m.tags.includes(activeTag)) : ofLevel
        if (ofLevel.length === 0) return <p className="px-1 pt-6 text-center text-[13px] text-[var(--social-fg-muted)]">还没有{LEVEL_LABEL[level]}。</p>
        return (
            <div className="space-y-6">
                {levelTags.length > 0 ? (
                    <ChoiceChips
                        label="按标签筛选"
                        value={activeTag}
                        options={[{ value: '', label: '全部' }, ...levelTags.map((tag) => ({ value: tag, label: `#${tag}` }))]}
                        onChange={setTagFilter}
                        className="-mx-4 flex-nowrap overflow-x-auto px-4"
                    />
                ) : null}
                {scopesInOrder(list).map((scope) => (
                    <ListGroup key={scope || 'global'} title={scopeLabel(scope)}>
                        {list.filter((m) => m.scope === scope).map((m) => {
                            const backing = evidenceOf(m.id, links).length
                            return (
                                <ListRow
                                    key={m.id}
                                    wrap
                                    title={<Clamp text={m.text} />}
                                    subtitle={[backing ? `依据 ${backing} 条` : null, m.support > 1 ? `被提到 ${m.support} 次` : null, sourceLabel(m), m.tags.map((tag) => `#${tag}`).join(' ')].filter(Boolean).join(' · ')}
                                    trailing={m.status === 'pending' ? <Badge variant="warning">待审批</Badge> : m.status === 'candidate' ? <Badge>观察中</Badge> : undefined}
                                    onClick={() => setOpenId(m.id)}
                                />
                            )
                        })}
                    </ListGroup>
                ))}
            </div>
        )
    }

    const tabs: Array<{ value: Tab; label: string }> = [
        { value: 'recent', label: '最近' },
        { value: 'principle', label: `原则 ${count('principle')}` },
        { value: 'experience', label: `经验 ${count('experience')}` },
        { value: 'fact', label: `事实 ${count('fact')}` },
        { value: 'graph', label: '图谱' }
    ]

    const subtitle = data ? `今天新记 ${data.stats.addedToday} 条 · ${mode === 'off' ? '已关闭' : '只记录'}` : '加载中…'
    const settingsButton = (
        <IconButton label="记忆设置" onClick={() => setSettingsOpen(true)}>
            <MoreHorizontalIcon className="h-6 w-6" />
        </IconButton>
    )
    const desktopTitle = isMobile ? null : (
        <div className="flex items-center gap-2 pb-2 pt-6">
            <div className="min-w-0 flex-1">
                <h1 className="text-[20px] font-semibold leading-none tracking-[-0.035em] text-[var(--social-fg)]">记忆</h1>
                <p className="mt-2 text-[12px] leading-none text-[var(--social-fg-muted)]">{subtitle}</p>
            </div>
            {settingsButton}
        </div>
    )
    const chips = (sticky: boolean) => (
        <ChoiceChips
            label="视图"
            value={tab}
            options={tabs}
            onChange={setTab}
            className={sticky
                ? 'sticky top-0 z-10 -mx-4 flex-nowrap overflow-x-auto bg-[var(--social-surface)] px-4 py-2 [scrollbar-width:none]'
                : '-mx-4 flex-nowrap overflow-x-auto px-4 py-2 [scrollbar-width:none]'}
        />
    )

    const searchResults = () => {
        if (hits.isLoading || needle !== search.trim()) return <p className="pt-6 text-center text-[13px] text-[var(--social-fg-muted)]">正在搜索…</p>
        if (hits.error) return <p className="pt-6 text-center text-[13px] text-[var(--social-danger)]">搜索失败：{hits.error instanceof Error ? hits.error.message : '未知错误'}</p>
        const list = hits.data ?? []
        if (list.length === 0) return <p className="pt-6 text-center text-[13px] text-[var(--social-fg-muted)]">没有相关记忆。</p>
        return (
            <ListGroup title={`相关 · ${list.length}`}>
                {list.map((m) => (
                    <ListRow
                        key={m.id}
                        wrap
                        title={<Clamp text={m.text} />}
                        subtitle={[LEVEL_LABEL[m.level], scopeLabel(m.scope), m.status === 'pending' ? '等你审批' : m.status === 'candidate' ? '观察中' : null, `相关度 ${m.score.toFixed(2)}`].filter(Boolean).join(' · ')}
                        onClick={() => setOpenId(m.id)}
                    />
                ))}
            </ListGroup>
        )
    }

    const body = search.trim()
        ? searchResults()
        : query.isLoading
        ? <p className="pt-10 text-center text-[13px] text-[var(--social-fg-muted)]">加载中…</p>
        : query.error
            ? <p className="pt-10 text-center text-[13px] text-[var(--social-danger)]">记忆加载失败：{query.error instanceof Error ? query.error.message : '未知错误'}</p>
            : tab === 'recent' ? recent() : tab === 'graph' ? null : levelList(tab)

    const saveThen = (memory: MemoryItem, patch: MemoryEdit, then?: () => Promise<unknown>) => run(async () => {
        if (Object.keys(patch).length > 0) await api!.editMemoryItem(memory.id, patch)
        if (then) await then()
    }, () => setOpenId(null))

    const projects = data?.settings.projects ?? []

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
            {isMobile ? <MobilePageHeader title="记忆" subtitle={subtitle} actions={settingsButton} /> : null}
            {tab === 'graph' ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="mx-auto w-full max-w-content px-4">
                        {desktopTitle}
                        {chips(false)}
                    </div>
                    <div className="min-h-0 flex-1 px-4 pb-4 pt-1">
                        {memories.length === 0 ? empty : (
                            <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-[var(--social-fg-muted)]">正在加载图谱…</div>}>
                                <MemoryGraph memories={memories} links={links} onOpen={setOpenId} mobile={isMobile} />
                            </Suspense>
                        )}
                    </div>
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="mx-auto max-w-content px-4 pb-8">
                        {desktopTitle}
                        <div className="pt-2">
                            <MobileSearchField value={search} onChange={setSearch} placeholder="搜记忆：按意思找，中英文都行" />
                        </div>
                        {search.trim() ? null : chips(true)}
                        {notice ? <p className="px-1 pt-2 text-[13px] text-[var(--social-fg-muted)]">{notice}</p> : null}
                        <div className="pt-3">{body}</div>
                    </div>
                </div>
            )}
            {isMobile ? <MobileTabBar active="memory" /> : null}

            <BottomSheet open={Boolean(open)} onOpenChange={(value) => { if (!value) setOpenId(null) }} title={open?.status === 'pending' ? '等你审批' : '编辑记忆'}>
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
                        onMerge={(into) => run(() => api!.mergeMemoryItem(open.id, into), () => setOpenId(into))}
                        onDelete={() => setDeleteId(open.id)}
                    />
                ) : null}
            </BottomSheet>

            <ConfirmDialog
                isOpen={Boolean(deleteId)}
                onClose={() => setDeleteId(null)}
                title="删除这条记忆？"
                description="删除后不能恢复。它的关联也会一起去掉。"
                confirmLabel="删除"
                confirmingLabel="正在删除…"
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

            <BottomSheet open={settingsOpen} onOpenChange={setSettingsOpen} title="记忆设置">
                <div className="space-y-5 px-4 pb-6">
                    <div className="space-y-2">
                        <SegmentedControl
                            label="模式"
                            value={mode}
                            options={[{ value: 'off', label: '关' }, { value: 'record', label: '只记录' }]}
                            onChange={(next) => run(() => api!.updateMemoryCapture({ mode: next }))}
                        />
                        <FieldHint>{MODE_HINT[mode]} 注入会话放在第二期。</FieldHint>
                    </div>
                    <ListGroup title="采集的项目">
                        {(data?.settings.knownProjects ?? []).map((project) => (
                            <ListRow
                                key={project.name}
                                wrap
                                title={project.name}
                                subtitle={[project.path ? project.path.replace(/^\/Users\/[^/]+/, '~') : null, project.sessions ? `${project.sessions} 个会话` : null].filter(Boolean).join(' · ') || undefined}
                                trailing={(
                                    <Switch
                                        checked={projects.includes(project.name)}
                                        ariaLabel={`采集 ${project.name}`}
                                        onCheckedChange={(on) => run(() => api!.updateMemoryCapture({ projects: on ? [...projects, project.name] : projects.filter((p) => p !== project.name) }))}
                                    />
                                )}
                            />
                        ))}
                    </ListGroup>
                    <FieldHint>打开的项目，会话能提交记忆、会自动收集 Claude 记忆，内容会发给 Jev（经 OpenRouter 到 TypeSafe）判断。全局 MEMORY.md 不受这里限制。</FieldHint>
                    <ListGroup>
                        <ListRow title="Jev" trailing={data?.settings.jevReady ? '已连接' : '没有 key'} />
                        <ListRow title="Jev 准确率" trailing={`近 30 天 ${data?.stats.judged ?? 0} 次，你改了 ${data?.stats.corrected ?? 0} 次`} />
                        <ListRow title="导入 MEMORY.md" subtitle="把手写的全局记忆交给 Jev 判断" wrap disabled={action.isPending} onClick={() => run(async () => {
                            const result = await api!.importMemoryMd()
                            setNotice(`MEMORY.md 里有 ${result.found} 条，交给 Jev 判断了 ${result.proposed} 条。`)
                        })} />
                        <ListRow title="立即整理" subtitle="合并重复、被提到够多次的交给你审批、过期的不记；每 15 分钟也会自动整理一次" wrap disabled={action.isPending} onClick={() => run(async () => {
                            const r = await api!.maintainMemories()
                            setNotice(`整理完：合并重复 ${r.merged} 条，交给你审批 ${r.promoted} 条，不记 ${r.expired} 条，按新规则调整 ${r.moved} 条，建议升原则 ${r.offered} 条。`)
                        })} />
                        <ListRow title="立即读我的消息" subtitle="从你在上面开启的项目里发的消息提取，每 15 分钟也会自动读一次" wrap disabled={action.isPending} onClick={() => run(async () => {
                            const r = await api!.readUserMessagesForMemory()
                            setNotice(`读了 ${r.read} 条消息，${r.passed} 条讲了长期规则，提取 ${r.proposed} 条，花了 $${r.costUsd.toFixed(3)}。`)
                        })} />
                        <ListRow title="立即收集 Claude 记忆" subtitle="agent 自己记的，只进观察；只收上面开启的项目，每 15 分钟也会自动收一次" wrap disabled={action.isPending} onClick={() => run(async () => {
                            const result = await api!.harvestClaudeMemories()
                            setNotice(`找到 ${result.checked} 个 Claude 记忆文件，新交给 Jev ${result.proposed} 条。`)
                        })} />
                    </ListGroup>
                    {action.isPending ? <FieldHint>正在处理，Jev 每条约 0.4 秒…</FieldHint> : notice ? <FieldHint>{notice}</FieldHint> : null}
                </div>
            </BottomSheet>
        </div>
    )
}
