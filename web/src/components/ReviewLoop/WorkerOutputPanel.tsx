import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { ChevronRightIcon } from '@/components/mobile/icons'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import type { WorkerOutput } from '@/types/api'

const CODE_BLOCK_CLASS = 'app-scrollbar min-w-0 overflow-auto rounded-xl bg-[var(--social-muted)] px-3 py-2 font-mono text-caption leading-relaxed text-[var(--social-fg)]'

function Section({
    title,
    suffix,
    defaultOpen = false,
    children,
}: {
    title: string
    suffix?: string
    defaultOpen?: boolean
    children: React.ReactNode
}) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <div className="min-w-0">
            <button
                type="button"
                aria-expanded={open}
                className="flex min-h-11 w-full min-w-0 items-center gap-2 text-left text-[var(--social-fg-muted)] transition-colors hover:text-[var(--social-fg)] [-webkit-tap-highlight-color:transparent]"
                onClick={() => setOpen((v) => !v)}
            >
                <ChevronRightIcon className={cn('h-4 w-4 shrink-0 text-[var(--social-fg-subtle)] transition-transform', open && 'rotate-90')} />
                <span className="text-body font-semibold text-[var(--social-fg)]">{title}</span>
                {suffix && <span className="text-footnote">{suffix}</span>}
            </button>
            {open && (
                <div className="min-w-0 overflow-hidden pb-1 pl-6">
                    {children}
                </div>
            )}
        </div>
    )
}

function CommandEntry({ command, exitCode, stdout, stderr }: {
    command: string
    exitCode: number
    stdout: string
    stderr: string
}) {
    const { t } = useTranslation()
    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="break-all font-mono text-footnote text-[var(--social-fg)]">$ {command}</span>
                <Badge variant={exitCode === 0 ? 'success' : 'destructive'}>{t('loops.output.exit', { code: exitCode })}</Badge>
            </div>
            {stdout && (
                <pre className={cn(CODE_BLOCK_CLASS, 'max-h-48 whitespace-pre-wrap break-all')}>{stdout}</pre>
            )}
            {stderr && (
                <pre className={cn(CODE_BLOCK_CLASS, 'max-h-48 whitespace-pre-wrap break-all text-[var(--app-badge-error-text)]')}>{stderr}</pre>
            )}
        </div>
    )
}

export function WorkerOutputPanel({ output }: { output: WorkerOutput }) {
    const { t } = useTranslation()
    return (
        <div className="flex min-w-0 flex-col gap-1 overflow-hidden">
            <div className="flex min-w-0 items-center gap-2">
                <span className="text-body font-semibold text-[var(--social-fg)]">{t('loops.output.title')}</span>
                <Badge variant={output.exitStatus === 'success' ? 'success' : 'destructive'}>
                    {t(output.exitStatus === 'success' ? 'loops.output.success' : 'loops.output.error')}
                </Badge>
            </div>

            {output.summary && (
                <Section title={t('loops.output.summary')} defaultOpen>
                    <p className="whitespace-pre-wrap break-words text-body text-[var(--social-fg)]">{output.summary}</p>
                </Section>
            )}

            {output.filesChanged.length > 0 && (
                <Section title={t('loops.output.files', { n: output.filesChanged.length })} defaultOpen>
                    <div className="flex min-w-0 flex-col gap-1">
                        {output.filesChanged.map((f, i) => {
                            const prefix = f.startsWith('D ') ? 'D' : f.startsWith('A ') ? 'A' : 'M'
                            const name = f.replace(/^[MAD]\s+/, '')
                            const prefixColor = prefix === 'D' ? 'var(--app-badge-error-text)' : prefix === 'A' ? 'var(--app-badge-success-text)' : 'var(--app-badge-info-text)'
                            return (
                                <div key={i} className="min-w-0 truncate font-mono text-footnote">
                                    <span className="font-semibold" style={{ color: prefixColor }}>{prefix}</span>{' '}
                                    <span className="text-[var(--social-fg)]">{name}</span>
                                </div>
                            )
                        })}
                    </div>
                </Section>
            )}

            {output.diff && (
                <Section title={t('diff.title')} suffix={(() => {
                    const lines = output.diff.split('\n')
                    const added = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length
                    const removed = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length
                    return `(+${added} -${removed})`
                })()}>
                    <pre className={cn(CODE_BLOCK_CLASS, 'max-h-96 whitespace-pre-wrap break-all px-0')}>
                        {output.diff.split('\n').map((line, i) => {
                            let style: React.CSSProperties = { color: 'var(--social-fg)' }
                            if (line.startsWith('+')) style = { color: 'var(--app-diff-added-text)', backgroundColor: 'var(--app-diff-added-bg)' }
                            else if (line.startsWith('-')) style = { color: 'var(--app-diff-removed-text)', backgroundColor: 'var(--app-diff-removed-bg)' }
                            else if (line.startsWith('@@')) style = { color: 'var(--social-fg-muted)' }
                            return (
                                <div key={i} className="px-3" style={style}>
                                    {line || ' '}
                                </div>
                            )
                        })}
                    </pre>
                </Section>
            )}

            {output.commands.length > 0 && (
                <Section title={t('loops.output.commands', { n: output.commands.length })}>
                    <div className="flex min-w-0 flex-col gap-3">
                        {output.commands.map((cmd, i) => (
                            <CommandEntry key={i} {...cmd} />
                        ))}
                    </div>
                </Section>
            )}

            {output.rawResponse && (
                <Section title={t('loops.output.raw')}>
                    <pre className={cn(CODE_BLOCK_CLASS, 'max-h-64 whitespace-pre-wrap break-all')}>
                        {output.rawResponse}
                    </pre>
                </Section>
            )}
        </div>
    )
}
