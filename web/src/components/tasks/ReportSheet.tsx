import { useState } from 'react'
import { BriefCardMarkdownPreview } from '@/components/AssistantChat/BriefCardMarkdownPreview'
import { BriefFullMarkdownContent } from '@/components/AssistantChat/BriefFullMarkdownContent'
import { BottomSheet } from '@/components/mobile/BottomSheet'
import { ChevronRightIcon } from '@/components/mobile/icons'
import { useTranslation } from '@/lib/use-translation'

/**
 * The report is plain markdown with one <details> block for the process. The app does not render HTML in
 * markdown, so the block becomes an ordinary section; the leading "# name" goes, the sheet already shows it.
 */
export function reportMarkdownForApp(markdown: string): string {
    return escapeTildes(criteriaTableAsList(markdown))
        .replace(/^# .*\n+/, '')
        .replace(/<details><summary>(.*?)<\/summary>/g, '## $1')
        .replace(/<\/details>/g, '')
}

/** Paths like ~/dev/x come in pairs in a report; GFM would strike the text between them. Code spans stay as they are. */
function escapeTildes(markdown: string): string {
    return markdown.split(/(`[^`\n]*`)/).map((part, index) => index % 2 === 1 ? part : part.replace(/~/g, '\\~')).join('')
}

const CRITERIA_HEADER = /^\| # \| 标准 \| 结论 \| 证据 \|$/

/** The criteria table is four columns of long text; on a phone and in a side panel it reads better as a list. */
function criteriaTableAsList(markdown: string): string {
    const out: string[] = []
    let inTable = false
    for (const line of markdown.split('\n')) {
        if (CRITERIA_HEADER.test(line)) { inTable = true; continue }
        if (inTable && /^\|[-| ]+\|$/.test(line)) continue
        if (inTable && line.startsWith('|')) {
            const cells = line.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
            const [index, text, verdict, evidence] = cells
            out.push(`${index}. **${verdict}**：${text}${evidence ? `\n   证据：${evidence}` : ''}`)
            continue
        }
        inTable = false
        out.push(line)
    }
    return out.join('\n')
}

/** The full report, read inside HAQI instead of on the share page. */
export function ReportSheet(props: { open: boolean; onOpenChange: (open: boolean) => void; title: string; markdown: string; shareUrl?: string | null }) {
    const { t } = useTranslation()
    return (
        <BottomSheet open={props.open} onOpenChange={props.onOpenChange} title={props.title} className="md:w-[640px]">
            <div className="px-5 pb-6">
                <BriefFullMarkdownContent content={reportMarkdownForApp(props.markdown)} className="text-body" />
                {props.shareUrl ? (
                    <a href={props.shareUrl} target="_blank" rel="noreferrer" className="mt-5 inline-block text-caption text-[var(--social-fg-muted)] underline underline-offset-4">
                        {t('taskRun.openShare')}
                    </a>
                ) : null}
            </div>
        </BottomSheet>
    )
}

/** The report as a card in the task's conversation: the conclusion, a short preview, and the full report on tap. */
export function TaskReportCard(props: { text: string; markdown: string; title: string }) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    return (
        <div className="overflow-hidden rounded-2xl border border-[var(--social-border)] bg-[var(--social-bg)]">
            <div className="px-4 pb-3 pt-3.5">
                <p className="text-caption font-semibold text-[var(--social-fg-muted)]">{t('taskRun.reportCard')}</p>
                <p className="mt-1 text-body font-semibold leading-snug text-[var(--social-fg)]">{props.text}</p>
                <BriefCardMarkdownPreview content={reportMarkdownForApp(props.markdown).replace(/^\*\*.*\*\*\n+/, '')} className="mt-2 max-h-[120px] text-footnote text-[var(--social-fg-muted)]" />
            </div>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex w-full items-center justify-between border-t border-[var(--social-divider)] px-4 py-3 text-left text-body font-semibold text-[var(--social-fg)] transition-colors hover:bg-[var(--social-muted)]"
            >
                {t('taskRun.fullReport')}
                <ChevronRightIcon className="h-4 w-4 text-[var(--social-fg-subtle)]" />
            </button>
            <ReportSheet open={open} onOpenChange={setOpen} title={props.title} markdown={props.markdown} />
        </div>
    )
}
