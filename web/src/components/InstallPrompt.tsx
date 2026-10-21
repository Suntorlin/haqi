import { useState } from 'react'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { usePlatform } from '@/hooks/usePlatform'
import { CloseIcon, ShareIcon, PlusCircleIcon } from '@/components/mobile/icons'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/IconButton'
import { BottomSheet } from '@/components/mobile/BottomSheet'
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
        // The banner hides while the guide is open, as before.
        if (showIOSGuide) {
            return (
                <BottomSheet open onOpenChange={setShowIOSGuide} title={t('install.title')}>
                    <div className="space-y-3 px-5 pb-2 pt-2">
                        <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--social-primary)] text-footnote font-semibold text-[var(--social-primary-fg)]">
                                1
                            </div>
                            <p className="flex-1 pt-1 text-body text-[var(--social-fg)]">
                                {t('install.ios.share.before')} <ShareIcon className="inline h-5 w-5 align-text-bottom" /> {t('install.ios.share.after')}
                            </p>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--social-primary)] text-footnote font-semibold text-[var(--social-primary-fg)]">
                                2
                            </div>
                            <p className="flex-1 pt-1 text-body text-[var(--social-fg)]">
                                {t('install.ios.add.before')} <PlusCircleIcon className="inline h-5 w-5 align-text-bottom" /> <strong className="font-semibold">{t('install.ios.add.label')}</strong>
                            </p>
                        </div>
                        <div className="flex items-start gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--social-primary)] text-footnote font-semibold text-[var(--social-primary-fg)]">
                                3
                            </div>
                            <p className="flex-1 pt-1 text-body text-[var(--social-fg)]">
                                {t('install.ios.confirm.before')} <strong className="font-semibold">{t('install.ios.confirm.label')}</strong> {t('install.ios.confirm.after')}
                            </p>
                        </div>
                    </div>
                    <div className="px-5 pb-4 pt-2">
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
                </BottomSheet>
            )
        }

        return (
            <div className="fixed bottom-4 left-4 right-4 bg-[var(--social-surface)] border border-[var(--social-border)] rounded-2xl p-4 shadow-[var(--shadow-float)] z-50">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                        <p className="text-body font-semibold text-[var(--social-fg)]">
                            {t('install.title')}
                        </p>
                        <p className="text-caption text-[var(--social-fg-muted)] mt-0.5">
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
                        label={t('button.dismiss')}
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
        <div className="fixed bottom-4 left-4 right-4 bg-[var(--social-surface)] border border-[var(--social-border)] rounded-2xl p-4 shadow-[var(--shadow-float)] z-50">
            <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                    <p className="text-body font-semibold text-[var(--social-fg)]">
                        {t('install.title')}
                    </p>
                    <p className="text-caption text-[var(--social-fg-muted)] mt-0.5">
                        {t('install.description')}
                    </p>
                </div>
                <Button onClick={handleInstall}>
                    {t('install.button')}
                </Button>
                <IconButton
                    label={t('button.dismiss')}
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
