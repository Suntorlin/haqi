import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'
import { Chip } from '@/components/ui/Chip'
import { Badge, CountBadge, DotBadge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/Switch'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { CheckRow } from '@/components/ui/CheckRow'
import { SegmentedControl } from '@/components/ui/FormControls'
import { SwitchChip } from '@/components/ui/SettingChip'
import { CONTEXT_MENU_SURFACE, ContextMenuItem } from '@/components/mobile/ContextMenu'
import {
    ClearIcon,
    CloseIcon,
    ExternalLinkIcon,
    FileIcon,
    GlobeIcon,
    PlusIcon,
    RefreshIcon,
    SendArrowIcon,
    SlidersIcon,
    TerminalIcon
} from '@/components/mobile/icons'

function Section(props: { title: string; note?: string; children: ReactNode }) {
    return (
        <section className="flex flex-col gap-4 border-t border-[var(--social-border)] pt-8">
            <div>
                <h2 className="text-[20px] font-semibold tracking-[-0.01em]">{props.title}</h2>
                {props.note ? <p className="mt-1 max-w-2xl text-[14px] text-[var(--social-fg-muted)]">{props.note}</p> : null}
            </div>
            {props.children}
        </section>
    )
}

function Spec(props: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-2">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{props.label}</div>
            {props.children}
        </div>
    )
}

const SWATCHES: Array<[string, string, string]> = [
    ['--social-surface', '页面底色', 'bg-[var(--social-surface)]'],
    ['--social-muted', '次级填充 / 输入栏', 'bg-[var(--social-muted)]'],
    ['--social-hover', '悬停 / 分组底', 'bg-[var(--social-hover)]'],
    ['--social-border', '边框', 'bg-[var(--social-border)]'],
    ['--social-divider', '行内分隔线', 'bg-[var(--social-divider)]'],
    ['--social-fg', '主文字', 'bg-[var(--social-fg)]'],
    ['--social-fg-muted', '次要文字', 'bg-[var(--social-fg-muted)]'],
    ['--social-fg-subtle', '占位 / 图标', 'bg-[var(--social-fg-subtle)]'],
    ['--social-primary', '主按钮', 'bg-[var(--social-primary)]'],
    ['--social-badge', '未读徽标 (品牌红)', 'bg-[var(--social-badge)]'],
    ['--social-danger', '危险', 'bg-[var(--social-danger)]'],
    ['--social-success', '成功', 'bg-[var(--social-success)]']
]

const RADII: Array<[string, string, string, string]> = [
    ['full', '9999', '胶囊 · 按钮 · 地址栏 · 头像 · 标签', 'rounded-full'],
    ['2xl', '16', '卡片 · 面板 · 弹层 · 分组列表', 'rounded-2xl'],
    ['xl', '12', '表单输入框 · 列表行', 'rounded-xl'],
    ['md', '8', '小标签 · 代码块', 'rounded-md']
]

const TYPE: Array<[string, string, string]> = [
    ['text-[20px] font-semibold', '20 / 600', '区块标题'],
    ['text-[16px] font-semibold', '16 / 600', '页面标题 · 输入框文字'],
    ['text-[15px]', '15 / 400', '正文 · 列表行标题'],
    ['text-[13px]', '13 / 400', '次要说明 · 按钮(小) · 标签'],
    ['text-[12px] font-semibold uppercase tracking-wide', '12 / 600', '分组标题 · 辅助']
]

export function DesignShowcase() {
    const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a')
    const [chip, setChip] = useState('all')
    const [on, setOn] = useState(true)
    const [direct, setDirect] = useState(true)
    const [kept, setKept] = useState<Record<string, boolean>>({ a: true, b: true, c: false })
    const [url, setUrl] = useState('http://localhost:3000/')

    return (
        <div className="mx-auto flex max-w-[1120px] flex-col gap-10 px-5 py-10 text-[var(--social-fg)]">
            <header>
                <div className="text-[12px] font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">HAQI Design System · v1 草案</div>
                <h1 className="mt-1 text-[32px] font-semibold tracking-[-0.02em]">视觉取 Instagram，交互守 Apple HIG</h1>
                <p className="mt-2 max-w-2xl text-[15px] text-[var(--social-fg-muted)]">
                    黑白灰为底、胶囊与大圆角、克制的层级（Instagram）；44px 触控目标、16px 输入字号、4/8 间距、150–200ms 动效（Apple HIG）。
                    所有业务页面只允许用下面这些基础件，不再手写 <code className="rounded-md bg-[var(--social-muted)] px-1.5 py-0.5 text-[13px]">rounded-xl border px-3</code>。
                </p>
            </header>

            <Section title="1 · 颜色 Token" note="--social-* 是唯一来源；旧的 --app-* 全部改为别名指向它，Telegram 主题变量已移除。亮 / 暗两套同名。">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {SWATCHES.map(([name, label, cls]) => (
                        <div key={name} className="overflow-hidden rounded-2xl border border-[var(--social-border)]">
                            <div className={`h-14 ${cls}`} />
                            <div className="px-3 py-2">
                                <div className="text-[13px] font-semibold">{label}</div>
                                <div className="truncate text-[11px] text-[var(--social-fg-muted)]">{name}</div>
                            </div>
                        </div>
                    ))}
                </div>
            </Section>

            <Section title="2 · 圆角 · 字号 · 触控" note="圆角只有四档；字号 12/13/15/16 + 20/32 标题，字重只用 400 与 600；任何可点元素的点击区不小于 44px。">
                <div className="grid gap-6 sm:grid-cols-2">
                    <Spec label="圆角 4 档">
                        <div className="flex flex-col gap-2">
                            {RADII.map(([name, px, use, cls]) => (
                                <div key={name} className="flex items-center gap-3">
                                    <div className={`h-11 w-16 shrink-0 border border-[var(--social-fg-subtle)] bg-[var(--social-muted)] ${cls}`} />
                                    <div className="min-w-0">
                                        <div className="text-[14px] font-semibold">{name} <span className="font-normal text-[var(--social-fg-muted)]">{px}px</span></div>
                                        <div className="truncate text-[12px] text-[var(--social-fg-muted)]">{use}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Spec>
                    <Spec label="字号 / 字重">
                        <div className="flex flex-col gap-2">
                            {TYPE.map(([cls, spec, use]) => (
                                <div key={spec} className="flex items-baseline justify-between gap-3 border-b border-[var(--social-divider)] pb-2">
                                    <span className={cls}>HAQI 远程协作 Aa</span>
                                    <span className="shrink-0 text-[12px] text-[var(--social-fg-muted)]">{spec} · {use}</span>
                                </div>
                            ))}
                        </div>
                    </Spec>
                </div>
            </Section>

            <Section title="3 · 按钮 Button / IconButton" note="胶囊形，默认 44px（手机触控）；sm 36px 给桌面工具栏。一个视图只放一个实心主按钮；破坏性操作用红色实心，仅出现在确认框里。">
                <div className="grid gap-6 sm:grid-cols-2">
                    <Spec label="变体 · 默认 44px">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button>主要</Button>
                            <Button variant="secondary">次要</Button>
                            <Button variant="outline">描边</Button>
                            <Button variant="ghost">文字</Button>
                            <Button variant="destructive">删除</Button>
                        </div>
                    </Spec>
                    <Spec label="尺寸 · lg 48 / 默认 44 / sm 36">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button size="lg">大按钮</Button>
                            <Button>默认</Button>
                            <Button size="sm">小按钮</Button>
                            <Button size="sm" variant="secondary">小次要</Button>
                        </div>
                    </Spec>
                    <Spec label="带图标 / 禁用">
                        <div className="flex flex-wrap items-center gap-2">
                            <Button><PlusIcon className="h-4 w-4" />新建会话</Button>
                            <Button variant="secondary"><ExternalLinkIcon className="h-4 w-4" />新窗口打开</Button>
                            <Button disabled>不可用</Button>
                        </div>
                    </Spec>
                    <Spec label="IconButton · 44 / 36 · 必须带 label">
                        <div className="flex flex-wrap items-center gap-2">
                            <IconButton label="刷新"><RefreshIcon className="h-[18px] w-[18px]" /></IconButton>
                            <IconButton label="设置" variant="muted"><SlidersIcon className="h-[18px] w-[18px]" /></IconButton>
                            <IconButton label="发送" variant="filled"><SendArrowIcon className="h-[18px] w-[18px]" /></IconButton>
                            <IconButton label="关闭" size="sm"><CloseIcon className="h-4 w-4" /></IconButton>
                            <IconButton label="发送" size="sm" variant="filled"><SendArrowIcon className="h-4 w-4" /></IconButton>
                        </div>
                    </Spec>
                </div>
            </Section>

            <Section title="4 · 输入 TextField" note="44px 高、16px 字（小于 16px iOS 会自动放大页面）。field 是带边框的表单输入；pill 是无边框的地址栏 / 搜索栏，左右可放图标与按钮。">
                <div className="grid gap-6 sm:grid-cols-2">
                    <Spec label="field · 默认 / 错误 / 禁用">
                        <div className="flex flex-col gap-2">
                            <TextField placeholder="会话名称" />
                            <TextField defaultValue="not a url" invalid />
                            <TextField placeholder="不可编辑" disabled />
                        </div>
                    </Spec>
                    <Spec label="pill · 地址栏 / 搜索">
                        <div className="flex flex-col gap-2">
                            <TextField
                                variant="pill"
                                value={url}
                                onChange={(event) => setUrl(event.target.value)}
                                leading={<GlobeIcon className="h-4 w-4" />}
                                trailing={(
                                    <>
                                        <IconButton label="清除" size="sm"><ClearIcon className="h-4 w-4" /></IconButton>
                                        <IconButton label="刷新" size="sm"><RefreshIcon className="h-4 w-4" /></IconButton>
                                    </>
                                )}
                            />
                            <TextField
                                variant="pill"
                                placeholder="搜索会话"
                                leading={<GlobeIcon className="h-4 w-4" />}
                            />
                        </div>
                    </Spec>
                </div>
            </Section>

            <Section title="5 · 选择 · 标签 · 开关" note="Chip 32px 胶囊，选中变黑底；分段控件用于 2–3 个互斥选项；开关保持单色。">
                <div className="grid gap-6 sm:grid-cols-2">
                    <Spec label="Chip（单选 / 筛选）">
                        <div className="flex flex-wrap gap-2">
                            {['all', 'claude', 'codex', 'gemini'].map((id) => (
                                <Chip key={id} selected={chip === id} onClick={() => setChip(id)}>{id}</Chip>
                            ))}
                        </div>
                    </Spec>
                    <Spec label="SegmentedControl">
                        <SegmentedControl
                            label="demo"
                            value={seg}
                            onChange={setSeg}
                            options={[{ value: 'a', label: '本地' }, { value: 'b', label: '远程' }, { value: 'c', label: '混合' }]}
                        />
                    </Spec>
                    <Spec label="Badge · 状态胶囊（柔和底色、无描边，可带状态点）">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge>默认</Badge>
                            <Badge variant="solid">新</Badge>
                            <Badge variant="info" dot>同步中</Badge>
                            <Badge variant="success" dot live>运行中</Badge>
                            <Badge variant="warning" dot>待确认</Badge>
                            <Badge variant="destructive" dot>失败</Badge>
                        </div>
                    </Spec>
                    <Spec label="CountBadge / DotBadge · 未读（Instagram 红，贴在头像或图标右上角）">
                        <div className="flex items-center gap-6">
                            {[3, 28, 120].map((n) => (
                                <div key={n} className="relative">
                                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--social-muted)] text-[15px] font-semibold">AI</div>
                                    <CountBadge count={n} className="absolute -right-1 -top-1" />
                                </div>
                            ))}
                            <div className="relative">
                                <IconButton label="消息" variant="muted"><TerminalIcon className="h-[18px] w-[18px]" /></IconButton>
                                <DotBadge className="absolute right-0.5 top-0.5" />
                            </div>
                        </div>
                    </Spec>
                    <Spec label="Switch">
                        <div className="flex items-center gap-3">
                            <Switch checked={on} onCheckedChange={setOn} ariaLabel="demo" />
                            <span className="text-[14px] text-[var(--social-fg-muted)]">{on ? '开' : '关'}</span>
                        </div>
                    </Spec>
                </div>
            </Section>

            <Section title="6 · 列表 ListGroup / ListRow" note="iOS 分组列表：16px 圆角容器 + 行间 hairline，行高 ≥52px，可点的行右侧加 chevron。用于设置、会话详情、账号管理。">
                <div className="max-w-md">
                    <ListGroup title="会话">
                        <ListRow icon={<TerminalIcon className="h-[18px] w-[18px]" />} title="终端" subtitle="在右侧打开" onClick={() => undefined} />
                        <ListRow icon={<GlobeIcon className="h-[18px] w-[18px]" />} title="预览" trailing="localhost:3000" onClick={() => undefined} />
                        <ListRow icon={<FileIcon className="h-[18px] w-[18px]" />} title="文件" onClick={() => undefined} />
                        <ListRow title="通知" trailing={<Switch checked={on} onCheckedChange={setOn} ariaLabel="notify" />} />
                        <ListRow title="归档会话" destructive onClick={() => undefined} />
                    </ListGroup>
                </div>
                <div className="max-w-md">
                    <p className="pb-2 text-[13px] text-[var(--social-fg-muted)]">CheckRow：可勾选的行（引导步骤里的验收标准）。取消勾选后划线但仍可见；点文字可改。</p>
                    <div className="overflow-hidden rounded-2xl border border-[var(--social-border)] px-2">
                        {[
                            { id: 'a', text: 'bun run test 全部通过', how: '验证：bun run test', source: '仓库约定', warn: false },
                            { id: 'b', text: '报告结论先行，带关键数字', how: '验证：看报告第一段', source: '你的原则', warn: false },
                            { id: 'c', text: '引导面板 3 秒内出现', how: '验证：Playwright 计时', source: '本次推断', warn: true }
                        ].map((row) => (
                            <CheckRow
                                key={row.id}
                                checked={kept[row.id] ?? false}
                                onCheckedChange={(checked) => setKept((current) => ({ ...current, [row.id]: checked }))}
                                label={row.text}
                                title={row.text}
                                subtitle={row.how}
                                onEdit={() => undefined}
                                editLabel="改这一行"
                                trailing={<Badge variant={row.warn ? 'warning' : 'default'}>{row.source}</Badge>}
                            />
                        ))}
                    </div>
                </div>
            </Section>

            <Section title="7 · 浮层 · 一键切换 · 停靠面板" note="浮层只有两种：菜单（CONTEXT_MENU_SURFACE，下拉与右键菜单）和浮层卡片（.social-float-card，会话信息）。二选一的设置用 SwitchChip，点一下就切换。终端 / 预览在桌面端停靠在聊天左右，默认右侧。">
                <div className="grid gap-6 md:grid-cols-3">
                    <Spec label="SwitchChip · 点一下切换">
                        <SwitchChip title="发送方式" valueLabel={`发送 · ${direct ? '直发' : '排队'}`} onToggle={() => setDirect((value) => !value)} />
                    </Spec>
                    <Spec label="菜单 · 下拉（最近路径、历史地址）">
                        <div className={`${CONTEXT_MENU_SURFACE} max-w-xs`}>
                            <ContextMenuItem label="~/projects/haqi" onSelect={() => undefined} />
                            <ContextMenuItem label="~/dev/fish" onSelect={() => undefined} />
                        </div>
                    </Spec>
                    <Spec label="浮层卡片 .social-float-card">
                        <div className="social-float-card max-w-xs rounded-3xl p-4 text-[13px] text-[var(--social-fg)]">
                            悬浮在内容之上，半透明加模糊；只用于锚在按钮下方的小卡片。
                        </div>
                    </Spec>
                </div>
            </Section>
        </div>
    )
}
