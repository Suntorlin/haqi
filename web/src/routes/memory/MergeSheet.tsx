import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { Button } from '@/components/ui/button'
import { FieldHint } from '@/components/ui/FormControls'
import { ListGroup, ListRow } from '@/components/ui/ListRow'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'
import type { MemoryItem, MemoryMergePreview } from '@/types/api'
import { levelLabel, scopeLabel, statusLabel } from './model'

/** Merging memories: the ones picked, the text AI wrote from all of them (the user can change it), and what stays. */
export function MergeSheet(props: {
    ids: string[]
    all: MemoryItem[]
    busy: boolean
    onMerge: (text: string) => void
    onCancel: () => void
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const preview = useQuery({
        queryKey: [...queryKeys.memories, 'merge-preview', ...props.ids],
        queryFn: async () => {
            if (!api) throw new Error('API unavailable')
            return await api.previewMemoryMerge(props.ids)
        },
        enabled: Boolean(api),
        staleTime: Infinity,
        gcTime: 0,
        retry: false
    })
    const byId = new Map(props.all.map((m) => [m.id, m]))
    const picked = props.ids.map((id) => byId.get(id)).filter((m): m is MemoryItem => Boolean(m))

    return (
        <div className="space-y-5 px-4 pb-6">
            <ListGroup title={t('memoryPage.merge.picked', { count: picked.length })}>
                {picked.map((m) => (
                    <ListRow key={m.id} wrap title={m.text} subtitle={[levelLabel(m.level, t), scopeLabel(m.scope, t), statusLabel(m.status, t)].join(' · ')} />
                ))}
            </ListGroup>
            {preview.isLoading ? (
                <p className="px-1 text-footnote text-[var(--social-fg-muted)]">{t('memoryPage.merge.writing')}</p>
            ) : preview.error || !preview.data ? (
                <p className="px-1 text-footnote text-[var(--social-danger)]">{t('memoryPage.merge.failed', { error: preview.error instanceof Error ? preview.error.message : t('memoryPage.unknownError') })}</p>
            ) : (
                <MergeDraft key={preview.data.text} preview={preview.data} busy={props.busy} onMerge={props.onMerge} onCancel={props.onCancel} />
            )}
        </div>
    )
}

function MergeDraft(props: { preview: MemoryMergePreview; busy: boolean; onMerge: (text: string) => void; onCancel: () => void }) {
    const { t } = useTranslation()
    const { preview } = props
    const [text, setText] = useState(preview.text)
    return (
        <>
            <div className="space-y-2">
                <textarea
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    rows={5}
                    aria-label={t('memoryPage.merge.textLabel')}
                    className={cn(DIALOG_INPUT_CLASS, 'resize-none leading-relaxed')}
                />
                <FieldHint>
                    {preview.rewritten ? t('memoryPage.merge.rewritten') : t('memoryPage.merge.notRewritten')}
                    {' '}
                    {t('memoryPage.merge.result', {
                        level: levelLabel(preview.level, t),
                        scope: scopeLabel(preview.scope, t),
                        status: statusLabel(preview.status, t),
                        count: preview.support
                    })}
                </FieldHint>
            </div>
            <div className="flex gap-2">
                <Button className="flex-1" disabled={props.busy || !text.trim()} onClick={() => props.onMerge(text.trim())}>{t('memoryPage.merge.confirm')}</Button>
                <Button variant="secondary" className="flex-1" disabled={props.busy} onClick={props.onCancel}>{t('memoryPage.merge.cancel')}</Button>
            </div>
        </>
    )
}
