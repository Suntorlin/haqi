import type { ReactNode } from 'react'
import type { ReportStat, Shot } from './types'
import { FitText } from '@/components/ui/FitText'

/** Section caption inside a report page ("等你", "进度", "风险"). */
export function SectionCaption(props: { children: ReactNode; trailing?: ReactNode }) {
    return (
        <div className="flex items-center justify-between px-5 pb-1 pt-6">
            <h3 className="text-footnote font-semibold text-[var(--social-fg-muted)]">{props.children}</h3>
            {props.trailing}
        </div>
    )
}

/** Row of small stat tiles (value over label). */
export function StatTiles(props: { stats: ReportStat[] }) {
    return (
        <div className="grid grid-cols-3 gap-2">
            {props.stats.map((stat) => (
                <div key={stat.label} className="rounded-2xl bg-[var(--social-muted)] px-3 py-3">
                    {/* keep-all: a narrow tile breaks "3 小时 59 分" between its parts, never inside one. */}
                    <div className="text-title font-semibold leading-tight tracking-[-0.02em] text-[var(--social-fg)] [word-break:keep-all]">{stat.value}</div>
                    <div className="mt-1.5 text-caption text-[var(--social-fg-muted)]">{stat.label}</div>
                </div>
            ))}
        </div>
    )
}

/** Report opener: one-line conclusion, optional detail line, optional stat tiles. */
export function ReportSummary(props: { headline: ReactNode; lede?: ReactNode; stats?: ReportStat[] }) {
    return (
        <article className="px-5 pt-4">
            <h2 className="text-title font-semibold leading-snug tracking-[-0.02em] text-[var(--social-fg)]">{props.headline}</h2>
            {props.lede ? <p className="mt-2 text-body leading-relaxed text-[var(--social-fg-muted)]">{props.lede}</p> : null}
            {props.stats && props.stats.length > 0 ? (
                <div className="mt-4">
                    <StatTiles stats={props.stats} />
                </div>
            ) : null}
        </article>
    )
}

/** Warning-tinted card listing open risks. */
export function RiskNotice(props: { risks: string[] }) {
    return (
        <div className="flex flex-col gap-2 rounded-2xl bg-[var(--app-badge-warning-bg)] p-4">
            {props.risks.map((risk) => (
                <div key={risk} className="flex gap-3">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-badge-warning-text)]" />
                    <span className="text-body leading-relaxed text-[var(--app-badge-warning-text)]">{risk}</span>
                </div>
            ))}
        </div>
    )
}

/** Row of phone-aspect screenshots with captions, used in finished reports. */
export function ShotRow(props: { shots: Shot[] }) {
    return (
        <div className="flex gap-2">
            {props.shots.map((shot) => (
                <figure key={shot.src} className="min-w-0 flex-1">
                    <img src={shot.src} alt={shot.caption} className="aspect-[393/852] w-full rounded-xl border border-[var(--social-border)] object-cover object-top" />
                    <figcaption className="mt-1.5 text-caption text-[var(--social-fg-muted)]"><FitText kind="title" text={shot.caption} /></figcaption>
                </figure>
            ))}
        </div>
    )
}
