import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { useExperimentalSettings } from '@/hooks/queries/useExperimentalSettings'
import { useSession } from '@/hooks/queries/useSession'
import { LoadingState } from '@/components/LoadingState'
import { queryKeys } from '@/lib/query-keys'
import { normalizePreviewUrlInput } from '@/lib/preview-url'
import { useTranslation } from '@/lib/use-translation'
import { SubPageHeader } from '@/components/mobile/SubPageHeader'
import { CONTEXT_MENU_SURFACE, ContextMenuItem } from '@/components/mobile/ContextMenu'
import { IconButton } from '@/components/ui/IconButton'
import { TextField } from '@/components/ui/TextField'
import { cn } from '@/lib/utils'
import { ChevronDownIcon, ChevronLeftIcon, ClearIcon, ExternalLinkIcon, GlobeIcon, RefreshIcon, SendArrowIcon } from '@/components/mobile/icons'

export default function PreviewPage() {
    const { sessionId } = useParams({ from: '/sessions/$sessionId/preview' })
    return <PreviewPanel sessionId={sessionId} />
}

/** Full page (phones, direct URL) or, with `dockActions`, a side panel next to the chat. */
export function PreviewPanel(props: { sessionId: string; dockActions?: ReactNode }) {
    const { sessionId, dockActions } = props
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

    const barRef = useRef<HTMLDivElement>(null)
    const [historyOpen, setHistoryOpen] = useState(false)

    useEffect(() => {
        if (!historyOpen) return
        const close = (event: PointerEvent) => {
            if (!barRef.current?.contains(event.target as Node)) setHistoryOpen(false)
        }
        document.addEventListener('pointerdown', close)
        return () => document.removeEventListener('pointerdown', close)
    }, [historyOpen])

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
                <SubPageHeader title={t('preview.title')} onBack={dockActions ? undefined : goBack} actions={dockActions} />
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

    const dirty = inputUrl.trim() !== (frameUrl ?? '')

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
            {/* The address bar lives in the header, like a browser tab bar. */}
            <header className="social-bar relative z-20 shrink-0 border-b border-[var(--social-border)] pt-[env(safe-area-inset-top)]">
                <div className="flex h-[54px] items-center gap-2 px-2 lg:h-[60px] lg:pl-3">
                    {dockActions ? null : (
                        <IconButton label={t('button.back')} onClick={goBack}>
                            <ChevronLeftIcon className="h-6 w-6" />
                        </IconButton>
                    )}
                    <div ref={barRef} className="relative min-w-0 flex-1">
                        <TextField
                            variant="pill"
                            type="text"
                            inputMode="url"
                            autoCapitalize="off"
                            autoCorrect="off"
                            spellCheck={false}
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
                            leading={<GlobeIcon className="h-4 w-4" />}
                            trailing={(
                                <>
                                    {historyUrls.length > 0 ? (
                                        <IconButton
                                            size="sm"
                                            label={t('preview.history')}
                                            aria-expanded={historyOpen}
                                            onClick={() => setHistoryOpen((open) => !open)}
                                        >
                                            <ChevronDownIcon className={cn('h-4 w-4 transition-transform duration-150', historyOpen && 'rotate-180')} />
                                        </IconButton>
                                    ) : null}
                                    {inputUrl ? (
                                        <IconButton
                                            size="sm"
                                            label={t('preview.clear')}
                                            disabled={isSaving}
                                            onClick={() => {
                                                if (dirty) {
                                                    setInputUrl('')
                                                } else {
                                                    void clearPreview()
                                                }
                                            }}
                                        >
                                            <ClearIcon className="h-4 w-4" />
                                        </IconButton>
                                    ) : null}
                                    {dirty ? (
                                        <IconButton
                                            size="sm"
                                            variant="filled"
                                            label={isSaving ? t('preview.saving') : t('preview.go')}
                                            disabled={isSaving || !inputUrl.trim()}
                                            onClick={() => void openPreview(inputUrl)}
                                        >
                                            <SendArrowIcon className="h-4 w-4" />
                                        </IconButton>
                                    ) : (
                                        <IconButton
                                            size="sm"
                                            label={t('preview.reload')}
                                            disabled={!frameUrl}
                                            onClick={() => setFrameKey((key) => key + 1)}
                                        >
                                            <RefreshIcon className="h-4 w-4" />
                                        </IconButton>
                                    )}
                                </>
                            )}
                        />
                        {historyOpen && historyUrls.length > 0 ? (
                            <div className={cn('absolute left-0 right-0 top-full z-10 mt-1 max-h-[260px] overflow-y-auto', CONTEXT_MENU_SURFACE)}>
                                {historyUrls.slice(0, 10).map((url) => (
                                    <ContextMenuItem
                                        key={url}
                                        label={url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                                        onSelect={() => {
                                            setHistoryOpen(false)
                                            setInputUrl(url)
                                            void openPreview(url)
                                        }}
                                    />
                                ))}
                            </div>
                        ) : null}
                    </div>
                    {frameUrl ? (
                        <IconButton
                            size="sm"
                            label={`${t('preview.open')} · ${t('preview.embedHint')}`}
                            onClick={() => window.open(frameUrl, '_blank', 'noreferrer')}
                        >
                            <ExternalLinkIcon className="h-[18px] w-[18px]" />
                        </IconButton>
                    ) : null}
                    {dockActions}
                </div>
            </header>

            {formError ? <div className="px-4 pt-2 text-[13px] text-[var(--social-danger)]">{formError}</div> : null}
            {error ? <div className="px-4 pt-2 text-[13px] text-[var(--social-danger)]">{error}</div> : null}

            <div className={cn('min-h-0 flex-1', frameUrl ? 'bg-white' : 'bg-[var(--app-bg)]')}>
                {frameUrl ? (
                    <iframe
                        key={`${frameKey}:${frameUrl}`}
                        src={frameUrl}
                        title={t('preview.title')}
                        className="h-full w-full border-0"
                        style={{ colorScheme: 'light' }}
                    />
                ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                        <GlobeIcon className="h-8 w-8 text-[var(--social-fg-subtle)]" />
                        <div className="text-[13px] text-[var(--social-fg-muted)]">{t('preview.empty')}</div>
                    </div>
                )}
            </div>
        </div>
    )
}
