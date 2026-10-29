import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
    AgentTimeline,
    AtDetail,
    DetailSwitch,
    DetailText,
    PinnedShot,
    ReportBlock,
    ReportDetailProvider,
    SinceVisit,
    StoryCards,
    BarChart,
    CompareTable,
    EvidenceList,
    Checklist,
    DecisionCard,
    DecisionConfirmation,
    DecisionPeek,
    LeadComposer,
    ProgressList,
    ProgressOrb,
    CheckRing,
    ReportSummary,
    RiskNotice,
    SectionCaption,
    StatTiles,
    VerdictBar,
    type Decision,
    type LatestMessage,
    type ProgressItem,
    type TimelineAgent,
    type EvidenceItem
} from '@/components/report'

// Demo data for the showcase only. Business pages feed real hub data instead.

const DEMO_DECISION: Decision = {
    id: 'demo-pay',
    question: '旧支付接口还留着吗？',
    context: '新接口已经上线。老接口还有 3 家客户在调。',
    basis: ['近 7 天调用 4,213 次', '3 家客户都没回迁移邮件'],
    source: { seed: 'pay', name: '支付重构', meta: '等了 12 分钟' },
    options: [
        { label: '留一个月', good: '3 家客户不用改', cost: '多维护一个月，约 6 小时', recommended: true },
        { label: '现在删', good: '少 1,200 行代码', cost: '3 家客户要马上改对接' }
    ]
}

const DEMO_PEEK: Decision = {
    id: 'demo-speed',
    question: '首屏 2.8 秒，还要再优化吗？',
    source: { seed: 'speed', name: '首页提速', meta: '等了 40 分钟' },
    options: [{ label: '再优化半天', good: '预计能到 1.6 秒', cost: '上线推迟到周五' }]
}

const DEMO_PROGRESS: ProgressItem[] = [
    { id: 'pay', name: '支付重构', status: '等你定旧接口', tone: 'wait', done: 3, total: 5 },
    { id: 'voice', name: '语音输入', status: '在 iPhone 上试录音', tone: 'live', done: 2, total: 4 },
    { id: 'logs', name: '日志清理', status: '25 分钟没进展', tone: 'stuck', done: 1, total: 3 },
    { id: 'docs', name: '文档迁移', status: '做完了', tone: 'done', done: 3, total: 3, when: '10:42', unread: true }
]


const DEMO_TIMELINE: TimelineAgent[] = [
    { id: 'research', name: '研究员', model: 'Sonnet', tone: 'done', progress: 1,
        spans: [{ from: -40, to: -22, state: 'done', label: '竞品定价对比' }],
        steps: [{ from: -40, to: -33, state: 'done', label: '搜 5 家竞品' }, { from: -33, to: -26, state: 'done', label: '抓定价页' }, { from: -26, to: -22, state: 'done', label: '整理成表' }] },
    { id: 'writer', name: '写手', model: 'Opus', tone: 'wait', progress: 0.6, plan: { from: -21, to: -6 },
        spans: [{ from: -21, to: -12, state: 'done', label: '草拟文案' }, { from: -12, to: 0, state: 'wait', label: '等你选标题' }],
        steps: [{ from: -21, to: -16, state: 'done', label: '读竞品表' }, { from: -16, to: -12, state: 'done', label: '写 3 版标题' }, { from: -12, to: 0, state: 'wait', label: '等你选' }] },
    { id: 'eng', name: '工程师', model: 'GPT-6', tone: 'live', progress: 0.73, plan: { from: -25, to: -5 },
        spans: [{ from: -25, to: 0, state: 'live', label: '接入 Stripe · 测试 38/52' }],
        steps: [{ from: -25, to: -12, state: 'done', label: '接入 Stripe' }, { from: -12, to: 0, state: 'live', label: '跑测试' }] }
]

const DEMO_EVIDENCE: EvidenceItem[] = [
    { id: 'shot', kind: 'shot', title: '定价页手机版', meta: 'pricing-mobile.png', when: '2 分钟前', status: { label: '通过', tone: 'success' }, image: '/pwa-192x192.png' },
    { id: 'cmd', kind: 'command', title: '52 个测试，38 个通过', meta: 'bun test pricing', when: '4 分钟前', status: { label: '退出码 1', tone: 'destructive' },
        lines: ['✓ seat price rounds to cents', '✓ annual discount 20%', '✗ webhook retries on 502', '✗ proration on downgrade', '38 pass · 14 fail · 52 total'] },
    { id: 'link', kind: 'link', title: '按席位计费的官方说明', meta: 'stripe.com/docs', when: '2026-10', status: { label: '引用', tone: 'default' },
        quote: 'Per-seat pricing charges customers based on the number of users.', source: 'stripe.com · Billing' }
]

/** A drawn stand-in for a screenshot, so the showcase needs no image file. */
function DemoPricingShot() {
    return (
        <div className="grid grid-cols-3 gap-2 bg-[var(--social-hover)] p-4">
            {[['A 低价', '$8', '1 人免费'], ['B 中价', '$12', '3 人免费'], ['C 高价', '$20', '企业']].map(([name, price, note], i) => (
                <div key={name} className={i === 1 ? 'rounded-xl border-2 border-[var(--social-fg)] bg-[var(--social-surface)] p-3' : 'rounded-xl border border-[var(--social-border)] bg-[var(--social-surface)] p-3'}>
                    <div className="text-caption text-[var(--social-fg-muted)]">{name}</div>
                    <div className="text-title font-semibold text-[var(--social-fg)]">{price}</div>
                    <div className="text-caption text-[var(--social-fg-subtle)]">{note}</div>
                    <div className="mt-2 h-6 rounded-full bg-[var(--social-muted)]" />
                </div>
            ))}
        </div>
    )
}

const DEMO_PINS = [
    { x: 50, y: 12, label: '推荐方案加了黑框，第一眼落在这里' },
    { x: 84, y: 46, label: '高价方案的价格从 $25 降到 $20' },
    { x: 18, y: 82, label: '按钮在 390px 宽度下不再折行' }
]

function LessTextDemo() {
    return (
        <ReportDetailProvider initial="brief">
            <div className="flex flex-col gap-4">
                <DetailSwitch />
                <SinceVisit minutes={40} changed={['result', 'proof']} decisions={1}>
                    <ReportBlock id="result" title="结论">
                        <DetailText
                            brief="定价页能上线，只差你选一个标题方向。"
                            points={['验收 6 条达到 5 条', '测试 52 个，38 个通过，失败的都在退款流程', '预计周五上线，比计划晚 1 天']}
                            full="失败的 14 个测试都和降级退款有关，工程师判断是同一个舍入问题，预计 30 分钟修完。标题方向不影响上线时间，但会影响首屏文案。"
                        />
                        <AtDetail from="points">
                            <div className="pt-1"><StatTiles stats={[{ value: '5/6', label: '验收达到' }, { value: '38/52', label: '测试通过' }, { value: '周五', label: '预计上线' }]} /></div>
                        </AtDetail>
                    </ReportBlock>
                    <ReportBlock id="progress" title="进度">
                        <ProgressList items={DEMO_PROGRESS.slice(0, 3)} onOpen={() => {}} />
                    </ReportBlock>
                    <ReportBlock id="proof" title="证据">
                        <DetailText brief="手机版定价页改了 3 处，点数字看。" />
                        <PinnedShot pins={DEMO_PINS} caption="定价页 · 390px · 2 分钟前">
                            <DemoPricingShot />
                        </PinnedShot>
                    </ReportBlock>
                </SinceVisit>
            </div>
        </ReportDetailProvider>
    )
}

function StoryDemo() {
    const [open, setOpen] = useState(true)
    return (
        <div className="mx-auto h-[620px] w-full max-w-[380px] overflow-hidden rounded-[28px] border border-[var(--social-border)]">
            {open ? (
                <StoryCards
                    title="发布新定价页"
                    seed="pricing"
                    onClose={() => setOpen(false)}
                    stories={[
                        { id: 's1', label: '结论', content: <div className="flex flex-col gap-4"><p className="m-0 text-title font-semibold leading-snug text-[var(--social-fg)]">能上线，只差你选标题方向。</p><StatTiles stats={[{ value: '5/6', label: '验收' }, { value: '38/52', label: '测试' }, { value: '周五', label: '上线' }]} /></div> },
                        { id: 's2', label: '等你', content: <div className="flex flex-col gap-3"><p className="m-0 text-title font-semibold leading-snug text-[var(--social-fg)]">1 件等你拍板</p><DecisionPeek decision={DEMO_PEEK} onOpen={() => {}} /></div> },
                        { id: 's3', label: '进度', content: <div className="flex flex-col gap-3"><p className="m-0 text-title font-semibold leading-snug text-[var(--social-fg)]">3 件在跑，1 件卡住</p><ProgressList items={DEMO_PROGRESS} onOpen={() => {}} /></div> },
                        { id: 's4', label: '证据', content: <div className="flex flex-col gap-3"><p className="m-0 text-title font-semibold leading-snug text-[var(--social-fg)]">改了 3 处，点数字看</p><PinnedShot pins={DEMO_PINS}><DemoPricingShot /></PinnedShot></div> }
                    ]}
                />
            ) : (
                <div className="flex h-full items-center justify-center">
                    <Button onClick={() => setOpen(true)}>再看一遍</Button>
                </div>
            )}
        </div>
    )
}

function Spec(props: { label: string; children: ReactNode }) {
    return (
        <div className="flex flex-col gap-2">
            <div className="text-caption font-semibold uppercase tracking-wide text-[var(--social-fg-muted)]">{props.label}</div>
            {props.children}
        </div>
    )
}

export function ReportKitSection() {
    const [answered, setAnswered] = useState<string | null>(null)
    const [draft, setDraft] = useState('')
    const [latest, setLatest] = useState<LatestMessage>({ from: 'lead', text: '支付的回归测试还要 20 分钟。跑完我先发报告，再等你定旧接口。', when: '2 分钟前' })
    const [verdict, setVerdict] = useState<string | null>(null)

    return (
        <div className="grid gap-6 lg:grid-cols-2">
            <Spec label="DecisionCard · 等用户拍板的决策卡（可交互）">
                <div className="flex flex-col gap-2">
                    {answered ? <DecisionConfirmation label={answered} /> : (
                        <DecisionCard decision={DEMO_DECISION} showSource onAnswer={(option) => setAnswered(option.label)} onAsk={() => {}} />
                    )}
                    <DecisionPeek decision={DEMO_PEEK} onOpen={() => setAnswered(null)} />
                </div>
            </Spec>

            <div className="flex flex-col gap-6">
                <Spec label="ReportSummary + StatTiles · 结论先行">
                    <div className="rounded-2xl border border-[var(--social-border)] pb-4">
                        <ReportSummary
                            headline="6 件里 2 件做完，2 件等你拍板。"
                            lede="预计周五全部做完，比计划晚 1 天。"
                            stats={[
                                { value: '周五', label: '预计做完' },
                                { value: '1 件', label: '卡住' },
                                { value: '¥38', label: '已花，预算 120' }
                            ]}
                        />
                    </div>
                </Spec>

                <Spec label="ProgressList · 全部目标的紧凑进度">
                    <SectionCaption>进度</SectionCaption>
                    <ProgressList items={DEMO_PROGRESS} onOpen={() => {}} />
                </Spec>
            </div>

            <Spec label="Checklist · 验收点清单（live 行可点开详情）">
                <Checklist
                    items={[
                        { title: '新接口能下单', state: 'done', trailing: '09:12' },
                        { title: '回归测试', state: 'live', trailing: '142 / 180', onClick: () => {} },
                        { title: '灰度上线', state: 'wait', waiting: true },
                        { title: '写上线公告', state: 'todo' }
                    ]}
                />
            </Spec>

            <Spec label="RiskNotice · 风险卡">
                <RiskNotice
                    risks={[
                        '日志清理 25 分钟没进展。负责人在查，可能是磁盘权限。',
                        '首页提速如果再优化，上线推迟到周五。'
                    ]}
                />
            </Spec>

            <Spec label="ProgressOrb / CheckRing · 状态指示">
                <div className="flex flex-wrap items-center gap-5">
                    <ProgressOrb seed="pay" size={40} progress={0.6} tone="wait" />
                    <ProgressOrb seed="voice" size={40} progress={0.5} tone="live" />
                    <ProgressOrb seed="logs" size={40} progress={0.33} tone="stuck" />
                    <ProgressOrb seed="docs" size={40} progress={1} tone="done" />
                    <CheckRing state="done" />
                    <CheckRing state="live" />
                    <CheckRing state="wait" />
                    <CheckRing state="todo" />
                </div>
            </Spec>

            <Spec label="少写字 · 详略三档 + 你离开后变了什么 + 截图钉注">
                <LessTextDemo />
            </Spec>

            <Spec label="StoryCards · 手机上一张张翻（点右边继续，点左边回去，也能左右滑）">
                <StoryDemo />
            </Spec>

            <Spec label="AgentTimeline · 谁在做什么，同一条时间轴（可切换结论 / 步骤）">
                <AgentTimeline agents={DEMO_TIMELINE} onDecide={() => {}} />
            </Spec>

            <Spec label="BarChart + CompareTable · 标题即结论；推荐列">
                <div className="flex flex-col gap-3">
                    <BarChart
                        title="竞品月费中位数 $12，我们定 $12，卡在中间"
                        lede="5 家竞品单人月费 · 研究员 22 分钟前整理"
                        format={(v) => `$${v}`}
                        data={[{ label: '竞品 1', value: 8 }, { label: '竞品 2', value: 10 }, { label: '竞品 3', value: 12 }, { label: '竞品 4', value: 15 }, { label: '竞品 5', value: 20 }, { label: '我们', value: 12, highlight: true }]}
                    />
                    <CompareTable
                        title="三种方案"
                        columns={[{ id: 'a', label: 'A 低价' }, { id: 'b', label: 'B 中价', recommended: true }, { id: 'c', label: 'C 高价' }]}
                        rows={[
                            { label: '单人月费', values: { a: '$8', b: '$12', c: '$20' }, numeric: true },
                            { label: '年付折扣', values: { a: '无', b: '20%', c: '20%' } },
                            { label: '免费人数', values: { a: '1', b: '3', c: '无' }, numeric: true },
                            { label: '适合', values: { a: '个人', b: '小团队', c: '企业' } }
                        ]}
                    />
                </div>
            </Spec>

            <Spec label="EvidenceList · 证据，一行一条，点开看截图 / 输出 / 原文">
                <EvidenceList items={DEMO_EVIDENCE} />
            </Spec>

            <Spec label="LeadComposer + VerdictBar · 底部对话与验收">
                <div className="overflow-hidden rounded-2xl border border-[var(--social-border)]">
                    <LeadComposer
                        latest={latest}
                        draft={draft}
                        onDraft={setDraft}
                        allChatsHref="#"
                        onSend={() => {
                            const text = draft.trim()
                            if (!text) return
                            setDraft('')
                            setLatest({ from: 'me', text, when: '刚刚' })
                        }}
                    />
                    <VerdictBar
                        verdict={verdict}
                        onApprove={() => setVerdict('已通过')}
                        onRequestChanges={() => setVerdict('说一下要改哪里')}
                    />
                </div>
            </Spec>
        </div>
    )
}
