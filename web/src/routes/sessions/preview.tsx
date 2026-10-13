import { useCallback, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useExperimentalSettings } from '@/hooks/queries/useExperimentalSettings'
import { useSession } from '@/hooks/queries/useSession'
import { LoadingState } from '@/components/LoadingState'
import { queryKeys } from '@/lib/query-keys'
import { normalizePreviewUrlInput } from '@/lib/preview-url'
import { useTranslation } from '@/lib/use-translation'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'
import { DIALOG_INPUT_CLASS } from '@/components/RenameSessionDialog'
import { Button } from '@/components/ui/button'
import { FieldHint, SuggestionChip } from '@/components/ui/FormControls'

export default function PreviewPage() {
    const { sessionId } = useParams({ from: '/sessions/$sessionId/preview' })
    const { api } = useAppContext()
    const goBack = useAppGoBack()
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const { settings: experimentalSettings, isLoading: experimentalSettingsLoading } = useExperimentalSettings(api, true)
    const { session, isLoading, error } = useSession(api, sessionId)
    const [inputUrl, setInputUrl] = useState('')
    const [frameUrl, setFrameUrl] = useState<string | null>(null)
    const [formError, setFormError] = useState<string | null>(null)
    const [isSaving, setIsSaving] = useState(false)
    const [frameKey, setFrameKey] = useState(0)

    const historyQuery = useQuery({
        queryKey: queryKeys.previewUrlHistory,
        queryFn: async () => {
            if (!api) {
                throw new Error(t('preview.error.api'))
            }
            return await api.getPreviewUrlHistory(20)
        },
        enabled: Boolean(api && experimentalSettings.previewEnabled),
        staleTime: 30_000
    })

    const historyUrls = historyQuery.data?.urls ?? []

    useEffect(() => {
        const next = session?.previewUrl ?? ''
        setInputUrl(next)
        setFrameUrl(next || null)
    }, [session?.id, session?.previewUrl])

    const sessionTitle = useMemo(() => {
        if (session?.metadata?.name) return session.metadata.name
        if (session?.metadata?.path) {
            const parts = session.metadata.path.split('/').filter(Boolean)
            return parts[parts.length - 1] || t('preview.title')
        }
        return t('preview.title')
    }, [session, t])

    const invalidatePreviewData = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        await queryClient.invalidateQueries({ queryKey: queryKeys.previewUrlHistory })
    }, [queryClient, sessionId])

    const openPreview = useCallback(async (raw: string) => {
        if (!api) {
            setFormError(t('preview.error.api'))
            return
        }

        const normalized = normalizePreviewUrlInput(raw)
        if (normalized.error) {
            setFormError(t(`preview.error.${normalized.error}`))
            return
        }

        setFormError(null)
        setIsSaving(true)
        try {
            const result = await api.setSessionPreviewUrl(sessionId, normalized.value)
            setInputUrl(result.previewUrl ?? '')
            setFrameUrl(result.previewUrl)
            setFrameKey((key) => key + 1)
            await invalidatePreviewData()
        } catch (e) {
            setFormError(e instanceof Error ? e.message : t('preview.error.save'))
        } finally {
            setIsSaving(false)
        }
    }, [api, invalidatePreviewData, sessionId, t])

    const clearPreview = useCallback(async () => {
        if (!api) {
            setFormError(t('preview.error.api'))
            return
        }

        setFormError(null)
        setIsSaving(true)
        try {
            await api.setSessionPreviewUrl(sessionId, null)
            setInputUrl('')
            setFrameUrl(null)
            setFrameKey((key) => key + 1)
            await invalidatePreviewData()
        } catch (e) {
            setFormError(e instanceof Error ? e.message : t('preview.error.clear'))
        } finally {
            setIsSaving(false)
        }
    }, [api, invalidatePreviewData, sessionId, t])

    // Early returns stay below every hook: settings load after the first render.
    if (experimentalSettingsLoading) {
        return (
            <div className="flex h-full items-center justify-center text-sm text-[var(--app-hint)]">
                <LoadingState label={t('preview.loading')} className="text-sm" />
            </div>
        )
    }

    if (!experimentalSettings.previewEnabled) {
        return (
            <div className="flex h-full flex-col bg-[var(--app-bg)]">
                <SubPageHeader title={t('preview.title')} onBack={goBack} />
                <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--app-hint)]">
                    {t('preview.disabled')}
                </div>
            </div>
        )
    }

    if (isLoading && !session) {
        return (
            <div className="flex h-full items-center justify-center p-4">
                <LoadingState label={t('preview.loading')} className="text-sm" />
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
            <SubPageHeader
                title={t('preview.title')}
                subtitle={sessionTitle}
                onBack={goBack}
                actions={frameUrl ? (
                    <a
                        href={frameUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-[var(--social-border)] px-3 py-1.5 text-[13px] text-[var(--social-fg)] transition-colors hover:bg-[var(--social-muted)]"
                    >
                        {t('preview.open')}
                    </a>
                ) : undefined}
            />

            <div className="mx-auto flex w-full max-w-content flex-1 min-h-0 flex-col gap-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
                <div className="flex flex-col gap-2">
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                            type="text"
                            value={inputUrl}
                            onChange={(event) => setInputUrl(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    void openPreview(inputUrl)
                                }
                            }}
                            placeholder="http://localhost:3000"
                            aria-label={t('newSession.previewUrl')}
                            className={`${DIALOG_INPUT_CLASS} min-w-0 flex-1`}
                        />
                        <div className="flex items-center gap-2">
                            <Button type="button" className="h-10" onClick={() => void openPreview(inputUrl)} disabled={isSaving}>
                                {isSaving ? t('preview.saving') : t('preview.load')}
                            </Button>
                            <Button type="button" variant="secondary" className="h-10" onClick={() => setFrameKey((key) => key + 1)} disabled={!frameUrl}>
                                {t('preview.reload')}
                            </Button>
                            <Button type="button" variant="secondary" className="h-10" onClick={() => void clearPreview()} disabled={isSaving}>
                                {t('preview.clear')}
                            </Button>
                        </div>
                    </div>

                    {historyUrls.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                            {historyUrls.slice(0, 10).map((url) => (
                                <SuggestionChip
                                    key={url}
                                    label={url}
                                    onClick={() => {
                                        setInputUrl(url)
                                        void openPreview(url)
                                    }}
                                />
                            ))}
                        </div>
                    ) : null}

                    {formError ? <div className="px-1 text-[13px] text-[var(--social-danger)]">{formError}</div> : null}
                    {error ? <div className="px-1 text-[13px] text-[var(--social-danger)]">{error}</div> : null}
                    <FieldHint>{t('preview.embedHint')}</FieldHint>
                </div>

                <div className={`min-h-0 flex-1 overflow-hidden rounded-2xl border border-[var(--social-border)] ${frameUrl ? 'bg-white' : 'bg-[var(--app-bg)]'}`}>
                    {frameUrl ? (
                        <iframe
                            key={`${frameKey}:${frameUrl}`}
                            src={frameUrl}
                            title={t('preview.title')}
                            className="h-full w-full border-0"
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center p-6 text-center text-[14px] text-[var(--social-fg-muted)]">
                            {t('preview.empty')}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
