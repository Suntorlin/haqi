import { useState } from 'react'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { usePlatform } from '@/hooks/usePlatform'
import { CloseIcon, ShareIcon, PlusCircleIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { useTranslation } from '@/lib/use-translation'

export function InstallPrompt() {
    const { t } = useTranslation()
    const { canInstall, canInstallIOS, promptInstall, dismissInstall, isStandalone } = usePWAInstall()
    const { isTelegram, haptic } = usePlatform()
    const [showIOSGuide, setShowIOSGuide] = useState(false)

    if (isTelegram || isStandalone) {
        return null
    }

    // iOS Safari install guide
    if (canInstallIOS) {
        if (showIOSGuide) {
            return (
                <div className="fixed inset-0 bg-black/50 z-50 flex items-end justify-center">
                    <div className="w-full max-w-lg bg-[var(--app-bg)] rounded-t-2xl p-5 pb-8 space-y-4 animate-slide-up">
                        <div className="flex items-center justify-between">
                            <h3 className="text-[16px] font-semibold text-[var(--social-fg)]">
                                {t('install.title')}
                            </h3>
                            <IconButton label="Close" className="-mr-2" onClick={() => setShowIOSGuide(false)}>
                                <CloseIcon className="w-5 h-5" />
                            </IconButton>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-start gap-3">
                                <div className="shrink-0 w-8 h-8 rounded-full bg-[var(--social-primary)] text-[var(--social-primary-fg)] flex items-center justify-center text-[13px] font-semibold">
                                    1
                                </div>
                                <div className="flex-1 pt-1">
                                    <p className="text-[15px] text-[var(--social-fg)]">
                                        Tap the <ShareIcon className="inline w-5 h-5 align-text-bottom" /> Share button in the toolbar
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="shrink-0 w-8 h-8 rounded-full bg-[var(--social-primary)] text-[var(--social-primary-fg)] flex items-center justify-center text-[13px] font-semibold">
                                    2
                                </div>
                                <div className="flex-1 pt-1">
                                    <p className="text-[15px] text-[var(--social-fg)]">
                                        Scroll down and tap <PlusCircleIcon className="inline w-5 h-5 align-text-bottom" /> <strong className="font-semibold">Add to Home Screen</strong>
                                    </p>
                                </div>
                            </div>

                            <div className="flex items-start gap-3">
                                <div className="shrink-0 w-8 h-8 rounded-full bg-[var(--social-primary)] text-[var(--social-primary-fg)] flex items-center justify-center text-[13px] font-semibold">
                                    3
                                </div>
                                <div className="flex-1 pt-1">
                                    <p className="text-[15px] text-[var(--social-fg)]">
                                        Tap <strong className="font-semibold">Add</strong> in the top right corner
                                    </p>
                                </div>
                            </div>
                        </div>

                        <Button
                            variant="ghost"
                            className="w-full"
                            onClick={() => {
                                setShowIOSGuide(false)
                                dismissInstall()
                            }}
                        >
                            {t('button.dismiss')}
                        </Button>
                    </div>
                </div>
            )
        }

        return (
            <div className="fixed bottom-4 left-4 right-4 bg-[var(--app-bg)] border border-[var(--social-border)] rounded-2xl p-4 shadow-lg z-50">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-semibold text-[var(--social-fg)]">
                            {t('install.title')}
                        </p>
                        <p className="text-[12px] text-[var(--social-fg-muted)] mt-0.5">
                            {t('install.description')}
                        </p>
                    </div>
                    <Button
                        onClick={() => {
                            haptic.impact('light')
                            setShowIOSGuide(true)
                        }}
                    >
                        {t('install.button')}
                    </Button>
                    <IconButton
                        label="Dismiss"
                        onClick={() => {
                            haptic.impact('light')
                            dismissInstall()
                        }}
                    >
                        <CloseIcon className="w-4 h-4" />
                    </IconButton>
                </div>
            </div>
        )
    }

    // Chrome/Edge install prompt
    if (!canInstall) {
        return null
    }

    const handleInstall = async () => {
        haptic.impact('light')
        const success = await promptInstall()
        if (success) {
            haptic.notification('success')
        }
    }

    return (
        <div className="fixed bottom-4 left-4 right-4 bg-[var(--app-bg)] border border-[var(--social-border)] rounded-2xl p-4 shadow-lg z-50">
            <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-semibold text-[var(--social-fg)]">
                        {t('install.title')}
                    </p>
                    <p className="text-[12px] text-[var(--social-fg-muted)] mt-0.5">
                        {t('install.description')}
                    </p>
                </div>
                <Button onClick={handleInstall}>
                    {t('install.button')}
                </Button>
                <IconButton
                    label="Dismiss"
                    onClick={() => {
                        haptic.impact('light')
                        dismissInstall()
                    }}
                >
                    <CloseIcon className="w-4 h-4" />
                </IconButton>
            </div>
        </div>
    )
}
