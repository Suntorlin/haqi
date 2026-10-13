import { lazy, Suspense, useMemo } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { usePointerFocusRing } from '@/hooks/usePointerFocusRing'
import { useTheme } from '@/hooks/useTheme'
import { buildSyntheticUnifiedDiff, inferGitDiffLanguage, normalizeGitDiffLanguage } from '@/lib/gitDiff'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

const GitDiffViewer = lazy(() => import('@/components/GitDiffViewer'))

export function DiffView(props: {
    oldString: string
    newString: string
    filePath?: string
    variant?: 'preview' | 'inline'
    language?: string
}) {
    const { t } = useTranslation()
    const { isDark } = useTheme()
    const variant = props.variant ?? 'preview'
    const { suppressFocusRing, onTriggerPointerDown, onTriggerKeyDown, onTriggerBlur } = usePointerFocusRing()
    const language = normalizeGitDiffLanguage(props.language ?? inferGitDiffLanguage(props.filePath))

    const stats = useMemo(() => {
        const oldChars = props.oldString.length
        const newChars = props.newString.length
        const oldLabel = `${oldChars.toLocaleString()} chars`
        const newLabel = `${newChars.toLocaleString()} chars`
        return { label: `old: ${oldLabel} → new: ${newLabel}` }
    }, [props.oldString, props.newString])

    const diffContent = useMemo(() => buildSyntheticUnifiedDiff({
        filePath: props.filePath,
        oldContent: props.oldString,
        newContent: props.newString
    }), [props.filePath, props.oldString, props.newString])

    const title = props.filePath ? props.filePath : t('diff.title')
    const subtitle = props.filePath ? stats.label : `${t('diff.title')} • ${stats.label}`

    const diffBody = (
        <Suspense fallback={<DiffFallback />}>
            <GitDiffViewer
                filePath={props.filePath ?? 'untitled'}
                language={language}
                oldContent={props.oldString}
                newContent={props.newString}
                diffContent={diffContent}
                theme={isDark ? 'dark' : 'light'}
            />
        </Suspense>
    )

    if (variant === 'inline') {
        return diffBody
    }

    return (
        <Dialog>
            <DialogTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--social-fg)]',
                        suppressFocusRing && 'focus-visible:ring-0'
                    )}
                    onPointerDown={onTriggerPointerDown}
                    onKeyDown={onTriggerKeyDown}
                    onBlur={onTriggerBlur}
                >
                    <div className="overflow-hidden rounded-md border border-[var(--social-border)] bg-[var(--social-hover)] transition-colors hover:bg-[var(--social-muted)]">
                        {props.filePath ? (
                            <div className="truncate border-b border-[var(--social-border)] bg-[var(--social-hover)] px-2 py-1 text-xs text-[var(--social-fg-muted)]">
                                {props.filePath}
                            </div>
                        ) : null}
                        <div className="px-2 py-2">
                            <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 truncate font-mono text-xs text-[var(--social-fg-muted)]">
                                    {props.filePath ? stats.label : subtitle}
                                </div>
                                <div className="shrink-0 text-xs text-[var(--social-fg)]">
                                    {t('diff.view')}
                                </div>
                            </div>
                        </div>
                    </div>
                </button>
            </DialogTrigger>
            <DialogContent className="!w-[calc(100vw-32px)] !max-w-[min(1800px,calc(100vw-48px))] lg:!w-[calc(100vw-48px)]">
                <DialogHeader>
                    <DialogTitle className="break-all">{title}</DialogTitle>
                    <DialogDescription className="break-all font-mono">
                        {stats.label}
                    </DialogDescription>
                </DialogHeader>
                <div className="mt-3 max-h-[78vh] overflow-auto lg:max-h-[85vh]">
                    {diffBody}
                </div>
            </DialogContent>
        </Dialog>
    )
}

function DiffFallback() {
    return (
        <div className="rounded-md border border-[var(--social-border)] bg-[var(--social-hover)] px-3 py-4 text-xs text-[var(--social-fg-muted)]">
            Loading diff…
        </div>
    )
}
