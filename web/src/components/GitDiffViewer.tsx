import '@git-diff-view/react/styles/diff-view-pure.css'
import { DiffModeEnum, DiffView } from '@git-diff-view/react'
import { memo, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useDiffSoftWrap } from '@/hooks/useDiffSoftWrap'
import { useDiffViewMode } from '@/hooks/useDiffViewMode'
import { useTranslation } from '@/lib/use-translation'

export function GitDiffViewer(props: {
    filePath: string
    language: string
    oldContent: string
    newContent: string
    diffContent: string
    theme: 'light' | 'dark'
    showToolbar?: boolean
}) {
    const { t } = useTranslation()
    const { softWrap, toggleSoftWrap } = useDiffSoftWrap()
    const { diffViewMode, setDiffViewMode } = useDiffViewMode()

    const showToolbar = props.showToolbar ?? true
    const diffData = useMemo(() => ({
        oldFile: {
            fileName: props.filePath,
            fileLang: props.language,
            content: props.oldContent
        },
        newFile: {
            fileName: props.filePath,
            fileLang: props.language,
            content: props.newContent
        },
        hunks: [props.diffContent]
    }), [props.diffContent, props.filePath, props.language, props.newContent, props.oldContent])

    return (
        <div className="overflow-hidden rounded-xl border border-[var(--social-border)] bg-[var(--social-surface)]">
            {showToolbar ? (
                <div className="flex items-center justify-between gap-2 border-b border-[var(--social-border)] bg-[var(--social-hover)] px-2 py-1">
                    <div className="flex items-center gap-1">
                        <Button
                            variant={diffViewMode === DiffModeEnum.Unified ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => setDiffViewMode(DiffModeEnum.Unified)}
                            aria-pressed={diffViewMode === DiffModeEnum.Unified}
                            title={t('diff.unified.title')}
                        >
                            {t('diff.unified')}
                        </Button>
                        <Button
                            variant={diffViewMode === DiffModeEnum.SplitGitHub ? 'secondary' : 'ghost'}
                            size="sm"
                            onClick={() => setDiffViewMode(DiffModeEnum.SplitGitHub)}
                            aria-pressed={diffViewMode === DiffModeEnum.SplitGitHub}
                            title={t('diff.split.title')}
                        >
                            {t('diff.split')}
                        </Button>
                    </div>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={toggleSoftWrap}
                        aria-pressed={softWrap}
                        title={softWrap ? t('diff.softWrap.disable') : t('diff.softWrap.enable')}
                    >
                        {softWrap ? t('diff.softWrap.on') : t('diff.softWrap.off')}
                    </Button>
                </div>
            ) : null}
            <DiffView
                data={diffData}
                diffViewMode={diffViewMode}
                diffViewTheme={props.theme}
                diffViewHighlight
                diffViewWrap={softWrap}
                diffViewFontSize={12}
            />
        </div>
    )
}

export default memo(GitDiffViewer)
