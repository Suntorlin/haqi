import { createContext, useContext, useState, type ReactNode } from 'react'
import { SegmentedControl } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

/** How much of the report to show: one sentence, the key points, or everything. */
export type DetailLevel = 'brief' | 'points' | 'full'

const DetailContext = createContext<{ level: DetailLevel; setLevel: (level: DetailLevel) => void }>({ level: 'full', setLevel: () => {} })

/** Holds the report's detail level, so one switch drives every block — the report's semantic zoom. */
export function ReportDetailProvider(props: { initial?: DetailLevel; children: ReactNode }) {
    const [level, setLevel] = useState<DetailLevel>(props.initial ?? 'brief')
    return <DetailContext.Provider value={{ level, setLevel }}>{props.children}</DetailContext.Provider>
}

export function useReportDetail() {
    return useContext(DetailContext)
}

/** The one switch at the top of a report: 一句话 / 要点 / 全文. */
export function DetailSwitch() {
    const { t } = useTranslation()
    const { level, setLevel } = useReportDetail()
    return (
        <SegmentedControl<DetailLevel>
            label={t('report.detail.label')}
            value={level}
            options={[
                { value: 'brief', label: t('report.detail.brief') },
                { value: 'points', label: t('report.detail.points') },
                { value: 'full', label: t('report.detail.full') }
            ]}
            onChange={setLevel}
        />
    )
}

/** Opens or folds its content with a height transition, so switching levels never jumps. */
function Fold(props: { open: boolean; children: ReactNode }) {
    return (
        <div className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-out', props.open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')} aria-hidden={!props.open}>
            <div className="min-h-0 overflow-hidden">{props.children}</div>
        </div>
    )
}

/**
 * Text written three times, from short to long. The brief line always shows; the points and the full
 * paragraph open as the reader asks for more.
 */
export function DetailText(props: { brief: ReactNode; points?: string[]; full?: ReactNode }) {
    const { level } = useReportDetail()
    return (
        <div>
            <p className="m-0 text-body leading-relaxed text-[var(--social-fg)]">{props.brief}</p>
            {props.points && props.points.length > 0 ? (
                <Fold open={level !== 'brief'}>
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 pt-2">
                        {props.points.map((point) => (
                            <li key={point} className="flex gap-2.5 text-body leading-relaxed text-[var(--social-fg-muted)]">
                                <span className="mt-[9px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--social-fg-subtle)]" />
                                {point}
                            </li>
                        ))}
                    </ul>
                </Fold>
            ) : null}
            {props.full ? (
                <Fold open={level === 'full'}>
                    <div className="pt-2 text-body leading-relaxed text-[var(--social-fg-muted)]">{props.full}</div>
                </Fold>
            ) : null}
        </div>
    )
}

/** Shows its children only at the given levels (e.g. a chart from "points" on). */
export function AtDetail(props: { from: DetailLevel; children: ReactNode }) {
    const { level } = useReportDetail()
    const order: DetailLevel[] = ['brief', 'points', 'full']
    return <Fold open={order.indexOf(level) >= order.indexOf(props.from)}>{props.children}</Fold>
}
