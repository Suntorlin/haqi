import { createContext, useContext, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

const SinceContext = createContext<{ changed: ReadonlySet<string>; only: boolean }>({ changed: new Set(), only: false })

/**
 * What changed since the reader last looked. With "only changes" on, blocks that did not change
 * fold into one line each, so coming back means reading the new parts only.
 */
export function SinceVisit(props: { minutes: number; changed: string[]; decisions?: number; children: ReactNode }) {
    const { t } = useTranslation()
    const [only, setOnly] = useState(props.changed.length > 0)
    const changed = new Set(props.changed)
    return (
        <SinceContext.Provider value={{ changed, only }}>
            <div className="flex flex-col gap-3">
                {props.changed.length > 0 ? (
                    <div className="flex items-center gap-3 rounded-2xl bg-[var(--social-muted)] py-2 pl-4 pr-2">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--social-badge)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1 text-footnote text-[var(--social-fg)]">
                            {t('report.since.summary', { minutes: props.minutes, n: props.changed.length })}
                            {props.decisions ? t('report.since.decisions', { n: props.decisions }) : null}
                        </span>
                        <Button size="sm" variant={only ? 'secondary' : 'default'} className={only ? 'bg-[var(--social-surface)]' : undefined} onClick={() => setOnly((v) => !v)}>
                            {only ? t('report.since.showAll') : t('report.since.onlyChanges')}
                        </Button>
                    </div>
                ) : null}
                {props.children}
            </div>
        </SinceContext.Provider>
    )
}

/** One titled block of a report. Marks itself when it changed; folds to a line when unchanged and the reader asked for changes only. */
export function ReportBlock(props: { id: string; title: string; children: ReactNode }) {
    const { t } = useTranslation()
    const { changed, only } = useContext(SinceContext)
    const [opened, setOpened] = useState(false)
    const isChanged = changed.has(props.id)
    if (only && !isChanged && !opened) {
        return (
            <button
                type="button"
                onClick={() => setOpened(true)}
                className="flex min-h-11 w-full items-center gap-2 rounded-2xl border border-dashed border-[var(--social-border)] px-4 text-left text-footnote text-[var(--social-fg-subtle)] transition-colors active:bg-[var(--social-hover)]"
            >
                {t('report.since.unchanged', { name: props.title })}
            </button>
        )
    }
    return (
        <section className="flex flex-col gap-2">
            <h3 className="m-0 flex items-center gap-2 text-footnote font-semibold text-[var(--social-fg-muted)]">
                {props.title}
                {isChanged ? <Badge variant="info" dot>{t('report.since.updated')}</Badge> : null}
            </h3>
            {props.children}
        </section>
    )
}
