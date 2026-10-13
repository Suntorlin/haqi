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
                throw new Error('API unavailable')
            }
            return await api.getPreviewUrlHistory(20)
        },
        enabled: Boolean(api && experimentalSettings.previewEnabled),
        staleTime: 30_000
    })

    const historyUrls = historyQuery.data?.urls ?? []

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

    useEffect(() => {
        const next = session?.previewUrl ?? ''
        setInputUrl(next)
        setFrameUrl(next || null)
    }, [session?.id, session?.previewUrl])

    const sessionTitle = useMemo(() => {
        if (session?.metadata?.name) return session.metadata.name
        if (session?.metadata?.path) {
            const parts = session.metadata.path.split('/').filter(Boolean)
            return parts[parts.length - 1] || 'Preview'
        }
        return 'Preview'
    }, [session])

    const invalidatePreviewData = useCallback(async () => {
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        await queryClient.invalidateQueries({ queryKey: queryKeys.previewUrlHistory })
    }, [queryClient, sessionId])

    const openPreview = useCallback(async (raw: string) => {
        if (!api) {
            setFormError('API unavailable')
            return
        }

        const normalized = normalizePreviewUrlInput(raw)
        if (normalized.error) {
            setFormError(normalized.error)
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
            setFormError(e instanceof Error ? e.message : 'Failed to update preview URL')
        } finally {
            setIsSaving(false)
        }
    }, [api, invalidatePreviewData, sessionId])

    const clearPreview = useCallback(async () => {
        if (!api) {
            setFormError('API unavailable')
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
            setFormError(e instanceof Error ? e.message : 'Failed to clear preview URL')
        } finally {
            setIsSaving(false)
        }
    }, [api, invalidatePreviewData, sessionId])

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

            <div className="mx-auto flex w-full max-w-content flex-1 min-h-0 flex-col gap-3 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                <div className="rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3">
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
                            className="min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                        />
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => void openPreview(inputUrl)}
                                disabled={isSaving}
                                className="rounded-md bg-[var(--app-button)] px-3 py-2 text-sm font-medium text-[var(--app-button-text)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                {isSaving ? 'Saving…' : 'Load'}
                            </button>
                            <button
                                type="button"
                                onClick={() => setFrameKey((key) => key + 1)}
                                disabled={!frameUrl}
                                className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)] disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                Reload
                            </button>
                            <button
                                type="button"
                                onClick={() => void clearPreview()}
                                disabled={isSaving}
                                className="rounded-md border border-[var(--app-border)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                            >
                                Clear
                            </button>
                        </div>
                    </div>

                    {historyUrls.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                            {historyUrls.slice(0, 10).map((url) => (
                                <button
                                    key={url}
                                    type="button"
                                    onClick={() => {
                                        setInputUrl(url)
                                        void openPreview(url)
                                    }}
                                    className="max-w-full truncate rounded bg-[var(--app-subtle-bg)] px-2 py-1 text-left text-xs text-[var(--app-fg)] transition-colors hover:bg-[var(--app-bg)]"
                                    title={url}
                                >
                                    {url}
                                </button>
                            ))}
                        </div>
                    ) : null}

                    {formError ? (
                        <div className="mt-2 text-sm text-red-600">{formError}</div>
                    ) : null}
                    {error ? (
                        <div className="mt-2 text-sm text-red-600">{error}</div>
                    ) : null}
                    <div className="mt-2 text-xs text-[var(--app-hint)]">
                        Some sites block embedding with iframe headers (X-Frame-Options/CSP).
                    </div>
                </div>

                <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-[var(--app-border)] bg-white">
                    {frameUrl ? (
                        <iframe
                            key={`${frameKey}:${frameUrl}`}
                            src={frameUrl}
                            title={`Session preview ${sessionId}`}
                            className="h-full w-full border-0"
                        />
                    ) : (
                        <div className="flex h-full items-center justify-center p-4 text-sm text-[var(--app-hint)]">
                            Enter a URL and click Load to open the preview.
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
