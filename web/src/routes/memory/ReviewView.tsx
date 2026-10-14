import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { MEMORIES, WEEKLY_REVIEW } from './mock'
import { ConfidencePill, LayerTag, LockGlyph, MaturityBadge, PrimaryButton, SupportMeter } from './ui'

function find(id: string) {
    const item = MEMORIES.find((m) => m.id === id)
    if (!item) throw new Error(`missing memory ${id}`)
    return item
}

function ReviewCard(props: { kind: string; tone: 'danger' | 'warning' | 'muted' | 'primary'; title: string; children: ReactNode; actions: ReactNode; meta?: ReactNode }) {
    return (
        <section className="rounded-2xl border border-[var(--social-border)] px-4 py-3.5">
            <div className="flex items-center gap-2">
                <span className={cn(
                    'rounded-full px-2 text-[11px] font-semibold leading-5',
                    props.tone === 'danger' ? 'bg-[var(--social-danger)]/12 text-[var(--social-danger)]'
                        : props.tone === 'warning' ? 'bg-amber-500/12 text-amber-600 dark:text-amber-400'
                            : props.tone === 'primary' ? 'bg-[var(--social-primary)] text-[var(--social-primary-fg)]'
                                : 'bg-[var(--social-muted)] text-[var(--social-fg-muted)]'
                )}>{props.kind}</span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-[var(--social-fg)]">{props.title}</span>
                {props.meta}
            </div>
            <div className="mt-2.5">{props.children}</div>
            <div className="mt-3 flex flex-wrap gap-2">{props.actions}</div>
        </section>
    )
}

function Quote(props: { label: string; children: ReactNode; strike?: boolean; locked?: boolean }) {
    return (
        <div className="rounded-xl bg-[var(--social-muted)] px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--social-fg-muted)]">{props.label}{props.locked ? <LockGlyph /> : null}</div>
            <div className={cn('mt-1 text-[13.5px] leading-relaxed text-[var(--social-fg)]', props.strike ? 'text-[var(--social-fg-muted)] line-through' : '')}>{props.children}</div>
        </div>
    )
}

export function ReviewView(props: { mobile?: boolean; onOpenMemory: (id: string) => void }) {
    const u3 = find('u3')
    const p4 = find('p4')
    return (
        <div className={cn('grid gap-4', props.mobile ? 'grid-cols-1' : 'grid-cols-2')}>
            <div className="space-y-4">
                <ReviewCard
                    kind="冲突"
                    tone="danger"
                    title="“修完直接推送”和锁定的 u3 相反"
                    meta={<span className="text-[11px] text-[var(--social-fg-muted)]">1 小时前</span>}
                    actions={(
                        <>
                            <PrimaryButton>保留 u3</PrimaryButton>
                            <PrimaryButton tone="ghost">改成新说法（u3 v5）</PrimaryButton>
                            <PrimaryButton tone="ghost">去原会话看上下文</PrimaryButton>
                        </>
                    )}
                >
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Quote label={`现在 · u3 v${u3.versions.length} · 支撑 ${u3.support}`} locked>{u3.text}</Quote>
                        <Quote label="新候选 · 会话「HAQI 社交改版」称“你说的”">以后修完可以直接推送，不用再问我。</Quote>
                    </div>
                    <div className="mt-2 text-[12px] text-[var(--social-fg-muted)]">Jev：对应 u3（0.97）。在原会话里没找到你的原话，可能是会话误读了“这次可以推”。</div>
                </ReviewCard>

                <ReviewCard
                    kind="升级提议"
                    tone="primary"
                    title="经验 → 原则：发布要原子切换"
                    meta={<ConfidencePill value={0.5} />}
                    actions={(
                        <>
                            <PrimaryButton>升为原则</PrimaryButton>
                            <PrimaryButton tone="ghost">改写后再升</PrimaryButton>
                            <PrimaryButton tone="ghost">先不升</PrimaryButton>
                        </>
                    )}
                >
                    <Quote label="整理会话写的原则（由 p1 + p4 归纳）">发布要原子切换：先备份，入口文件最后替换。</Quote>
                    <div className="mt-2 space-y-1.5">
                        {['p1', 'p4', 'pf1', 'pf2'].map((id) => {
                            const m = find(id)
                            return (
                                <button key={id} type="button" onClick={() => props.onOpenMemory(id)} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left hover:bg-[var(--social-hover)]">
                                    <MaturityBadge maturity={m.maturity} />
                                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--social-fg)]">{m.text}</span>
                                    {m.maturity !== 'fact' ? <SupportMeter support={m.support} /> : null}
                                </button>
                            )
                        })}
                    </div>
                    <div className="mt-2 text-[12px] text-[var(--social-fg-muted)]">Jev 支撑核查 0.50：依据能撑起它，但只来自 1 个项目。升为原则后会注入 haqi 的所有会话。</div>
                </ReviewCard>

                <ReviewCard
                    kind="合并稿"
                    tone="muted"
                    title="Claude 自带记忆补充了 p4 没写的步骤"
                    actions={(
                        <>
                            <PrimaryButton>用合并稿（p4 v3）</PrimaryButton>
                            <PrimaryButton tone="ghost">保持原样</PrimaryButton>
                        </>
                    )}
                >
                    <div className="grid gap-2 sm:grid-cols-2">
                        <Quote label={`现在 · p4 v${p4.versions.length}`}>{p4.text}</Quote>
                        <Quote label="合并稿 · 整理会话">部署 web：构建到 dist.new → 备份 dist → rsync 静态资源 → 最后拷 sw.js、404.html、index.html，避免刷新到半新半旧的页面。</Quote>
                    </div>
                </ReviewCard>
            </div>

            <div className="space-y-4">
                <ReviewCard
                    kind="层拿不准"
                    tone="warning"
                    title="Tailwind v4 禁用按钮的 hover 写法"
                    meta={<ConfidencePill value={0.24} />}
                    actions={(
                        <>
                            <PrimaryButton>项目层 / 坑（建议）</PrimaryButton>
                            <PrimaryButton tone="ghost">用户层</PrimaryButton>
                            <PrimaryButton tone="danger">不记</PrimaryButton>
                        </>
                    )}
                >
                    <Quote label="会话「HAQI 社交改版」提交">Tailwind v4 禁用按钮不想要 hover，要写 enabled:hover:。</Quote>
                    <div className="mt-2 text-[12px] text-[var(--social-fg-muted)]">Jev：用户层 0.43 · 不记 0.43 · 项目层 0.13。通用技术技巧的边界还没教会它，你选完会进训练集。</div>
                </ReviewCard>

                <ReviewCard
                    kind="推断待验证"
                    tone="muted"
                    title="会话对你的两条推断"
                    actions={(
                        <>
                            <PrimaryButton>都对</PrimaryButton>
                            <PrimaryButton tone="ghost">逐条看</PrimaryButton>
                        </>
                    )}
                >
                    <div className="space-y-2">
                        {['u9', 'u10'].map((id) => {
                            const m = find(id)
                            return (
                                <div key={id} className="flex items-start gap-2">
                                    <MaturityBadge maturity={m.maturity} inference />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[13px] leading-relaxed text-[var(--social-fg)]">{m.text}</div>
                                        <div className="mt-1 flex gap-1.5">
                                            {['是这样', '不是', '再观察'].map((label) => (
                                                <button key={label} type="button" className="h-7 rounded-full border border-[var(--social-border)] px-2.5 text-[12px] text-[var(--social-fg)]">{label}</button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </ReviewCard>

                <ReviewCard
                    kind="每周复核"
                    tone="muted"
                    title="这些原则还成立吗？"
                    meta={<span className="text-[11px] text-[var(--social-fg-muted)]">每周 3 条，最久没被提到的先问</span>}
                    actions={<PrimaryButton tone="ghost">全部保留</PrimaryButton>}
                >
                    <div className="space-y-2">
                        {WEEKLY_REVIEW.map((id) => {
                            const m = find(id)
                            return (
                                <div key={id} className="rounded-xl border border-[var(--social-border)] px-3 py-2.5">
                                    <div className="flex items-center gap-2">
                                        <LayerTag layer={m.layer} project={m.project} section={m.section} />
                                        <span className="ml-auto text-[11px] text-[var(--social-fg-muted)]">最近被提到 {m.reinforcedAt}</span>
                                    </div>
                                    <div className="mt-1 text-[13px] leading-relaxed text-[var(--social-fg)]">{m.text}</div>
                                    <div className="mt-1.5 flex gap-1.5">
                                        {['保留', '修改', '退役'].map((label) => (
                                            <button key={label} type="button" className="h-7 rounded-full border border-[var(--social-border)] px-2.5 text-[12px] text-[var(--social-fg)]">{label}</button>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </ReviewCard>
            </div>
        </div>
    )
}
