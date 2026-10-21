import { useCallback, useEffect, useId, useState } from 'react'
import { ApiClient } from '@/api/client'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { Spinner } from '@/components/Spinner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { FormField } from '@/components/ui/FormControls'
import { TextField } from '@/components/ui/TextField'
import { useTranslation } from '@/lib/use-translation'
import type { ServerUrlResult } from '@/hooks/useServerUrl'

type LoginPromptProps = {
    mode?: 'login' | 'bind'
    onLogin?: (token: string) => void
    onBind?: (token: string) => Promise<void>
    baseUrl: string
    serverUrl: string | null
    setServerUrl: (input: string) => ServerUrlResult
    clearServerUrl: () => void
    requireServerUrl?: boolean
    error?: string | null
}

export function LoginPrompt(props: LoginPromptProps) {
    const { t } = useTranslation()
    const serverInputId = useId()
    const isBindMode = props.mode === 'bind'
    const [accessToken, setAccessToken] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isServerDialogOpen, setIsServerDialogOpen] = useState(false)
    const [serverInput, setServerInput] = useState(props.serverUrl ?? '')
    const [serverError, setServerError] = useState<string | null>(null)

    const handleSubmit = useCallback(async (e: React.FormEvent) => {
        e.preventDefault()

        const trimmedToken = accessToken.trim()
        if (!trimmedToken) {
            setError(t('login.error.enterToken'))
            return
        }

        if (!isBindMode && props.requireServerUrl && !props.serverUrl) {
            setServerError(t('login.server.required'))
            setIsServerDialogOpen(true)
            return
        }

        setIsLoading(true)
        setError(null)

        try {
            if (isBindMode) {
                if (!props.onBind) {
                    setError(t('login.error.bindingUnavailable'))
                    return
                }
                await props.onBind(trimmedToken)
            } else {
                // Validate token by attempting to authenticate
                const client = new ApiClient('', { baseUrl: props.baseUrl })
                await client.authenticate({ accessToken: trimmedToken })
                // If successful, pass token to parent
                if (!props.onLogin) {
                    setError(t('login.error.loginUnavailable'))
                    return
                }
                props.onLogin(trimmedToken)
            }
        } catch (e) {
            const fallbackMessage = isBindMode ? t('login.error.bindFailed') : t('login.error.authFailed')
            setError(e instanceof Error ? e.message : fallbackMessage)
        } finally {
            setIsLoading(false)
        }
    }, [accessToken, props, t, isBindMode])

    useEffect(() => {
        if (!isServerDialogOpen) {
            return
        }
        setServerInput(props.serverUrl ?? '')
    }, [isServerDialogOpen, props.serverUrl])

    const handleSaveServer = useCallback((e: React.FormEvent) => {
        e.preventDefault()
        const result = props.setServerUrl(serverInput)
        if (!result.ok) {
            setServerError(result.error)
            return
        }
        setServerError(null)
        setServerInput(result.value)
        setIsServerDialogOpen(false)
    }, [props, serverInput])

    const handleClearServer = useCallback(() => {
        props.clearServerUrl()
        setServerInput('')
        setServerError(null)
        setIsServerDialogOpen(false)
    }, [props])

    const handleServerDialogOpenChange = useCallback((open: boolean) => {
        setIsServerDialogOpen(open)
        if (!open) {
            setServerError(null)
        }
    }, [])

    const displayError = error || props.error
    const serverSummary = props.serverUrl ?? `${props.baseUrl} ${t('login.server.default')}`
    const title = isBindMode ? t('login.bind.title') : t('login.title')
    const subtitle = t('login.subtitle')
    const submitLabel = isBindMode ? t('login.bind.submit') : t('login.submit')

    return (
        <div className="relative h-full flex items-center justify-center p-4">
            {/* Language switcher */}
            <div className="absolute top-4 right-4">
                <LanguageSwitcher />
            </div>

            <div className="w-full max-w-sm space-y-6">
                {/* Header */}
                <div className="text-center space-y-2">
                    <div className="text-title font-semibold text-[var(--social-fg)]">{title}</div>
                    <div className="text-body text-[var(--social-fg-muted)]">
                        {subtitle}
                    </div>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                    <TextField
                        type="password"
                        value={accessToken}
                        onChange={(e) => setAccessToken(e.target.value)}
                        placeholder={t('login.placeholder')}
                        aria-label={t('login.placeholder')}
                        autoComplete="current-password"
                        disabled={isLoading}
                        invalid={Boolean(displayError)}
                    />

                    {displayError && (
                        <div className="text-center text-footnote text-[var(--social-danger)]">
                            {displayError}
                        </div>
                    )}

                    <Button
                        type="submit"
                        disabled={isLoading || !accessToken.trim()}
                        aria-busy={isLoading}
                        className="w-full gap-2"
                    >
                        {isLoading ? (
                            <>
                                <Spinner size="sm" label={null} className="text-[var(--social-primary-fg)]" />
                                {isBindMode ? t('login.bind.submitting') : t('login.submitting')}
                            </>
                        ) : (
                            submitLabel
                        )}
                    </Button>
                </form>

                {/* Help links */}
                {!isBindMode && (
                    <div className="flex items-center justify-between text-footnote text-[var(--social-fg-muted)]">
                        <a href="https://hapi.run/docs" target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline hover:text-[var(--social-fg)]">
                            {t('login.help')}
                        </a>
                        <Dialog open={isServerDialogOpen} onOpenChange={handleServerDialogOpenChange}>
                            <DialogTrigger asChild>
                                <button type="button" className="inline-flex min-h-11 items-center underline hover:text-[var(--social-fg)]">
                                    Hub {props.serverUrl ? `${t('login.server.custom')}` : `${t('login.server.default')}`}
                                </button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md">
                                <DialogHeader>
                                    <DialogTitle>{t('login.server.title')}</DialogTitle>
                                    <DialogDescription>
                                        {t('login.server.description')}
                                    </DialogDescription>
                                </DialogHeader>
                                <form onSubmit={handleSaveServer} className="space-y-4">
                                    <div className="text-caption text-[var(--social-fg-muted)]">
                                        {t('login.server.current')} {serverSummary}
                                    </div>
                                    <FormField label={t('login.server.origin')} htmlFor={serverInputId} hint={t('login.server.hint')}>
                                        <TextField
                                            id={serverInputId}
                                            type="url"
                                            value={serverInput}
                                            onChange={(e) => {
                                                setServerInput(e.target.value)
                                                setServerError(null)
                                            }}
                                            placeholder={t('login.server.placeholder')}
                                            invalid={Boolean(serverError)}
                                        />
                                    </FormField>

                                    {serverError && (
                                        <div className="text-footnote text-[var(--social-danger)]">
                                            {serverError}
                                        </div>
                                    )}

                                    <div className="flex items-center justify-end gap-2">
                                        {props.serverUrl && (
                                            <Button type="button" variant="outline" onClick={handleClearServer}>
                                                {t('login.server.useSameOrigin')}
                                            </Button>
                                        )}
                                        <Button type="submit">
                                            {t('login.server.save')}
                                        </Button>
                                    </div>
                                </form>
                            </DialogContent>
                        </Dialog>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="absolute bottom-4 left-0 right-0 text-center text-caption text-[var(--social-fg-muted)] space-y-1">
                <div>{t('login.footer')} <span className="text-[var(--social-danger)]">♥</span> {t('login.footer.for')}</div>
                <div>{t('login.footer.copyright')} {new Date().getFullYear()} HAQI</div>
            </div>
        </div>
    )
}
