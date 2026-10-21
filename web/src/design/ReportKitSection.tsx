import { useState, type ReactNode } from 'react'
import {
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
    type ProgressItem
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
