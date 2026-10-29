import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { SegmentedControl } from '@/components/ui/FormControls'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import type { CompareColumn, CompareRow } from './types'

/**
 * A few options side by side. The recommended column carries a "Suggested" badge and a soft fill.
 * On a phone only one option shows at a time, picked with a segmented control.
 */
export function CompareTable(props: { title: string; columns: CompareColumn[]; rows: CompareRow[] }) {
    const { t } = useTranslation()
    const [picked, setPicked] = useState(() => (props.columns.find((c) => c.recommended) ?? props.columns[0])?.id ?? '')
    const cell = (id: string) => cn(id !== picked && 'max-sm:hidden', props.columns.find((c) => c.id === id)?.recommended && 'bg-[var(--social-hover)]')
    return (
        <div className="flex flex-col gap-2">
            <div className="sm:hidden">
                <SegmentedControl label={props.title} value={picked} options={props.columns.map((c) => ({ value: c.id, label: c.label }))} onChange={setPicked} />
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--social-border)]">
                <table className="w-full border-collapse text-body">
                    <thead>
                        <tr>
                            <th className="w-[30%] px-4 py-3 text-left text-footnote font-semibold text-[var(--social-fg-muted)]">{props.title}</th>
                            {props.columns.map((col) => (
                                <th key={col.id} className={cn('px-4 py-3 text-left font-semibold text-[var(--social-fg)]', cell(col.id))}>
                                    <span className="inline-flex items-center gap-2">
                                        {col.label}
                                        {col.recommended ? <Badge>{t('report.option.recommended')}</Badge> : null}
                                    </span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {props.rows.map((row) => (
                            <tr key={row.label} className="border-t border-[var(--social-divider)]">
                                <td className="px-4 py-3 text-footnote text-[var(--social-fg-muted)]">{row.label}</td>
                                {props.columns.map((col) => (
                                    <td key={col.id} className={cn('px-4 py-3 text-[var(--social-fg)]', row.numeric && 'tabular-nums', cell(col.id))}>
                                        {row.values[col.id] ?? '—'}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
