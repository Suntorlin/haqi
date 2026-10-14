import { useState } from 'react'
import { cn } from '@/lib/utils'
import { CRITERIA_SCOPE, HEALTH, JEV_QUESTIONS, REPLAY_DIFF, SCOPE_CALIBRATION } from './mock'
import { Panel, PrimaryButton, Segmented } from './ui'

function coverageAt(threshold: number) {
    const above = SCOPE_CALIBRATION.filter(([confidence]) => confidence >= threshold)
    const correct = above.filter(([, ok]) => ok === 1).length
    return {
        coverage: above.length / SCOPE_CALIBRATION.length,
        precision: above.length ? correct / above.length : 1,
        n: above.length
    }
}

const BUCKETS = [
    { from: 0, to: 0.4 },
    { from: 0.4, to: 0.6 },
    { from: 0.6, to: 0.8 },
    { from: 0.8, to: 1.01 }
]

/** Reliability chart: accuracy of "which layer" by confidence bucket, plus the auto-write threshold. */
export function CalibrationPanel() {
    const [threshold, setThreshold] = useState(0.6)
    const stats = coverageAt(threshold)
    const buckets = BUCKETS.map((bucket) => {
        const rows = SCOPE_CALIBRATION.filter(([c]) => c >= bucket.from && c < bucket.to)
        const acc = rows.length ? rows.filter(([, ok]) => ok === 1).length / rows.length : 0
        return { ...bucket, n: rows.length, acc }
    })
    return (
        <Panel title="置信度校准 · “放哪一层”" actions={<span className="text-[11px] text-[var(--social-fg-muted)]">离线 104 次（52 条 × 2 种选项顺序）</span>}>
            <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
                <div>
                    <div className="flex h-[132px] items-end gap-3 border-b border-[var(--social-border)] px-1">
                        {buckets.map((bucket) => (
                            <div key={bucket.from} className="flex flex-1 flex-col items-center gap-1">
                                <span className="text-[11px] font-semibold tabular-nums text-[var(--social-fg)]">{Math.round(bucket.acc * 100)}%</span>
                                <div className={cn('w-full rounded-t-lg', bucket.to > threshold ? 'bg-[var(--social-fg)]' : 'bg-[var(--social-fg-subtle)]')} style={{ height: `${Math.max(6, bucket.acc * 96)}px` }} />
                            </div>
                        ))}
                    </div>
                    <div className="mt-1.5 flex gap-3 px-1">
                        {buckets.map((bucket) => (
                            <div key={bucket.from} className="flex-1 text-center text-[10.5px] text-[var(--social-fg-muted)]">
                                {bucket.from.toFixed(1)}–{Math.min(1, bucket.to).toFixed(1)}
                                <div className="text-[var(--social-fg-subtle)]">n={bucket.n}</div>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 text-[11.5px] text-[var(--social-fg-muted)]">横轴是 Jev 给的置信度，柱子是这一档实际判对的比例。越往右越准，说明置信度可以拿来分流。</div>
                </div>
                <div>
                    <div className="flex items-center justify-between text-[12.5px]">
                        <span className="font-medium text-[var(--social-fg)]">自动写入阈值</span>
                        <span className="text-[15px] font-semibold tabular-nums text-[var(--social-fg)]">{threshold.toFixed(2)}</span>
                    </div>
                    <input type="range" min={0.3} max={0.95} step={0.05} value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} className="mt-2 w-full accent-[var(--social-primary)]" aria-label="自动写入阈值" />
                    <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-xl bg-[var(--social-muted)] px-3 py-2.5">
                            <div className="text-[11px] text-[var(--social-fg-muted)]">自动处理的比例</div>
                            <div className="text-[20px] font-semibold tabular-nums text-[var(--social-fg)]">{Math.round(stats.coverage * 100)}%</div>
                        </div>
                        <div className="rounded-xl bg-[var(--social-muted)] px-3 py-2.5">
                            <div className="text-[11px] text-[var(--social-fg-muted)]">这部分的准确率</div>
                            <div className={cn('text-[20px] font-semibold tabular-nums', stats.precision >= 0.95 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>{Math.round(stats.precision * 100)}%</div>
                        </div>
                    </div>
                    <div className="mt-2.5 text-[11.5px] leading-relaxed text-[var(--social-fg-muted)]">
                        低于阈值的 {SCOPE_CALIBRATION.length - stats.n} 次：用户层 ↔ 项目层拿不准就放项目层，项目层 ↔ 任务层拿不准就放任务层，和“不记”拿不准就进待确认。目标：自动处理的准确率 ≥95%。
                    </div>
                </div>
            </div>
        </Panel>
    )
}

export function QuestionsPanel() {
    return (
        <Panel title="Jev 每道题的表现" actions={<span className="text-[11px] text-[var(--social-fg-muted)]">离线评测 · 本周你的纠正</span>}>
            <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-left text-[12.5px]">
                    <thead>
                        <tr className="text-[11px] text-[var(--social-fg-muted)]">
                            <th className="py-1.5 font-medium">题目</th>
                            <th className="py-1.5 font-medium">题型</th>
                            <th className="py-1.5 font-medium">准确率</th>
                            <th className="py-1.5 font-medium">样本</th>
                            <th className="py-1.5 font-medium">你改判</th>
                            <th className="py-1.5 font-medium">备注</th>
                        </tr>
                    </thead>
                    <tbody>
                        {JEV_QUESTIONS.map((q) => {
                            const bad = q.key === 'relation'
                            return (
                                <tr key={q.key} className="border-t border-[var(--social-divider)]">
                                    <td className="py-2 font-medium text-[var(--social-fg)]">{q.label}</td>
                                    <td className="py-2 text-[var(--social-fg-muted)]">{q.type}</td>
                                    <td className={cn('py-2 font-semibold tabular-nums', bad ? 'text-[var(--social-danger)]' : 'text-[var(--social-fg)]')}>{q.offline}</td>
                                    <td className="py-2 text-[var(--social-fg-muted)]">{q.n}</td>
                                    <td className="py-2 tabular-nums text-[var(--social-fg)]">{q.corrections || '—'}</td>
                                    <td className="py-2 text-[var(--social-fg-muted)]">{q.note}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
        </Panel>
    )
}

/** The option descriptions sent to Jev are the "training": edit them, replay recent candidates, then switch. */
export function CriteriaPanel() {
    const [drafts, setDrafts] = useState<string[]>(CRITERIA_SCOPE.map((c) => c.text))
    const [replayed, setReplayed] = useState(true)
    const dirty = drafts.some((text, index) => text !== CRITERIA_SCOPE[index].text)
    return (
        <Panel title="判断标准 · “放哪一层”的选项说明" actions={<span className="text-[11px] text-[var(--social-fg-muted)]">当前 v3 · 10-14 · 原样发给 Jev</span>}>
            <div className="space-y-2.5">
                {CRITERIA_SCOPE.map((criterion, index) => (
                    <div key={criterion.key} className="rounded-xl border border-[var(--social-border)] px-3 py-2.5">
                        <div className="flex items-center gap-2 text-[12.5px] font-semibold text-[var(--social-fg)]">
                            {criterion.label}
                            {criterion.test ? <span className="font-normal text-[var(--social-fg-muted)]">判断：{criterion.test}</span> : null}
                        </div>
                        <textarea
                            value={drafts[index]}
                            onChange={(event) => {
                                const next = [...drafts]
                                next[index] = event.target.value
                                setDrafts(next)
                                setReplayed(false)
                            }}
                            rows={2}
                            className="mt-1.5 w-full resize-none bg-transparent text-[12.5px] leading-relaxed text-[var(--social-fg)] outline-none"
                        />
                    </div>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <PrimaryButton tone="ghost" onClick={() => setReplayed(true)}>预演：用最近 200 条候选重判（约 $0.012）</PrimaryButton>
                <PrimaryButton>{dirty ? '启用 v4' : '已是最新'}</PrimaryButton>
            </div>
            {replayed ? (
                <div className="mt-3 rounded-xl bg-[var(--social-muted)] px-3 py-3">
                    <div className="text-[12.5px] font-semibold text-[var(--social-fg)]">预演结果（示例：给“项目层”加了一句“通用技术技巧算项目层的坑”）：200 条里 4 条改判，训练集准确率 88% → 92%</div>
                    <div className="mt-2 space-y-1.5">
                        {REPLAY_DIFF.map((row) => (
                            <div key={row.text} className="grid gap-1 text-[12px] sm:grid-cols-[1.4fr_1fr_1fr] sm:gap-3">
                                <span className="truncate text-[var(--social-fg)]">{row.text}</span>
                                <span className="text-[var(--social-fg-muted)] line-through">{row.before}</span>
                                <span className="font-medium text-[var(--social-fg)]">→ {row.after}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </Panel>
    )
}

export function TrainingSetPanel() {
    return (
        <Panel title="训练集" actions={<span className="text-[11px] text-[var(--social-fg-muted)]">61 条 · 留出 12 条不参与调参</span>}>
            <div className="grid grid-cols-3 gap-2 text-center">
                {[
                    { label: '自编', n: 52 },
                    { label: '你的纠正', n: 9 },
                    { label: '本周新增', n: 7 }
                ].map((item) => (
                    <div key={item.label} className="rounded-xl bg-[var(--social-muted)] py-2.5">
                        <div className="text-[18px] font-semibold tabular-nums text-[var(--social-fg)]">{item.n}</div>
                        <div className="text-[11px] text-[var(--social-fg-muted)]">{item.label}</div>
                    </div>
                ))}
            </div>
            <div className="mt-3 space-y-1.5 text-[12.5px]">
                {[
                    { text: '记忆要分三层成熟：事实 → 推断和经验 → 原则和偏好。', from: '任务层', to: '项目层 / 架构 / 原则' },
                    { text: 'Tailwind v4 禁用按钮不想要 hover…', from: '待确认', to: '项目层 / 坑' },
                    { text: '凌晨的消息多半在手机上看，回复要更短。', from: '推断', to: '拒绝（你说不是）' }
                ].map((row) => (
                    <div key={row.text} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[var(--social-fg)]">{row.text}</span>
                        <span className="shrink-0 text-[var(--social-fg-muted)] line-through">{row.from}</span>
                        <span className="shrink-0 font-medium text-[var(--social-fg)]">→ {row.to}</span>
                    </div>
                ))}
            </div>
            <div className="mt-3">
                <PrimaryButton tone="ghost">用训练集回放评测（约 $0.004）</PrimaryButton>
            </div>
        </Panel>
    )
}

export function HealthPanel() {
    return (
        <Panel title="健康信号">
            <div className="space-y-2">
                {HEALTH.map((item) => (
                    <div key={item.title} className="flex gap-2.5 rounded-xl px-1 py-1">
                        <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', item.tone === 'danger' ? 'bg-[var(--social-danger)]' : item.tone === 'warning' ? 'bg-amber-500' : 'bg-[var(--social-fg-subtle)]')} />
                        <div>
                            <div className="text-[13px] font-semibold text-[var(--social-fg)]">{item.title}</div>
                            <div className="mt-0.5 text-[12px] leading-relaxed text-[var(--social-fg-muted)]">{item.body}</div>
                        </div>
                    </div>
                ))}
            </div>
        </Panel>
    )
}

export function PolicyPanel() {
    const [mode, setMode] = useState<'off' | 'shadow' | 'review' | 'auto'>('shadow')
    const rows = [
        { k: '用户层自动写入', v: '你亲口说 + 层置信 ≥0.8 + 不和旧条目重复；其余进待确认' },
        { k: '会话提交的“原则”', v: '先按经验入库；支撑 ≥3、跨 2 个会话、14 天无冲突再提议升级' },
        { k: '升级核查', v: 'Jev 支撑核查 <0.2 直接否决；0.2–0.6 交给你；>0.6 也要你点确认' },
        { k: '过期', v: '任务层 7 天；事实 30 天没被引用就归档；经验 90 天没被加强标“可能过时”' },
        { k: '注入预算', v: '用户层 1,500 token、每个项目 1,500 token；超出时先压事实和低支撑经验' },
        { k: '永远不记', v: '密钥原文、<private> 包起来的内容、git 已记录的状态、没采纳的建议' },
        { k: '外发记录', v: '今天发给 Jev 37 条候选（只发候选和 ≤20 条相似旧条目），本地打码 2 处' }
    ]
    return (
        <Panel title="策略">
            <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-[12.5px] font-medium text-[var(--social-fg)]">模式</span>
                <Segmented
                    size="sm"
                    value={mode}
                    onChange={setMode}
                    options={[
                        { value: 'off', label: '关' },
                        { value: 'shadow', label: '影子' },
                        { value: 'review', label: '审核' },
                        { value: 'auto', label: '自动' }
                    ]}
                />
                <span className="text-[11.5px] text-[var(--social-fg-muted)]">
                    {mode === 'shadow' ? '只判断、只记录，不写入也不注入' : mode === 'review' ? '全部进待确认，你点了才生效' : mode === 'auto' ? '按下面的规则自动写入' : '不采集'}
                </span>
            </div>
            <dl className="space-y-2">
                {rows.map((row) => (
                    <div key={row.k} className="grid gap-1 text-[12.5px] sm:grid-cols-[132px_1fr] sm:gap-3">
                        <dt className="font-medium text-[var(--social-fg-muted)]">{row.k}</dt>
                        <dd className="leading-relaxed text-[var(--social-fg)]">{row.v}</dd>
                    </div>
                ))}
            </dl>
        </Panel>
    )
}

export function TrainingView(props: { mobile?: boolean }) {
    return (
        <div className="space-y-4">
            <div className={cn('grid gap-4', props.mobile ? 'grid-cols-1' : 'grid-cols-[1.25fr_1fr]')}>
                <div className="space-y-4">
                    <CalibrationPanel />
                    <CriteriaPanel />
                </div>
                <div className="space-y-4">
                    <HealthPanel />
                    <TrainingSetPanel />
                </div>
            </div>
            <QuestionsPanel />
            <PolicyPanel />
        </div>
    )
}
