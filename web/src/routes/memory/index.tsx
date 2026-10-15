import { lazy, Suspense, useMemo, useState } from 'react'
import { BottomSheet } from '@/components/mobile/BottomSheet'
import { MoreHorizontalIcon } from '@/components/mobile/icons'
import { MobilePageHeader, MobileTabBar } from '@/components/mobile/MobileTabBar'
import { Badge } from '@/components/ui/badge'
import { ChoiceChips, FieldHint, SegmentedControl } from '@/components/ui/FormControls'
import { IconButton } from '@/components/ui/IconButton'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { useIsMobileLayout } from '@/hooks/useIsMobileLayout'
import { MemoryDetail } from './MemoryDetail'
import { findMemory, GLOBAL_SCOPE, LEVEL_LABEL, MEMORIES, RECENT, SKIPPED_TODAY, STATS, type Level, type Memory } from './mock'

const MemoryGraph = lazy(() => import('./MemoryGraph'))

type Tab = 'recent' | Level | 'graph'
type Mode = 'off' | 'record' | 'auto'

const MODE_LABEL: Record<Mode, string> = { off: '已关闭', record: '只记录', auto: '自动' }
const MODE_HINT: Record<Mode, string> = {
    off: '不采集新记忆。',
    record: 'Jev 判断后列在这里，你可以改；还不注入会话。',
    auto: 'Jev 有把握的直接生效；原则仍要你确认。'
}

function scopesOf(list: Memory[]): string[] {
    const projects = Array.from(new Set(list.map((m) => m.scope).filter((s) => s !== GLOBAL_SCOPE)))
    return list.some((m) => m.scope === GLOBAL_SCOPE) ? [GLOBAL_SCOPE, ...projects] : projects
}

/** Prototype memory page (mock data): recent captures with Jev's call, the three levels, a small graph. */
export function MemoryPage() {
    const isMobile = useIsMobileLayout()
    const params = useMemo(() => new URLSearchParams(window.location.search), [])
    const [tab, setTab] = useState<Tab>((params.get('tab') as Tab | null) ?? 'recent')
    const [openId, setOpenId] = useState<string | null>(params.get('m'))
    const [settingsOpen, setSettingsOpen] = useState(params.get('settings') === '1')
    const [mode, setMode] = useState<Mode>('record')

    const pending = MEMORIES.filter((m) => m.status === 'pending')
    const open = openId ? findMemory(openId) : undefined
    const count = (level: Level) => MEMORIES.filter((m) => m.level === level && m.status === 'active').length

    const recent = (
        <div className="space-y-6">
            <ListGroup title={`等你确认 · ${pending.length}`}>
                {pending.map((m) => (
                    <ListRow key={m.id} wrap title={m.text} subtitle={`${LEVEL_LABEL[m.level]} · ${m.reason}`} onClick={() => setOpenId(m.id)} />
                ))}
            </ListGroup>
            <div className="space-y-2">
                <ListGroup title="最近">
                    {RECENT.filter(({ id }) => findMemory(id)?.status !== 'pending').map(({ id, action }) => {
                        const m = findMemory(id)
                        if (!m) return null
                        return (
                            <ListRow
                                key={id}
                                wrap
                                title={m.text}
                                subtitle={`${action} · ${LEVEL_LABEL[m.level]} · ${m.scope} · ${m.at}`}
                                onClick={() => setOpenId(id)}
                            />
                        )
                    })}
                </ListGroup>
                <p className="px-4 text-[13px] text-[var(--social-fg-muted)]">今天另有 {SKIPPED_TODAY.total} 条没记：{SKIPPED_TODAY.detail}。</p>
            </div>
        </div>
    )

    const levelList = (level: Level) => {
        const list = MEMORIES.filter((m) => m.level === level)
        return (
            <div className="space-y-6">
                {scopesOf(list).map((scope) => (
                    <ListGroup key={scope} title={scope}>
                        {list.filter((m) => m.scope === scope).map((m) => (
                            <ListRow
                                key={m.id}
                                wrap
                                title={m.text}
                                subtitle={level === 'fact' ? m.source : `${m.evidence?.length ? `依据 ${m.evidence.length} 条 · ` : ''}${m.source}`}
                                trailing={m.status === 'pending' ? <Badge variant="warning">待确认</Badge> : undefined}
                                onClick={() => setOpenId(m.id)}
                            />
                        ))}
                    </ListGroup>
                ))}
            </div>
        )
    }

    const body = tab === 'recent' ? recent : tab === 'graph' ? null : levelList(tab)

    const tabs: Array<{ value: Tab; label: string }> = [
        { value: 'recent', label: '最近' },
        { value: 'principle', label: `原则 ${count('principle')}` },
        { value: 'experience', label: `经验 ${count('experience')}` },
        { value: 'fact', label: `事实 ${count('fact')}` },
        { value: 'graph', label: '图谱' }
    ]

    const subtitle = `今天新记 ${STATS.addedToday} 条 · ${MODE_LABEL[mode]}`
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

    const page = (
        <div className="flex h-full min-h-0 flex-col bg-[var(--social-surface)]">
            {isMobile ? (
                <MobilePageHeader title="记忆" subtitle={subtitle} actions={settingsButton} />
            ) : null}
            {tab === 'graph' ? (
                <div className="flex min-h-0 flex-1 flex-col">
                    <div className="mx-auto w-full max-w-content px-4">
                        {desktopTitle}
                        <ChoiceChips label="视图" value={tab} options={tabs} onChange={setTab} className="-mx-4 flex-nowrap overflow-x-auto px-4 py-2 [scrollbar-width:none]" />
                    </div>
                    <div className="min-h-0 flex-1 px-4 pb-4 pt-1">
                        <Suspense fallback={<div className="flex h-full items-center justify-center text-[13px] text-[var(--social-fg-muted)]">正在加载图谱…</div>}>
                            <MemoryGraph onOpen={setOpenId} mobile={isMobile} />
                        </Suspense>
                    </div>
                </div>
            ) : (
                <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="mx-auto max-w-content px-4 pb-8">
                        {desktopTitle}
                        <ChoiceChips label="视图" value={tab} options={tabs} onChange={setTab} className="sticky top-0 z-10 -mx-4 flex-nowrap overflow-x-auto bg-[var(--social-surface)] px-4 py-2 [scrollbar-width:none]" />
                        <div className="pt-3">{body}</div>
                    </div>
                </div>
            )}
            {isMobile ? <MobileTabBar active="memory" /> : null}

            <BottomSheet open={Boolean(open)} onOpenChange={(value) => { if (!value) setOpenId(null) }} title={open?.status === 'pending' ? '等你确认' : '编辑记忆'}>
                {open ? <MemoryDetail key={open.id} memory={open} onOpen={setOpenId} onDone={() => setOpenId(null)} /> : null}
            </BottomSheet>

            <BottomSheet open={settingsOpen} onOpenChange={setSettingsOpen} title="记忆设置">
                <div className="space-y-5 px-4 pb-6">
                    <div className="space-y-2">
                        <SegmentedControl
                            label="模式"
                            value={mode}
                            options={[{ value: 'off', label: '关' }, { value: 'record', label: '只记录' }, { value: 'auto', label: '自动' }]}
                            onChange={setMode}
                        />
                        <FieldHint>{MODE_HINT[mode]}</FieldHint>
                    </div>
                    <ListGroup>
                        <ListRow title="Jev 准确率" trailing={`最近 ${STATS.jevRecent} 次，你改了 ${STATS.corrected} 次`} />
                        <ListRow title="发给 Jev 的内容" trailing="今天 38 条" onClick={() => {}} />
                        <ListRow title="导入现有记忆" subtitle="MEMORY.md、各账号的 Claude 记忆" wrap onClick={() => {}} />
                    </ListGroup>
                </div>
            </BottomSheet>
        </div>
    )

    return page
}
